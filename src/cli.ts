#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDesignTokens } from './extractor.js';
import { validateAndResolveUrl } from './security.js';
import { 
  formatToMarkdown, 
  formatToTailwind, 
  formatToTailwindV4, 
  formatToShadcn, 
  formatToFigmaTokens,
  formatToAgentRules,
  formatToClaudeMd,
  formatToAgentsMd,
  formatToCursorrules,
  formatToCssVariables
} from './formatter.js';

// Fast-path for MCP server mode
if (process.argv[2] === 'mcp') {
  const { startMcpServer } = await import('./mcp.js');
  startMcpServer().catch((err) => {
    console.error('Fatal MCP Server Error:', err);
    process.exit(1);
  });
} else {
  const program = new Command();

  program
    .name('styleprobe')
    .description('Probe and extract design systems from any URL into AI-ready specifications, Tailwind configs, and design tokens')
    .version('1.0.0')
    .argument('<url>', 'Target website URL (e.g., https://github.com or stripe.com)')
    .option('-o, --output <path>', 'Output file path (default adjusts based on format)')
    .option('-f, --format <format>', 'Output format: markdown, claude, agents, cursorrules, all-agents, tailwind, tailwind-v4, shadcn, figma-tokens, css-variables, or json', 'markdown')
    .option('-d, --depth <number>', 'Number of internal pages to crawl (1 to 5)', '1')
    .option('--sitemap', 'Discover pages from /sitemap.xml and /sitemap_index.xml', false)
    .option('--assets [dir]', 'Harvest SVGs & brand logos into a local directory', false)
    .addHelpText('after', `
Commands:
  styleprobe mcp               Start the Model Context Protocol (MCP) server for Claude Desktop, Cursor, Antigravity, and AI agents
`)
  .action(async (targetUrl: string, options: { output?: string; format: string; depth: string; sitemap: boolean; assets: boolean | string }) => {
    // 1. Input validation & SSRF pre-check
    const precheck = await validateAndResolveUrl(targetUrl);
    if (!precheck.safe) {
      console.error(chalk.red(`\n✖ Security Rejection: ${precheck.reason || 'Invalid or prohibited URL'}\n`));
      process.exit(1);
    }

    const normalizedUrl = precheck.normalizedUrl!;
    const crawlDepth = Math.max(1, Math.min(parseInt(options.depth, 10) || 1, 3));

    console.log(chalk.bold.magenta('\n🔍 styleprobe') + chalk.gray(' — Visual DNA Extractor for AI Coding Agents\n'));
    const spinnerText = crawlDepth > 1 || options.sitemap
      ? `Launching crawler & discovering pages (depth: ${crawlDepth}${options.sitemap ? ', sitemap: true' : ''})...`
      : `Probing ${chalk.cyan(normalizedUrl)}...`;
    const spinner = ora(spinnerText).start();

    try {
      const tokens = await extractDesignTokens(normalizedUrl, {
        depth: crawlDepth,
        sitemap: !!options.sitemap
      });

      spinner.text = `Analyzing design tokens & formatting as ${chalk.yellow(options.format)}...`;
      
      let outputContent = '';
      let defaultFilename = 'design.md';

      switch (options.format.toLowerCase()) {
        case 'claude':
        case 'claude.md':
          outputContent = formatToClaudeMd(tokens);
          defaultFilename = 'CLAUDE.md';
          break;
        case 'agents':
        case 'agents.md':
          outputContent = formatToAgentsMd(tokens);
          defaultFilename = 'AGENTS.md';
          break;
        case 'cursorrules':
        case '.cursorrules':
        case 'agent':
          outputContent = formatToCursorrules(tokens);
          defaultFilename = '.cursorrules';
          break;
        case 'all-agents':
          await fs.writeFile(path.resolve(process.cwd(), 'CLAUDE.md'), formatToClaudeMd(tokens), 'utf-8');
          await fs.writeFile(path.resolve(process.cwd(), 'AGENTS.md'), formatToAgentsMd(tokens), 'utf-8');
          await fs.writeFile(path.resolve(process.cwd(), '.cursorrules'), formatToCursorrules(tokens), 'utf-8');
          outputContent = formatToClaudeMd(tokens);
          defaultFilename = 'CLAUDE.md';
          break;
        case 'tailwind':
          outputContent = formatToTailwind(tokens);
          defaultFilename = 'tailwind.config.js';
          break;
        case 'tailwind-v4':
          outputContent = formatToTailwindV4(tokens);
          defaultFilename = 'theme.css';
          break;
        case 'shadcn':
          outputContent = formatToShadcn(tokens);
          defaultFilename = 'shadcn-globals.css';
          break;
        case 'figma-tokens':
        case 'dtcg':
          outputContent = formatToFigmaTokens(tokens);
          defaultFilename = 'tokens.json';
          break;
        case 'css-variables':
        case 'variables':
          outputContent = formatToCssVariables(tokens);
          defaultFilename = 'variables.css';
          break;
        case 'json':
          outputContent = JSON.stringify(tokens, null, 2);
          defaultFilename = 'design-tokens.json';
          break;
        case 'markdown':
        default:
          outputContent = formatToMarkdown(tokens);
          defaultFilename = 'design.md';
          break;
      }

      const targetPath = options.output || defaultFilename;
      const resolvedPath = path.resolve(process.cwd(), targetPath);
      await fs.writeFile(resolvedPath, outputContent, 'utf-8');

      // Save SVG assets to directory if --assets flag is provided
      let savedAssetsCount = 0;
      if (options.assets && tokens.assets && tokens.assets.length > 0) {
        const assetsDir = typeof options.assets === 'string' ? options.assets : './assets';
        const resolvedAssetsDir = path.resolve(process.cwd(), assetsDir);
        await fs.mkdir(resolvedAssetsDir, { recursive: true });

        for (let i = 0; i < tokens.assets.length; i++) {
          const asset = tokens.assets[i];
          if (asset.svgContent) {
            const filename = `${asset.type}-${i + 1}-${asset.name}.svg`;
            await fs.writeFile(path.join(resolvedAssetsDir, filename), asset.svgContent, 'utf-8');
            savedAssetsCount++;
          }
        }
      }

      spinner.succeed(chalk.green(`Successfully generated ${chalk.bold(targetPath)} (${options.format})!`));

      console.log(chalk.gray('\nExtracted System:'));
      console.log(` • Title:       ${tokens.title}`);
      if (tokens.crawledDetails && tokens.crawledDetails.length > 0) {
        const pagesSummary = tokens.crawledDetails.map(d => {
          try {
            const p = new URL(d.url).pathname;
            return `${p} (depth: ${d.depth})`;
          } catch {
            return `${d.url} (depth: ${d.depth})`;
          }
        }).join(', ');
        console.log(` • Pages:       ${tokens.crawledDetails.length} crawled [${pagesSummary}]`);
      } else {
        console.log(` • Pages:       ${tokens.crawledPages?.length || 1} crawled (${tokens.crawledPages?.map(u => {
          try { return new URL(u).pathname; } catch { return u; }
        }).join(', ')})`);
      }
      console.log(` • Theme:       ${tokens.themeMode.toUpperCase()}`);
      console.log(` • Primary:     ${chalk.hex(tokens.colors.primary)('■')} ${tokens.colors.primary}`);
      console.log(` • Background:  ${chalk.hex(tokens.colors.background)('■')} ${tokens.colors.background}`);
      console.log(` • Text:        ${chalk.hex(tokens.colors.textPrimary)('■')} ${tokens.colors.textPrimary}`);
      console.log(` • Fonts:       ${tokens.typography.fontFamilies.join(', ') || 'System default'}`);
      if (tokens.breakpoints && tokens.breakpoints.length > 0) {
        const bpStr = tokens.breakpoints.map(b => `${b.value}px`).join(', ');
        console.log(` • Breakpoints: ${bpStr}`);
      }
      if (tokens.responsive) {
        const dNav = tokens.responsive.viewports.desktop.navigationMode;
        const mNav = tokens.responsive.viewports.mobile.navigationMode;
        const dCols = tokens.responsive.viewports.desktop.gridColumns;
        const mCols = tokens.responsive.viewports.mobile.gridColumns;
        console.log(` • Responsive:  Nav: ${dNav} → ${mNav} | Grid: ${dCols} cols → ${mCols} col | Section: ${tokens.responsive.viewports.desktop.sectionPadding} → ${tokens.responsive.viewports.mobile.sectionPadding}`);
      }
      console.log(` • SVGs:        ${tokens.assets.length} extracted${savedAssetsCount > 0 ? ` (saved to ${options.assets})` : ''}`);
      console.log(` • File:        ${resolvedPath}\n`);

    } catch (err: any) {
      spinner.fail(chalk.red(`Failed to probe design tokens: ${err.message}`));
      process.exit(1);
    }
  });

  program.parse(process.argv);
}
