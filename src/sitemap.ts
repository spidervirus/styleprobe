import { validateAndResolveUrl } from './security.js';

const SITEMAP_CANDIDATES = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml'
];

const EXCLUDED_EXTENSIONS = /\.(pdf|zip|tar|gz|exe|dmg|iso|png|jpe?g|gif|svg|webp|ico|mp4|webm|mp3|wav|csv|docx?|xlsx?|pptx?|css|js|json|xml|rss|woff2?|ttf|eot)$/i;
const EXCLUDED_PATHS = /\/(login|signin|logout|signout|signup|register|auth|cart|checkout|privacy|terms|legal|cookie-policy|cookies|gdpr|wp-admin|wp-content|api|cdn-cgi)\b/i;

const HIGH_VALUE_PATHS = /\/(components|design|docs|documentation|ui|elements|buttons|theme|tokens|styles|patterns)\b/i;
const MID_VALUE_PATHS  = /\/(features|product|pricing|about|showcase|templates|examples|overview)\b/i;

function scoreUrl(path: string): number {
  if (HIGH_VALUE_PATHS.test(path)) return 10;
  if (MID_VALUE_PATHS.test(path)) return 5;
  return 1;
}

/**
 * Extracts <loc>...</loc> URLs from XML sitemap contents.
 */
function extractLocUrls(xml: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>(https?:\/\/[^<]+)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Fetches and parses sitemaps for the given origin.
 * Enforces same-origin, SSRF protection, extension exclusion, and design relevance scoring.
 */
export async function discoverSitemapUrls(originUrl: string, maxEntries = 15): Promise<string[]> {
  const discovered: string[] = [];

  try {
    const origin = new URL(originUrl).origin;

    for (const path of SITEMAP_CANDIDATES) {
      const sitemapUrl = `${origin}${path}`;
      const sec = await validateAndResolveUrl(sitemapUrl);
      if (!sec.safe) continue;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      let text = '';
      try {
        const res = await fetch(sitemapUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'styleprobe/1.0 (+https://github.com/spidervirus/styleprobe)',
            'Accept': 'application/xml, text/xml, */*'
          }
        });
        if (res.ok) {
          text = await res.text();
        }
      } catch {
        // Continue to next candidate if fetch fails or times out
      } finally {
        clearTimeout(timeoutId);
      }

      if (!text || text.indexOf('<loc>') === -1) continue;

      let locs = extractLocUrls(text);

      // If this is a sitemapindex, inspect the first child sitemap
      if (text.indexOf('<sitemapindex') !== -1) {
        const childSitemaps = locs.slice(0, 2);
        for (const childUrl of childSitemaps) {
          const childSec = await validateAndResolveUrl(childUrl);
          if (!childSec.safe) continue;

          const childCtrl = new AbortController();
          const childTimeout = setTimeout(() => childCtrl.abort(), 4000);
          try {
            const childRes = await fetch(childUrl, {
              signal: childCtrl.signal,
              headers: { 'Accept': 'application/xml, text/xml, */*' }
            });
            if (childRes.ok) {
              const childText = await childRes.text();
              const childLocs = extractLocUrls(childText);
              locs = locs.concat(childLocs);
            }
          } catch {} finally {
            clearTimeout(childTimeout);
          }
        }
      }

      // Filter and score URLs
      const scored: Array<{ url: string; score: number }> = [];
      for (const loc of locs) {
        try {
          const u = new URL(loc);
          if (u.origin !== origin) continue;
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;

          const pathname = u.pathname;
          if (EXCLUDED_EXTENSIONS.test(pathname) || EXCLUDED_PATHS.test(pathname)) continue;

          scored.push({ url: u.toString(), score: scoreUrl(pathname) });
        } catch {}
      }

      // Sort by score descending and take top candidates
      scored.sort((a, b) => b.score - a.score);
      for (const item of scored) {
        if (!discovered.includes(item.url)) {
          discovered.push(item.url);
          if (discovered.length >= maxEntries) break;
        }
      }

      if (discovered.length > 0) break; // Found a valid sitemap, no need to check other candidates
    }
  } catch {}

  return discovered;
}
