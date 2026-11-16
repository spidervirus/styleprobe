<div align="center">

# 🔍 styleprobe

### Point at any URL. Extract its complete visual design system.

Extracts colors, typography scales, SVG brand assets, multi-page design tokens, and **responsive viewport behaviors** from any website directly into AI-ready **CLAUDE.md**, **AGENTS.md**, **.cursorrules**, shadcn/ui variables, Tailwind v4, or Figma tokens.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![CI Status](https://img.shields.io/github/actions/workflow/status/spidervirus/styleprobe/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/spidervirus/styleprobe/actions)
[![Node Version](https://img.shields.io/badge/Node-%3E%3D18.0.0-10b981.svg?style=flat-square)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Engine-Playwright-f97316.svg?style=flat-square)](https://playwright.dev/)

```bash
npx styleprobe https://example.com -f claude
```

[Live Web Playground](web/) · [Quick Start](#-quick-start) · [Usage Examples](docs/USAGE_EXAMPLES.md) · [Architecture](docs/ARCHITECTURE.md) · [Benchmark Report](docs/REAL_WORLD_BENCHMARK.md) · [Phase 3 Validation](docs/PHASE_3_VALIDATION.md) · [Export Formats](#-supported-export-formats)

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

```text
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────────┐
│   Target URL    │ ───►  │   Headless Engine    │ ───►  │ Universal Brand Tokens │
│  (Live Website) │       │ (Multi-Page Crawler) │       │ (Light + Dark Palettes)│
└─────────────────┘       └──────────────────────┘       └────────────────────────┘
                                                                      │
                                   ┌──────────────────────────────────┴──────────────────────────────────┐
                                   ▼                                                                     ▼
                      ┌──────────────────────────┐                                          ┌──────────────────────────┐
                      │  Multi-Viewport Probing  │                                          │  AI Coding Agent Context │
                      │ (Desktop, Tablet, Mobile)│                                          │  & Negative Constraints  │
                      └──────────────────────────┘                                          └──────────────────────────┘
                                   │                                                                     │
          ┌────────────────────────┼────────────────────────┬────────────────────────┬───────────────────┼────────────────────────┐
          ▼                        ▼                        ▼                        ▼                   ▼                        ▼
    [ CLAUDE.md ]            [ AGENTS.md ]           [ .cursorrules ]         [ Tailwind v4 ]     [ shadcn/ui CSS ]       [ tokens.json ]
```

---

## ✨ Core Features

### 1. Responsive Design Extraction Across Viewports
Websites adapt across screen sizes. `styleprobe` evaluates the target page across **Desktop (1440×900)**, **Tablet (768×1024)**, and **Mobile (375×667)** viewports to extract a complete responsive behavior matrix:
- **Heading scaling**: e.g. H1 font size `48px` (desktop) → `36px` (tablet) → `28px` (mobile).
- **Section padding**: e.g. `80px` (desktop) → `48px` (tablet) → `24px` (mobile).
- **Grid architecture**: e.g. `3` columns (desktop) → `2` columns (tablet) → `1` column (mobile).
- **Navigation state**: detects transitions from full desktop navigation bars to compact or mobile hamburger drawers.
- **Card gap & touch targets**: tracks card spacing and mobile button expansion (e.g. `Auto` → `100% Full width`).

### 2. Media Query & Custom Breakpoint Detection
Does not assume generic Tailwind default breakpoints (640/768/1024). It parses the site's actual stylesheets and inline `<style>` tags to discover real breakpoint thresholds (e.g. `680px`, `1080px`, `48em`), and detects fluid CSS scaling (`clamp()`, viewport units) versus discrete media queries.

### 3. AI Coding Agent Integration (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`)
Provides immediately usable context files tailored for AI coding assistants (**Claude Code, Cursor, Antigravity, OpenAI Codex, Copilot Workspace**). Every file includes:
1. **Which colors to use** (exact light and dark palette tokens).
2. **Which fonts and typography scales to follow** (H1–H6 sizes, weights, line heights).
3. **How to structure layouts** (container max-widths, section padding, grid column counts).
4. **Which component styles to reuse** (buttons, cards, inputs, badges).
5. **How responsive behavior works** (cross-viewport comparison matrix).
6. **Strict Negative Constraints ("Styles AI Agents MUST NOT Invent")**: Explicit guardrails forbidding AI agents from hallucinating random hex colors (e.g. `#1a1a2e`), injecting unlisted web fonts, or inventing non-standard breakpoints.

### 4. Multi-Page Site Crawling (`--depth <n>`)
Landing pages (`/`) often have different layouts and styles than documentation (`/docs`) or pricing sections (`/pricing`). The multi-page crawler navigates internal subpages and aggregates styling across your entire web application to extract universal design rules.

### 5. Dual-Theme Extraction
Inspects both light and dark modes within a single pass. The output documents separate color palettes for both modes and automatically outputs `:root` and `.dark` blocks in CSS exports.

### 6. SVG & Logo Harvester (`--assets`)
Automatically harvests inline brand logos, navigation marks, and SVGs into a dedicated local directory, eliminating broken image placeholders during AI component builds.

### 7. Modern CSS Color & Semantic CTA Scoring
Supports modern color spaces (**OKLCH, OKLAB, Display-P3, LAB, LCH**) with canvas-based sRGB fallback and gamut clamping. Semantic CTA scoring selects true conversion actions over navbar toggles and search controls.

### 8. Interactive Web Playground
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

### 5. Generate Claude Code Guidelines (`CLAUDE.md`)
```bash
npx styleprobe https://linear.app -f claude
```

### 6. Generate All AI Agent Files in One Shot (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`)
```bash
npx styleprobe https://linear.app -f all-agents
```

### 7. Extract Responsive Custom Breakpoints into Tailwind
```bash
npx styleprobe https://stripe.com -f tailwind -o ./tailwind.config.js
```

---

## 📊 Supported Export Formats

| Format Flag | Target Output | Primary Use Case |
|---|---|---|
| `-f claude` | `CLAUDE.md` | Tailored specifications for **Claude Code** with layout, responsive matrix, and strict negative constraints |
| `-f agents` | `AGENTS.md` | Comprehensive design system context for **Antigravity**, **OpenAI Codex**, and **Copilot Workspace** |
| `-f cursorrules` | `.cursorrules` | Directive system prompt rules and forbidden styling actions for **Cursor IDE** |
| `-f all-agents` | `CLAUDE.md`, `AGENTS.md`, `.cursorrules` | Generates all three primary AI coding agent files simultaneously |
| `-f markdown` *(default)* | `design.md` | Complete human and LLM-readable design specification with responsive matrix |
| `-f tailwind` | `tailwind.config.js` | Tailwind v3 configuration with detected site screens/breakpoints (not generic defaults) |
| `-f tailwind-v4` | `theme.css` | Modern Tailwind v4 `@theme` configuration with custom `--breakpoint-*` CSS tokens |
| `-f shadcn` | `shadcn-globals.css` | Drop-in HSL theme variables with dual-theme (`.dark`) support |
| `-f figma-tokens` | `tokens.json` | Design Tokens Community Group (DTCG) specification with responsive breakpoint dimensions |
| `-f css-variables` | `variables.css` | Dual-theme CSS custom properties with responsive `@media` layout queries |
| `-f json` | `design-tokens.json` | Complete raw extracted design token metadata |

---

## 💻 CLI Reference

```text
Usage: styleprobe <url> [options]

Arguments:
  url                    Target web address (e.g., https://example.com)

Options:
  -o, --output <path>    Output destination path (defaults to standard name per format)
  -f, --format <format>  Selected format: markdown, claude, agents, cursorrules, all-agents, tailwind, tailwind-v4, shadcn, figma-tokens, css-variables, json (default: markdown)
  -d, --depth <number>   Number of internal pages to crawl (1 to 5, default: 1)
  --sitemap              Discover pages from /sitemap.xml and /sitemap_index.xml (default: false)
  --assets [dir]         Harvest brand logos and SVGs to a directory (default: ./assets)
  -V, --version          Display installed version
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
├── docs/
│   ├── ARCHITECTURE.md       # Technical architecture & pipeline specification
│   ├── USAGE_EXAMPLES.md     # CLI, SDK, and AI agent integration examples
│   ├── REAL_WORLD_BENCHMARK.md # 15-website reproducible benchmark scorecard
│   ├── PHASE_3_VALIDATION.md # Real-world responsive & confidence validation
│   └── evidence/             # Viewport screenshots and benchmark datasets
├── src/
│   ├── analyzer.ts       # Color clustering, modern color spaces (OKLCH, P3) & contrast
│   ├── cli.ts            # CLI command options & terminal UX
│   ├── colors.ts         # OKLCH, OKLAB, LAB, LCH, P3 parsers & gamut clamping
│   ├── extractor.ts      # Playwright DOM inspection & multi-page crawler
│   ├── formatter.ts      # Multi-format exporters (CLAUDE.md, AGENTS.md, .cursorrules, Tailwind, DTCG)
│   ├── responsive.ts     # Multi-viewport probing (Desktop, Tablet, Mobile) & breakpoint detection
│   ├── robots.ts         # RFC 9309 robots.txt parser & compliance engine
│   ├── security.ts       # SSRF, DNS rebinding & URL validation defenses
│   ├── sitemap.ts        # XML sitemap discovery, recursion & budget enforcement
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
