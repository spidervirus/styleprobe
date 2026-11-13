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
 * Standard Markdown format optimized for LLMs with Dual-Theme specs
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

## 5. Component Patterns

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

## 6. Extracted Brand SVGs & Assets

${assets && assets.length > 0 ? assets.map((a, i) => `### Asset ${i + 1}: ${a.name} (${a.type.toUpperCase()})
\`\`\`xml
${a.svgContent}
\`\`\`
`).join('\n') : '*No inline SVGs extracted.*'}

---

## 7. AI Agent Implementation Instructions

When building components or pages for this interface:
1. **Support dual themes**: Use CSS variables \`--background\`, \`--surface\`, and \`--primary\` so components switch cleanly between light and dark modes.
2. **Typography hierarchy**: Maintain the specified heading scales and avoid mixing incompatible font families.
3. **Corner rounding**: Use the extracted border-radii consistently across all cards and interactive controls.
4. **Theme fidelity**: Respect the contrast ratios defined in both light and dark modes.
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
 * Tailwind v4 modern @theme CSS block
 */
export function formatToTailwindV4(tokens: DesignTokens): string {
  const { colors, themes, typography, spacingAndRadii } = tokens;
  const fonts = typography.fontFamilies.length > 0 
    ? typography.fontFamilies.map(f => `"${f}"`).join(', ') + ', sans-serif'
    : 'system-ui, sans-serif';

  const light = themes?.light || colors;
  const dark = themes?.dark || colors;

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
 * Tailwind v3 configuration
 */
export function formatToTailwind(tokens: DesignTokens): string {
  const { colors, typography, spacingAndRadii } = tokens;
  const config = {
    darkMode: 'class',
    theme: {
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

  return `// tailwind.config.js - Generated by styleprobe
/** @type {import('tailwindcss').Config} */
module.exports = ${JSON.stringify(config, null, 2)};
`;
}

/**
 * Standard Design Tokens Community Group (DTCG) / Figma Tokens JSON
 */
export function formatToFigmaTokens(tokens: DesignTokens): string {
  const { colors, themes, typography, spacingAndRadii } = tokens;

  const dtcg = {
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

  return JSON.stringify(dtcg, null, 2);
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
