import { Page } from 'playwright';
import { 
  BreakpointToken, 
  ViewportSnapshot, 
  ResponsivePropertyComparison, 
  ResponsiveRule, 
  ResponsiveDesignSystem 
} from './types.js';

// ─────────────────────────────────────────────────────────────────
// MEDIA QUERY & BREAKPOINT EXTRACTION SCRIPT (in-page execution)
// ─────────────────────────────────────────────────────────────────
const MEDIA_QUERY_EVAL_SCRIPT = `
(function() {
  'use strict';
  var rawBreakpoints = [];
  var rawQueries = [];
  var fluidPatterns = [];

  function parseWidthInPx(val, unit) {
    var num = parseFloat(val);
    if (isNaN(num)) return null;
    unit = (unit || 'px').toLowerCase();
    if (unit === 'em' || unit === 'rem') {
      return Math.round(num * 16);
    }
    return Math.round(num);
  }

  function addBreakpoint(px, query, raw) {
    if (px < 240 || px > 3840) return;
    rawBreakpoints.push({
      value: px,
      unit: 'px',
      query: query.trim(),
      raw: raw.trim()
    });
  }

  function extractBreakpointsFromQuery(q) {
    if (!q || typeof q !== 'string') return;
    // 1. Classic min-width / max-width: (min-width: 768px), (max-width: 1024px), (min-width: 48em)
    var mRegex = /(min|max)-width\\s*:\\s*([\\d.]+)\\s*(px|em|rem)/gi;
    var m;
    while ((m = mRegex.exec(q)) !== null) {
      var px = parseWidthInPx(m[2], m[3]);
      if (px !== null) {
        // max-width 767px or 767.98px represents the 768px threshold boundary
        if (m[1].toLowerCase() === 'max' && (px % 10 === 7 || px % 10 === 9)) {
          px = Math.round(px) + 1;
        }
        addBreakpoint(px, q, m[0]);
      }
    }

    // 2. Modern Range Queries (CSS Media Queries Level 4): (width >= 768px), (width <= 1024px), (768px <= width)
    var rangeRegex = /(?:width\\s*(>=|<=|>|<)\\s*([\\d.]+)\\s*(px|em|rem)|([\\d.]+)\\s*(px|em|rem)\\s*(<=|<)\\s*width)/gi;
    var r;
    while ((r = rangeRegex.exec(q)) !== null) {
      var val = r[2] || r[4];
      var u = r[3] || r[5];
      var px2 = parseWidthInPx(val, u);
      if (px2 !== null) {
        addBreakpoint(px2, q, r[0]);
      }
    }
  }

  function scanTextForQueries(text) {
    if (!text || typeof text !== 'string') return;
    // Scan for fluid clamp formulas
    var clampMatches = text.match(/clamp\\s*\\([^)]+\\)/gi);
    if (clampMatches) {
      for (var f = 0; f < clampMatches.length; f++) {
        var cleanClamp = clampMatches[f].replace(/\\s+/g, ' ');
        if (fluidPatterns.indexOf(cleanClamp) === -1 && fluidPatterns.length < 10) {
          fluidPatterns.push(cleanClamp);
        }
      }
    }

    // Scan for @media rules
    var mqRegex = /@media\\s*([^{]+)\\{/gi;
    var match;
    while ((match = mqRegex.exec(text)) !== null) {
      var query = match[1].trim();
      rawQueries.push(query);
      extractBreakpointsFromQuery(query);
    }
  }

  // 1. Scan CSSStyleSheet rules (handles same-origin and CORS-accessible sheets)
  try {
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      try {
        var rules = sheet.cssRules || sheet.rules;
        if (rules) {
          for (var ri = 0; ri < rules.length; ri++) {
            var rule = rules[ri];
            if (rule.type === 4 || (rule.media && rule.media.mediaText)) {
              var mText = rule.conditionText || rule.media.mediaText || '';
              rawQueries.push(mText);
              extractBreakpointsFromQuery(mText);
            }
          }
        }
      } catch (e) {
        // Cross-origin protected stylesheet, proceed to DOM styles
      }
    }
  } catch (e) {}

  // 2. Scan inline <style> tags (catches SSR/Next.js/Tailwind styles)
  var styleEls = document.querySelectorAll('style');
  for (var si = 0; si < styleEls.length; si++) {
    scanTextForQueries(styleEls[si].textContent || '');
  }

  // 3. Scan <link rel="stylesheet" media="...">
  var linkEls = document.querySelectorAll('link[rel="stylesheet"][media]');
  for (var li = 0; li < linkEls.length; li++) {
    var med = linkEls[li].getAttribute('media');
    if (med && med !== 'all' && med !== 'screen' && med !== 'print') {
      extractBreakpointsFromQuery(med);
    }
  }

  // Deduplicate and cluster raw breakpoints within 5px tolerance
  var sorted = rawBreakpoints.sort(function(a, b) { return a.value - b.value; });
  var clustered = [];
  for (var i = 0; i < sorted.length; i++) {
    var curr = sorted[i];
    var existing = null;
    for (var c = 0; c < clustered.length; c++) {
      if (Math.abs(clustered[c].value - curr.value) <= 5) {
        existing = clustered[c];
        break;
      }
    }
    if (existing) {
      if (curr.query && existing.query.indexOf(curr.query) === -1 && existing.query.length < 200) {
        existing.query += '; ' + curr.query;
      }
    } else {
      clustered.push({
        value: curr.value,
        unit: 'px',
        query: curr.query,
        raw: curr.raw
      });
    }
  }

  // Assign semantic breakpoint names based on detected width values
  for (var k = 0; k < clustered.length; k++) {
    var val = clustered[k].value;
    if (val < 640) clustered[k].name = 'xs';
    else if (val < 768) clustered[k].name = 'sm (mobile landscape)';
    else if (val < 1024) clustered[k].name = 'md (tablet)';
    else if (val < 1280) clustered[k].name = 'lg (desktop)';
    else if (val < 1536) clustered[k].name = 'xl (wide desktop)';
    else clustered[k].name = '2xl (ultra-wide)';
  }

  return {
    breakpoints: clustered,
    rawQueries: rawQueries.slice(0, 30),
    fluidPatterns: fluidPatterns
  };
})()
`;

// ─────────────────────────────────────────────────────────────────
// VIEWPORT SNAPSHOT SCRIPT (runs at specific viewport dimensions)
// ─────────────────────────────────────────────────────────────────
function getViewportEvalScript(vpName: string): string {
  return `
(function() {
  'use strict';
  var vpName = '${vpName}';
  function gc(el, prop) {
    if (!el) return '';
    return window.getComputedStyle(el).getPropertyValue(prop).trim();
  }

  function isVisible(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // 1. Typography Sampling
  var h1 = document.querySelector('h1, [class*="hero"] h2, main h1, .title, [class*="title"], [class*="heading"]');
  var h1FontSize = h1 ? gc(h1, 'font-size') : '36px';
  var h1LineHeight = h1 ? gc(h1, 'line-height') : '1.2';

  var h2 = document.querySelector('h2, [class*="subtitle"], main h2, [class*="section-heading"]');
  var h2FontSize = h2 ? gc(h2, 'font-size') : '24px';

  var p = document.querySelector('main p, article p, p');
  var bodyFontSize = p ? gc(p, 'font-size') : '16px';

  // 2. Section Spacing & Containers
  var section = document.querySelector('main > section, section, main, [class*="hero"], [class*="section"], [class*="container"]');
  var pt = section ? gc(section, 'padding-top') : '40px';
  var pb = section ? gc(section, 'padding-bottom') : '40px';
  var pl = section ? gc(section, 'padding-left') : '20px';
  var pr = section ? gc(section, 'padding-right') : '20px';
  var sectionPadding = pt === pb ? pt : pt + ' ' + pb;

  var container = document.querySelector('[class*="container"], [class*="wrapper"], main, #__next > div');
  var containerMaxWidth = container ? gc(container, 'max-width') : '1280px';

  // 3. Grid Columns & Layout
  var gridColumns = '1';
  var cardGap = '16px';
  var gridEl = document.querySelector('[class*="grid"], [class*="cards"], [class*="features"], [class*="list"], .grid, main section ul');
  if (gridEl) {
    var cs = window.getComputedStyle(gridEl);
    if (cs.display === 'grid') {
      var cols = cs.gridTemplateColumns;
      if (cols && cols !== 'none') {
        var colList = cols.split(' ').filter(function(x){ return x.trim().length > 0; });
        gridColumns = String(colList.length);
      }
      var cGap = cs.columnGap || cs.gap || cs.gridColumnGap;
      if (cGap && cGap !== 'normal' && cGap !== '0px') cardGap = cGap;
    } else {
      // Flexbox or inline layout: measure children on first visual line
      var children = Array.prototype.slice.call(gridEl.children).filter(isVisible);
      if (children.length > 1) {
        var firstTop = children[0].getBoundingClientRect().top;
        var onRow = 0;
        for (var c = 0; c < children.length; c++) {
          if (Math.abs(children[c].getBoundingClientRect().top - firstTop) < 12) {
            onRow++;
          }
        }
        if (onRow > 0) gridColumns = String(onRow);
        var fGap = cs.gap || cs.columnGap;
        if (fGap && fGap !== 'normal' && fGap !== '0px') cardGap = fGap;
      }
    }
  }

  // 4. Navigation Architecture & Hamburger Detection
  var navLinks = document.querySelectorAll('header nav a, nav ul, [class*="nav-links"], [class*="nav-menu"], [class*="navbar-nav"], header a:not([class*="logo"])');
  var visibleNavLinks = 0;
  for (var n = 0; n < navLinks.length; n++) {
    if (isVisible(navLinks[n])) visibleNavLinks++;
  }

  var hamburger = document.querySelector(
    'button[class*="hamburger"], button[class*="menu"], [class*="menu-toggle"], [aria-label*="menu" i], [aria-label*="navigation" i], [aria-expanded], [class*="drawer-toggle"], [class*="navbar-toggler"]'
  );
  var hamburgerVisible = hamburger ? isVisible(hamburger) : false;

  var navigationMode = 'Full';
  var navSummary = '';
  if (hamburgerVisible && visibleNavLinks <= 1) {
    navigationMode = 'Menu';
    navSummary = 'Mobile menu / hamburger button visible; desktop links collapsed';
  } else if (hamburgerVisible && visibleNavLinks > 1) {
    navigationMode = 'Compact';
    navSummary = 'Compact navigation with both secondary links and menu button';
  } else if (!hamburgerVisible && visibleNavLinks > 1) {
    navigationMode = 'Full';
    navSummary = 'Full desktop navigation bar with visible inline links';
  } else {
    navigationMode = visibleNavLinks > 0 ? 'Full' : 'Menu';
    navSummary = visibleNavLinks > 0 ? 'Inline navigation links' : 'Collapsed navigation';
  }

  // 5. Button Behavior (prioritize conversion/hero CTA over navigation hamburger toggles)
  var btn = document.querySelector(
    '[class*="hero"] a[class*="btn"], [class*="hero"] button, main [class*="btn"], main button, a[class*="btn"], a[class*="cta"], a[role="button"], button:not([class*="hamburger"]):not([class*="menu"]):not([class*="toggle"]):not([aria-label*="menu" i])'
  ) || document.querySelector('button, a[class*="btn"], [role="button"]');
  var btnWidth = 'Auto';
  var btnPadding = '12px 24px';
  if (btn) {
    var bcs = window.getComputedStyle(btn);
    var br = btn.getBoundingClientRect();
    var parent = btn.parentElement;
    var prt = parent ? parent.getBoundingClientRect() : null;
    if (prt && prt.width > 0 && (br.width / prt.width) > 0.85) {
      btnWidth = '100% (Full width)';
    } else {
      btnWidth = 'Auto';
    }
    btnPadding = bcs.padding || (bcs.paddingTop + ' ' + bcs.paddingLeft);
  }

  // 6. Card Component
  var card = document.querySelector('[class*="card"], [class*="tile"], article, .card');
  var cardPadding = card ? gc(card, 'padding') : '24px';

  return {
    viewport: vpName,
    width: window.innerWidth,
    height: window.innerHeight,
    h1FontSize: h1FontSize,
    h1LineHeight: h1LineHeight,
    h2FontSize: h2FontSize,
    bodyFontSize: bodyFontSize,
    sectionPadding: sectionPadding,
    containerMaxWidth: containerMaxWidth,
    gridColumns: gridColumns,
    cardGap: cardGap,
    buttonWidth: btnWidth,
    buttonPadding: btnPadding,
    cardPadding: cardPadding,
    navigationMode: navigationMode,
    navSummary: navSummary
  };
})()
`;
}

// ─────────────────────────────────────────────────────────────────
// Comparison & Rule Builder
// ─────────────────────────────────────────────────────────────────
function buildResponsiveComparisonAndRules(
  desktop: ViewportSnapshot,
  tablet: ViewportSnapshot,
  mobile: ViewportSnapshot,
  detectedBreakpoints: BreakpointToken[],
  fluidPatterns: string[]
): { comparison: ResponsivePropertyComparison[]; rules: ResponsiveRule[] } {
  const comparison: ResponsivePropertyComparison[] = [];
  const rules: ResponsiveRule[] = [];

  const hasFluidHeading = fluidPatterns.some(p => /clamp/i.test(p) || /vw/i.test(p));

  // 1. H1 font size
  const h1Fluid = hasFluidHeading && desktop.h1FontSize !== mobile.h1FontSize;
  const h1Breakpoint = detectedBreakpoints.find(b => b.value <= 768)?.query || '@media (max-width: 768px)';
  comparison.push({
    property: 'H1 font size',
    category: 'typography',
    desktop: desktop.h1FontSize,
    tablet: tablet.h1FontSize,
    mobile: mobile.h1FontSize,
    isFluid: h1Fluid,
    fluidFormula: h1Fluid ? fluidPatterns[0] : undefined,
    breakpointRule: h1Fluid ? undefined : (desktop.h1FontSize !== mobile.h1FontSize ? h1Breakpoint : undefined)
  });
  if (desktop.h1FontSize !== mobile.h1FontSize) {
    rules.push({
      selector: 'h1',
      property: 'font-size',
      behavior: `H1 font size steps down from ${desktop.h1FontSize} on desktop to ${tablet.h1FontSize} on tablet and ${mobile.h1FontSize} on mobile.`,
      query: h1Fluid ? 'Fluid clamp()' : h1Breakpoint,
      isFluid: h1Fluid
    });
  }

  // 2. Section padding
  const paddingBreakpoint = detectedBreakpoints.find(b => b.value <= 768)?.query || '@media (max-width: 768px)';
  comparison.push({
    property: 'Section padding',
    category: 'spacing',
    desktop: desktop.sectionPadding,
    tablet: tablet.sectionPadding,
    mobile: mobile.sectionPadding,
    breakpointRule: desktop.sectionPadding !== mobile.sectionPadding ? paddingBreakpoint : undefined
  });
  if (desktop.sectionPadding !== mobile.sectionPadding) {
    rules.push({
      selector: 'section',
      property: 'padding',
      behavior: `Section padding compresses from ${desktop.sectionPadding} on desktop to ${tablet.sectionPadding} on tablet and ${mobile.sectionPadding} on mobile.`,
      query: paddingBreakpoint
    });
  }

  // 3. Grid columns
  const gridBreakpoint = detectedBreakpoints.find(b => b.value <= 768)?.query || '@media (max-width: 768px)';
  comparison.push({
    property: 'Grid columns',
    category: 'layout',
    desktop: desktop.gridColumns,
    tablet: tablet.gridColumns,
    mobile: mobile.gridColumns,
    breakpointRule: desktop.gridColumns !== mobile.gridColumns ? gridBreakpoint : undefined
  });
  if (desktop.gridColumns !== mobile.gridColumns) {
    rules.push({
      selector: '.grid, .cards',
      property: 'grid-template-columns',
      behavior: `Main content layout adapts from ${desktop.gridColumns} column${desktop.gridColumns !== '1' ? 's' : ''} on desktop to ${tablet.gridColumns} on tablet and ${mobile.gridColumns} on mobile.`,
      query: gridBreakpoint
    });
  }

  // 4. Navigation
  const navBreakpoint = detectedBreakpoints.find(b => b.value <= 768)?.query || '@media (max-width: 768px)';
  comparison.push({
    property: 'Navigation',
    category: 'navigation',
    desktop: desktop.navigationMode,
    tablet: tablet.navigationMode,
    mobile: mobile.navigationMode,
    breakpointRule: desktop.navigationMode !== mobile.navigationMode ? navBreakpoint : undefined
  });
  if (desktop.navigationMode !== mobile.navigationMode) {
    rules.push({
      selector: 'header nav',
      property: 'display / visibility',
      behavior: `Desktop navigation (${desktop.navigationMode}) collapses into a mobile menu toggle (${mobile.navigationMode}) on mobile screens.`,
      query: navBreakpoint
    });
  }

  // 5. Card gap
  comparison.push({
    property: 'Card gap',
    category: 'spacing',
    desktop: desktop.cardGap,
    tablet: tablet.cardGap,
    mobile: mobile.cardGap,
    breakpointRule: desktop.cardGap !== mobile.cardGap ? gridBreakpoint : undefined
  });
  if (desktop.cardGap !== mobile.cardGap) {
    rules.push({
      selector: '.card-container',
      property: 'gap',
      behavior: `Card gap narrows from ${desktop.cardGap} on desktop to ${tablet.cardGap} on tablet and ${mobile.cardGap} on mobile.`,
      query: gridBreakpoint
    });
  }

  // 6. Button width
  comparison.push({
    property: 'Button width',
    category: 'component',
    desktop: desktop.buttonWidth,
    tablet: tablet.buttonWidth,
    mobile: mobile.buttonWidth,
    breakpointRule: desktop.buttonWidth !== mobile.buttonWidth ? navBreakpoint : undefined
  });
  if (desktop.buttonWidth !== mobile.buttonWidth) {
    rules.push({
      selector: 'button, .btn',
      property: 'width',
      behavior: `Primary action buttons expand to full width (${mobile.buttonWidth}) on mobile devices for touch targets.`,
      query: navBreakpoint
    });
  }

  // 7. H2 font size
  if (desktop.h2FontSize) {
    comparison.push({
      property: 'H2 font size',
      category: 'typography',
      desktop: desktop.h2FontSize,
      tablet: tablet.h2FontSize || desktop.h2FontSize,
      mobile: mobile.h2FontSize || desktop.h2FontSize
    });
  }

  // 8. Body font size
  comparison.push({
    property: 'Body font size',
    category: 'typography',
    desktop: desktop.bodyFontSize,
    tablet: tablet.bodyFontSize,
    mobile: mobile.bodyFontSize
  });

  return { comparison, rules };
}

// ─────────────────────────────────────────────────────────────────
// Primary Export: Multi-Viewport Responsive Extraction
// ─────────────────────────────────────────────────────────────────
export async function extractResponsiveDesignSystem(
  page: Page,
  rootUrl: string
): Promise<ResponsiveDesignSystem> {
  // 1. Detect media queries and stylesheet breakpoint thresholds
  const mqResult = await page.evaluate(MEDIA_QUERY_EVAL_SCRIPT) as {
    breakpoints: BreakpointToken[];
    rawQueries: string[];
    fluidPatterns: string[];
  };

  const detectedBreakpoints = mqResult.breakpoints || [];
  const fluidPatterns = mqResult.fluidPatterns || [];

  // 2. Snapshot Desktop (1440x900)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(60);
  const desktopSnapshot = await page.evaluate(getViewportEvalScript('desktop')) as ViewportSnapshot;

  // 3. Snapshot Tablet (768x1024)
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(60);
  const tabletSnapshot = await page.evaluate(getViewportEvalScript('tablet')) as ViewportSnapshot;

  // 4. Snapshot Mobile (375x667)
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(60);
  const mobileSnapshot = await page.evaluate(getViewportEvalScript('mobile')) as ViewportSnapshot;

  // 5. Restore original desktop viewport
  await page.setViewportSize({ width: 1440, height: 900 });

  // 6. Build comparisons and responsive behavioral rules
  const { comparison, rules } = buildResponsiveComparisonAndRules(
    desktopSnapshot,
    tabletSnapshot,
    mobileSnapshot,
    detectedBreakpoints,
    fluidPatterns
  );

  return {
    detectedBreakpoints,
    viewports: {
      desktop: desktopSnapshot,
      tablet: tabletSnapshot,
      mobile: mobileSnapshot
    },
    comparison,
    rules,
    fluidFormulas: fluidPatterns
  };
}
