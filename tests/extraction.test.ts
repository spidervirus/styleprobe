import test from 'node:test';
import assert from 'node:assert/strict';
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

test('Extraction Suite: Deterministic Fixture Verification', async (t) => {
  await t.test('1. CSS custom property extraction and selector context', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);
    
    assert.ok(tokens.cssVariables, 'cssVariables should be defined');
    
    // Verify variable presence
    const primaryVar = tokens.cssVariables['--primary'] as any;
    assert.ok(primaryVar, 'Should extract --primary variable');
    assert.equal(primaryVar.light, '#4f46e5', 'Light mode --primary should be #4f46e5');
    assert.equal(primaryVar.dark, '#818cf8', 'Dark mode --primary should be #818cf8');
    
    // Verify selector specificity recording
    assert.ok(primaryVar.selectors.includes(':root'), 'Should record :root selector');
    assert.ok(
      primaryVar.selectors.some((s: string) => s.includes('.dark')),
      'Should record .dark selector context'
    );

    // Verify DOM usage recording
    const bgVar = tokens.cssVariables['--background'] as any;
    assert.ok(bgVar, 'Should extract --background');
    assert.equal(bgVar.light, '#ffffff');
    assert.equal(bgVar.dark, '#0f172a');
  });

  await t.test('2. Semantic role detection against known DOM structures', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);

    // Baseline theme mode on light fixture
    assert.equal(tokens.themeMode, 'light', 'Theme mode should resolve to light');

    // Canvas background
    assert.equal(tokens.colors.background, '#ffffff', 'Background should resolve to #ffffff');

    // Elevated surface/card
    assert.equal(tokens.colors.surface, '#f8fafc', 'Surface should resolve to card background #f8fafc');

    // Primary CTA accent
    assert.equal(tokens.colors.primary, '#4f46e5', 'Primary should resolve to button accent #4f46e5');

    // Border color
    assert.equal(tokens.colors.border, '#e2e8f0', 'Border should resolve to #e2e8f0');

    // Text primary & muted
    assert.equal(tokens.colors.textPrimary, '#0f172a', 'Text primary should be high-contrast foreground #0f172a');
    assert.equal(tokens.colors.textSecondary, '#64748b', 'Text secondary should be muted #64748b');
  });

  await t.test('3. Typography clustering and hierarchy scales', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);

    // Font families
    assert.ok(tokens.typography.fontFamilies.includes('Inter'), 'Should discover Inter font family');
    assert.ok(tokens.typography.fontFamilies.includes('Fira Code'), 'Should discover Fira Code font family');

    // Headings scale
    const headings = tokens.typography.headings;
    assert.ok(headings.length >= 3, 'Should extract multiple heading tokens');

    const h1Token = headings.find(h => h.tag === 'h1');
    assert.ok(h1Token, 'Should contain h1 heading');
    assert.equal(h1Token.fontSize, '36px', 'h1 size should be 36px');
    assert.equal(h1Token.fontWeight, '800', 'h1 weight should be 800');
    assert.equal(h1Token.lineHeight, '44px', 'h1 line-height should be 44px');

    const h2Token = headings.find(h => h.tag === 'h2');
    assert.ok(h2Token, 'Should contain h2 heading');
    assert.equal(h2Token.fontSize, '24px', 'h2 size should be 24px');
    assert.equal(h2Token.fontWeight, '700', 'h2 weight should be 700');

    // Body tokens
    const bodyP = tokens.typography.body.find(b => b.tag === 'p');
    assert.ok(bodyP, 'Should contain body paragraph token');
    assert.equal(bodyP.fontSize, '16px', 'body p size should be 16px');
    assert.equal(bodyP.fontWeight, '400', 'body p weight should be 400');
  });

  await t.test('4. Representative component extraction and computed styles', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);

    assert.ok(tokens.components.length >= 4, 'Should extract at least 4 representative components');

    // Button
    const btn = tokens.components.find(c => c.type === 'button');
    assert.ok(btn, 'Should extract button component');
    assert.equal(btn.styles.backgroundColor, 'rgb(79, 70, 229)', 'Button bg should be rgb(79, 70, 229)');
    assert.equal(btn.styles.borderRadius, '8px', 'Button border radius should be 8px');
    assert.equal(btn.styles.fontWeight, '600', 'Button font weight should be 600');

    // Card
    const card = tokens.components.find(c => c.type === 'card');
    assert.ok(card, 'Should extract card component');
    assert.equal(card.styles.backgroundColor, 'rgb(248, 250, 252)', 'Card bg should be rgb(248, 250, 252)');
    assert.equal(card.styles.borderRadius, '16px', 'Card border radius should be 16px');

    // Input
    const input = tokens.components.find(c => c.type === 'input');
    assert.ok(input, 'Should extract input component');
    assert.equal(input.styles.borderRadius, '8px', 'Input border radius should be 8px');

    // Badge
    const badge = tokens.components.find(c => c.type === 'badge');
    assert.ok(badge, 'Should extract badge component');
    assert.equal(badge.styles.borderRadius, '9999px', 'Badge border radius should be 9999px');

    // Nav
    const nav = tokens.components.find(c => c.type === 'nav');
    assert.ok(nav, 'Should extract nav component');
  });

  await t.test('5. Independent light and dark theme extraction via emulateMedia', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);

    assert.ok(tokens.themes, 'Themes object should be populated');
    const light = tokens.themes.light;
    const dark = tokens.themes.dark;

    // Verify Light Palette
    assert.equal(light.mode, 'light');
    assert.equal(light.background, '#ffffff', 'Light background should be #ffffff');
    assert.equal(light.surface, '#f8fafc', 'Light surface should be #f8fafc');
    assert.equal(light.primary, '#4f46e5', 'Light primary should be #4f46e5');

    // Verify Dark Palette (genuinely different from Light)
    assert.equal(dark.mode, 'dark');
    assert.equal(dark.background, '#0f172a', 'Dark background should be #0f172a');
    assert.equal(dark.surface, '#1e293b', 'Dark surface should be #1e293b');
    assert.equal(dark.primary, '#818cf8', 'Dark primary should be #818cf8');
    assert.equal(dark.border, '#334155', 'Dark border should be #334155');

    // Assert that light and dark palettes are genuinely distinct
    assert.notEqual(light.background, dark.background, 'Light and dark backgrounds must not be identical');
    assert.notEqual(light.primary, dark.primary, 'Light and dark primaries must not be identical');
  });

  await t.test('6. Brand assets and SVG extraction', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);

    assert.ok(tokens.assets.length >= 1, 'Should extract at least one SVG logo');
    const logo = tokens.assets[0];
    assert.equal(logo.type, 'logo');
    assert.ok(logo.svgContent?.includes('viewBox="0 0 100 100"'), 'SVG content should preserve viewBox');
    assert.ok(logo.svgContent?.includes('fill="#4f46e5"'), 'SVG content should preserve fill color');
  });
});
