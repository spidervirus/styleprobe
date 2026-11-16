import { colord } from 'colord';
import { DesignTokens } from './types.js';

/**
 * Converts a hex code to shadcn's space-separated HSL format: "H S% L%"
 */
function toShadcnHsl(hex: string): string {
  const hsl = colord(hex).toHsl();
  return `${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`;
}

/**
 * Builds responsive property comparison markdown table
 */
export function buildResponsiveTable(tokens: DesignTokens): string {
  if (tokens.responsive?.comparison && tokens.responsive.comparison.length > 0) {
    const rows = tokens.responsive.comparison.map(c => 
      `| ${c.property} | \`${c.desktop}\` | \`${c.tablet}\` | \`${c.mobile}\` |`
    );
    return `| Property | Desktop | Tablet | Mobile |
|---|---|---|---|
${rows.join('\n')}`;
  }

  // Fallback if responsive extraction was skipped or unavailable
  const h1 = tokens.typography.headings.find(h => h.tag === 'h1')?.fontSize || '36px';
  const body = tokens.typography.body[0]?.fontSize || '16px';
  return `| Property | Desktop | Tablet | Mobile |
|---|---|---|---|
| H1 font size | \`${h1}\` | \`32px\` | \`26px\` |
| Section padding | \`80px\` | \`48px\` | \`24px\` |
| Grid columns | \`3\` | \`2\` | \`1\` |
| Navigation | \`Full\` | \`Compact\` | \`Menu\` |
| Card gap | \`24px\` | \`20px\` | \`16px\` |
| Body font size | \`${body}\` | \`${body}\` | \`${body}\` |`;
}

/**
 * Builds detected media query breakpoints list
 */
export function buildBreakpointsList(tokens: DesignTokens): string {
  const breakpoints = tokens.breakpoints || tokens.responsive?.detectedBreakpoints || [];
  if (breakpoints.length > 0) {
    return breakpoints.map(b => 
      `- **${b.name || `${b.value}px`}**: \`${b.value}px\` (\`${b.query}\`)`
    ).join('\n');
  }
  return '- *Fluid responsive scaling or no discrete media query thresholds detected.*';
}

/**
 * Builds responsive implementation rules
 */
export function buildResponsiveRulesList(tokens: DesignTokens): string {
  if (tokens.responsive?.rules && tokens.responsive.rules.length > 0) {
    return tokens.responsive.rules.map((r, i) => 
      `${i + 1}. **${r.property}**: ${r.behavior}${r.query ? ` (\`${r.query}\`)` : ''}`
    ).join('\n');
  }

  return `1. **Navigation collapse**: Desktop navigation links collapse into a hamburger drawer on mobile viewports (< 768px).
2. **Typography scaling**: Heading sizes scale down smoothly between desktop and mobile to maintain line lengths.
3. **Grid wrapping**: Multi-column grids (3 or 2 columns) reduce to a single full-width column on mobile screens.
4. **Touch targets**: Interactive buttons expand to full container width on mobile viewports.`;
}

/**
 * Builds strict negative constraints for AI coding agents
 */
export function buildNegativeConstraints(tokens: DesignTokens): string {
  const { colors, typography, spacingAndRadii, breakpoints } = tokens;
  const bpString = breakpoints && breakpoints.length > 0
    ? breakpoints.map(b => `${b.value}px`).join(', ')
    : 'detected site thresholds';

  return `To prevent visual drift and style fragmentation, AI coding agents MUST strictly observe these negative constraints:

1. **DO NOT invent arbitrary colors or hex codes**: Only use the extracted palette tokens (\`${colors.primary}\`, \`${colors.background}\`, \`${colors.surface}\`, \`${colors.textPrimary}\`, \`${colors.border}\`). Do not introduce random grays (e.g. \`#1a1a2e\`, \`#2d3748\`, \`slate-800\`).
2. **DO NOT introduce unlisted web fonts**: Use only the extracted font families (${typography.fontFamilies.map(f => `\`${f}\``).join(', ') || 'System default'}). Do not default to Inter, Roboto, or Arial unless explicitly extracted.
3. **DO NOT invent arbitrary border-radii**: Use only the extracted corner radii (${spacingAndRadii.borderRadii.map(r => `\`${r}\``).join(', ') || '`6px`, `8px`'}).
4. **DO NOT assume Tailwind default breakpoints (640/768/1024/1280)**: The target site uses custom breakpoints: ${bpString}. Respect these thresholds.
5. **DO NOT hardcode light colors inside dark mode or vice versa**: Always use dual-theme CSS variables (\`var(--background)\`, \`var(--surface)\`, \`var(--primary)\`) or theme classes.
6. **DO NOT invent arbitrary elevation shadows**: Use only the extracted box-shadows (${spacingAndRadii.shadows.map(s => `\`${s}\``).join(', ') || '`none`'}).
7. **DO NOT invent unextracted spacing values**: Stick to the extracted section padding and card gap scales across viewports.`;
}

/**
 * Standard Markdown format optimized for LLMs with Dual-Theme specs & Responsive Matrix
 */
export function formatToMarkdown(tokens: DesignTokens): string {
  const { title, url, extractedAt, themeMode, colors, themes, typography, spacingAndRadii, components, assets } = tokens;

  const light = themes?.light || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  const dark = themes?.dark || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  return `# Design Guidelines for ${title}

> Extracted automatically from [${url}](${url}) on ${extractedAt.split('T')[0]}.
> Designed for AI coding agents (Antigravity, Cursor, Claude Code) to accurately match the site's design system.

---

## 1. Visual Theme & Overview

- **Default Mode**: \`${themeMode.toUpperCase()}\`
- **Supported Schemes**: \`LIGHT\` and \`DARK\`

### Dual-Theme Tokens

| Role | Light Mode | Dark Mode | Notes |
|---|---|---|---|
| Background | \`${light.background}\` | \`${dark.background}\` | Primary canvas surface |
| Surface / Cards | \`${light.surface}\` | \`${dark.surface}\` | Elevated cards, sidebars, modals |
| Primary Accent | \`${light.primary}\` | \`${dark.primary}\` | Key interactive CTAs, active links |
| Text Primary | \`${light.textPrimary}\` | \`${dark.textPrimary}\` | High-contrast headings and body |
| Text Muted | \`${light.textSecondary}\` | \`${dark.textSecondary}\` | Secondary labels and descriptions |
| Border | \`${light.border}\` | \`${dark.border}\` | Dividers, container boundaries |

---

## 2. CSS Custom Properties

\`\`\`css
:root {
  --background: ${light.background};
  --surface: ${light.surface};
  --primary: ${light.primary};
  --text-primary: ${light.textPrimary};
  --text-secondary: ${light.textSecondary};
  --border: ${light.border};
}

.dark {
  --background: ${dark.background};
  --surface: ${dark.surface};
  --primary: ${dark.primary};
  --text-primary: ${dark.textPrimary};
  --text-secondary: ${dark.textSecondary};
  --border: ${dark.border};
}
\`\`\`

---

## 3. Typography

- **Primary Font Families**: ${typography.fontFamilies.length > 0 ? typography.fontFamilies.map(f => `\`${f}\``).join(', ') : '`System Sans-Serif`'}

### Heading Scale
| Element | Font Size | Weight | Line Height |
|---|---|---|---|
${typography.headings.map(h => `| \`<${h.tag}>\` | \`${h.fontSize}\` | \`${h.fontWeight}\` | \`${h.lineHeight}\` |`).join('\n')}

### Body Typography
| Element | Font Size | Weight | Line Height |
|---|---|---|---|
${typography.body.map(b => `| \`<${b.tag}>\` | \`${b.fontSize}\` | \`${b.fontWeight}\` | \`${b.lineHeight}\` |`).join('\n')}

---

## 4. Spacing, Elevation & Corners

### Border Radii
${spacingAndRadii.borderRadii.length > 0 ? spacingAndRadii.borderRadii.map(r => `- \`${r}\``).join('\n') : '- `6px` / `8px`'}

### Shadows & Elevation
${spacingAndRadii.shadows.length > 0 ? spacingAndRadii.shadows.map(s => `- \`${s}\``).join('\n') : '- `0 1px 3px rgba(0,0,0,0.1)`'}

---

## 5. Responsive Design & Viewport Matrix

### Detected Breakpoint Thresholds
${buildBreakpointsList(tokens)}

### Cross-Viewport Property Comparison
${buildResponsiveTable(tokens)}

### Responsive Implementation Rules
${buildResponsiveRulesList(tokens)}

---

## 6. Component Patterns

${components.map(comp => `### ${comp.type.toUpperCase()} Component Spec
\`\`\`css
.${comp.type} {
  background-color: ${comp.styles.backgroundColor};
  color: ${comp.styles.color};
  border-radius: ${comp.styles.borderRadius};
  border: ${comp.styles.border};
  padding: ${comp.styles.padding};
  font-size: ${comp.styles.fontSize};
  font-weight: ${comp.styles.fontWeight};
  box-shadow: ${comp.styles.boxShadow};
}
\`\`\`
`).join('\n')}

---

## 7. Extracted Brand SVGs & Assets

${assets && assets.length > 0 ? assets.map((a, i) => `### Asset ${i + 1}: ${a.name} (${a.type.toUpperCase()})
\`\`\`xml
${a.svgContent}
\`\`\`
`).join('\n') : '*No inline SVGs extracted.*'}

---

## 8. AI Agent Implementation Instructions & Negative Constraints

When building components or pages for this interface:
1. **Support dual themes**: Use CSS variables \`--background\`, \`--surface\`, and \`--primary\` so components switch cleanly between light and dark modes.
2. **Typography hierarchy**: Maintain the specified heading scales and avoid mixing incompatible font families.
3. **Corner rounding**: Use the extracted border-radii consistently across all cards and interactive controls.
4. **Theme fidelity**: Respect the contrast ratios defined in both light and dark modes.

### Styles AI Agents MUST NOT Invent
${buildNegativeConstraints(tokens)}
`;
}

/**
 * Dedicated CLAUDE.md exporter for Claude Code
 */
export function formatToClaudeMd(tokens: DesignTokens): string {
  const { title, url, extractedAt, themeMode, colors, themes, typography, spacingAndRadii, components } = tokens;

  const light = themes?.light || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  const dark = themes?.dark || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  return `# CLAUDE.md — Design System Rules for ${title}

> Extracted from [${url}](${url}) on ${extractedAt.split('T')[0]}.
> Claude Code must follow these specifications when writing UI components, pages, and stylesheets.

## 1. Which Colors to Use
Default Mode: **${themeMode.toUpperCase()}**

### Dual-Theme Palette
- **Canvas Background**: \`${light.background}\` (Light) | \`${dark.background}\` (Dark) — Use \`var(--background)\`
- **Surface / Cards**: \`${light.surface}\` (Light) | \`${dark.surface}\` (Dark) — Use \`var(--surface)\`
- **Primary CTA / Accent**: \`${light.primary}\` (Light) | \`${dark.primary}\` (Dark) — Use \`var(--primary)\`
- **Text Primary**: \`${light.textPrimary}\` (Light) | \`${dark.textPrimary}\` (Dark) — Use \`var(--text-primary)\`
- **Text Muted**: \`${light.textSecondary}\` (Light) | \`${dark.textSecondary}\` (Dark) — Use \`var(--text-secondary)\`
- **Border**: \`${light.border}\` (Light) | \`${dark.border}\` (Dark) — Use \`var(--border)\`

## 2. Fonts and Typography Scales to Follow
- **Primary Families**: ${typography.fontFamilies.length > 0 ? typography.fontFamilies.map(f => `\`${f}\``).join(', ') : '`system-ui, sans-serif`'}

### Heading Scale
| Element | Font Size | Weight | Line Height |
|---|---|---|---|
${typography.headings.map(h => `| \`<${h.tag}>\` | \`${h.fontSize}\` | \`${h.fontWeight}\` | \`${h.lineHeight}\` |`).join('\n')}

### Body Scale
| Element | Font Size | Weight | Line Height |
|---|---|---|---|
${typography.body.map(b => `| \`<${b.tag}>\` | \`${b.fontSize}\` | \`${b.fontWeight}\` | \`${b.lineHeight}\` |`).join('\n')}

## 3. How to Structure Layouts
- **Container Max Width**: \`${tokens.responsive?.viewports.desktop.containerMaxWidth || '1280px'}\`
- **Section Vertical Padding**:
  - Desktop: \`${tokens.responsive?.viewports.desktop.sectionPadding || '80px'}\`
  - Tablet: \`${tokens.responsive?.viewports.tablet.sectionPadding || '48px'}\`
  - Mobile: \`${tokens.responsive?.viewports.mobile.sectionPadding || '24px'}\`
- **Grid Architecture**:
  - Desktop: \`${tokens.responsive?.viewports.desktop.gridColumns || '3'}\` columns (gap: \`${tokens.responsive?.viewports.desktop.cardGap || '24px'}\`)
  - Tablet: \`${tokens.responsive?.viewports.tablet.gridColumns || '2'}\` columns (gap: \`${tokens.responsive?.viewports.tablet.cardGap || '20px'}\`)
  - Mobile: \`${tokens.responsive?.viewports.mobile.gridColumns || '1'}\` column (gap: \`${tokens.responsive?.viewports.mobile.cardGap || '16px'}\`)

## 4. Which Component Styles to Reuse
${components.map(comp => `### ${comp.type.toUpperCase()} Pattern
- Background: \`${comp.styles.backgroundColor}\`
- Text: \`${comp.styles.color}\`
- Border: \`${comp.styles.border}\`
- Border Radius: \`${comp.styles.borderRadius}\`
- Padding: \`${comp.styles.padding}\`
- Font Size: \`${comp.styles.fontSize}\` | Weight: \`${comp.styles.fontWeight}\`
`).join('\n')}

## 5. How Responsive Behavior Works
### Breakpoint Thresholds
${buildBreakpointsList(tokens)}

### Viewport Property Comparison
${buildResponsiveTable(tokens)}

### Behavioral Transition Rules
${buildResponsiveRulesList(tokens)}

## 6. Styles AI Agents MUST NOT Invent
${buildNegativeConstraints(tokens)}
`;
}

/**
 * Dedicated AGENTS.md exporter for autonomous coding agents (Codex, Antigravity, Copilot)
 */
export function formatToAgentsMd(tokens: DesignTokens): string {
  const { title, url, extractedAt, themeMode, colors, themes, typography, components } = tokens;

  const light = themes?.light || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  const dark = themes?.dark || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  return `# AGENTS.md — Visual DNA & Design Specifications for ${title}

> Target URL: [${url}](${url}) | Extracted: ${extractedAt.split('T')[0]}
> Instruction scope: All coding agents generating frontend UI for this project.

## 1. Color Palette & Roles
- Default Theme: \`${themeMode.toUpperCase()}\`
- Light Mode:
  - \`--background\`: \`${light.background}\`
  - \`--surface\`: \`${light.surface}\`
  - \`--primary\`: \`${light.primary}\`
  - \`--text-primary\`: \`${light.textPrimary}\`
  - \`--text-secondary\`: \`${light.textSecondary}\`
  - \`--border\`: \`${light.border}\`
- Dark Mode:
  - \`--background\`: \`${dark.background}\`
  - \`--surface\`: \`${dark.surface}\`
  - \`--primary\`: \`${dark.primary}\`
  - \`--text-primary\`: \`${dark.textPrimary}\`
  - \`--text-secondary\`: \`${dark.textSecondary}\`
  - \`--border\`: \`${dark.border}\`

## 2. Typography Hierarchy
- Fonts: ${typography.fontFamilies.map(f => `\`${f}\``).join(', ') || 'System default'}
- Heading Scales:
${typography.headings.map(h => `  - \`<${h.tag}>\`: ${h.fontSize} / ${h.lineHeight} (Weight: ${h.fontWeight})`).join('\n')}
- Body Scales:
${typography.body.map(b => `  - \`<${b.tag}>\`: ${b.fontSize} / ${b.lineHeight} (Weight: ${b.fontWeight})`).join('\n')}

## 3. Layout & Structure
- Viewport Max Width: \`${tokens.responsive?.viewports.desktop.containerMaxWidth || '1280px'}\`
- Section Padding:
  - Desktop: \`${tokens.responsive?.viewports.desktop.sectionPadding || '80px'}\`
  - Tablet: \`${tokens.responsive?.viewports.tablet.sectionPadding || '48px'}\`
  - Mobile: \`${tokens.responsive?.viewports.mobile.sectionPadding || '24px'}\`
- Grid Columns: \`${tokens.responsive?.viewports.desktop.gridColumns || '3'}\` (desktop) → \`${tokens.responsive?.viewports.tablet.gridColumns || '2'}\` (tablet) → \`${tokens.responsive?.viewports.mobile.gridColumns || '1'}\` (mobile)

## 4. Component Styles to Reuse
${components.map(comp => `- **${comp.type.toUpperCase()}**: padding: \`${comp.styles.padding}\`, radius: \`${comp.styles.borderRadius}\`, border: \`${comp.styles.border}\`, bg: \`${comp.styles.backgroundColor}\`, color: \`${comp.styles.color}\``).join('\n')}

## 5. Responsive Behavior Matrix
${buildResponsiveTable(tokens)}

### Detected Breakpoint Thresholds
${buildBreakpointsList(tokens)}

### Rules
${buildResponsiveRulesList(tokens)}

## 6. Strict Negative Constraints (DO NOT INVENT)
${buildNegativeConstraints(tokens)}
`;
}

/**
 * Dedicated .cursorrules exporter for Cursor IDE
 */
export function formatToCursorrules(tokens: DesignTokens): string {
  const { title, colors, typography, spacingAndRadii, breakpoints } = tokens;
  const bpList = breakpoints?.map(b => `${b.value}px`).join(', ') || '768px, 1024px';

  return `# Cursor AI Design System Rules for ${title}
# You are an expert frontend engineer building UI matching the exact design system of ${title}.
# YOU MUST STRICTLY ADHERE to the design tokens and negative constraints below:

[COLORS]
- Primary CTA: ${colors.primary}
- Canvas Background: ${colors.background}
- Card / Surface: ${colors.surface}
- Text Primary: ${colors.textPrimary}
- Text Muted: ${colors.textSecondary}
- Border: ${colors.border}
- Always use CSS variables: var(--background), var(--surface), var(--primary), var(--text-primary), var(--border)

[TYPOGRAPHY]
- Font Families: ${typography.fontFamilies.join(', ') || 'System default'}
${typography.headings.map(h => `- <${h.tag}>: ${h.fontSize}, weight ${h.fontWeight}, line-height ${h.lineHeight}`).join('\n')}
${typography.body.slice(0, 2).map(b => `- Body <${b.tag}>: ${b.fontSize}, weight ${b.fontWeight}, line-height ${b.lineHeight}`).join('\n')}

[SPACING & CORNERS]
- Border Radii: ${spacingAndRadii.borderRadii.join(', ') || '6px, 8px'}
- Elevation Shadows: ${spacingAndRadii.shadows.join(' | ') || 'none'}
- Section Padding: Desktop: ${tokens.responsive?.viewports.desktop.sectionPadding || '80px'}, Tablet: ${tokens.responsive?.viewports.tablet.sectionPadding || '48px'}, Mobile: ${tokens.responsive?.viewports.mobile.sectionPadding || '24px'}

[RESPONSIVE MATRIX]
${buildResponsiveTable(tokens)}
- Detected Breakpoints: ${bpList}
- Navigation: Desktop ${tokens.responsive?.viewports.desktop.navigationMode || 'Full'} -> Mobile ${tokens.responsive?.viewports.mobile.navigationMode || 'Menu'}
- Grid: Desktop ${tokens.responsive?.viewports.desktop.gridColumns || '3'} cols -> Tablet ${tokens.responsive?.viewports.tablet.gridColumns || '2'} cols -> Mobile ${tokens.responsive?.viewports.mobile.gridColumns || '1'} col

[STRICT FORBIDDEN ACTIONS - DO NOT INVENT]
1. DO NOT introduce arbitrary hex colors. Only use the extracted palette.
2. DO NOT use unlisted font families (do not inject Inter, Roboto, Arial unless specified).
3. DO NOT invent arbitrary border-radius values.
4. DO NOT assume Tailwind default breakpoints unless they match detected breakpoints (${bpList}).
5. DO NOT hardcode light colors in dark mode.
6. DO NOT invent arbitrary box shadows or custom padding scales.
`;
}

/**
 * Agent Rules format (.cursorrules or Antigravity instruction rules)
 */
export function formatToAgentRules(tokens: DesignTokens): string {
  const markdown = formatToMarkdown(tokens);

  return `# AGENT DESIGN SYSTEM RULES
# When generating any HTML, CSS, React, Vue, or Tailwind code, YOU MUST STRICTLY ADHERE to these design tokens:

${markdown}
`;
}

/**
 * shadcn/ui compatible globals.css with dual-theme HSL variables (:root and .dark)
 */
export function formatToShadcn(tokens: DesignTokens): string {
  const { colors, themes, spacingAndRadii } = tokens;
  const radius = spacingAndRadii.borderRadii[0] || '0.5rem';

  const light = themes?.light || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  const dark = themes?.dark || {
    background: colors.background,
    surface: colors.surface,
    primary: colors.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border
  };

  return `/* shadcn/ui globals.css - Dual Theme Generated by styleprobe */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: ${toShadcnHsl(light.background)};
    --foreground: ${toShadcnHsl(light.textPrimary)};

    --card: ${toShadcnHsl(light.surface)};
    --card-foreground: ${toShadcnHsl(light.textPrimary)};

    --popover: ${toShadcnHsl(light.surface)};
    --popover-foreground: ${toShadcnHsl(light.textPrimary)};

    --primary: ${toShadcnHsl(light.primary)};
    --primary-foreground: 0 0% 100%;

    --secondary: ${toShadcnHsl(light.surface)};
    --secondary-foreground: ${toShadcnHsl(light.textPrimary)};

    --muted: ${toShadcnHsl(light.surface)};
    --muted-foreground: ${toShadcnHsl(light.textSecondary)};

    --accent: ${toShadcnHsl(light.primary)};
    --accent-foreground: 0 0% 100%;

    --border: ${toShadcnHsl(light.border)};
    --input: ${toShadcnHsl(light.border)};
    --ring: ${toShadcnHsl(light.primary)};

    --radius: ${radius};
  }

  .dark {
    --background: ${toShadcnHsl(dark.background)};
    --foreground: ${toShadcnHsl(dark.textPrimary)};

    --card: ${toShadcnHsl(dark.surface)};
    --card-foreground: ${toShadcnHsl(dark.textPrimary)};

    --popover: ${toShadcnHsl(dark.surface)};
    --popover-foreground: ${toShadcnHsl(dark.textPrimary)};

    --primary: ${toShadcnHsl(dark.primary)};
    --primary-foreground: 0 0% 0%;

    --secondary: ${toShadcnHsl(dark.surface)};
    --secondary-foreground: ${toShadcnHsl(dark.textPrimary)};

    --muted: ${toShadcnHsl(dark.surface)};
    --muted-foreground: ${toShadcnHsl(dark.textSecondary)};

    --accent: ${toShadcnHsl(dark.primary)};
    --accent-foreground: 0 0% 0%;

    --border: ${toShadcnHsl(dark.border)};
    --input: ${toShadcnHsl(dark.border)};
    --ring: ${toShadcnHsl(dark.primary)};
  }
}
`;
}

/**
 * Tailwind v4 modern @theme CSS block with detected custom breakpoints
 */
export function formatToTailwindV4(tokens: DesignTokens): string {
  const { colors, themes, typography, spacingAndRadii, breakpoints } = tokens;
  const fonts = typography.fontFamilies.length > 0 
    ? typography.fontFamilies.map(f => `"${f}"`).join(', ') + ', sans-serif'
    : 'system-ui, sans-serif';

  const light = themes?.light || colors;
  const dark = themes?.dark || colors;

  const breakpointLines = (breakpoints && breakpoints.length > 0)
    ? breakpoints.map((b, i) => `  --breakpoint-${b.name?.split(' ')[0] || `bp-${i + 1}`}: ${b.value}px;`).join('\n')
    : '  --breakpoint-tablet: 768px;\n  --breakpoint-desktop: 1024px;';

  return `/* Modern Tailwind v4 Theme Configuration - Generated by styleprobe */
@import "tailwindcss";

@theme {
  --color-background: ${light.background};
  --color-surface: ${light.surface};
  --color-primary: ${light.primary};
  --color-text-primary: ${light.textPrimary};
  --color-text-secondary: ${light.textSecondary};
  --color-border: ${light.border};

  --font-sans: ${fonts};

${breakpointLines}

${spacingAndRadii.borderRadii.map((r, i) => `  --radius-brand-${i + 1}: ${r};`).join('\n')}
}

@layer base {
  .dark {
    --color-background: ${dark.background};
    --color-surface: ${dark.surface};
    --color-primary: ${dark.primary};
    --color-text-primary: ${dark.textPrimary};
    --color-text-secondary: ${dark.textSecondary};
    --color-border: ${dark.border};
  }
}
`;
}

/**
 * Tailwind v3 configuration with detected site screens (does not assume generic defaults)
 */
export function formatToTailwind(tokens: DesignTokens): string {
  const { colors, typography, spacingAndRadii, breakpoints } = tokens;

  // Build custom screens object if site breakpoints were detected
  const screens: Record<string, string> = {};
  if (breakpoints && breakpoints.length > 0) {
    for (let i = 0; i < breakpoints.length; i++) {
      const b = breakpoints[i];
      const key = b.name?.split(' ')[0] || `screen-${i + 1}`;
      screens[key] = `${b.value}px`;
    }
  }

  const config: any = {
    darkMode: 'class',
    theme: {
      screens: Object.keys(screens).length > 0 ? screens : undefined,
      extend: {
        colors: {
          background: colors.background,
          surface: colors.surface,
          primary: colors.primary,
          'text-primary': colors.textPrimary,
          'text-secondary': colors.textSecondary,
          border: colors.border
        },
        fontFamily: {
          sans: typography.fontFamilies.length > 0 ? typography.fontFamilies : ['sans-serif']
        },
        borderRadius: spacingAndRadii.borderRadii.reduce((acc, r, i) => {
          acc[`brand-${i + 1}`] = r;
          return acc;
        }, {} as Record<string, string>)
      }
    }
  };

  // Clean undefined properties
  if (!config.theme.screens) delete config.theme.screens;

  return `// tailwind.config.js - Generated by styleprobe
/** @type {import('tailwindcss').Config} */
module.exports = ${JSON.stringify(config, null, 2)};
`;
}

/**
 * Standard Design Tokens Community Group (DTCG) / Figma Tokens JSON with responsive breakpoints
 */
export function formatToFigmaTokens(tokens: DesignTokens): string {
  const { colors, themes, typography, spacingAndRadii, breakpoints } = tokens;

  const dtcg: any = {
    color: {
      light: {
        background: { $value: themes?.light.background || colors.background, $type: 'color' },
        surface: { $value: themes?.light.surface || colors.surface, $type: 'color' },
        primary: { $value: themes?.light.primary || colors.primary, $type: 'color' },
        textPrimary: { $value: themes?.light.textPrimary || colors.textPrimary, $type: 'color' },
        border: { $value: themes?.light.border || colors.border, $type: 'color' }
      },
      dark: {
        background: { $value: themes?.dark.background || colors.background, $type: 'color' },
        surface: { $value: themes?.dark.surface || colors.surface, $type: 'color' },
        primary: { $value: themes?.dark.primary || colors.primary, $type: 'color' },
        textPrimary: { $value: themes?.dark.textPrimary || colors.textPrimary, $type: 'color' },
        border: { $value: themes?.dark.border || colors.border, $type: 'color' }
      }
    },
    typography: {
      fontFamily: {
        primary: {
          $value: typography.fontFamilies[0] || 'sans-serif',
          $type: 'fontFamily'
        }
      }
    },
    borderRadius: spacingAndRadii.borderRadii.reduce((acc, r, idx) => {
      acc[`radius-${idx + 1}`] = { $value: r, $type: 'dimension' };
      return acc;
    }, {} as Record<string, any>),
    boxShadow: spacingAndRadii.shadows.reduce((acc, s, idx) => {
      acc[`shadow-${idx + 1}`] = { $value: s, $type: 'shadow' };
      return acc;
    }, {} as Record<string, any>)
  };

  if (breakpoints && breakpoints.length > 0) {
    dtcg.breakpoint = breakpoints.reduce((acc, b, idx) => {
      const key = b.name?.split(' ')[0] || `bp-${idx + 1}`;
      acc[key] = { $value: `${b.value}px`, $type: 'dimension' };
      return acc;
    }, {} as Record<string, any>);
  }

  return JSON.stringify(dtcg, null, 2);
}

/**
 * Pure CSS custom properties with dual themes and responsive layout variables
 */
export function formatToCssVariables(tokens: DesignTokens): string {
  const { colors, themes, breakpoints, responsive } = tokens;

  const light = themes?.light || colors;
  const dark = themes?.dark || colors;

  const desktop = responsive?.viewports.desktop;
  const mobile = responsive?.viewports.mobile;

  return `/* CSS Custom Properties - Generated by styleprobe */
:root {
  /* Color Palette - Light Mode */
  --background: ${light.background};
  --surface: ${light.surface};
  --primary: ${light.primary};
  --text-primary: ${light.textPrimary};
  --text-secondary: ${light.textSecondary};
  --border: ${light.border};

  /* Layout & Spacing */
  --container-max-width: ${desktop?.containerMaxWidth || '1280px'};
  --section-padding: ${desktop?.sectionPadding || '80px'};
  --card-gap: ${desktop?.cardGap || '24px'};
}

.dark {
  /* Color Palette - Dark Mode */
  --background: ${dark.background};
  --surface: ${dark.surface};
  --primary: ${dark.primary};
  --text-primary: ${dark.textPrimary};
  --text-secondary: ${dark.textSecondary};
  --border: ${dark.border};
}

/* Responsive Media Queries */
@media (max-width: 768px) {
  :root {
    --section-padding: ${mobile?.sectionPadding || '24px'};
    --card-gap: ${mobile?.cardGap || '16px'};
  }
}
`;
}
