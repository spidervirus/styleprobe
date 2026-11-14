import { NextRequest, NextResponse } from 'next/server';
import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateAndResolveUrl } from '@/lib/security';

extend([a11yPlugin]);

function cleanColor(raw: string): string | null {
  if (!raw || raw === 'transparent' || raw === 'inherit' || raw === 'initial') return null;
  const c = colord(raw);
  if (!c.isValid()) return null;
  if (c.alpha() < 0.1) return null;
  return c.toHex();
}

function colorDistance(hexA: string, hexB: string): number {
  const rgbA = colord(hexA).toRgb();
  const rgbB = colord(hexB).toRgb();
  const dr = (rgbA.r - rgbB.r) / 255;
  const dg = (rgbA.g - rgbB.g) / 255;
  const db = (rgbA.b - rgbB.b) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function toShadcnHsl(hex: string): string {
  const hsl = colord(hex).toHsl();
  return `${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`;
}

// Complete browser header profile to avoid WAF / bot-block 400 errors
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB maximum page size
const MAX_REDIRECTS = 5;

/**
 * Safely fetches a URL by following redirects manually and validating each redirect target
 * against SSRF, internal IPs, and metadata endpoints.
 */
async function safeFetchWithRedirects(initialUrl: string): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  let redirects = 0;

  while (redirects <= MAX_REDIRECTS) {
    // 1. SSRF & DNS rebinding validation on EVERY destination
    const sec = await validateAndResolveUrl(currentUrl);
    if (!sec.safe) {
      throw new Error(`SSRF Blocked: ${sec.reason || 'Target is in a private or restricted network'}`);
    }

    // 2. Fetch with manual redirect and 10s request timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        headers: BROWSER_HEADERS,
        redirect: 'manual',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Check for HTTP redirect status codes
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response (${res.status}) missing Location header`);
      }

      redirects++;
      if (redirects > MAX_REDIRECTS) {
        throw new Error(`Too many redirects (exceeded limit of ${MAX_REDIRECTS})`);
      }

      // Resolve relative or absolute redirect destination
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    // Check content-length header if provided
    const cl = res.headers.get('content-length');
    if (cl && parseInt(cl, 10) > MAX_HTML_SIZE_BYTES) {
      throw new Error(`Response size (${(parseInt(cl, 10) / 1024 / 1024).toFixed(1)} MB) exceeds maximum limit of 5 MB`);
    }

    return { response: res, finalUrl: currentUrl };
  }

  throw new Error('Redirect loop detected');
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. RATE LIMITING ──────────────────────────────────────────
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                     req.headers.get('x-real-ip') ||
                     '127.0.0.1';

    const rateLimit = checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded (max 10 requests/minute). Please wait before trying again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateLimit.resetMs / 1000)),
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': '0'
          }
        }
      );
    }

    // ── 2. INPUT VALIDATION & INITIAL SSRF CHECK ─────────────────
    const body = await req.json().catch(() => ({}));
    const rawUrl = body.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return NextResponse.json({ error: 'A valid URL is required' }, { status: 400 });
    }

    const precheck = await validateAndResolveUrl(rawUrl);
    if (!precheck.safe) {
      return NextResponse.json({ error: precheck.reason || 'Invalid or prohibited URL' }, { status: 400 });
    }

    const target = precheck.normalizedUrl!;

    // ── 3. SAFE REDIRECT FETCH & RESOURCE LIMITS ─────────────────
    let fetchResult: { response: Response; finalUrl: string };
    try {
      fetchResult = await safeFetchWithRedirects(target);
    } catch (fetchErr: any) {
      // If apex domain failed with 400, try www. variant safely
      try {
        const u = new URL(target);
        if (!u.hostname.startsWith('www.')) {
          u.hostname = `www.${u.hostname}`;
          fetchResult = await safeFetchWithRedirects(u.toString());
        } else {
          throw fetchErr;
        }
      } catch {
        return NextResponse.json({ error: fetchErr.message || 'Could not connect to target' }, { status: 400 });
      }
    }

    const response = fetchResult.response;
    if (!response.ok) {
      return NextResponse.json({ error: `Could not reach ${target} (HTTP ${response.status})` }, { status: 400 });
    }

    // Stream text with hard size cap
    const text = await response.text();
    if (text.length > MAX_HTML_SIZE_BYTES) {
      return NextResponse.json({ error: 'Response body exceeds the 5 MB limit' }, { status: 400 });
    }

    const html = text;

    // Extract Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : new URL(fetchResult.finalUrl).hostname;

    // Fast heuristic extraction of CSS colors (hex, rgb, hsl)
    const colorHexMatches = html.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) || [];
    const rgbMatches = html.match(/rgba?\([^)]+\)/g) || [];
    
    const colorCounts: Record<string, number> = {};
    const registerColor = (raw: string) => {
      const hex = cleanColor(raw);
      if (hex) {
        colorCounts[hex] = (colorCounts[hex] || 0) + 1;
      }
    };

    colorHexMatches.forEach(registerColor);
    rgbMatches.forEach(registerColor);

    // Color clustering
    const sorted = Object.entries(colorCounts)
      .map(([hex, count]) => ({ hex, count, luminance: colord(hex).luminance() }))
      .sort((a, b) => b.count - a.count);

    const deduped: Array<{ hex: string; count: number; luminance: number }> = [];
    for (const item of sorted) {
      const exists = deduped.find(d => colorDistance(d.hex, item.hex) < 0.08);
      if (exists) {
        exists.count += item.count;
      } else {
        deduped.push({ ...item });
      }
    }

    const bg = deduped[0]?.hex || '#ffffff';
    const bgLuminance = colord(bg).luminance();
    const themeMode = bgLuminance < 0.2 ? 'dark' : 'light';

    const surfaceCandidates = deduped.filter(c =>
      themeMode === 'dark'
        ? c.luminance > bgLuminance && c.luminance < 0.35
        : c.luminance < bgLuminance && c.luminance > 0.85
    );
    const surface = surfaceCandidates[0]?.hex || (themeMode === 'dark' ? '#18181b' : '#f4f4f5');

    const highContrast = deduped.filter(c => colord(c.hex).contrast(bg) >= 4.5);
    const textPrimary = highContrast[0]?.hex || (themeMode === 'dark' ? '#ffffff' : '#000000');

    const secondaryCandidates = deduped.filter(c => {
      const contrast = colord(c.hex).contrast(bg);
      return contrast >= 2.5 && contrast <= 6.0 && c.hex !== textPrimary;
    });
    const textSecondary = secondaryCandidates[0]?.hex || (themeMode === 'dark' ? '#a1a1aa' : '#71717a');

    const borderCandidates = deduped.filter(c => {
      const contrast = colord(c.hex).contrast(bg);
      return contrast >= 1.2 && contrast <= 2.8;
    });
    const border = borderCandidates[0]?.hex || (themeMode === 'dark' ? '#27272a' : '#e4e4e7');

    const vibrantCandidates = deduped.filter(c => {
      const hsl = colord(c.hex).toHsl();
      return hsl.s > 35 && hsl.l > 15 && hsl.l < 85;
    });
    const primary = vibrantCandidates[0]?.hex || (themeMode === 'dark' ? '#3b82f6' : '#1877f2');

    // Extract font families from style tags
    const fontMatches = html.match(/font-family:\s*([^;}]+)/gi) || [];
    const fontSet = new Set<string>();
    fontMatches.forEach(f => {
      const val = f.replace(/font-family:\s*/i, '').split(',')[0].replace(/['"]/g, '').trim();
      if (val && !val.includes('var(') && val.length < 25) {
        fontSet.add(val);
      }
    });
    const fontFamilies = Array.from(fontSet).slice(0, 4);

    const tokens = {
      title,
      url: fetchResult.finalUrl,
      themeMode,
      colors: {
        background: bg,
        surface,
        primary,
        textPrimary,
        textSecondary,
        border,
        palette: deduped.slice(0, 10).map(d => d.hex)
      },
      typography: {
        fonts: fontFamilies.length ? fontFamilies : ['system-ui', 'sans-serif']
      }
    };

    const isDark = themeMode === 'dark';
    const markdown = `# Design Guidelines for ${title}

> Extracted from [${fetchResult.finalUrl}](${fetchResult.finalUrl})
> Visual DNA for AI Coding Agents

## 1. Visual Theme
- **Theme Mode**: \`${themeMode.toUpperCase()}\`
- **Primary Accent**: \`${primary}\`
- **Background**: \`${bg}\`
- **Surface**: \`${surface}\`
- **Text Primary**: \`${textPrimary}\`
- **Text Muted**: \`${textSecondary}\`
- **Border**: \`${border}\`

## 2. Color Palette
| Role | Hex |
|---|---|
| Background | \`${bg}\` |
| Surface | \`${surface}\` |
| Primary Accent | \`${primary}\` |
| Text Primary | \`${textPrimary}\` |
| Text Muted | \`${textSecondary}\` |
| Border | \`${border}\` |

## 3. Typography
- **Fonts**: ${tokens.typography.fonts.map(f => `\`${f}\``).join(', ')}
`;

    const shadcnCss = `/* shadcn/ui globals.css - Generated by styleprobe */
@layer base {
  :root {
    --background: ${toShadcnHsl(bg)};
    --foreground: ${toShadcnHsl(textPrimary)};
    --card: ${toShadcnHsl(surface)};
    --card-foreground: ${toShadcnHsl(textPrimary)};
    --primary: ${toShadcnHsl(primary)};
    --primary-foreground: ${toShadcnHsl(isDark ? '#000000' : '#ffffff')};
    --secondary: ${toShadcnHsl(surface)};
    --secondary-foreground: ${toShadcnHsl(textPrimary)};
    --muted: ${toShadcnHsl(surface)};
    --muted-foreground: ${toShadcnHsl(textSecondary)};
    --accent: ${toShadcnHsl(primary)};
    --accent-foreground: ${toShadcnHsl(isDark ? '#000000' : '#ffffff')};
    --border: ${toShadcnHsl(border)};
    --input: ${toShadcnHsl(border)};
    --ring: ${toShadcnHsl(primary)};
    --radius: 0.5rem;
  }
}
`;

    const tailwindV4 = `/* Tailwind v4 @theme - Generated by styleprobe */
@import "tailwindcss";

@theme {
  --color-background: ${bg};
  --color-surface: ${surface};
  --color-primary: ${primary};
  --color-text-primary: ${textPrimary};
  --color-text-secondary: ${textSecondary};
  --color-border: ${border};
  --font-sans: "${tokens.typography.fonts[0]}", sans-serif;
}
`;

    return NextResponse.json({
      tokens,
      formats: {
        markdown,
        shadcn: shadcnCss,
        tailwindV4
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to probe site' }, { status: 500 });
  }
}
