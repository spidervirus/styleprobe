import { chromium, BrowserContext, Page } from 'playwright';
import { cleanColor, normalizeCssVarValue, dedupeColors } from './analyzer.js';
import { DesignTokens, TypographyToken, ComponentSample, ExtractedAsset, ThemePalette } from './types.js';
import { validateAndResolveUrl, resolveAndVerifyHostname } from './security.js';

// ─────────────────────────────────────────────────────────────────
// EVAL_SCRIPT: everything that runs inside the browser page.
// Must be a plain string — esbuild/tsx injects __name into arrow
// functions which crashes inside page.evaluate().
// ─────────────────────────────────────────────────────────────────
const EVAL_SCRIPT = `
(function() {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────
  function gc(el, prop) {
    if (!el) return '';
    return window.getComputedStyle(el).getPropertyValue(prop).trim();
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Most-frequent non-transparent value from a NodeList for a given CSS prop
  function dominantValue(els, prop) {
    var freq = {};
    var best = null, bestN = 0;
    for (var i = 0; i < els.length; i++) {
      var v = gc(els[i], prop);
      if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || v === 'none') continue;
      freq[v] = (freq[v] || 0) + 1;
      if (freq[v] > bestN) { bestN = freq[v]; best = v; }
    }
    return best;
  }

  // ── 1. CSS CUSTOM PROPERTIES with source/usage metadata ───────
  var cssVars = {};          // { '--name': { value, selectors: [], usedBy: [] } }
  var lightVars = {};
  var darkVars = {};

  for (var s = 0; s < document.styleSheets.length; s++) {
    try {
      var sheet = document.styleSheets[s];
      var rules = sheet.cssRules || [];
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (!(rule instanceof CSSStyleRule)) continue;
        var sel = rule.selectorText || '';
        var isDark  = sel.indexOf('.dark') !== -1 || sel.indexOf('[data-theme="dark"]') !== -1 || sel.indexOf('[data-mode="dark"]') !== -1 || sel.indexOf('[color-scheme="dark"]') !== -1;
        var isLight = sel === ':root' || sel === 'html' || sel === 'body' || sel.indexOf('.light') !== -1 || sel.indexOf('[data-theme="light"]') !== -1;

        for (var i = 0; i < rule.style.length; i++) {
          var prop = rule.style[i];
          if (!prop || prop.indexOf('--') !== 0) continue;
          var val = rule.style.getPropertyValue(prop).trim();

          // Store with metadata
          if (!cssVars[prop]) cssVars[prop] = { value: val, selectors: [], usedIn: [] };
          if (cssVars[prop].selectors.indexOf(sel) === -1) cssVars[prop].selectors.push(sel);

          if (isDark)  darkVars[prop]  = val;
          if (isLight) lightVars[prop] = val;
          else if (!isDark && !lightVars[prop]) lightVars[prop] = val;
        }
      }
    } catch(e) {}
  }

  // Walk real elements to record which CSS vars are actually used
  var sampleEls = document.querySelectorAll('button, input, a, h1, h2, p, header, nav, [class*="card"], [class*="btn"]');
  for (var e = 0; e < Math.min(sampleEls.length, 60); e++) {
    var style = window.getComputedStyle(sampleEls[e]);
    for (var p = 0; p < style.length; p++) {
      var v = style.getPropertyValue(style[p]);
      if (v && v.indexOf('var(--') !== -1) {
        var start = v.indexOf('var(--') + 4;
        var end = v.indexOf(')', start);
        var comma = v.indexOf(',', start);
        if (comma !== -1 && comma < end) end = comma;
        var varName = end !== -1 ? v.substring(start, end).trim() : v.substring(start).trim();
        if (varName && cssVars[varName]) {
          var tag = sampleEls[e].tagName.toLowerCase();
          if (cssVars[varName].usedIn.indexOf(tag) === -1) cssVars[varName].usedIn.push(tag);
        }
      }
    }
  }

  // ── 2. SEMANTIC ROLES via multi-element DOM sampling ──────────
  // Background
  var bgEls = document.querySelectorAll('body, main, #__next, #root, #app, [id*="layout"]');
  var computedBg = dominantValue(bgEls, 'background-color') || gc(document.body, 'background-color') || 'rgb(255,255,255)';

  // Surface: panels/cards that differ from bg
  var surfaceEls = document.querySelectorAll('[class*="card"], [class*="surface"], [class*="panel"], [class*="box"], article, aside, section');
  var computedSurface = null;
  for (var c = 0; c < surfaceEls.length; c++) {
    var sBg = gc(surfaceEls[c], 'background-color');
    if (sBg && sBg !== 'rgba(0, 0, 0, 0)' && sBg !== 'transparent' && sBg !== computedBg && isVisible(surfaceEls[c])) {
      computedSurface = sBg; break;
    }
  }

  // Primary accent: sample all CTAs, pick dominant background
  var primaryEls = document.querySelectorAll('button[type="submit"], button[class*="primary"], a[class*="primary"], [class*="cta"], [class*="btn-primary"], button');
  var computedPrimary = dominantValue(primaryEls, 'background-color') || dominantValue(primaryEls, 'color');

  // Text primary: sample all headings for dominant color
  var headingColorEls = document.querySelectorAll('h1, h2, h3');
  var computedTextPrimary = dominantValue(headingColorEls, 'color') || gc(document.body, 'color') || 'rgb(0,0,0)';

  // Text secondary: muted/subtitle/p elements
  var mutedEls = document.querySelectorAll('[class*="muted"], [class*="secondary"], [class*="subtitle"], small, figcaption');
  var computedTextSecondary = dominantValue(mutedEls, 'color') || gc(document.querySelector('p'), 'color');

  // Border: dominant border color across interactive/structural elements
  var borderEls = document.querySelectorAll('input, button, [class*="border"], [class*="card"], header, nav, table, hr');
  var computedBorder = dominantValue(borderEls, 'border-top-color') || dominantValue(borderEls, 'border-bottom-color');

  // ── 3. TYPOGRAPHY: full sampling with dedup/grouping ──────────
  var typSel = 'h1, h2, h3, h4, h5, h6, p, blockquote, label, a, small, code, [class*="title"], [class*="heading"], [class*="subtitle"], [class*="body-text"]';
  var typEls = document.querySelectorAll(typSel);

  var headings = [];
  var body = [];
  var typGroups = {};   // key = fontFamily+fontSize+fontWeight+lineHeight

  for (var t = 0; t < Math.min(typEls.length, 120); t++) {
    var tel = typEls[t];
    if (!isVisible(tel)) continue;
    var ts = window.getComputedStyle(tel);
    var ff = ts.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    var groupKey = ff + '|' + ts.fontSize + '|' + ts.fontWeight + '|' + ts.lineHeight;
    if (!typGroups[groupKey]) {
      typGroups[groupKey] = {
        tag: tel.tagName.toLowerCase(),
        fontFamily: ts.fontFamily,
        fontSize: ts.fontSize,
        fontWeight: ts.fontWeight,
        lineHeight: ts.lineHeight,
        letterSpacing: ts.letterSpacing,
        color: ts.color,
        sampleText: (tel.textContent || '').trim().slice(0, 60),
        count: 0
      };
    }
    typGroups[groupKey].count++;
  }

  // Sort by frequency desc, split into heading vs body scale
  var typArr = Object.values(typGroups).sort(function(a, b) { return b.count - a.count; });
  var hTags = { h1:1, h2:1, h3:1, h4:1, h5:1, h6:1 };
  for (var ti = 0; ti < typArr.length; ti++) {
    var tok = typArr[ti];
    var rec = { tag: tok.tag, fontFamily: tok.fontFamily, fontSize: tok.fontSize, fontWeight: tok.fontWeight, lineHeight: tok.lineHeight, letterSpacing: tok.letterSpacing, color: tok.color, sampleText: tok.sampleText };
    if (hTags[tok.tag]) { if (headings.length < 6) headings.push(rec); }
    else                 { if (body.length < 6)     body.push(rec); }
  }

  // ── 4. BORDER RADII, SHADOWS, FONT FAMILIES ───────────────────
  var borderRadii = [];
  var radiiSet = {};
  var shadows = [];
  var shadowSet = {};
  var fontFamilies = [];
  var fontSet = {};

  var interactiveEls = document.querySelectorAll('button, input, [class*="card"], [class*="btn"], nav, header, [class*="modal"], [class*="dialog"], [class*="tooltip"]');
  for (var i = 0; i < interactiveEls.length; i++) {
    var iStyle = window.getComputedStyle(interactiveEls[i]);
    if (iStyle.borderRadius && iStyle.borderRadius !== '0px' && !radiiSet[iStyle.borderRadius]) {
      radiiSet[iStyle.borderRadius] = true;
      borderRadii.push(iStyle.borderRadius);
    }
    if (iStyle.boxShadow && iStyle.boxShadow !== 'none' && !shadowSet[iStyle.boxShadow]) {
      shadowSet[iStyle.boxShadow] = true;
      shadows.push(iStyle.boxShadow);
    }
    if (iStyle.fontFamily) {
      var font = iStyle.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (font && !fontSet[font]) { fontSet[font] = true; fontFamilies.push(font); }
    }
  }

  // ── 5. REAL COMPONENT EXTRACTION ──────────────────────────────
  var components = [];

  function extractComponentStyles(el) {
    var cs = window.getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      borderRadius: cs.borderRadius,
      border: cs.borderTop + ' ' + cs.borderRight + ' ' + cs.borderBottom + ' ' + cs.borderLeft,
      borderColor: cs.borderTopColor,
      boxShadow: cs.boxShadow,
      padding: cs.padding,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      outline: cs.outline,
      backdropFilter: cs.backdropFilter || ''
    };
  }

  function pickTopK(els, k) {
    var out = [];
    for (var i = 0; i < els.length && out.length < k; i++) {
      if (isVisible(els[i])) out.push(els[i]);
    }
    return out;
  }

  // Buttons
  var btnEls = pickTopK(document.querySelectorAll('button, a[role="button"], [class*="btn"], [class*="button"], input[type="submit"], input[type="button"]'), 4);
  for (var b = 0; b < btnEls.length; b++) {
    var bs = extractComponentStyles(btnEls[b]);
    // Skip invisible/ghost buttons with transparent bg and no border
    if (bs.backgroundColor === 'rgba(0, 0, 0, 0)' && bs.borderColor === 'rgba(0, 0, 0, 0)') continue;
    components.push({
      type: 'button',
      sampleHtml: (btnEls[b].outerHTML || '').slice(0, 300),
      styles: bs
    });
    if (components.filter(function(x){ return x.type === 'button'; }).length >= 2) break;
  }

  // Inputs
  var inputEls = pickTopK(document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], input[type="password"], textarea, select'), 3);
  for (var inp = 0; inp < inputEls.length; inp++) {
    components.push({ type: 'input', sampleHtml: (inputEls[inp].outerHTML || '').slice(0, 200), styles: extractComponentStyles(inputEls[inp]) });
    if (components.filter(function(x){ return x.type === 'input'; }).length >= 1) break;
  }

  // Cards
  var cardEls = pickTopK(document.querySelectorAll('[class*="card"], [class*="tile"], article, [class*="item"], [class*="post"]'), 5);
  for (var cd = 0; cd < cardEls.length; cd++) {
    var cds = extractComponentStyles(cardEls[cd]);
    if (cds.backgroundColor === 'rgba(0, 0, 0, 0)' && cds.boxShadow === 'none') continue;
    components.push({ type: 'card', sampleHtml: '', styles: cds });
    if (components.filter(function(x){ return x.type === 'card'; }).length >= 1) break;
  }

  // Nav / Header
  var navEl = document.querySelector('header, nav, [role="navigation"], [class*="navbar"], [class*="header"]');
  if (navEl) {
    components.push({ type: 'nav', sampleHtml: '', styles: extractComponentStyles(navEl) });
  }

  // Badge / Tag / Chip
  var badgeEls = pickTopK(document.querySelectorAll('[class*="badge"], [class*="tag"], [class*="chip"], [class*="label"], [class*="pill"]'), 3);
  for (var bg = 0; bg < badgeEls.length; bg++) {
    components.push({ type: 'badge', sampleHtml: (badgeEls[bg].outerHTML || '').slice(0, 200), styles: extractComponentStyles(badgeEls[bg]) });
    if (components.filter(function(x){ return x.type === 'badge'; }).length >= 1) break;
  }

  // ── 6. SVG ASSETS ─────────────────────────────────────────────
  var assets = [];
  var seenSvg = {};
  var logoCandidates = Array.prototype.slice.call(document.querySelectorAll('header svg, nav svg, [class*="logo"] svg, a[href="/"] svg, svg'));
  for (var k = 0; k < logoCandidates.length && assets.length < 8; k++) {
    var svg = logoCandidates[k];
    var outer = svg.outerHTML;
    if (outer && outer.length > 30 && outer.length < 15000 && !seenSvg[outer]) {
      seenSvg[outer] = true;
      var aname = svg.getAttribute('aria-label') || svg.getAttribute('id') || svg.getAttribute('class') || ('asset-' + (assets.length + 1));
      assets.push({ type: k === 0 ? 'logo' : 'svg', name: String(aname).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30), svgContent: outer });
    }
  }

  // ── 7. INTERNAL LINKS FOR BFS ─────────────────────────────────
  var internalLinks = [];
  var seenLinks = {};
  var origin = window.location.origin;
  var allA = document.querySelectorAll('a[href]');
  for (var a = 0; a < allA.length; a++) {
    var href = allA[a].getAttribute('href');
    if (href && href.indexOf('#') !== 0 && href.indexOf('mailto:') !== 0 && href.indexOf('javascript:') !== 0) {
      try {
        var resolved = new URL(href, window.location.href);
        if (resolved.origin === origin && resolved.pathname !== window.location.pathname && !seenLinks[resolved.pathname]) {
          seenLinks[resolved.pathname] = true;
          internalLinks.push(resolved.href);
        }
      } catch(e) {}
    }
  }

  return {
    rawRoles: { background: computedBg, surface: computedSurface, primary: computedPrimary, textPrimary: computedTextPrimary, textSecondary: computedTextSecondary, border: computedBorder },
    cssVarsMeta: cssVars,
    lightVars: lightVars,
    darkVars: darkVars,
    headings: headings,
    body: body,
    borderRadii: borderRadii,
    shadows: shadows,
    fontFamilies: fontFamilies,
    components: components,
    assets: assets,
    internalLinks: internalLinks
  };
})()
`;

// ─────────────────────────────────────────────────────────────────
// Active dual-theme extraction via Playwright emulateMedia
// ─────────────────────────────────────────────────────────────────
async function extractThemeWithColorScheme(
  context: BrowserContext,
  url: string,
  scheme: 'light' | 'dark'
): Promise<{ rawRoles: any; lightVars: Record<string,string>; darkVars: Record<string,string>; cssVarsMeta: any }> {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200);

    // Also force the .dark class if the site uses class-based dark mode
    if (scheme === 'dark') {
      await page.evaluate(`
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.setAttribute('data-mode', 'dark');
      `);
      await page.waitForTimeout(400);
    } else {
      await page.evaluate(`
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.setAttribute('data-mode', 'light');
      `);
      await page.waitForTimeout(400);
    }

    const data = await page.evaluate(EVAL_SCRIPT);
    return data as any;
  } catch {
    return { rawRoles: {}, lightVars: {}, darkVars: {}, cssVarsMeta: {} };
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────────────────────────
// Single-page inspector (used by BFS crawler)
// ─────────────────────────────────────────────────────────────────
async function inspectPage(page: Page, targetUrl: string): Promise<any> {
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1000);
    return await page.evaluate(EVAL_SCRIPT);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// True BFS graph crawler with security bounds
// ─────────────────────────────────────────────────────────────────
async function crawlGraphBFS(
  page: Page,
  rootUrl: string,
  maxDepth: number,
  maxPages = 6
): Promise<{ crawledPages: string[]; pageDataList: any[] }> {
  interface QueueItem { url: string; depth: number; }
  const queue: QueueItem[] = [{ url: rootUrl, depth: 0 }];
  const visited = new Set<string>();
  visited.add(rootUrl);

  const crawledPages: string[] = [];
  const pageDataList: any[] = [];
  const boundedDepth = Math.max(1, Math.min(maxDepth, 3)); // Hard cap at depth 3

  while (queue.length > 0 && crawledPages.length < maxPages) {
    const current = queue.shift()!;
    const data = await inspectPage(page, current.url);
    if (!data) continue;

    crawledPages.push(current.url);
    pageDataList.push(data);

    if (current.depth < boundedDepth - 1) {
      for (const link of data.internalLinks || []) {
        if (!visited.has(link) && visited.size < maxPages * 2) {
          visited.add(link);
          // Verify discovered link syntax before enqueuing
          try {
            const parsedLink = new URL(link);
            if (parsedLink.protocol === 'http:' || parsedLink.protocol === 'https:') {
              queue.push({ url: link, depth: current.depth + 1 });
            }
          } catch {}
        }
      }
    }
  }

  return { crawledPages, pageDataList };
}

// Maximum overall execution time for the entire extraction session (60 seconds)
const OVERALL_TIMEOUT_MS = 60000;

// Maximum size allowed for individual HTTP network responses (10 MB)
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────
export async function extractDesignTokens(targetUrl: string, depth = 1): Promise<DesignTokens> {
  // ── 1. Input validation & SSRF / DNS rebinding pre-check ────────
  const precheck = await validateAndResolveUrl(targetUrl);
  if (!precheck.safe) {
    throw new Error(`SSRF / Security Rejection: ${precheck.reason || 'Invalid or prohibited destination'}`);
  }
  const verifiedUrl = precheck.normalizedUrl!;
  const boundedDepth = Math.max(1, Math.min(depth, 3));

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const browser = await chromium.launch({ headless: true });

  // Attach session timeout to guarantee browser closure even on stall
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Extraction timed out after ${OVERALL_TIMEOUT_MS / 1000}s limit`));
    }, OVERALL_TIMEOUT_MS);
  });

  const extractionTask = async (): Promise<DesignTokens> => {
    // Single shared context — avoids triple-hitting bot detection
    const sharedContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: UA
    });

    // ── 2. Route interception for SSRF, Redirects & Resource Limits ─
    await sharedContext.route('**/*', async (route) => {
      const request = route.request();
      const reqUrl = request.url();

      // Permit inline data/blob resources
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
        return route.continue();
      }

      // Reject non-web protocols
      if (!reqUrl.startsWith('http://') && !reqUrl.startsWith('https://')) {
        return route.abort('blockedbyclient');
      }

      try {
        const u = new URL(reqUrl);

        // Active DNS resolution & SSRF / Rebinding check on every outbound request & redirect destination
        const check = await resolveAndVerifyHostname(u.hostname);
        if (!check.safe) {
          return route.abort('blockedbyclient');
        }

        return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
    });

    // Response listener for resource limits (max page / asset size)
    sharedContext.on('response', (response) => {
      const cl = response.headers()['content-length'];
      if (cl && parseInt(cl, 10) > MAX_RESOURCE_BYTES) {
        // Abort large payloads
        response.body().catch(() => {});
      }
    });

    try {
      // ── BFS crawl first (gets page data + components + typography) ──
      const crawlPage = await sharedContext.newPage();
      crawlPage.setDefaultNavigationTimeout(20000);
      const { crawledPages, pageDataList } = await crawlGraphBFS(crawlPage, verifiedUrl, boundedDepth);
      await crawlPage.close();

      // ── Light theme extraction (reuse same context, sequential) ─────
      const lightData = await extractThemeWithColorScheme(sharedContext, verifiedUrl, 'light');

      // ── Dark theme extraction ───────────────────────────────────────
      const darkData = await extractThemeWithColorScheme(sharedContext, verifiedUrl, 'dark');

      if (pageDataList.length === 0) {
        throw new Error(`Failed to extract data from ${verifiedUrl}`);
      }

      const rootData = pageDataList[0];

      // ── Merge vars: light from lightContext, dark from darkContext ──
      const resolvedLightVars: Record<string, string> = {
        ...lightData.lightVars,
        ...lightData.darkVars
      };
      const resolvedDarkVars: Record<string, string> = {
        ...darkData.lightVars,
        ...darkData.darkVars
      };

      // ── Build ThemePalette from each scheme's actual DOM ───────────
      const buildPalette = (vars: Record<string, string>, roles: any, mode: 'light' | 'dark'): ThemePalette => {
        const bg   = normalizeCssVarValue(vars['--background']  || vars['--color-background'] || '') || cleanColor(roles.background) || (mode === 'dark' ? '#09090b' : '#ffffff');
        const surf = normalizeCssVarValue(vars['--card']        || vars['--surface']           || vars['--popover'] || '') || cleanColor(roles.surface) || (mode === 'dark' ? '#18181b' : '#f4f4f5');
        const prim = normalizeCssVarValue(vars['--primary']     || vars['--color-primary']     || '') || cleanColor(roles.primary) || (mode === 'dark' ? '#6366f1' : '#4f46e5');
        const txtP = normalizeCssVarValue(vars['--foreground']  || vars['--text-primary']      || '') || cleanColor(roles.textPrimary)   || (mode === 'dark' ? '#f4f4f5' : '#09090b');
        const txtS = normalizeCssVarValue(vars['--muted-foreground'] || vars['--text-secondary'] || '') || cleanColor(roles.textSecondary) || (mode === 'dark' ? '#a1a1aa' : '#71717a');
        const brd  = normalizeCssVarValue(vars['--border']      || vars['--color-border']      || '') || cleanColor(roles.border) || (mode === 'dark' ? '#27272a' : '#e4e4e7');

        return {
          mode, background: bg, surface: surf, primary: prim,
          textPrimary: txtP, textSecondary: txtS, border: brd,
          palette: [
            { hex: bg,   count: 10, luminance: 0 },
            { hex: surf, count: 8,  luminance: 0 },
            { hex: prim, count: 6,  luminance: 0 },
            { hex: txtP, count: 5,  luminance: 0 }
          ]
        };
      };

      const lightTheme = buildPalette(resolvedLightVars, lightData.rawRoles, 'light');
      const darkTheme  = buildPalette(resolvedDarkVars,  darkData.rawRoles,  'dark');

      const rawBg = cleanColor(rootData.rawRoles?.background || '');
      const themeMode: 'dark' | 'light' = (rawBg && (rawBg.startsWith('#0') || rawBg.startsWith('#1') || rawBg.startsWith('#2'))) ? 'dark' : 'light';
      const activePalette = themeMode === 'dark' ? darkTheme : lightTheme;

      // ── Aggregate across BFS pages ─────────────────────────────────
      const fontFamiliesSet = new Set<string>();
      const borderRadiiSet  = new Set<string>();
      const shadowsSet      = new Set<string>();
      const allAssets: ExtractedAsset[] = [];
      const allComponents: ComponentSample[] = [];

      for (const pageData of pageDataList) {
        (pageData.fontFamilies  || []).forEach((f: string) => fontFamiliesSet.add(f));
        (pageData.borderRadii   || []).forEach((r: string) => borderRadiiSet.add(r));
        (pageData.shadows       || []).forEach((s: string) => shadowsSet.add(s));

        for (const a of (pageData.assets || []) as ExtractedAsset[]) {
          if (!allAssets.some(x => x.svgContent === a.svgContent)) allAssets.push(a);
        }

        for (const c of (pageData.components || []) as ComponentSample[]) {
          const sameType = allComponents.filter(x => x.type === c.type);
          if (sameType.length < 2) {
            allComponents.push(c);
          }
        }
      }

      // ── Aggregate full typography across BFS pages ─────────────────
      const typGroups: Record<string, TypographyToken & { count: number }> = {};
      for (const pageData of pageDataList) {
        for (const tok of ([...(pageData.headings || []), ...(pageData.body || [])] as (TypographyToken & { count: number })[])) {
          const key = tok.fontFamily + '|' + tok.fontSize + '|' + tok.fontWeight + '|' + tok.lineHeight;
          if (!typGroups[key]) {
            typGroups[key] = { ...tok, count: 0 };
          }
          typGroups[key].count += (tok.count || 1);
        }
      }

      const typSorted = Object.values(typGroups).sort((a, b) => b.count - a.count);
      const hTags = new Set(['h1','h2','h3','h4','h5','h6']);
      const finalHeadings = typSorted.filter(t => hTags.has(t.tag)).slice(0, 6);
      const finalBody     = typSorted.filter(t => !hTags.has(t.tag)).slice(0, 6);

      // ── Build merged cssVariables with source/usage metadata ───────
      const cssVarsMeta = rootData.cssVarsMeta || {};
      const cssVariables: Record<string, any> = {};
      for (const [name, meta] of Object.entries(cssVarsMeta)) {
        const m = meta as any;
        cssVariables[name] = {
          light: resolvedLightVars[name] || m.value,
          dark:  resolvedDarkVars[name]  || m.value,
          selectors: m.selectors || [],
          usedIn:    m.usedIn    || []
        };
      }

      return {
        url: verifiedUrl,
        title: verifiedUrl,
        crawledPages,
        extractedAt: new Date().toISOString(),
        themeMode,
        colors: {
          background:    activePalette.background,
          surface:       activePalette.surface,
          primary:       activePalette.primary,
          textPrimary:   activePalette.textPrimary,
          textSecondary: activePalette.textSecondary,
          border:        activePalette.border,
          palette:       activePalette.palette
        },
        themes: { light: lightTheme, dark: darkTheme },
        typography: {
          fontFamilies: Array.from(fontFamiliesSet).slice(0, 6),
          headings:     finalHeadings,
          body:         finalBody
        },
        spacingAndRadii: {
          borderRadii: Array.from(borderRadiiSet).slice(0, 6),
          shadows:     Array.from(shadowsSet).slice(0, 5)
        },
        components: allComponents,
        assets:     allAssets.slice(0, 10),
        cssVariables
      };
    } finally {
      await sharedContext.close().catch(() => {});
    }
  };

  try {
    return await Promise.race([extractionTask(), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await browser.close().catch(() => {});
  }
}
