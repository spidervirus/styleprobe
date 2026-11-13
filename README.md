<div align="center">

# 🔍 styleprobe

### Point at any URL. Extract its complete visual design system.

Extracts colors, typography scales, SVG brand assets, and multi-page design tokens from any website directly into AI-ready Markdown, shadcn/ui variables, Tailwind v4, or Figma tokens.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![CI Status](https://img.shields.io/github/actions/workflow/status/spidervirus/styleprobe/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/spidervirus/styleprobe/actions)
[![Node Version](https://img.shields.io/badge/Node-%3E%3D18.0.0-10b981.svg?style=flat-square)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Engine-Playwright-f97316.svg?style=flat-square)](https://playwright.dev/)

```bash
npx styleprobe https://example.com
```

[Live Web Playground](web/) · [Quick Start](#-quick-start) · [Export Formats](#-supported-export-formats) · [CLI Options](#-cli-reference) · [Contributing](CONTRIBUTING.md)

</div>

---

## 💡 The Problem styleprobe Solves

When prompting modern AI coding agents (Antigravity, Cursor, Claude Code, Copilot) to create or restyle application interfaces, a common failure mode is **generic, default styling**:

- Generic, saturated default blues and random grays.
- Default system serif or sans fonts without scale hierarchy.
- Inconsistent border radii across buttons, cards, and input controls.
- Flat appearance lacking brand elevation, borders, or shadow depth.

Manual inspection via browser DevTools to gather CSS custom properties, typography values, and contrast ratios often takes 20–30 minutes per brand.

`styleprobe` automates this entire reverse-engineering workflow. It runs a headless browser inspection against any target URL, parses live computed styles across the DOM, and compiles them into production-ready tokens and AI context files.

---

## 🧭 System Architecture

```
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────────┐
│   Target URL    │ ───►  │   Headless Engine    │ ───►  │ Universal Brand Tokens │
│  (Live Website) │       │ (Multi-Page Crawler) │       │ (Light + Dark Palettes)│
└─────────────────┘       └──────────────────────┘       └────────────────────────┘
                                                                      │
         ┌───────────────────┬────────────────────┬───────────────────┼────────────────────┐
         ▼                   ▼                    ▼                   ▼                    ▼
   [ design.md ]     [ shadcn/ui CSS ]     [ Tailwind v4 ]     [ SVG Assets ]     [ .cursorrules ]
```

---

## ✨ Core Features

### 1. Multi-Page Site Crawling (`--depth <n>`)
Landing pages (`/`) often have different layouts and styles than documentation (`/docs`) or pricing sections (`/pricing`). The multi-page crawler navigates internal subpages and aggregates styling across your entire web application to extract universal design rules.

### 2. Dual-Theme Extraction
Inspects both light and dark modes within a single pass. The output documents separate color palettes for both modes and automatically outputs `:root` and `.dark` blocks in CSS exports.

### 3. SVG & Logo Harvester (`--assets`)
Automatically harvests inline brand logos, navigation marks, and SVGs into a dedicated local directory, eliminating broken image placeholders during AI component builds.

### 4. Semantic Color Clustering
Uses Euclidean RGB color distance calculations to collapse dozens of near-identical hex values into semantic tokens:
- `background`: Canvas background color
- `surface`: Elevated layers (cards, sidebars, popovers)
- `primary`: Interactive brand accent (buttons, active tabs)
- `textPrimary`: High-contrast headings and body copy
- `textSecondary`: Subtle secondary and muted labels
- `border`: Dividing lines and container boundaries

### 5. Rendered Typography & Component Extraction
Captures real computed heading hierarchies (`h1`–`h4`), paragraph line heights, button paddings, border radii, and box shadows directly from the rendered DOM.

### 6. Interactive Web Playground
A Next.js companion app located in [`web/`](web/) that provides an interactive canvas with pre-built components (Navbar, Hero, Pricing Card, and Forms) that dynamically restyle in real time when you probe a URL.

---

## ⚡ Quick Start

Run directly in your terminal with `npx` (no cloning or manual installation required):

### 1. Generate Markdown Design Specification (Default)
```bash
npx styleprobe https://linear.app -o ./design.md
```

### 2. Multi-Page Comprehensive Brand Audit
```bash
npx styleprobe https://stripe.com --depth 3 --assets ./brand-assets
```

### 3. Generate shadcn/ui Theme Variables (Light + Dark)
```bash
npx styleprobe https://vercel.com -f shadcn -o ./globals.css
```

### 4. Generate Modern Tailwind CSS v4 Theme
```bash
npx styleprobe https://github.com -f tailwind-v4 -o ./theme.css
```

### 5. Generate Agent Instructions for AI Editors
```bash
npx styleprobe https://linear.app -f cursorrules -o ./.cursorrules
```

---

## 📊 Supported Export Formats

| Format Flag | Target Output | Primary Use Case |
|---|---|---|
| `-f markdown` *(default)* | `design.md` | Complete prompt specification for LLMs and AI agents |
| `-f shadcn` | `shadcn-globals.css` | Drop-in HSL theme variables with dual-theme (`.dark`) support |
| `-f tailwind-v4` | `theme.css` | Modern `@theme` CSS block for Tailwind v4 |
| `-f tailwind` | `tailwind.config.js` | Traditional theme object for Tailwind v3 projects |
| `-f figma-tokens` | `tokens.json` | Design Tokens Community Group (DTCG) specification |
| `-f cursorrules` | `.cursorrules` | Direct instruction rules for AI coding assistants |
| `-f json` | `design-tokens.json` | Complete raw extracted token metadata |

---

## 💻 CLI Reference

```text
Usage: styleprobe <url> [options]

Arguments:
  url                    Target web address (e.g., https://example.com)

Options:
  -o, --output <path>    Output destination path (defaults to standard name per format)
  -f, --format <format>  Selected format: markdown, shadcn, tailwind-v4, tailwind, figma-tokens, cursorrules, json
  -d, --depth <number>   Number of internal pages to crawl (1 to 5, default: 1)
  --assets [dir]         Harvest brand logos and SVGs to a directory (default: ./assets)
  -v, --version          Display installed version
  -h, --help             Display CLI usage instructions
```

---

## 🛠️ Local Development

### Prerequisites
- Node.js 18.0.0 or higher
- npm 9.0.0 or higher

### Setup

```bash
# Clone the repository
git clone https://github.com/spidervirus/styleprobe.git
cd styleprobe

# Install root dependencies & Playwright browsers
npm install
npx playwright install chromium

# Run the CLI from local source
npm run dev https://example.com --depth 2

# Compile TypeScript to production bundle
npm run build
```

### Running the Web Playground Locally

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to interact with the live playground.

---

## 📁 Repository Structure

```text
styleprobe/
├── src/
│   ├── analyzer.ts       # Color clustering & semantic contrast algorithm
│   ├── cli.ts            # CLI command options & terminal experience
│   ├── extractor.ts      # Playwright DOM inspection & multi-page crawler
│   ├── formatter.ts      # Formatters (Markdown, shadcn, Tailwind, DTCG, Cursor)
│   └── types.ts          # Core TypeScript token definitions
├── web/
│   ├── app/
│   │   ├── api/probe/    # Vercel serverless probe endpoint
│   │   └── page.tsx      # Interactive component preview & code exporter
│   └── package.json      # Web playground dependencies
├── .github/
│   └── workflows/
│       └── ci.yml        # Continuous integration pipeline
├── CONTRIBUTING.md       # Contribution guidelines
├── LICENSE               # MIT License
├── package.json          # Root package & binary configuration
├── README.md             # Project documentation
└── tsconfig.json         # TypeScript compiler configuration
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps to contribute:

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/NewFeature`).
3. Commit your changes (`git commit -m 'Add NewFeature'`).
4. Push to the branch (`git push origin feature/NewFeature`).
5. Open a Pull Request.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for full details on coding standards and testing guidelines.

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
