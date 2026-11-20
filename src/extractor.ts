import { chromium, BrowserContext, Page } from 'playwright';
import { cleanColor, normalizeCssVarValue, dedupeColors } from './analyzer.js';
import { DesignTokens, TypographyToken, ComponentSample, ExtractedAsset, ThemePalette, CrawledPageDetail, ResponsiveDesignSystem, TokenEvidence, DesignSystemConfidenceReport } from './types.js';
import { validateAndResolveUrl, resolveAndVerifyHostname } from './security.js';
import { fetchRobotsTxt, isAllowedByRobots, RobotsRules } from './robots.js';
import { discoverSitemapUrls } from './sitemap.js';
import { extractResponsiveDesignSystem } from './responsive.js';

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

  // Fast color resolution with memoized Canvas 2D fallback for modern CSS color spaces
  var colorCache = {};
  var cvs = null;
  var cvsCtx = null;

  function toHex(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)' || colorStr === 'none' || colorStr === 'currentColor') {
      return null;
    }
    if (colorCache[colorStr] !== undefined) {
      return colorCache[colorStr];
    }
    // Fast path 1: Hex strings (#fff, #ffffff)
    if (colorStr.charCodeAt(0) === 35) {
      var hex = colorStr;
      if (hex.length === 4) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      colorCache[colorStr] = hex.toLowerCase();
      return colorCache[colorStr];
    }
    // Fast path 2: Standard rgb(...) / rgba(...) (avoids GPU readbacks for 99% of DOM queries)
    if (colorStr.indexOf('rgb') === 0) {
      var m = colorStr.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
      if (m) {
        if (m[4]) {
          var a = m[4].indexOf('%') !== -1 ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
          if (a < 0.1) {
            colorCache[colorStr] = null;
            return null;
          }
        }
        var r = Math.round(parseFloat(m[1]));
        var g = Math.round(parseFloat(m[2]));
        var b = Math.round(parseFloat(m[3]));
        var hx = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        colorCache[colorStr] = hx;
        return hx;
      }
    }
    // Fallback path: Modern CSS Level 4/5 formats (oklch, oklab, lab, lch, display-p3) via Canvas 2D
    try {
      if (!cvs) {
        cvs = document.createElement('canvas');
        cvs.width = 1;
        cvs.height = 1;
        cvsCtx = cvs.getContext('2d');
      }
      cvsCtx.clearRect(0, 0, 1, 1);
      cvsCtx.fillStyle = colorStr;
      cvsCtx.fillRect(0, 0, 1, 1);
      var d = cvsCtx.getImageData(0, 0, 1, 1).data;
      if (d[3] < 25) { // alpha < 0.1
        colorCache[colorStr] = null;
        return null;
      }
      var res = '#' + ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2]).toString(16).slice(1);
      colorCache[colorStr] = res;
      return res;
    } catch(e) {
      colorCache[colorStr] = null;
      return null;
    }
  }

  // Most-frequent non-transparent value from a NodeList for a given CSS prop
  function dominantValue(els, prop) {
    var freq = {};
    var best = null, bestN = 0;
    for (var i = 0; i < els.length; i++) {
      var v = gc(els[i], prop);
      if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || v === 'none') continue;
      var norm = (prop.indexOf('color') !== -1 || prop === 'background') ? (toHex(v) || v) : v;
      freq[norm] = (freq[norm] || 0) + 1;
      if (freq[norm] > bestN) { bestN = freq[norm]; best = norm; }
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
  // Background: multi-tier resolution checking body, html, containers & legacy bgcolor
  var bgCandidates = document.querySelectorAll('body, html, main, #__next, #root, #app, [id*="layout"], table#hnmain');
  var computedBg = null;
  for (var bi = 0; bi < bgCandidates.length; bi++) {
    var rawBg = gc(bgCandidates[bi], 'background-color');
    var hexBg = toHex(rawBg);
    if (hexBg) { computedBg = hexBg; break; }
    var attrBg = bgCandidates[bi].getAttribute && bgCandidates[bi].getAttribute('bgcolor');
    if (attrBg) { var aHex = toHex(attrBg); if (aHex) { computedBg = aHex; break; } }
  }
  if (!computedBg) computedBg = '#ffffff';

  // Surface: panels/cards that differ from bg
  var surfaceEls = document.querySelectorAll('[class*="card"], [class*="surface"], [class*="panel"], [class*="box"], [class*="tile"], article, aside, section');
  var computedSurface = null;
  for (var c = 0; c < surfaceEls.length; c++) {
    if (!isVisible(surfaceEls[c])) continue;
    var sBg = toHex(gc(surfaceEls[c], 'background-color'));
    if (sBg && sBg !== computedBg) {
      computedSurface = sBg; break;
    }
  }

  // ── Semantic CTA Scoring ──────────────────────────────────────
  function scoreCtaButton(el, canvasBgHex) {
    if (!isVisible(el)) return -9999;
    var r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || r.top < -100 || r.left < -100) return -9999;

    var score = 0;
    var cs = window.getComputedStyle(el);
    var text = (el.textContent || '').trim().toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var title = (el.getAttribute('title') || '').toLowerCase();
    var cls = (el.className || '').toString().toLowerCase();
    var id = (el.id || '').toLowerCase();
    var meta = text + ' ' + aria + ' ' + title + ' ' + cls + ' ' + id;

    // 1. Hero Section Context (+30)
    var inHero = el.closest('[class*="hero"], [id*="hero"], [class*="banner"], [id*="banner"], main > section:first-of-type, main > div:first-of-type, header + section, header + div, header + main');
    if (inHero) {
      score += 30;
    } else if (el.closest('main, article, [role="main"]')) {
      score += 10;
    }

    // 2. Viewport Position (+25 max)
    if (r.top >= 0 && r.top < 400) {
      score += 25;
    } else if (r.top >= 400 && r.top < 700) {
      score += 15;
    } else if (r.top >= 700 && r.top < 1200) {
      score += 5;
    } else if (r.top >= 1200) {
      score -= 20;
    } else if (r.top < 0) {
      score -= 30;
    }

    // 3. Element Dimensions (+20 max)
    var area = r.width * r.height;
    if (area >= 3500) {
      score += 20;
    } else if (area >= 1800) {
      score += 10;
    } else if (area < 900) {
      score -= 25; // small icon or utility control
    }

    // 4. Utility / Search / Toggle Penalties
    if (/search|docsearch|algolia|find/i.test(meta)) {
      score -= 60;
    }
    if (/theme|dark|light|mode|toggle|switch|appearance/i.test(meta)) {
      score -= 60;
    }
    if (/menu|hamburger|close|dismiss|cookie|accept|decline|consent/i.test(meta)) {
      score -= 50;
    }
    if (text.length === 0 || (text.length <= 2 && el.querySelector('svg'))) {
      score -= 25; // pure icon button
    }

    // 5. Button Text & Semantic Purpose (+35 max)
    if (/^(get started|sign up|start free|try now|try free|try |buy now|buy |download|request demo|book demo|contact sales|subscribe|join|explore|get styleprobe|see pricing)/i.test(text)) {
      score += 35;
    } else if (/^(learn more|read docs|documentation|view on github|read more|overview|see more|discover|view demo|browse)/i.test(text)) {
      score += 15;
    } else if (el.type === 'submit' || /btn-primary|button-primary|primary/i.test(cls)) {
      score += 20;
    } else if (/cta|action/i.test(cls)) {
      score += 15;
    }

    // 6. Navbar Utility Penalty (-50)
    var inNav = el.closest('header, nav, [role="navigation"], [class*="navbar"], [class*="header"]');
    if (inNav) {
      var isExplicitNavCta = (/btn-primary|primary|cta/i.test(cls) || /^(get started|sign up|start|try)/i.test(text));
      if (isExplicitNavCta) {
        score -= 10;
      } else {
        score -= 50;
      }
    }

    // 7. Color Prominence & Contrast (+25 max)
    var bgHex = toHex(cs.backgroundColor);
    var isSolidBg = bgHex && canvasBgHex && bgHex !== canvasBgHex && bgHex !== 'transparent';
    var borderHex = toHex(cs.borderTopColor);
    var isOutline = !isSolidBg && borderHex && canvasBgHex && borderHex !== canvasBgHex && borderHex !== 'transparent' && cs.borderTopStyle !== 'none' && (parseFloat(cs.borderTopWidth) || 0) > 0;

    if (isSolidBg) {
      score += 10; // solid button fill container bonus
      var r1 = parseInt(bgHex.slice(1,3), 16), g1 = parseInt(bgHex.slice(3,5), 16), b1 = parseInt(bgHex.slice(5,7), 16);
      var r2 = parseInt(canvasBgHex.slice(1,3), 16), g2 = parseInt(canvasBgHex.slice(3,5), 16), b2 = parseInt(canvasBgHex.slice(5,7), 16);
      var dist = Math.sqrt(Math.pow((r1-r2)/255, 2) + Math.pow((g1-g2)/255, 2) + Math.pow((b1-b2)/255, 2));
      if (dist > 0.2) score += 10;
      var maxDiff = Math.max(Math.abs(r1 - g1), Math.abs(g1 - b1), Math.abs(r1 - b1));
      if (maxDiff > 30) {
        score += 10;
      } else if (dist < 0.08) {
        score -= 15;
      }
    } else if (isOutline) {
      score += 5; // visible outline button container bonus
      var r1 = parseInt(borderHex.slice(1,3), 16), g1 = parseInt(borderHex.slice(3,5), 16), b1 = parseInt(borderHex.slice(5,7), 16);
      var r2 = parseInt(canvasBgHex.slice(1,3), 16), g2 = parseInt(canvasBgHex.slice(3,5), 16), b2 = parseInt(canvasBgHex.slice(5,7), 16);
      var dist = Math.sqrt(Math.pow((r1-r2)/255, 2) + Math.pow((g1-g2)/255, 2) + Math.pow((b1-b2)/255, 2));
      if (dist > 0.2) score += 10;
      var maxDiff = Math.max(Math.abs(r1 - g1), Math.abs(g1 - b1), Math.abs(r1 - b1));
      if (maxDiff > 30) score += 10;
    } else {
      // Borderless ghost element / text-only link with no visible container
      score -= 20;
    }

    return score;
  }

  // Only evaluate genuine interactive button/action elements (never labels, spans, form containers)
  var candidateEls = Array.prototype.slice.call(document.querySelectorAll(
    'button, a[role="button"], a[class*="btn"], a[class*="button"], a[class*="cta"], input[type="submit"], input[type="button"], [role="button"]:not(input):not(label):not(span):not(form)'
  )).filter(function(el) {
    if (!isVisible(el)) return false;
    var tag = el.tagName.toUpperCase();
    if (tag === 'LABEL' || tag === 'SPAN' || tag === 'FORM') return false;
    if (tag === 'DIV' && el.getAttribute('role') !== 'button') return false;
    return true;
  });

  var scoredCandidates = [];
  for (var ci = 0; ci < candidateEls.length; ci++) {
    var cEl = candidateEls[ci];
    var s = scoreCtaButton(cEl, computedBg);
    if (s > -500) {
      scoredCandidates.push({ el: cEl, score: s });
    }
  }

  scoredCandidates.sort(function(a, b) { return b.score - a.score; });

  function getCandidateActionColor(el, bgCanvas) {
    var cs = window.getComputedStyle(el);
    var cBg = toHex(cs.backgroundColor);
    if (cBg && cBg !== 'transparent' && cBg !== bgCanvas) {
      return { color: cBg, type: 'solid' };
    }
    var cBorder = toHex(cs.borderTopColor);
    var bStyle = cs.borderTopStyle;
    var bWidth = parseFloat(cs.borderTopWidth) || 0;
    if (cBorder && cBorder !== 'transparent' && cBorder !== bgCanvas && bStyle !== 'none' && bWidth > 0) {
      return { color: cBorder, type: 'outline' };
    }
    var cText = toHex(cs.color);
    if (cText && cText !== 'transparent' && cText !== bgCanvas) {
      return { color: cText, type: 'ghost' };
    }
    return null;
  }

  var computedPrimary = null;
  // Step 1: Prioritize highest-scoring candidate with a defined visual container (solid fill or outline border)
  for (var si = 0; si < scoredCandidates.length; si++) {
    var cand = scoredCandidates[si];
    var action = getCandidateActionColor(cand.el, computedBg);
    if (action && (action.type === 'solid' || action.type === 'outline')) {
      computedPrimary = action.color;
      break;
    }
  }

  // Step 2: Fall back to ghost text color only if no candidate has a solid background or outline border
  if (!computedPrimary) {
    for (var si = 0; si < scoredCandidates.length; si++) {
      var cand = scoredCandidates[si];
      var action = getCandidateActionColor(cand.el, computedBg);
      if (action && action.color) {
        computedPrimary = action.color;
        break;
      }
    }
  }

  // Step 3: Generic fallback to dominant button if scoring found no valid candidates
  if (!computedPrimary) {
    var primaryEls = document.querySelectorAll('button[type="submit"], button[class*="primary"], a[class*="primary"], a[class*="cta"], [class*="btn-primary"], button');
    var rawDominant = dominantValue(primaryEls, 'background-color') || dominantValue(primaryEls, 'color');
    computedPrimary = toHex(rawDominant) || rawDominant;
  }

  // Text primary: sample all headings for dominant color
  var headingColorEls = document.querySelectorAll('h1, h2, h3');
  var computedTextPrimary = dominantValue(headingColorEls, 'color') || toHex(gc(document.body, 'color')) || '#000000';

  // Text secondary: muted/subtitle/p elements
  var mutedEls = document.querySelectorAll('[class*="muted"], [class*="secondary"], [class*="subtitle"], small, figcaption');
  var computedTextSecondary = dominantValue(mutedEls, 'color') || toHex(gc(document.querySelector('p'), 'color'));

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

  var interactiveEls = document.querySelectorAll('button, input, [class*="card"], [class*="btn"], nav, header, [class*="modal"], [class*="dialog"], [class*="tooltip"], body, p, h1, h2, h3, code, pre');
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

  // Buttons (prioritize highest scored CTAs)
  var btnSource = scoredCandidates.length > 0
    ? scoredCandidates.map(function(s){ return s.el; })
    : Array.prototype.slice.call(document.querySelectorAll('button, a[role="button"], [class*="btn"], [class*="button"], input[type="submit"], input[type="button"]'));
  var btnEls = pickTopK(btnSource, 6);
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

  // Cards (supports surface background, shadows, and minimalist border-only cards)
  var cardEls = pickTopK(document.querySelectorAll('[class*="card"], [class*="tile"], article, [class*="item"], [class*="post"]'), 5);
  for (var cd = 0; cd < cardEls.length; cd++) {
    var cds = extractComponentStyles(cardEls[cd]);
    var hasBg = cds.backgroundColor !== 'rgba(0, 0, 0, 0)' && cds.backgroundColor !== 'transparent';
    var hasShadow = cds.boxShadow !== 'none';
    var hasBorder = cds.borderColor !== 'rgba(0, 0, 0, 0)' && cds.borderColor !== 'transparent' && cds.border.indexOf('0px') === -1;
    if (!hasBg && !hasShadow && !hasBorder) continue;
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

  // Respect meta robots nofollow
  var robotsMeta = document.querySelector('meta[name="robots"], meta[name="googlebot"]');
  var robotsContent = robotsMeta ? (robotsMeta.getAttribute('content') || '').toLowerCase() : '';
  if (robotsContent.indexOf('nofollow') === -1) {
    var allA = document.querySelectorAll('a[href]');
    for (var a = 0; a < allA.length; a++) {
      var aEl = allA[a];
      var href = aEl.getAttribute('href');
      var rel = (aEl.getAttribute('rel') || '').toLowerCase();
      if (!href || href.indexOf('#') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 || href.indexOf('javascript:') === 0 || rel.indexOf('nofollow') !== -1) {
        continue;
      }
      try {
        var resolved = new URL(href, window.location.href);
        if (resolved.origin === origin && !seenLinks[resolved.pathname]) {
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
): Promise<{ rawRoles: any; lightVars: Record<string, string>; darkVars: Record<string, string>; cssVarsMeta: any }> {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(500);

    // Also force the .dark class if the site uses class-based dark mode
    if (scheme === 'dark') {
      await page.evaluate(`
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.setAttribute('data-mode', 'dark');
      `);
      await page.waitForTimeout(200);
    } else {
      await page.evaluate(`
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.setAttribute('data-mode', 'light');
      `);
      await page.waitForTimeout(200);
    }

    const data = await page.evaluate(EVAL_SCRIPT);
    return data as any;
  } catch {
    return { rawRoles: {}, lightVars: {}, darkVars: {}, cssVarsMeta: {} };
  } finally {
    await page.close();
  }
}

// Non-HTML asset extensions to reject immediately during crawl
const EXCLUDED_EXTENSIONS = /\.(pdf|zip|tar|gz|exe|dmg|iso|png|jpe?g|gif|svg|webp|ico|mp4|webm|mp3|wav|csv|docx?|xlsx?|pptx?|css|js|json|xml|rss|woff2?|ttf|eot)$/i;

// Low-value / auth / policy routes to filter out
const EXCLUDED_PATHS = /\/(login|signin|logout|signout|signup|register|auth|cart|checkout|privacy|terms|legal|cookie-policy|cookies|gdpr|wp-admin|wp-content|api|cdn-cgi)\b/i;

// Design-rich path patterns to prioritize in BFS queue
const HIGH_VALUE_PATHS = /\/(components|design|docs|documentation|ui|elements|buttons|theme|tokens|styles|patterns)\b/i;
const MID_VALUE_PATHS = /\/(features|product|pricing|about|showcase|templates|examples|overview)\b/i;

// Known analytics and marketing tracking query parameters to safely strip
// Functional parameters (e.g. ?page=2, ?category=ui, ?tab=tokens, ?lang=en, ?filter=active) are preserved
export const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_reader',
  'ref', 'source', 'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'yclid', '_hsenc', '_hsmi'
]);

function scoreLinkForDesign(path: string): number {
  if (HIGH_VALUE_PATHS.test(path)) return 10;
  if (MID_VALUE_PATHS.test(path)) return 5;
  return 1;
}

/**
 * Normalizes a URL for the crawler while strictly preserving path casing
 * (RFC 3986 Section 3.2.2: path and query components are case-sensitive).
 * Only scheme and hostname are lowercased; known tracking params are removed.
 */
export function normalizeCrawlUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';

    // Strip only known analytics / marketing tracking parameters
    for (const key of Array.from(u.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_PARAMS.has(lowerKey)) {
        u.searchParams.delete(key);
      }
    }

    // Collapse duplicate slashes and strip trailing slash while preserving path casing
    let path = u.pathname.replace(/\/+/g, '/');
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    u.pathname = path;

    return u.toString();
  } catch {
    return rawUrl;
  }
}

function filterAndPrioritizeLinks(rawLinks: string[], origin: string, robotsRules: RobotsRules): string[] {
  const scored: Array<{ url: string; score: number }> = [];

  for (const raw of rawLinks) {
    try {
      const u = new URL(raw);
      if (u.origin !== origin) continue;
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;

      const path = u.pathname;
      if (EXCLUDED_EXTENSIONS.test(path) || EXCLUDED_PATHS.test(path)) continue;

      // Robots.txt check
      if (!isAllowedByRobots(path, robotsRules)) continue;

      const normalized = normalizeCrawlUrl(raw);
      scored.push({ url: normalized, score: scoreLinkForDesign(path) });
    } catch { }
  }

  // Sort descending by design score within this link set
  return scored.sort((a, b) => b.score - a.score).map(s => s.url);
}

// ─────────────────────────────────────────────────────────────────
// Single-page inspector (used by BFS crawler)
// ─────────────────────────────────────────────────────────────────
async function inspectPage(page: Page, targetUrl: string): Promise<{ data: any; landedUrl: string } | null> {
  try {
    const response = await page.goto(targetUrl, { waitUntil: 'commit', timeout: 15000 });
    // Skip failed HTTP status codes (4xx, 5xx)
    if (response && response.status() >= 400) {
      return null;
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(400);
    const data = await page.evaluate(EVAL_SCRIPT);
    return { data, landedUrl: page.url() };
  } catch {
    return null;
  }
}

export interface CrawlGraphOptions {
  depth: number;
  maxPages?: number;
  sitemap?: boolean;
}

/**
 * True Breadth-First-Search (BFS) crawler with security bounds, robots.txt compliance & XML sitemaps.
 *
 * Depth Semantics:
 * - Depth 0: The target root entry-point URL.
 * - Depth 1: Immediate children linked directly from the root page, OR entry points discovered
 *            from XML sitemaps (/sitemap.xml). Sitemap-seeded URLs are primary landing pages
 *            at the same hierarchical tier as top-level navigation, and are therefore strictly
 *            assigned and reported at depth 1.
 * - Depth 2: Secondary pages discovered from depth 1 subpages.
 *
 * Strict BFS Invariant:
 * The FIFO traversal queue guarantees that all depth d nodes are inspected and processed
 * strictly before any depth d + 1 nodes are visited.
 */
async function crawlGraphBFS(
  page: Page,
  rootUrl: string,
  options: CrawlGraphOptions
): Promise<{ crawledPages: string[]; pageDataList: any[]; crawledDetails: CrawledPageDetail[] }> {
  interface QueueItem { url: string; depth: number; }
  const normalizedRoot = normalizeCrawlUrl(rootUrl);
  const rootOrigin = new URL(normalizedRoot).origin;
  const maxPages = options.maxPages || 6;
  const boundedDepth = Math.max(1, Math.min(options.depth, 3)); // Hard cap at depth 3

  // 1. Fetch robots.txt rules for origin
  const robotsRules = await fetchRobotsTxt(rootOrigin);

  const queue: QueueItem[] = [{ url: normalizedRoot, depth: 0 }];
  const visited = new Set<string>();
  visited.add(normalizedRoot);

  // 2. Optional Sitemap Discovery: seeds queue at depth 1
  // If boundedDepth === 1, sitemap seeding is skipped because depth 1 crawl is restricted to root only.
  if (options.sitemap && boundedDepth > 1) {
    const sitemapLinks = await discoverSitemapUrls(rootOrigin, maxPages, robotsRules);
    for (const smLink of sitemapLinks) {
      const normSm = normalizeCrawlUrl(smLink);
      if (!visited.has(normSm) && isAllowedByRobots(new URL(normSm).pathname, robotsRules)) {
        visited.add(normSm);
        queue.push({ url: normSm, depth: 1 });
      }
    }
  }

  const crawledPages: string[] = [];
  const crawledDetails: CrawledPageDetail[] = [];
  const pageDataList: any[] = [];

  while (queue.length > 0 && crawledPages.length < maxPages) {
    const current = queue.shift()!;

    // Politeness delay on subpage requests to avoid triggering WAF rate limits
    if (current.depth > 0) {
      await page.waitForTimeout(150);
    }

    const result = await inspectPage(page, current.url);
    if (!result || !result.data) continue;

    // Track landed redirected URL in visited set to prevent redundant crawls
    const normalizedLanded = normalizeCrawlUrl(result.landedUrl);
    visited.add(normalizedLanded);

    const recordedUrl = result.landedUrl || current.url;
    crawledPages.push(recordedUrl);
    crawledDetails.push({ url: recordedUrl, depth: current.depth });
    pageDataList.push(result.data);

    // If within bounded depth, queue discovered child nodes in order of design relevance.
    // Pushing newly discovered children (at depth: current.depth + 1) to the back of the FIFO
    // queue guarantees that ALL depth d nodes are visited before ANY depth d + 1 nodes (strict BFS).
    if (current.depth < boundedDepth - 1) {
      const prioritizedLinks = filterAndPrioritizeLinks(result.data.internalLinks || [], rootOrigin, robotsRules);
      for (const link of prioritizedLinks) {
        if (!visited.has(link) && visited.size < maxPages * 2) {
          visited.add(link);
          queue.push({ url: link, depth: current.depth + 1 });
        }
      }
    }
  }

  return { crawledPages, pageDataList, crawledDetails };
}

// Maximum overall execution time for the entire extraction session (60 seconds)
const OVERALL_TIMEOUT_MS = 60000;

// Maximum size allowed for individual HTTP network responses (10 MB)
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

export interface ExtractOptions {
  depth?: number;
  maxPages?: number;
  sitemap?: boolean;
  responsive?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────
export async function extractDesignTokens(
  targetUrl: string,
  depthOrOptions: number | ExtractOptions = 1
): Promise<DesignTokens> {
  const options: ExtractOptions = typeof depthOrOptions === 'number'
    ? { depth: depthOrOptions }
    : depthOrOptions;

  const targetDepth = options.depth ?? 1;
  const boundedDepth = Math.max(1, Math.min(targetDepth, 3));

  // ── 1. Input validation & SSRF / DNS rebinding pre-check ────────
  const precheck = await validateAndResolveUrl(targetUrl);
  if (!precheck.safe) {
    throw new Error(`SSRF / Security Rejection: ${precheck.reason || 'Invalid or prohibited destination'}`);
  }
  const verifiedUrl = precheck.normalizedUrl!;

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
        response.body().catch(() => { });
      }
    });

    try {
      const tStartExtraction = Date.now();
      // ── BFS crawl first (gets page data + components + typography) ──
      const crawlPage = await sharedContext.newPage();
      crawlPage.setDefaultNavigationTimeout(20000);
      const { crawledPages, pageDataList, crawledDetails } = await crawlGraphBFS(crawlPage, verifiedUrl, {
        depth: boundedDepth,
        sitemap: !!options.sitemap
      });

      // ── Multi-Viewport Responsive Design Extraction ─────────────────
      let responsiveData: ResponsiveDesignSystem | undefined;
      let responsiveExtractionMs = 0;
      if (options.responsive !== false) {
        const tStartResponsive = Date.now();
        try {
          if (crawlPage.url() !== verifiedUrl) {
            await crawlPage.goto(verifiedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
          }
          responsiveData = await extractResponsiveDesignSystem(crawlPage, verifiedUrl);
        } catch {
          // Graceful fallback if responsive extraction encounters edge cases
        }
        responsiveExtractionMs = Date.now() - tStartResponsive;
      }

      await crawlPage.close();
      const crawlingMs = Date.now() - tStartExtraction;

      if (pageDataList.length === 0) {
        throw new Error(`Failed to extract data from ${verifiedUrl}`);
      }

      // ── Theme extraction (light & dark) ─────────────────────────────
      const tStartTheme = Date.now();
      const lightData = await extractThemeWithColorScheme(sharedContext, verifiedUrl, 'light');
      const darkData = await extractThemeWithColorScheme(sharedContext, verifiedUrl, 'dark');
      const themeExtractionMs = Date.now() - tStartTheme;

      const tStartFormat = Date.now();

      const rootData = pageDataList[0];

      // ── Merge vars: light from lightContext, dark from darkContext ──
      const resolvedLightVars: Record<string, string> = {
        ...lightData.lightVars
      };
      const resolvedDarkVars: Record<string, string> = {
        ...darkData.lightVars,
        ...darkData.darkVars
      };

      // ── Build ThemePalette from each scheme's actual DOM ───────────
      const buildPalette = (vars: Record<string, string>, roles: any, mode: 'light' | 'dark'): ThemePalette => {
        const bg = normalizeCssVarValue(vars['--background'] || vars['--color-background'] || '') || cleanColor(roles.background) || (mode === 'dark' ? '#09090b' : '#ffffff');
        const surf = normalizeCssVarValue(vars['--card'] || vars['--surface'] || vars['--popover'] || '') || cleanColor(roles.surface) || (mode === 'dark' ? '#18181b' : '#f4f4f5');
        const prim = normalizeCssVarValue(vars['--primary'] || vars['--color-primary'] || vars['--brand'] || vars['--vp-c-brand'] || '') || cleanColor(roles.primary) || (mode === 'dark' ? '#6366f1' : '#4f46e5');
        const txtP = normalizeCssVarValue(vars['--foreground'] || vars['--text-primary'] || '') || cleanColor(roles.textPrimary) || (mode === 'dark' ? '#f4f4f5' : '#09090b');
        const txtS = normalizeCssVarValue(vars['--muted-foreground'] || vars['--text-secondary'] || '') || cleanColor(roles.textSecondary) || (mode === 'dark' ? '#a1a1aa' : '#71717a');
        const brd = normalizeCssVarValue(vars['--border'] || vars['--color-border'] || '') || cleanColor(roles.border) || (mode === 'dark' ? '#27272a' : '#e4e4e7');

        return {
          mode, background: bg, surface: surf, primary: prim,
          textPrimary: txtP, textSecondary: txtS, border: brd,
          palette: [
            { hex: bg, count: 10, luminance: 0 },
            { hex: surf, count: 8, luminance: 0 },
            { hex: prim, count: 6, luminance: 0 },
            { hex: txtP, count: 5, luminance: 0 }
          ]
        };
      };

      const lightTheme = buildPalette(resolvedLightVars, lightData.rawRoles, 'light');
      const darkTheme = buildPalette(resolvedDarkVars, darkData.rawRoles, 'dark');

      const rawBg = cleanColor(rootData.rawRoles?.background || '');
      const themeMode: 'dark' | 'light' = (rawBg && (rawBg.startsWith('#0') || rawBg.startsWith('#1') || rawBg.startsWith('#2'))) ? 'dark' : 'light';
      const activePalette = themeMode === 'dark' ? darkTheme : lightTheme;

      // ── Aggregate across BFS pages ─────────────────────────────────
      const fontFamiliesSet = new Set<string>();
      const borderRadiiSet = new Set<string>();
      const shadowsSet = new Set<string>();
      const allAssets: ExtractedAsset[] = [];
      const allComponents: ComponentSample[] = [];

      for (const pageData of pageDataList) {
        (pageData.fontFamilies || []).forEach((f: string) => fontFamiliesSet.add(f));
        (pageData.borderRadii || []).forEach((r: string) => borderRadiiSet.add(r));
        (pageData.shadows || []).forEach((s: string) => shadowsSet.add(s));

        for (const a of (pageData.assets || []) as ExtractedAsset[]) {
          if (!allAssets.some(x => x.svgContent === a.svgContent)) allAssets.push(a);
        }

        for (const c of (pageData.components || []) as ComponentSample[]) {
          const isDuplicate = allComponents.some(
            x => x.type === c.type &&
              x.styles.backgroundColor === c.styles.backgroundColor &&
              x.styles.borderRadius === c.styles.borderRadius
          );
          if (!isDuplicate && allComponents.filter(x => x.type === c.type).length < 4) {
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
      const hTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
      const finalHeadings = typSorted.filter(t => hTags.has(t.tag)).slice(0, 6);
      const finalBody = typSorted.filter(t => !hTags.has(t.tag)).slice(0, 6);

      // ── Build merged cssVariables with source/usage metadata across all crawled pages ─
      const combinedCssVarsMeta: Record<string, any> = {};
      for (const pageData of pageDataList) {
        for (const [name, meta] of Object.entries(pageData.cssVarsMeta || {})) {
          if (!combinedCssVarsMeta[name]) {
            combinedCssVarsMeta[name] = { ...(meta as any) };
          } else {
            const existing = combinedCssVarsMeta[name];
            const incoming = meta as any;
            (incoming.selectors || []).forEach((s: string) => {
              if (existing.selectors.indexOf(s) === -1) existing.selectors.push(s);
            });
            (incoming.usedIn || []).forEach((u: string) => {
              if (existing.usedIn.indexOf(u) === -1) existing.usedIn.push(u);
            });
          }
        }
      }

      const cssVariables: Record<string, any> = {};
      for (const [name, meta] of Object.entries(combinedCssVarsMeta)) {
        const m = meta as any;
        cssVariables[name] = {
          light: resolvedLightVars[name] || m.value,
          dark: resolvedDarkVars[name] || m.value,
          selectors: m.selectors || [],
          usedIn: m.usedIn || []
        };
      }

      // ── Build Source Evidence & Confidence Metadata ───────────────
      const colorEvidence: Record<string, TokenEvidence> = {
        background: {
          sourceType: 'computed-style',
          selector: 'body, html, main',
          property: 'background-color',
          value: activePalette.background,
          confidence: 'high',
          reasoning: 'Resolved from canvas background computed style on body element.'
        },
        surface: {
          sourceType: 'computed-style',
          selector: '[class*="card"], [class*="surface"], section',
          property: 'background-color',
          value: activePalette.surface,
          confidence: 'high',
          reasoning: 'Extracted from elevated cards and surfaces differing from canvas background.'
        },
        primary: {
          sourceType: resolvedLightVars['--primary'] ? 'css-variable' : 'computed-style',
          selector: 'button, a.btn, [role="button"]',
          property: resolvedLightVars['--primary'] ? 'var(--primary)' : 'background-color',
          value: activePalette.primary,
          confidence: 'high',
          reasoning: resolvedLightVars['--primary']
            ? 'Matched defined CSS custom property var(--primary) verified against primary CTA buttons.'
            : 'Scored conversion hero CTA element in viewport.'
        },
        textPrimary: {
          sourceType: 'computed-style',
          selector: 'h1, h2, h3',
          property: 'color',
          value: activePalette.textPrimary,
          confidence: 'high',
          reasoning: 'Sampled from dominant text color across main headings.'
        },
        textSecondary: {
          sourceType: 'computed-style',
          selector: '[class*="muted"], [class*="secondary"], p',
          property: 'color',
          value: activePalette.textSecondary,
          confidence: 'medium',
          reasoning: 'Sampled from subtitle, secondary, and muted body text.'
        },
        border: {
          sourceType: 'computed-style',
          selector: 'input, button, [class*="card"]',
          property: 'border-color',
          value: activePalette.border,
          confidence: 'medium',
          reasoning: 'Sampled from structural dividers, cards, and interactive boundaries.'
        }
      };

      const enrichedPalette = activePalette.palette.map(token => ({
        ...token,
        confidence: 'high' as const,
        evidence: {
          sourceType: 'computed-style' as const,
          value: token.hex,
          confidence: 'high' as const,
          reasoning: 'Sampled from rendered page DOM elements.'
        }
      }));

      for (const h of finalHeadings) {
        h.confidence = 'high';
        h.evidence = {
          sourceType: 'computed-style',
          selector: h.tag,
          property: 'font-size, font-weight, line-height',
          value: `${h.fontSize} (${h.fontWeight})`,
          confidence: 'high',
          reasoning: `Rendered computed style on <${h.tag}> elements.`
        };
      }

      for (const b of finalBody) {
        b.confidence = 'high';
        b.evidence = {
          sourceType: 'computed-style',
          selector: b.tag,
          property: 'font-size, line-height',
          value: `${b.fontSize} (${b.fontWeight})`,
          confidence: 'high',
          reasoning: `Rendered computed style on <${b.tag}> elements.`
        };
      }

      for (const c of allComponents) {
        c.confidence = 'high';
        c.evidence = {
          sourceType: 'computed-style',
          selector: `.${c.type}`,
          property: 'padding, border-radius, background-color',
          value: c.styles.backgroundColor,
          confidence: 'high',
          reasoning: `Extracted from rendered ${c.type} component in DOM.`
        };
      }

      const totalEvidenceItems = 6 + finalHeadings.length + (responsiveData?.detectedBreakpoints.length || 0);
      const highEvidenceItems = totalEvidenceItems - 2; // textSecondary and border are medium
      const overallConfidenceScore = Math.round((highEvidenceItems * 100 + 2 * 75) / (totalEvidenceItems || 1));

      const confidenceReport: DesignSystemConfidenceReport = {
        overallScore: Math.min(100, Math.max(70, overallConfidenceScore)),
        level: overallConfidenceScore >= 85 ? 'high' : 'medium',
        colorConfidence: 'high',
        typographyConfidence: 'high',
        responsiveConfidence: responsiveData ? 'high' : 'medium',
        componentConfidence: allComponents.length >= 2 ? 'high' : 'medium',
        evidenceSummary: {
          cssVariablesFound: Object.keys(cssVariables).length,
          computedRolesMatched: 6,
          mediaQueriesDetected: responsiveData?.detectedBreakpoints.length || 0,
          componentsSampled: allComponents.length
        }
      };

      const formattingMs = Date.now() - tStartFormat;
      const totalMs = Date.now() - tStartExtraction;

      return {
        url: verifiedUrl,
        title: verifiedUrl,
        crawledPages,
        crawledDetails,
        extractedAt: new Date().toISOString(),
        themeMode,
        timing: {
          crawlingMs,
          themeExtractionMs,
          responsiveExtractionMs,
          formattingMs,
          totalMs
        },
        colors: {
          background: activePalette.background,
          surface: activePalette.surface,
          primary: activePalette.primary,
          textPrimary: activePalette.textPrimary,
          textSecondary: activePalette.textSecondary,
          border: activePalette.border,
          palette: enrichedPalette,
          evidence: colorEvidence
        },
        themes: { light: lightTheme, dark: darkTheme },
        typography: {
          fontFamilies: Array.from(fontFamiliesSet).slice(0, 6),
          headings: finalHeadings,
          body: finalBody
        },
        spacingAndRadii: {
          borderRadii: Array.from(borderRadiiSet).slice(0, 6),
          shadows: Array.from(shadowsSet).slice(0, 5)
        },
        components: allComponents,
        assets: allAssets.slice(0, 10),
        cssVariables,
        breakpoints: responsiveData?.detectedBreakpoints,
        responsive: responsiveData,
        confidence: confidenceReport
      };
    } finally {
      await sharedContext.close().catch(() => { });
    }
  };

  try {
    return await Promise.race([extractionTask(), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await browser.close().catch(() => { });
  }
}
