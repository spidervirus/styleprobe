import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanColor, normalizeCssVarValue } from '../src/analyzer.js';
import { parseModernColor, modernColorToHex, oklchToLinearSrgb, labToLinearSrgb, p3ToLinearSrgb, linearRgbToHex } from '../src/colors.js';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { extractDesignTokens } from '../src/extractor.js';

let server: FixtureServer;

test.before(async () => {
  process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
  server = await startFixtureServer();
});

test.after(async () => {
  delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
  if (server) await server.stop();
});

test('Color & CTA Suite: Modern CSS Spaces, Gamut Safety & Semantic CTA Scoring', async (t) => {

  // ── 1. Modern CSS Color Formats & Conversion Accuracy ─────────────
  await t.test('1. OKLCH color parsing and canonical sRGB conversion', () => {
    // Standard OKLCH coordinates
    const hex1 = cleanColor('oklch(0.6 0.2 240)');
    assert.equal(hex1, '#0089e9', 'oklch(0.6 0.2 240) must convert to #0089e9');

    // Percentage lightness
    const hex2 = cleanColor('oklch(60% 0.2 240)');
    assert.equal(hex2, '#0089e9', 'oklch(60% 0.2 240) must equal 0.6 lightness');

    // Hue with deg unit and alpha channel
    const hex3 = cleanColor('oklch(0.6 0.2 240deg / 0.85)');
    assert.equal(hex3, '#0089e9', 'oklch with deg unit and valid alpha must resolve');

    // Hue with turns
    const hex4 = cleanColor('oklch(0.6 0.2 0.66667turn)');
    assert.equal(hex4, '#0089e9', 'oklch with turn unit must resolve hue accurately');

    // Transparent alpha (< 0.1) must be rejected
    const transparent = cleanColor('oklch(0.6 0.2 240 / 5%)');
    assert.equal(transparent, null, 'Alpha < 10% must return null');
  });

  await t.test('2. OKLAB color parsing and canonical sRGB conversion', () => {
    const hex1 = cleanColor('oklab(0.6 -0.1 -0.1)');
    assert.equal(hex1, '#0090bf', 'oklab(0.6 -0.1 -0.1) must convert to #0090bf');

    // Percentage lightness and alpha
    const hex2 = cleanColor('oklab(60% -0.1 -0.1 / 100%)');
    assert.equal(hex2, '#0090bf', 'oklab with percentages must convert to #0090bf');

    // Low alpha rejection
    const lowAlpha = cleanColor('oklab(0.6 -0.1 -0.1 / 0.05)');
    assert.equal(lowAlpha, null, 'oklab with alpha < 0.1 must return null');
  });

  await t.test('3. CIE LAB color parsing and conversion (D50 to D65 Bradford adaptation)', () => {
    // lab(50 40 50)
    const hex1 = cleanColor('lab(50% 40 50)');
    assert.equal(hex1, '#be5720', 'lab(50% 40 50) must convert to #be5720');

    const hex2 = cleanColor('lab(50 40 50)');
    assert.equal(hex2, '#be5720', 'lab(50 40 50) unitless L must match 50%');

    // Low alpha rejection
    const lowAlpha = cleanColor('lab(50% 40 50 / 0.02)');
    assert.equal(lowAlpha, null, 'lab with alpha < 0.1 must return null');
  });

  await t.test('4. CIE LCH polar color parsing and conversion', () => {
    const hex1 = cleanColor('lch(50% 50 30)');
    assert.equal(hex1, '#bf544f', 'lch(50% 50 30) must convert to #bf544f');

    const hex2 = cleanColor('lch(50 50 30deg)');
    assert.equal(hex2, '#bf544f', 'lch with degree unit must convert to #bf544f');

    const lowAlpha = cleanColor('lch(50% 50 30 / 0.08)');
    assert.equal(lowAlpha, null, 'lch with alpha < 0.1 must return null');
  });

  await t.test('5. Display-P3 wide-gamut parsing and conversion', () => {
    // Pure P3 Red
    const red = cleanColor('color(display-p3 1 0 0)');
    assert.equal(red, '#ff0000', 'color(display-p3 1 0 0) must resolve to #ff0000');

    // Mixed P3 color
    const mixed = cleanColor('color(display-p3 0.9 0.2 0.1)');
    assert.equal(mixed, '#fa0500', 'color(display-p3 0.9 0.2 0.1) must convert to #fa0500');

    // Percentage values
    const pct = cleanColor('color(display-p3 90% 20% 10%)');
    assert.equal(pct, '#fa0500', 'P3 with percentages must equal float representation');

    // Low alpha rejection
    const lowAlpha = cleanColor('color(display-p3 1 0 0 / 0.05)');
    assert.equal(lowAlpha, null, 'P3 with alpha < 0.1 must return null');
  });

  // ── 2. Out-of-Gamut Handling & Clamping ───────────────────────────
  await t.test('6. Out-of-gamut safe clamping without exceptions or NaN', () => {
    // P3 pure green is outside sRGB gamut
    const p3Green = cleanColor('color(display-p3 0 1 0)');
    assert.equal(p3Green, '#00ff00', 'Out-of-gamut P3 green must clamp cleanly to #00ff00');

    // Extreme OKLCH chroma (0.4 chroma is outside standard sRGB triangle)
    const oklchVibrant = cleanColor('oklch(0.8 0.4 140)');
    assert.equal(oklchVibrant, '#00f000', 'Extreme OKLCH chroma must clamp cleanly to #00f000');

    // Ensure format is valid 7-character hex
    assert.match(p3Green!, /^#[0-9a-f]{6}$/i);
    assert.match(oklchVibrant!, /^#[0-9a-f]{6}$/i);
  });

  // ── 3. CSS Variable Normalization with Modern Formats ────────────
  await t.test('7. CSS variable normalization for modern tokens and raw triplets', () => {
    // Raw OKLCH triplets from Tailwind/shadcn
    assert.equal(normalizeCssVarValue('0.6 0.2 240'), '#0089e9');
    assert.equal(normalizeCssVarValue('60% 0.2 240'), '#0089e9');

    // Raw HSL triplets
    assert.equal(normalizeCssVarValue('222.2 84% 4.9%'), '#020817');

    // Raw LAB coordinates
    assert.equal(normalizeCssVarValue('50% 40 50'), '#be5720');

    // Raw RGB triplets
    assert.equal(normalizeCssVarValue('79 70 229'), '#4f46e5');

    // Direct modern functional colors in variables
    assert.equal(normalizeCssVarValue('oklch(0.6 0.2 240)'), '#0089e9');
    assert.equal(normalizeCssVarValue('color(display-p3 1 0 0)'), '#ff0000');
  });

  // ── 4. Live Fixture: Modern Colors Extraction ────────────────────
  await t.test('8. End-to-end extraction of modern CSS color tokens in DOM and styles', async () => {
    const targetUrl = `${server.baseUrl}/modern-colors.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Primary token extracted from oklch(0.6 0.2 240)
    assert.equal(tokens.colors.primary, '#0089e9', 'Primary color should resolve OKLCH to #0089e9');

    // Surface token extracted from lab(95% -10 10)
    assert.ok(tokens.colors.surface, 'Surface should be extracted from CIE LAB');

    // CSS variables preservation
    const primaryVar = tokens.cssVariables['--primary'] as any;
    assert.ok(primaryVar, '--primary CSS variable should be recorded');
    assert.equal(primaryVar.light, 'oklch(0.6 0.2 240)', 'Raw variable string should be preserved in metadata');
  });

  // ── 5. Semantic CTA Scoring: Hero vs. Navbar Utility Buttons ─────
  await t.test('9. Hero CTA wins over navbar utility buttons (theme toggle, search, lang)', async () => {
    const targetUrl = `${server.baseUrl}/cta-benchmark.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Hero CTA button color is #6366f1.
    // The navbar contains 4 utility buttons with background #e4e4e7.
    // Semantic CTA scoring must select #6366f1, NOT #e4e4e7!
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#6366f1',
      'Hero CTA #6366f1 must be selected over navbar utility buttons #e4e4e7'
    );

    // Representative button in components list must be the hero CTA button
    const heroBtnComp = tokens.components.find(c => c.type === 'button');
    assert.ok(heroBtnComp, 'Representative button component should be extracted');
    assert.ok(
      heroBtnComp.sampleHtml?.includes('Get Started Free') || heroBtnComp.sampleHtml?.includes('cta-primary'),
      'Extracted button sample should be the hero CTA button, not navbar utility control'
    );
  });

  // ── 6. Competing CTA Buttons Priority ─────────────────────────────
  await t.test('10. Competing CTA buttons: Primary action selected over secondary link', async () => {
    const targetUrl = `${server.baseUrl}/competing-cta.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Primary CTA is "Start Free Trial" with #2563eb
    // Secondary CTA is "View Documentation" with #f1f5f9
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#2563eb',
      'Primary conversion button (#2563eb) must be prioritized over secondary button (#f1f5f9)'
    );
  });

  // ── 7. Light and Dark Theme Independence ──────────────────────────
  await t.test('11. Light and dark theme independence with modern colors', async () => {
    const targetUrl = `${server.baseUrl}/modern-colors.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    assert.ok(tokens.themes, 'Themes object must be present');
    const light = tokens.themes.light;
    const dark = tokens.themes.dark;

    assert.equal(light.mode, 'light');
    assert.equal(dark.mode, 'dark');

    // Light primary: oklch(0.6 0.2 240) -> #0089e9
    assert.equal(light.primary, '#0089e9', 'Light theme primary must be #0089e9');

    // Dark primary: oklch(0.7 0.15 150) -> green accent
    assert.notEqual(dark.primary, light.primary, 'Dark primary must be independently resolved from light primary');

    // Light and dark backgrounds must not contaminate each other
    assert.notEqual(light.background, dark.background, 'Light and dark backgrounds must be distinct');
  });

  // ── 8. Non-interactive Tag Filtering Regression Test (Wikipedia Bug) ──
  await t.test('12. Non-interactive tags with button classes (span, label, checkbox) do not hijack primary color', async () => {
    const targetUrl = `${server.baseUrl}/non-button-regression.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // .action-btn has #eaecf0. The icon span and label have #404244 with transparent background.
    // Real button's visible background #eaecf0 must be selected, NOT the transparent span's text color!
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#eaecf0',
      'Real button background #eaecf0 must be selected over transparent span/label text color #404244'
    );
  });

  // ── 9. Edge Case: Solid Navbar Utility Buttons vs Outline Hero CTA ──
  await t.test('13. Solid navbar utility buttons competing with an outline hero CTA', async () => {
    const targetUrl = `${server.baseUrl}/cta-solid-nav-outline-hero.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Hero CTA is outline #6366f1 ("Get Started Free"). Navbar has solid utility buttons #334155 and #1e293b.
    // Semantic CTA scoring must prioritize the prominent outline hero CTA over solid navbar utility buttons!
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#6366f1',
      'Prominent outline hero CTA (#6366f1) must be selected over solid navbar buttons (#334155 / #1e293b)'
    );
  });

  // ── 10. Edge Case: Multiple Solid Buttons With Different Semantic Importance ──
  await t.test('14. Multiple solid buttons with different semantic importance', async () => {
    const targetUrl = `${server.baseUrl}/cta-multiple-solid.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Primary conversion CTA is "Start Free Trial" with #10b981.
    // Secondary is #64748b ("View Documentation") and tertiary is #ef4444 ("Dismiss").
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#10b981',
      'High-conversion primary CTA (#10b981) must be prioritized over secondary and tertiary buttons'
    );
  });

  // ── 11. Edge Case: An Outline-Only Page ──
  await t.test('15. An outline-only page cleanly resolves outline CTA color', async () => {
    const targetUrl = `${server.baseUrl}/cta-outline-only.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Page has no solid buttons; hero outline button is #ec4899 ("Join Community").
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#ec4899',
      'Primary outline button (#ec4899) must be selected on an outline-only page'
    );
  });

  // ── 12. Edge Case: Hero CTA Implemented as Accessible Div with role="button" ──
  await t.test('16. Hero CTA implemented as an accessible div with role="button"', async () => {
    const targetUrl = `${server.baseUrl}/cta-accessible-div.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    // Hero CTA is <div role="button" ...> with background #8b5cf6 ("Explore Platform").
    assert.equal(
      tokens.colors.primary.toLowerCase(),
      '#8b5cf6',
      'Accessible div[role="button"] with #8b5cf6 must be discovered and selected as primary CTA'
    );
  });

  // ── 13. Edge Case: A Page With No Genuine Conversion CTA ──
  await t.test('17. A page with no genuine conversion CTA resolves safely without error', async () => {
    const targetUrl = `${server.baseUrl}/cta-no-conversion.html`;
    const tokens = await extractDesignTokens(targetUrl, 1);

    assert.ok(tokens, 'Extraction must return a valid tokens object');
    assert.equal(tokens.colors.background.toLowerCase(), '#ffffff', 'Background must be extracted as #ffffff');
    assert.ok(tokens.colors.primary, 'Primary color must have a safe fallback string');
    assert.ok(Array.isArray(tokens.components), 'Components array must be present');
  });
});
