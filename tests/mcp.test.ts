import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';

describe('MCP Suite: Model Context Protocol Server & AI Agent Tools', () => {
  let server: FixtureServer;
  let client: Client;

  before(async () => {
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
    server = await startFixtureServer();

    const mcpServer = createMcpServer();
    client = new Client({ name: 'styleprobe-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      mcpServer.connect(serverTransport)
    ]);
  });

  after(async () => {
    delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    await client.close();
    await server.stop();
  });

  test('1. List tools: registers all 6 core design system tools', async () => {
    const res = await client.listTools();
    const toolNames = res.tools.map(t => t.name);

    assert.ok(toolNames.includes('probe_design_system'), 'Must include probe_design_system');
    assert.ok(toolNames.includes('extract_colors'), 'Must include extract_colors');
    assert.ok(toolNames.includes('extract_typography'), 'Must include extract_typography');
    assert.ok(toolNames.includes('extract_responsive_matrix'), 'Must include extract_responsive_matrix');
    assert.ok(toolNames.includes('generate_agent_rules'), 'Must include generate_agent_rules');
    assert.ok(toolNames.includes('audit_design_system'), 'Must include audit_design_system');
    assert.equal(toolNames.length, 6, 'Exactly 6 tools should be registered');
  });

  test('2. Tool: probe_design_system formats CLAUDE.md by default', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'probe_design_system',
      arguments: { url: targetUrl }
    }) as any;

    assert.equal(res.isError, undefined);
    assert.ok(res.content && res.content.length > 0);
    const text = res.content[0].text;

    assert.ok(text.includes('# CLAUDE.md'), 'Must format as CLAUDE.md by default');
    assert.ok(text.includes('Which Colors to Use'), 'Must contain color rules');
    assert.ok(text.includes('Styles AI Agents MUST NOT Invent'), 'Must enforce negative constraints');
  });

  test('3. Tool: probe_design_system formats modern Tailwind v4 @theme', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'probe_design_system',
      arguments: { url: targetUrl, format: 'tailwind-v4' }
    }) as any;

    assert.equal(res.isError, undefined);
    const text = res.content[0].text;
    assert.ok(text.includes('@theme'), 'Must contain @theme directive');
    assert.ok(text.includes('--color-primary:'), 'Must map --color-primary');
    assert.ok(text.includes('@import "tailwindcss";'), 'Must import tailwindcss');
  });

  test('4. Tool: probe_design_system formats JSON tokens', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'probe_design_system',
      arguments: { url: targetUrl, format: 'json' }
    }) as any;

    assert.equal(res.isError, undefined);
    const text = res.content[0].text;
    const json = JSON.parse(text);
    assert.ok(json.colors, 'Must have colors object');
    assert.ok(json.typography, 'Must have typography object');
    assert.ok(json.responsive, 'Must have responsive object');
  });

  test('5. Tool: extract_colors returns dual-theme palette & dominant table', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'extract_colors',
      arguments: { url: targetUrl, theme: 'both' }
    }) as any;

    assert.equal(res.isError, undefined);
    const text = res.content[0].text;
    assert.ok(text.includes('Light Theme Tokens'));
    assert.ok(text.includes('Dark Theme Tokens'));
    assert.ok(text.includes('Canvas Background'));
    assert.ok(text.includes('Primary CTA'));
  });

  test('6. Tool: extract_typography returns heading and body scales', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'extract_typography',
      arguments: { url: targetUrl }
    }) as any;

    assert.equal(res.isError, undefined);
    const text = res.content[0].text;
    assert.ok(text.includes('Heading Scale'));
    assert.ok(text.includes('Body Typography'));
    assert.ok(text.includes('`<h1>`'));
  });

  test('7. Tool: extract_responsive_matrix returns breakpoints & viewport comparison', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'extract_responsive_matrix',
      arguments: { url: targetUrl }
    }) as any;

    assert.equal(res.isError, undefined);
    const text = res.content[0].text;
    assert.ok(text.includes('Detected Custom Breakpoint Thresholds'));
    assert.ok(text.includes('Cross-Viewport Property Comparison'));
    assert.ok(text.includes('H1 font size'));
    assert.ok(text.includes('Section padding'));
  });

  test('8. Tool: generate_agent_rules outputs targeted formats (.cursorrules and bundle)', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;

    // 1. Cursor format
    const cursorRes = await client.callTool({
      name: 'generate_agent_rules',
      arguments: { url: targetUrl, agentType: 'cursor' }
    }) as any;
    assert.equal(cursorRes.isError, undefined);
    assert.ok(cursorRes.content[0].text.includes('# Cursor AI Design System Rules'));

    // 2. All bundle
    const allRes = await client.callTool({
      name: 'generate_agent_rules',
      arguments: { url: targetUrl, agentType: 'all' }
    }) as any;
    assert.equal(allRes.isError, undefined);
    assert.ok(allRes.content[0].text.includes('=== 1. CLAUDE.md'));
    assert.ok(allRes.content[0].text.includes('=== 2. .cursorrules'));
    assert.ok(allRes.content[0].text.includes('=== 3. AGENTS.md'));
  });

  test('9. Tool: audit_design_system returns confidence scorecard', async () => {
    const targetUrl = `${server.baseUrl}/responsive.html`;
    const res = await client.callTool({
      name: 'audit_design_system',
      arguments: { url: targetUrl }
    }) as any;

    assert.equal(res.isError, undefined);
    const text = res.content[0].text;
    assert.ok(text.includes('Design System Health & Audit Scorecard'));
    assert.ok(text.includes('Overall Extraction Confidence'));
    assert.ok(text.includes('Token Coverage & Evidence Summary'));
  });

  test('10. Security: SSRF targets are rejected with isError in MCP', async () => {
    delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    const res = await client.callTool({
      name: 'probe_design_system',
      arguments: { url: 'http://169.254.169.254/latest/meta-data' }
    }) as any;

    assert.equal(res.isError, true, 'SSRF target must set isError: true');
    assert.ok(res.content[0].text.includes('Security Rejection'), 'Must state security rejection');
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
  });

  test('11. List prompts: registers recreate-component prompt template', async () => {
    const res = await client.listPrompts();
    const promptNames = res.prompts.map(p => p.name);
    assert.ok(promptNames.includes('recreate-component'));

    const promptResult = await client.getPrompt({
      name: 'recreate-component',
      arguments: {
        url: 'https://linear.app',
        component: 'hero'
      }
    });
    assert.ok(promptResult.messages.length > 0);
    const msgText = (promptResult.messages[0].content as any).text;
    assert.ok(msgText.includes('probe_design_system'));
    assert.ok(msgText.includes('linear.app'));
    assert.ok(msgText.includes('hero'));
  });

  test('12. List resources: registers styleprobe://formats resource', async () => {
    const res = await client.listResources();
    const uris = res.resources.map(r => r.uri);
    assert.ok(uris.includes('styleprobe://formats'));

    const resourceContent = await client.readResource({
      uri: 'styleprobe://formats'
    });
    assert.ok(resourceContent.contents.length > 0);
    const data = JSON.parse((resourceContent.contents[0] as any).text);
    assert.equal(data.name, 'Styleprobe Supported Export Formats');
    assert.ok(data.formats.length >= 8);
  });
});
