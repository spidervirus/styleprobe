import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { extractDesignTokens } from '../src/extractor.js';
import { 
  formatToClaudeMd, 
  formatToAgentsMd, 
  formatToCursorrules, 
  formatToTailwind, 
  formatToTailwindV4, 
  formatToFigmaTokens,
  formatToCssVariables,
  formatToMarkdown 
} from '../src/formatter.js';

describe('Phase 1 & Phase 2: Responsive Design Extraction & AI Coding Agent Integration', () => {
  let server: FixtureServer;

  before(async () => {
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
    server = await startFixtureServer();
  });

  after(async () => {
    delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    await server.stop();
  });

  test('1. Multi-viewport style extraction across Desktop, Tablet, and Mobile viewports', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.responsive, 'Responsive design system should be extracted');
    const { viewports } = tokens.responsive;

    // Desktop (1440px)
    assert.equal(viewports.desktop.h1FontSize, '48px');
    assert.equal(viewports.desktop.gridColumns, '3');
    assert.equal(viewports.desktop.navigationMode, 'Full');
    assert.equal(viewports.desktop.cardGap, '24px');
    assert.equal(viewports.desktop.buttonWidth, 'Auto');

    // Tablet (768px)
    assert.equal(viewports.tablet.h1FontSize, '36px');
    assert.equal(viewports.tablet.gridColumns, '2');
    assert.equal(viewports.tablet.navigationMode, 'Compact');
    assert.equal(viewports.tablet.cardGap, '20px');

    // Mobile (375px)
    assert.equal(viewports.mobile.h1FontSize, '28px');
    assert.equal(viewports.mobile.gridColumns, '1');
    assert.equal(viewports.mobile.navigationMode, 'Menu');
    assert.equal(viewports.mobile.cardGap, '16px');
    assert.equal(viewports.mobile.buttonWidth, '100% (Full width)');
  });

  test('2. Media query and custom breakpoint detection from stylesheets', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.breakpoints && tokens.breakpoints.length >= 2, 'Should detect at least 2 custom breakpoints');

    const bpValues = tokens.breakpoints.map(b => b.value);
    assert.ok(bpValues.includes(680), 'Should detect custom mobile threshold of 680px');
    assert.ok(bpValues.includes(1080), 'Should detect custom tablet threshold of 1080px');
  });

  test('3. Responsive property comparison table matches expected Reddit benchmark structure', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const comp = tokens.responsive?.comparison;
    assert.ok(comp && comp.length >= 5, 'Should contain all key comparison properties');

    const h1Row = comp.find(r => r.property === 'H1 font size');
    assert.ok(h1Row);
    assert.equal(h1Row.desktop, '48px');
    assert.equal(h1Row.tablet, '36px');
    assert.equal(h1Row.mobile, '28px');

    const gridRow = comp.find(r => r.property === 'Grid columns');
    assert.ok(gridRow);
    assert.equal(gridRow.desktop, '3');
    assert.equal(gridRow.tablet, '2');
    assert.equal(gridRow.mobile, '1');

    const navRow = comp.find(r => r.property === 'Navigation');
    assert.ok(navRow);
    assert.equal(navRow.desktop, 'Full');
    assert.equal(navRow.tablet, 'Compact');
    assert.equal(navRow.mobile, 'Menu');

    const gapRow = comp.find(r => r.property === 'Card gap');
    assert.ok(gapRow);
    assert.equal(gapRow.desktop, '24px');
    assert.equal(gapRow.tablet, '20px');
    assert.equal(gapRow.mobile, '16px');
  });

  test('4. Fluid typography detection extracts clamp() formulas', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.responsive?.fluidFormulas && tokens.responsive.fluidFormulas.length > 0, 'Should detect fluid formulas');
    const clampFormula = tokens.responsive.fluidFormulas.find(f => f.includes('clamp') && f.includes('1.5vw'));
    assert.ok(clampFormula, 'Should detect clamp(1.25rem, 1rem + 1.5vw, 2rem)');
  });

  test('5. CLAUDE.md exporter produces all 6 mandatory sections with negative constraints', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const claudeMd = formatToClaudeMd(tokens);

    // Verify all 6 mandatory sections
    assert.ok(claudeMd.includes('## 1. Which Colors to Use'), 'Must contain section 1: Colors');
    assert.ok(claudeMd.includes('## 2. Fonts and Typography Scales to Follow'), 'Must contain section 2: Typography');
    assert.ok(claudeMd.includes('## 3. How to Structure Layouts'), 'Must contain section 3: Layouts');
    assert.ok(claudeMd.includes('## 4. Which Component Styles to Reuse'), 'Must contain section 4: Component styles');
    assert.ok(claudeMd.includes('## 5. How Responsive Behavior Works'), 'Must contain section 5: Responsive behavior');
    assert.ok(claudeMd.includes('## 6. Styles AI Agents MUST NOT Invent'), 'Must contain section 6: Negative constraints');

    // Verify negative constraints details
    assert.ok(claudeMd.includes('DO NOT invent arbitrary colors or hex codes'));
    assert.ok(claudeMd.includes('DO NOT introduce unlisted web fonts'));
    assert.ok(claudeMd.includes('DO NOT assume Tailwind default breakpoints'));

    // Verify responsive comparison table is embedded
    assert.ok(claudeMd.includes('| H1 font size | `48px` | `36px` | `28px` |'));
    assert.ok(claudeMd.includes('| Grid columns | `3` | `2` | `1` |'));
    assert.ok(claudeMd.includes('| Navigation | `Full` | `Compact` | `Menu` |'));
  });

  test('6. AGENTS.md exporter formats design system for autonomous agent harnesses', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const agentsMd = formatToAgentsMd(tokens);

    assert.ok(agentsMd.includes('# AGENTS.md'));
    assert.ok(agentsMd.includes('## 1. Color Palette & Roles'));
    assert.ok(agentsMd.includes('## 5. Responsive Behavior Matrix'));
    assert.ok(agentsMd.includes('## 6. Strict Negative Constraints (DO NOT INVENT)'));
    assert.ok(agentsMd.includes('| H1 font size | `48px` | `36px` | `28px` |'));
  });

  test('7. .cursorrules exporter generates directive prompt with forbidden actions', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const cursorrules = formatToCursorrules(tokens);

    assert.ok(cursorrules.includes('# Cursor AI Design System Rules'));
    assert.ok(cursorrules.includes('[COLORS]'));
    assert.ok(cursorrules.includes('[TYPOGRAPHY]'));
    assert.ok(cursorrules.includes('[RESPONSIVE MATRIX]'));
    assert.ok(cursorrules.includes('[STRICT FORBIDDEN ACTIONS - DO NOT INVENT]'));
    assert.ok(cursorrules.includes('DO NOT introduce arbitrary hex colors'));
  });

  test('8. Tailwind exporter incorporates custom site screens without assuming generic defaults', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const twConfig = formatToTailwind(tokens);

    assert.ok(twConfig.includes('screens'), 'Should configure custom screens');
    assert.ok(twConfig.includes('680px') || twConfig.includes('1080px'), 'Should include detected breakpoints in screens');
  });

  test('9. Modern Tailwind v4 exporter includes @theme breakpoint declarations', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const twV4 = formatToTailwindV4(tokens);

    assert.ok(twV4.includes('@theme'));
    assert.ok(twV4.includes('--breakpoint-'), 'Should declare custom breakpoints');
    assert.ok(twV4.includes('680px') || twV4.includes('1080px'), 'Should include detected threshold values');
  });

  test('10. Figma / DTCG design tokens exporter includes breakpoint tokens', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const figmaJson = formatToFigmaTokens(tokens);
    const parsed = JSON.parse(figmaJson);

    assert.ok(parsed.breakpoint, 'Should include breakpoint tokens in DTCG export');
    const bpKeys = Object.keys(parsed.breakpoint);
    assert.ok(bpKeys.length >= 2, 'Should export at least 2 breakpoint tokens');
  });

  test('11. CSS variables exporter generates dual-theme and responsive media queries', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const cssVars = formatToCssVariables(tokens);

    assert.ok(cssVars.includes(':root'));
    assert.ok(cssVars.includes('.dark'));
    assert.ok(cssVars.includes('@media (max-width: 768px)'));
    assert.ok(cssVars.includes('--section-padding:'));
  });
});
