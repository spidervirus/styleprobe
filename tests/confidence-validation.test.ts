import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { extractDesignTokens } from '../src/extractor.js';
import {
  formatToMarkdown,
  formatToClaudeMd,
  formatToAgentsMd,
  formatToCursorrules
} from '../src/formatter.js';

describe('Phase 3: Source Evidence & Extraction Confidence Levels', () => {
  let server: FixtureServer;

  before(async () => {
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
    server = await startFixtureServer();
  });

  after(async () => {
    delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    await server.stop();
  });

  test('1. Color tokens contain verifiable source evidence and confidence ratings', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.colors.evidence, 'tokens.colors should have an evidence map');
    
    const { evidence } = tokens.colors;
    assert.ok(evidence.background, 'Background evidence should exist');
    assert.equal(evidence.background.confidence, 'high');
    assert.equal(evidence.background.sourceType, 'computed-style');
    assert.ok(evidence.background.reasoning.length > 0);

    assert.ok(evidence.primary, 'Primary color evidence should exist');
    assert.equal(evidence.primary.confidence, 'high');
    assert.ok(evidence.primary.sourceType === 'css-variable' || evidence.primary.sourceType === 'computed-style');

    assert.ok(evidence.textPrimary, 'Text primary evidence should exist');
    assert.equal(evidence.textPrimary.confidence, 'high');
  });

  test('2. Design tokens include comprehensive confidence report', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.confidence, 'tokens.confidence report must be present');
    
    const { confidence } = tokens;
    assert.ok(confidence.overallScore >= 80, `Overall score should be >= 80, got ${confidence.overallScore}`);
    assert.equal(confidence.level, 'high');
    assert.equal(confidence.colorConfidence, 'high');
    assert.equal(confidence.typographyConfidence, 'high');
    assert.equal(confidence.responsiveConfidence, 'high');
    assert.equal(confidence.componentConfidence, 'high');

    assert.ok(confidence.evidenceSummary.computedRolesMatched >= 4, 'Should match multiple computed roles');
    assert.ok(confidence.evidenceSummary.mediaQueriesDetected >= 2, 'Should detect at least 2 media queries');
  });

  test('3. Typography headings and body tokens carry computed-style evidence', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const h1 = tokens.typography.headings.find(h => h.tag === 'h1');
    assert.ok(h1, 'H1 token should exist');
    assert.equal(h1.confidence, 'high');
    assert.ok(h1.evidence, 'H1 should have evidence metadata');
    assert.equal(h1.evidence.sourceType, 'computed-style');
    assert.equal(h1.evidence.selector, 'h1');

    const body = tokens.typography.body[0];
    assert.ok(body, 'Body token should exist');
    assert.equal(body.confidence, 'high');
    assert.ok(body.evidence, 'Body should have evidence metadata');
  });

  test('4. Breakpoint tokens cite media-query source rules', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.breakpoints && tokens.breakpoints.length > 0, 'Breakpoints should exist');
    
    for (const bp of tokens.breakpoints) {
      assert.equal(bp.confidence, 'high');
      assert.ok(bp.evidence);
      assert.equal(bp.evidence.sourceType, 'media-query');
      assert.ok(bp.evidence.ruleText?.includes(`${bp.value}px`) || bp.evidence.ruleText?.includes(`${bp.value}`));
    }
  });

  test('5. Responsive property comparisons carry multi-viewport computed style evidence', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    assert.ok(tokens.responsive?.comparison, 'Responsive comparison must exist');
    
    for (const comp of tokens.responsive.comparison) {
      assert.equal(comp.confidence, 'high');
      assert.ok(comp.evidence, `Comparison row ${comp.property} should have evidence`);
      assert.equal(comp.evidence.sourceType, 'computed-style');
      assert.ok(comp.evidence.reasoning.length > 0);
    }
  });

  test('6. Markdown exporter renders Section 9: Extraction Confidence & Source Evidence Report', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });
    const md = formatToMarkdown(tokens);

    assert.ok(md.includes('## 9. Extraction Confidence & Source Evidence Report'), 'Must contain Section 9 header');
    assert.ok(md.includes('Overall Confidence'), 'Must render overall confidence');
    assert.ok(md.includes('Evidence Audit Table'), 'Must render Evidence Audit Table');
    assert.ok(md.includes('| Color: `primary` |'), 'Must include primary color evidence row');
    assert.ok(md.includes('| Responsive: `H1 font size` |'), 'Must include responsive H1 evidence row');
  });

  test('7. AI Agent exporters (CLAUDE.md, AGENTS.md, .cursorrules) contain confidence metadata', async () => {
    const tokens = await extractDesignTokens(`${server.baseUrl}/responsive.html`, { depth: 1 });

    const claudeMd = formatToClaudeMd(tokens);
    assert.ok(claudeMd.includes('## 7. Extraction Confidence & Source Evidence'), 'CLAUDE.md must include confidence section');
    assert.ok(claudeMd.includes('Overall Reliability'), 'CLAUDE.md must include overall reliability');

    const agentsMd = formatToAgentsMd(tokens);
    assert.ok(agentsMd.includes('## 7. Extraction Confidence & Source Evidence'), 'AGENTS.md must include confidence section');
    assert.ok(agentsMd.includes('Overall Confidence Score'), 'AGENTS.md must include confidence score');

    const cursorrules = formatToCursorrules(tokens);
    assert.ok(cursorrules.includes('[EXTRACTION CONFIDENCE & EVIDENCE]'), '.cursorrules must include confidence section');
    assert.ok(cursorrules.includes('Overall Reliability'), '.cursorrules must include reliability');
  });
});
