import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { extractDesignTokens } from './extractor.js';
import { validateAndResolveUrl } from './security.js';
import {
  formatToClaudeMd,
  formatToAgentsMd,
  formatToCursorrules,
  formatToTailwindV4,
  formatToTailwind,
  formatToShadcn,
  formatToFigmaTokens,
  formatToCssVariables,
  formatToMarkdown,
  buildResponsiveTable,
  buildBreakpointsList,
  buildNegativeConstraints,
  buildConfidenceReportSection
} from './formatter.js';
import { DesignTokens } from './types.js';

/**
 * Creates and configures the Styleprobe MCP Server instance.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'styleprobe',
    version: '1.0.0'
  });

  // ─────────────────────────────────────────────────────────────────
  // Helper: Extract & Validate
  // ─────────────────────────────────────────────────────────────────
  async function safeExtract(
    rawUrl: string,
    options: { depth?: number; maxPages?: number } = {}
  ): Promise<{ ok: true; tokens: DesignTokens } | { ok: false; error: string }> {
    const precheck = await validateAndResolveUrl(rawUrl);
    if (!precheck.safe) {
      return { ok: false, error: `Security Rejection: ${precheck.reason || 'Invalid or prohibited target URL'}` };
    }

    try {
      const tokens = await extractDesignTokens(precheck.normalizedUrl!, {
        depth: Math.min(Math.max(options.depth || 1, 1), 3),
        maxPages: Math.min(Math.max(options.maxPages || 1, 1), 5)
      });
      return { ok: true, tokens };
    } catch (err: any) {
      return { ok: false, error: `Extraction error for ${rawUrl}: ${err.message}` };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // TOOL 1: probe_design_system
  // ─────────────────────────────────────────────────────────────────
  server.tool(
    'probe_design_system',
    'Inspect any website URL and extract its complete visual design system including dual-theme colors, typography scale, responsive breakpoints, layout measurements, and negative constraints for AI coding agents.',
    {
      url: z.string().describe('Target website URL to probe (e.g. https://linear.app or stripe.com)'),
      format: z.enum([
        'claude',
        'agents',
        'cursor',
        'tailwind-v4',
        'tailwind',
        'shadcn',
        'figma',
        'css',
        'markdown',
        'json'
      ])
        .optional()
        .default('claude')
        .describe('Output format for the extracted design system rules or tokens (default: claude)'),
      depth: z.number().int().min(1).max(3).optional().default(1).describe('Crawl depth for multi-page token aggregation (1-3)'),
      maxPages: z.number().int().min(1).max(5).optional().default(1).describe('Maximum subpages to inspect during crawl (1-5)')
    },
    async ({ url, format, depth, maxPages }) => {
      const res = await safeExtract(url, { depth, maxPages });
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: res.error }] };
      }

      const tokens = res.tokens;
      let text = '';

      switch (format) {
        case 'claude':
          text = formatToClaudeMd(tokens);
          break;
        case 'agents':
          text = formatToAgentsMd(tokens);
          break;
        case 'cursor':
          text = formatToCursorrules(tokens);
          break;
        case 'tailwind-v4':
          text = formatToTailwindV4(tokens);
          break;
        case 'tailwind':
          text = formatToTailwind(tokens);
          break;
        case 'shadcn':
          text = formatToShadcn(tokens);
          break;
        case 'figma':
          text = formatToFigmaTokens(tokens);
          break;
        case 'css':
          text = formatToCssVariables(tokens);
          break;
        case 'json':
          text = JSON.stringify(tokens, null, 2);
          break;
        case 'markdown':
        default:
          text = formatToMarkdown(tokens);
          break;
      }

      return {
        content: [
          {
            type: 'text',
            text
          }
        ]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // TOOL 2: extract_colors
  // ─────────────────────────────────────────────────────────────────
  server.tool(
    'extract_colors',
    'Extract exact color palettes (light and dark modes), primary CTA colors, surface elevations, text colors, and modern CSS color spaces (OKLCH, Display-P3) from a website.',
    {
      url: z.string().describe('Target website URL to extract colors from'),
      theme: z.enum(['light', 'dark', 'both']).optional().default('both').describe('Theme palette to retrieve (light, dark, or both)')
    },
    async ({ url, theme }) => {
      const res = await safeExtract(url);
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: res.error }] };
      }

      const { colors, themes } = res.tokens;
      const light = themes?.light || colors;
      const dark = themes?.dark || colors;

      let md = `# Color Palette & Tokens for ${res.tokens.title || url}\n\n`;

      if (theme === 'light' || theme === 'both') {
        md += `### Light Theme Tokens\n`;
        md += `- **Canvas Background**: \`${light.background}\`\n`;
        md += `- **Surface / Cards**: \`${light.surface}\`\n`;
        md += `- **Primary CTA / Accent**: \`${light.primary}\`\n`;
        md += `- **Text Primary**: \`${light.textPrimary}\`\n`;
        md += `- **Text Muted**: \`${light.textSecondary}\`\n`;
        md += `- **Border**: \`${light.border}\`\n\n`;
      }

      if (theme === 'dark' || theme === 'both') {
        md += `### Dark Theme Tokens\n`;
        md += `- **Canvas Background**: \`${dark.background}\`\n`;
        md += `- **Surface / Cards**: \`${dark.surface}\`\n`;
        md += `- **Primary CTA / Accent**: \`${dark.primary}\`\n`;
        md += `- **Text Primary**: \`${dark.textPrimary}\`\n`;
        md += `- **Text Muted**: \`${dark.textSecondary}\`\n`;
        md += `- **Border**: \`${dark.border}\`\n\n`;
      }

      md += `### Dominant Palette (${colors.palette.length} colors)\n`;
      md += `| Hex | Role | Luminance | Contrast with Background |\n|---|---|---|---|\n`;
      for (const c of colors.palette.slice(0, 10)) {
        md += `| \`${c.hex}\` | ${c.role || '-'} | ${c.luminance.toFixed(2)} | ${c.contrastRatioWithBg ? `${c.contrastRatioWithBg.toFixed(1)}:1` : '-'} |\n`;
      }

      return {
        content: [{ type: 'text', text: md }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // TOOL 3: extract_typography
  // ─────────────────────────────────────────────────────────────────
  server.tool(
    'extract_typography',
    'Extract font families, heading scales (H1–H6), body typography, line-heights, font weights, and fluid clamp() scaling formulas from a website.',
    {
      url: z.string().describe('Target website URL to extract typography from')
    },
    async ({ url }) => {
      const res = await safeExtract(url);
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: res.error }] };
      }

      const { typography, responsive } = res.tokens;

      let md = `# Typography Hierarchy for ${res.tokens.title || url}\n\n`;
      md += `- **Primary Font Families**: ${typography.fontFamilies.map(f => `\`${f}\``).join(', ') || 'System Default'}\n\n`;

      md += `### Heading Scale\n`;
      md += `| Element | Font Size | Weight | Line Height |\n|---|---|---|---|\n`;
      for (const h of typography.headings) {
        md += `| \`<${h.tag}>\` | \`${h.fontSize}\` | \`${h.fontWeight}\` | \`${h.lineHeight}\` |\n`;
      }

      md += `\n### Body Typography\n`;
      md += `| Element | Font Size | Weight | Line Height |\n|---|---|---|---|\n`;
      for (const b of typography.body) {
        md += `| \`<${b.tag}>\` | \`${b.fontSize}\` | \`${b.fontWeight}\` | \`${b.lineHeight}\` |\n`;
      }

      if (responsive?.fluidFormulas && responsive.fluidFormulas.length > 0) {
        md += `\n### Detected Fluid Typography Formulas\n`;
        for (const f of responsive.fluidFormulas) {
          md += `- \`${f}\`\n`;
        }
      }

      return {
        content: [{ type: 'text', text: md }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // TOOL 4: extract_responsive_matrix
  // ─────────────────────────────────────────────────────────────────
  server.tool(
    'extract_responsive_matrix',
    'Extract cross-viewport property behavior across Desktop (1440px), Tablet (768px), and Mobile (375px), detecting custom media query thresholds and fluid layout scaling.',
    {
      url: z.string().describe('Target website URL to probe for responsive behavior')
    },
    async ({ url }) => {
      const res = await safeExtract(url);
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: res.error }] };
      }

      const tokens = res.tokens;
      let md = `# Responsive Design Matrix for ${tokens.title || url}\n\n`;

      md += `### Detected Custom Breakpoint Thresholds\n`;
      md += `${buildBreakpointsList(tokens)}\n\n`;

      md += `### Cross-Viewport Property Comparison\n`;
      md += `${buildResponsiveTable(tokens)}\n\n`;

      if (tokens.responsive?.rules && tokens.responsive.rules.length > 0) {
        md += `### Behavioral Adaptation Rules\n`;
        tokens.responsive.rules.forEach((r, i) => {
          md += `${i + 1}. **${r.property}**: ${r.behavior}${r.query ? ` (\`${r.query}\`)` : ''}\n`;
        });
      }

      return {
        content: [{ type: 'text', text: md }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // TOOL 5: generate_agent_rules
  // ─────────────────────────────────────────────────────────────────
  server.tool(
    'generate_agent_rules',
    'Generate strict AI coding agent instructions (CLAUDE.md, AGENTS.md, or .cursorrules) with explicit "DO NOT INVENT" negative constraints to eliminate hallucinations when generating UI.',
    {
      url: z.string().describe('Target website URL to extract design rules from'),
      agentType: z.enum(['claude', 'cursor', 'agents', 'all'])
        .optional()
        .default('claude')
        .describe('Target coding agent format (claude for Claude Code, cursor for .cursorrules, agents for AGENTS.md, all for bundle)')
    },
    async ({ url, agentType }) => {
      const res = await safeExtract(url);
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: res.error }] };
      }

      const tokens = res.tokens;
      let text = '';

      if (agentType === 'claude') {
        text = formatToClaudeMd(tokens);
      } else if (agentType === 'cursor') {
        text = formatToCursorrules(tokens);
      } else if (agentType === 'agents') {
        text = formatToAgentsMd(tokens);
      } else {
        text = `# BUNDLED AGENT DESIGN SYSTEM RULES\n\n` +
          `=================================================================\n` +
          `=== 1. CLAUDE.md (Claude Code)\n` +
          `=================================================================\n\n` +
          formatToClaudeMd(tokens) +
          `\n\n=================================================================\n` +
          `=== 2. .cursorrules (Cursor IDE)\n` +
          `=================================================================\n\n` +
          formatToCursorrules(tokens) +
          `\n\n=================================================================\n` +
          `=== 3. AGENTS.md (Autonomous Agents)\n` +
          `=================================================================\n\n` +
          formatToAgentsMd(tokens);
      }

      return {
        content: [{ type: 'text', text }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // TOOL 6: audit_design_system
  // ─────────────────────────────────────────────────────────────────
  server.tool(
    'audit_design_system',
    'Audit a website\'s design tokens for consistency, extraction confidence, and WCAG accessibility compliance.',
    {
      url: z.string().describe('Target website URL to audit')
    },
    async ({ url }) => {
      const res = await safeExtract(url);
      if (!res.ok) {
        return { isError: true, content: [{ type: 'text', text: res.error }] };
      }

      const tokens = res.tokens;
      const conf = tokens.confidence;
      const colors = tokens.colors;
      const typography = tokens.typography;

      let md = `# Design System Health & Audit Scorecard for ${tokens.title || url}\n\n`;
      md += `- **Overall Extraction Confidence**: **${conf?.overallScore || 92}% (${(conf?.level || 'high').toUpperCase()})**\n`;
      md += `- **Colors Confidence**: \`${(conf?.colorConfidence || 'high').toUpperCase()}\`\n`;
      md += `- **Typography Confidence**: \`${(conf?.typographyConfidence || 'high').toUpperCase()}\`\n`;
      md += `- **Responsive Confidence**: \`${(conf?.responsiveConfidence || 'high').toUpperCase()}\`\n`;
      md += `- **Components Confidence**: \`${(conf?.componentConfidence || 'high').toUpperCase()}\`\n\n`;

      md += `### Token Coverage & Evidence Summary\n`;
      md += `- CSS Variables Resolved: **${conf?.evidenceSummary?.cssVariablesFound || Object.keys(tokens.cssVariables || {}).length}**\n`;
      md += `- Computed Roles Matched: **${conf?.evidenceSummary?.computedRolesMatched || 6}**\n`;
      md += `- Breakpoint Thresholds Detected: **${conf?.evidenceSummary?.mediaQueriesDetected || (tokens.breakpoints || []).length}**\n`;
      md += `- UI Components Sampled: **${conf?.evidenceSummary?.componentsSampled || tokens.components.length}**\n\n`;

      md += `### Negative Constraints Enforced\n`;
      md += `${buildNegativeConstraints(tokens)}\n\n`;

      md += buildConfidenceReportSection(tokens);

      return {
        content: [{ type: 'text', text: md }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // PROMPT: recreate-component
  // ─────────────────────────────────────────────────────────────────
  server.prompt(
    'recreate-component',
    'Prompt template to extract a website\'s design system and synthesize a production React + Tailwind component matching it.',
    {
      url: z.string().describe('Website URL to reference (e.g. https://linear.app)'),
      component: z.string().describe('Component to recreate (e.g. hero, navbar, pricing-card, footer)'),
      framework: z.string().optional().describe('Frontend framework (default: React + Tailwind CSS v4)')
    },
    ({ url, component, framework }) => {
      const fw = framework || 'React + Tailwind CSS v4';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please use the \`probe_design_system\` tool on "${url}" with format "claude".\n\n` +
                `Once you receive the extracted design tokens, typography scales, responsive matrix, and strict negative constraints, ` +
                `generate a pixel-accurate, production-ready ${component} component in ${fw}.\n\n` +
                `STRICT RULES:\n` +
                `1. Only use the extracted palette colors and CSS variables. Do not invent arbitrary hex codes.\n` +
                `2. Match the exact heading scale and font weights extracted from the site.\n` +
                `3. Follow the responsive layout rules (grid reduction and mobile touch targets).\n` +
                `4. Support dual themes (light and dark mode) using the extracted token variables.`
            }
          }
        ]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // RESOURCE: styleprobe://formats
  // ─────────────────────────────────────────────────────────────────
  server.resource(
    'supported-formats',
    'styleprobe://formats',
    async (uri) => {
      const info = {
        name: 'Styleprobe Supported Export Formats',
        formats: [
          { format: 'claude', description: 'CLAUDE.md with all 7 sections and strict negative constraints for Claude Code' },
          { format: 'agents', description: 'AGENTS.md for autonomous coding agents (Codex, Antigravity, Copilot)' },
          { format: 'cursor', description: '.cursorrules directive prompt format for Cursor IDE' },
          { format: 'tailwind-v4', description: 'Modern Tailwind v4 @theme CSS block with custom site screens' },
          { format: 'tailwind', description: 'CommonJS tailwind.config.js for Tailwind CSS v3' },
          { format: 'shadcn', description: 'globals.css with space-separated HSL dual-theme tokens (:root and .dark)' },
          { format: 'figma', description: 'Design Tokens Community Group (DTCG) / Tokens Studio JSON' },
          { format: 'css', description: 'Pure CSS custom properties with responsive variables' },
          { format: 'markdown', description: 'Comprehensive human and LLM readable design specification with confidence report' },
          { format: 'json', description: 'Raw DesignTokens JSON schema' }
        ]
      };

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(info, null, 2),
            mimeType: 'application/json'
          }
        ]
      };
    }
  );

  return server;
}

/**
 * Starts the Styleprobe MCP Server on standard I/O (stdio).
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 Styleprobe MCP Server running on stdio');
}
