import { chromium, Page } from 'playwright';
import { cleanColor, normalizeCssVarValue, dedupeColors } from './analyzer.js';
import { DesignTokens, TypographyToken, ComponentSample, ExtractedAsset, ThemePalette } from './types.js';

// Deterministic in-DOM style extractor
const EVAL_SCRIPT = `
(function() {
  function getComputed(el, prop) {
    if (!el) return null;
    return window.getComputedStyle(el).getPropertyValue(prop);
  }

  // 1. DETERMINISTIC CSS CUSTOM PROPERTIES & THEME EXTRACTION
  var lightVars = {};
  var darkVars = {};

  for (var s = 0; s < document.styleSheets.length; s++) {
    try {
      var sheet = document.styleSheets[s];
      var rules = sheet.cssRules || [];
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (rule instanceof CSSStyleRule) {
          var sel = rule.selectorText || '';
          var isDark = sel.indexOf('.dark') !== -1 || sel.indexOf('[data-theme="dark"]') !== -1 || sel.indexOf('[data-mode="dark"]') !== -1;
          var isLight = sel === ':root' || sel === 'html' || sel.indexOf('.light') !== -1 || sel.indexOf('[data-theme="light"]') !== -1;

          var targetStore = isDark ? darkVars : (isLight ? lightVars : null);
          if (targetStore) {
            for (var i = 0; i < rule.style.length; i++) {
              var prop = rule.style[i];
              if (prop && prop.indexOf('--') === 0) {
                targetStore[prop] = rule.style.getPropertyValue(prop).trim();
              }
            }
          }
        }
      }
    } catch (e) {
      // Cross-origin stylesheet access restriction
    }
  }

  // 2. TRUE DOM ROLE MAPPING
  // Background: body, html, #__next, main, or app-wrapper
  var bgEl = document.querySelector('main, #__next, #root, body, html');
  var computedBg = getComputed(bgEl, 'background-color') || getComputed(document.body, 'background-color') || 'rgb(255, 255, 255)';

  // Surface: real cards, sidebars, containers with background and borders/shadows
  var surfaceEls = document.querySelectorAll('header, nav, article, section, [class*="card"], [class*="surface"], [class*="box"], [class*="panel"]');
  var computedSurface = null;
  for (var c = 0; c < surfaceEls.length; c++) {
    var sBg = getComputed(surfaceEls[c], 'background-color');
    if (sBg && sBg !== 'rgba(0, 0, 0, 0)' && sBg !== 'transparent' && sBg !== computedBg) {
      computedSurface = sBg;
      break;
    }
  }

  // Primary Accent: Actual interactive buttons, CTAs, submit buttons
  var primaryEl = document.querySelector('button[type="submit"], button.primary, [class*="primary"], a[role="button"], button');
  var computedPrimary = getComputed(primaryEl, 'background-color') || getComputed(primaryEl, 'color');

  // Text Primary & Secondary
  var h1El = document.querySelector('h1, h2, h3');
  var computedTextPrimary = getComputed(h1El, 'color') || getComputed(document.body, 'color') || 'rgb(0, 0, 0)';

  var mutedEl = document.querySelector('small, [class*="muted"], [class*="secondary"], [class*="subtitle"], p');
  var computedTextSecondary = getComputed(mutedEl, 'color');

  // Border: computed border color from real borders
  var borderEl = document.querySelector('[class*="border"], input, button, card, header, nav');
  var computedBorder = getComputed(borderEl, 'border-top-color') || getComputed(borderEl, 'border-bottom-color');

  // 3. TYPOGRAPHY SCALES
  var headings = [];
  var tags = ['h1', 'h2', 'h3', 'h4'];
  for (var t = 0; t < tags.length; t++) {
    var tag = tags[t];
    var headingEl = document.querySelector(tag);
    if (headingEl) {
      var hStyle = window.getComputedStyle(headingEl);
      headings.push({
        tag: tag,
        fontFamily: hStyle.fontFamily,
        fontSize: hStyle.fontSize,
        fontWeight: hStyle.fontWeight,
        lineHeight: hStyle.lineHeight,
        letterSpacing: hStyle.letterSpacing,
        color: hStyle.color,
        sampleText: (headingEl.textContent || '').trim().slice(0, 40)
      });
    }
  }

  var body = [];
  var pEl = document.querySelector('p');
  if (pEl) {
    var pStyle = window.getComputedStyle(pEl);
    body.push({
      tag: 'p',
      fontFamily: pStyle.fontFamily,
      fontSize: pStyle.fontSize,
      fontWeight: pStyle.fontWeight,
      lineHeight: pStyle.lineHeight,
      letterSpacing: pStyle.letterSpacing,
      color: pStyle.color,
      sampleText: (pEl.textContent || '').trim().slice(0, 60)
    });
  }

  // 4. BORDER RADII & SHADOWS FROM REAL COMPONENTS
  var borderRadii = [];
  var radiiSet = {};
  var shadows = [];
  var shadowSet = {};
  var fontFamilies = [];
  var fontSet = {};

  var interactiveEls = document.querySelectorAll('button, input, [class*="card"], [class*="btn"], nav, header');
  for (var i = 0; i < interactiveEls.length; i++) {
    var style = window.getComputedStyle(interactiveEls[i]);
    if (style.borderRadius && style.borderRadius !== '0px' && !radiiSet[style.borderRadius]) {
      radiiSet[style.borderRadius] = true;
      borderRadii.push(style.borderRadius);
    }
    if (style.boxShadow && style.boxShadow !== 'none' && !shadowSet[style.boxShadow]) {
      shadowSet[style.boxShadow] = true;
      shadows.push(style.boxShadow);
    }
    if (style.fontFamily) {
      var font = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (font && !fontSet[font]) {
        fontSet[font] = true;
        fontFamilies.push(font);
      }
    }
  }

  // 5. SVG ASSETS & LOGOS
  var assets = [];
  var seenSvg = {};
  var logoCandidates = Array.prototype.slice.call(document.querySelectorAll('header svg, nav svg, [class*="logo"] svg, a[href="/"] svg, svg'));
  for (var k = 0; k < logoCandidates.length && assets.length < 8; k++) {
    var svg = logoCandidates[k];
    var outer = svg.outerHTML;
    if (outer && outer.length > 30 && outer.length < 15000 && !seenSvg[outer]) {
      seenSvg[outer] = true;
      var name = svg.getAttribute('aria-label') || svg.getAttribute('id') || svg.getAttribute('class') || ('asset-' + (assets.length + 1));
      assets.push({
        type: k === 0 ? 'logo' : 'svg',
        name: String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30),
        svgContent: outer
      });
    }
  }

  // 6. INTERNAL LINKS FOR BFS GRAPH CRAWLER
  var internalLinks = [];
  var seenLinks = {};
  var origin = window.location.origin;
  var allA = document.querySelectorAll('a[href]');
  for (var a = 0; a < allA.length; a++) {
    var href = allA[a].getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('javascript:')) {
      try {
        var resolved = new URL(href, window.location.href);
        if (resolved.origin === origin && resolved.pathname !== window.location.pathname && !seenLinks[resolved.pathname]) {
          seenLinks[resolved.pathname] = true;
          internalLinks.push(resolved.href);
        }
      } catch (e) {}
    }
  }

  return {
    rawRoles: {
      background: computedBg,
      surface: computedSurface,
      primary: computedPrimary,
      textPrimary: computedTextPrimary,
      textSecondary: computedTextSecondary,
      border: computedBorder
    },
    lightVars: lightVars,
    darkVars: darkVars,
    headings: headings,
    body: body,
    borderRadii: borderRadii,
    shadows: shadows,
    fontFamilies: fontFamilies,
    assets: assets,
    internalLinks: internalLinks
  };
})()
`;

async function inspectPage(page: Page, targetUrl: string): Promise<any> {
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1000);
    return await page.evaluate(EVAL_SCRIPT);
  } catch {
    return null;
  }
}

/**
 * True Breadth-First Search (BFS) graph crawler with genuine depth tracking
 */
async function crawlGraphBFS(page: Page, rootUrl: string, maxDepth: number, maxPages: number = 8): Promise<{
  crawledPages: string[];
  pageDataList: any[];
}> {
  interface QueueItem {
    url: string;
    depth: number;
  }

  const queue: QueueItem[] = [{ url: rootUrl, depth: 0 }];
  const visited = new Set<string>();
  visited.add(rootUrl);

  const crawledPages: string[] = [];
  const pageDataList: any[] = [];

  while (queue.length > 0 && crawledPages.length < maxPages) {
    const current = queue.shift()!;
    const data = await inspectPage(page, current.url);
    if (!data) continue;

    crawledPages.push(current.url);
    pageDataList.push(data);

    // If we have not exceeded the target tree depth, queue discovered child nodes (BFS traversal)
    if (current.depth < maxDepth - 1) {
      for (const link of data.internalLinks || []) {
        if (!visited.has(link) && visited.size < maxPages * 2) {
          visited.add(link);
          queue.push({ url: link, depth: current.depth + 1 });
        }
      }
    }
  }

  return { crawledPages, pageDataList };
}

export async function extractDesignTokens(targetUrl: string, depth: number = 1): Promise<DesignTokens> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // 1. Run BFS Graph Traversal with true depth parameter
  const { crawledPages, pageDataList } = await crawlGraphBFS(page, targetUrl, depth);
  await browser.close();

  if (pageDataList.length === 0) {
    throw new Error(`Failed to extract data from ${targetUrl}`);
  }

  const rootData = pageDataList[0];

  // 2. Resolve CSS variables for authentic light and dark palettes
  // Look for standard design variable keys: --background, --foreground, --primary, --muted, --border, --card
  const parseThemeFromVars = (vars: Record<string, string>, fallbackRoles: any, mode: 'light' | 'dark'): ThemePalette => {
    const bg = normalizeCssVarValue(vars['--background'] || vars['--color-background'] || '') || cleanColor(fallbackRoles.background) || (mode === 'dark' ? '#09090b' : '#ffffff');
    const surface = normalizeCssVarValue(vars['--card'] || vars['--surface'] || vars['--popover'] || '') || cleanColor(fallbackRoles.surface) || (mode === 'dark' ? '#18181b' : '#f4f4f5');
    const primary = normalizeCssVarValue(vars['--primary'] || vars['--color-primary'] || '') || cleanColor(fallbackRoles.primary) || (mode === 'dark' ? '#6366f1' : '#4f46e5');
    const textPrimary = normalizeCssVarValue(vars['--foreground'] || vars['--text-primary'] || '') || cleanColor(fallbackRoles.textPrimary) || (mode === 'dark' ? '#f4f4f5' : '#09090b');
    const textSecondary = normalizeCssVarValue(vars['--muted-foreground'] || vars['--text-secondary'] || '') || cleanColor(fallbackRoles.textSecondary) || (mode === 'dark' ? '#a1a1aa' : '#71717a');
    const border = normalizeCssVarValue(vars['--border'] || vars['--color-border'] || '') || cleanColor(fallbackRoles.border) || (mode === 'dark' ? '#27272a' : '#e4e4e7');

    return {
      mode,
      background: bg,
      surface,
      primary,
      textPrimary,
      textSecondary,
      border,
      palette: [
        { hex: bg, count: 10, luminance: 0 },
        { hex: surface, count: 8, luminance: 0 },
        { hex: primary, count: 6, luminance: 0 },
        { hex: textPrimary, count: 5, luminance: 0 }
      ]
    };
  };

  const hasDarkVars = Object.keys(rootData.darkVars || {}).length > 0;
  const lightTheme = parseThemeFromVars(rootData.lightVars || {}, rootData.rawRoles, 'light');
  const darkTheme = parseThemeFromVars(hasDarkVars ? rootData.darkVars : {}, rootData.rawRoles, 'dark');

  // Determine active theme mode based on primary background
  const bgLuminance = cleanColor(rootData.rawRoles.background);
  const themeMode: 'dark' | 'light' = (bgLuminance && bgLuminance.startsWith('#0')) ? 'dark' : 'light';
  const activePalette = themeMode === 'dark' ? darkTheme : lightTheme;

  // Aggregate typography and radii across all BFS crawled nodes
  const fontFamiliesSet = new Set<string>();
  const borderRadiiSet = new Set<string>();
  const shadowsSet = new Set<string>();
  const allAssets: ExtractedAsset[] = [];

  for (const pageData of pageDataList) {
    (pageData.fontFamilies || []).forEach((f: string) => fontFamiliesSet.add(f));
    (pageData.borderRadii || []).forEach((r: string) => borderRadiiSet.add(r));
    (pageData.shadows || []).forEach((s: string) => shadowsSet.add(s));
    (pageData.assets || []).forEach((a: ExtractedAsset) => {
      if (!allAssets.some(existing => existing.svgContent === a.svgContent)) {
        allAssets.push(a);
      }
    });
  }

  return {
    url: targetUrl,
    title: targetUrl,
    crawledPages,
    extractedAt: new Date().toISOString(),
    themeMode,
    colors: {
      background: activePalette.background,
      surface: activePalette.surface,
      primary: activePalette.primary,
      textPrimary: activePalette.textPrimary,
      textSecondary: activePalette.textSecondary,
      border: activePalette.border,
      palette: activePalette.palette
    },
    themes: {
      light: lightTheme,
      dark: darkTheme
    },
    typography: {
      fontFamilies: Array.from(fontFamiliesSet).slice(0, 6),
      headings: rootData.headings || [],
      body: rootData.body || []
    },
    spacingAndRadii: {
      borderRadii: Array.from(borderRadiiSet).slice(0, 6),
      shadows: Array.from(shadowsSet).slice(0, 5)
    },
    components: [],
    assets: allAssets.slice(0, 10),
    cssVariables: rootData.lightVars || {}
  };
}
