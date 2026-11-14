import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { extractDesignTokens } from '../src/extractor.js';
import {
  formatToMarkdown,
  formatToTailwind,
  formatToTailwindV4,
  formatToShadcn,
  formatToFigmaTokens,
  formatToAgentRules
} from '../src/formatter.js';

let server: FixtureServer;

test.before(async () => {
  process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
  server = await startFixtureServer();
});

test.after(async () => {
  delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
  if (server) await server.stop();
});

test('Consistency Suite: Multi-Format Exporters & Web Playground Alignment', async (t) => {
  const tokens = await extractDesignTokens(server.baseUrl, 1);

  await t.test('1. Markdown exporter consistency', () => {
    const md = formatToMarkdown(tokens);

    assert.ok(md.includes('#4f46e5'), 'Markdown must include primary color #4f46e5');
    assert.ok(md.includes('#ffffff'), 'Markdown must include light background #ffffff');
    assert.ok(md.includes('#0f172a'), 'Markdown must include dark background #0f172a');
    assert.ok(md.includes('### BUTTON Component Spec'), 'Markdown must render button component specs');
    assert.ok(md.includes('### CARD Component Spec'), 'Markdown must render card component specs');
    assert.ok(md.includes('Inter'), 'Markdown must render font family Inter');
  });

  await t.test('2. Tailwind v4 @theme exporter consistency', () => {
    const tw4 = formatToTailwindV4(tokens);

    assert.ok(tw4.includes('@theme'), 'Must include Tailwind v4 @theme directive');
    assert.ok(tw4.includes('--color-primary: #4f46e5;'), 'Must define --color-primary');
    assert.ok(tw4.includes('--color-background: #ffffff;'), 'Must define --color-background');
    assert.ok(tw4.includes('--font-sans:'), 'Must define font family');
  });

  await t.test('3. Tailwind legacy config exporter consistency', () => {
    const tw = formatToTailwind(tokens);

    assert.ok(tw.includes('"primary": "#4f46e5"'), 'Legacy Tailwind config must map primary color');
    assert.ok(tw.includes('"background": "#ffffff"'), 'Legacy Tailwind config must map background');
    assert.ok(tw.includes('module.exports'), 'Must be valid commonjs config module');
  });

  await t.test('4. shadcn/ui globals.css exporter consistency', () => {
    const shadcn = formatToShadcn(tokens);

    assert.ok(shadcn.includes('@layer base'), 'Must output CSS @layer base');
    assert.ok(shadcn.includes(':root'), 'Must define :root tokens');
    assert.ok(shadcn.includes('.dark'), 'Must define .dark tokens');
    assert.ok(shadcn.includes('--primary:'), 'Must map --primary in HSL format');
    assert.ok(shadcn.includes('--background:'), 'Must map --background in HSL format');
  });

  await t.test('5. Figma Tokens / W3C Design Tokens JSON consistency', () => {
    const figmaJson = formatToFigmaTokens(tokens);
    const parsed = JSON.parse(figmaJson);

    assert.ok(parsed.color, 'Must contain top-level color tokens object');
    assert.equal(parsed.color.light.primary.$value, '#4f46e5', 'Figma light primary token must match #4f46e5');
    assert.equal(parsed.color.dark.primary.$value, '#818cf8', 'Figma dark primary token must match #818cf8');
    assert.equal(parsed.color.light.background.$value, '#ffffff', 'Figma background token must match #ffffff');
  });

  await t.test('6. Cursorrules / AI Agent Rules consistency', () => {
    const rules = formatToAgentRules(tokens);

    assert.ok(rules.includes('# AGENT DESIGN SYSTEM RULES'), 'Must include agent header');
    assert.ok(rules.includes('#4f46e5'), 'Must enforce primary color in instructions');
    assert.ok(rules.includes('Support dual themes'), 'Must enforce theme fidelity rules');
  });
});
