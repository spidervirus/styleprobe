#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDesignTokens } from './extractor.js';
import { 
  formatToMarkdown, 
  formatToTailwind, 
  formatToTailwindV4, 
  formatToShadcn, 
  formatToFigmaTokens,
  formatToAgentRules 
} from './formatter.js';

const program = new Command();

program
  .name('styleprobe')
  .description('Probe and extract design systems from any URL into AI-ready specifications, Tailwind configs, and design tokens')
  .version('1.0.0')
  .argument('<url>', 'Target website URL (e.g., https://github.com or stripe.com)')
  .option('-o, --output <path>', 'Output file path (default adjusts based on format)')
  .option('-f, --format <format>', 'Output format: markdown, tailwind, tailwind-v4, shadcn, figma-tokens, cursorrules, or json', 'markdown')
  .option('-d, --depth <number>', 'Number of internal pages to crawl (1 to 5)', '1')
  .option('--assets [dir]', 'Harvest SVGs & brand logos into a local directory', false)
  .action(async (targetUrl: string, options: { output?: string; format: string; depth: string; assets: boolean | string }) => {
    let normalizedUrl = targetUrl;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    const crawlDepth = Math.max(1, Math.min(parseInt(options.depth, 10) || 1, 5));

    console.log(chalk.bold.magenta('\n🔍 styleprobe') + chalk.gray(' — Visual DNA Extractor for AI Coding Agents\n'));
    const spinner = ora(`Probing ${chalk.cyan(normalizedUrl)} (depth: ${crawlDepth})...`).start();

    try {
      spinner.text = crawlDepth > 1 
        ? `Launching crawler & discovering up to ${crawlDepth} internal subpages...`
        : 'Launching headless browser & parsing computed styles...';

      const tokens = await extractDesignTokens(normalizedUrl, crawlDepth);

      spinner.text = `Analyzing design tokens & formatting as ${chalk.yellow(options.format)}...`;
      
      let outputContent = '';
      let defaultFilename = 'design.md';

      switch (options.format.toLowerCase()) {
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
        case 'cursorrules':
        case 'agent':
          outputContent = formatToAgentRules(tokens);
          defaultFilename = '.cursorrules';
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
      console.log(` • Pages:       ${tokens.crawledPages?.length || 1} crawled (${tokens.crawledPages?.map(u => {
        try { return new URL(u).pathname; } catch { return u; }
      }).join(', ')})`);
      console.log(` • Theme:       ${tokens.themeMode.toUpperCase()}`);
      console.log(` • Primary:     ${chalk.hex(tokens.colors.primary)('■')} ${tokens.colors.primary}`);
      console.log(` • Background:  ${chalk.hex(tokens.colors.background)('■')} ${tokens.colors.background}`);
      console.log(` • Text:        ${chalk.hex(tokens.colors.textPrimary)('■')} ${tokens.colors.textPrimary}`);
      console.log(` • Fonts:       ${tokens.typography.fontFamilies.join(', ') || 'System default'}`);
      console.log(` • SVGs:        ${tokens.assets.length} extracted${savedAssetsCount > 0 ? ` (saved to ${options.assets})` : ''}`);
      console.log(` • File:        ${resolvedPath}\n`);

    } catch (err: any) {
      spinner.fail(chalk.red(`Failed to probe design tokens: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
