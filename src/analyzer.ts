import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import { ColorToken } from './types.js';

extend([a11yPlugin]);

export function cleanColor(raw: string): string | null {
  if (!raw || raw === 'transparent' || raw === 'inherit' || raw === 'initial') return null;
  const c = colord(raw);
  if (!c.isValid()) return null;
  if (c.alpha() < 0.1) return null;
  return c.toHex();
}

/**
 * Normalizes CSS custom properties that may be HSL values, hex, or raw rgb
 */
export function normalizeCssVarValue(val: string): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  // Check if standard hex or rgb
  const direct = cleanColor(trimmed);
  if (direct) return direct;

  // Many shadcn/Tailwind sites define variables as raw HSL numbers: "222.2 84% 4.9%"
  const spaceHsl = trimmed.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (spaceHsl) {
    const c = colord(`hsl(${spaceHsl[1]}, ${spaceHsl[2]}%, ${spaceHsl[3]}%)`);
    if (c.isValid()) return c.toHex();
  }
  return null;
}

export function dedupeColors(colors: Array<{ hex: string; count: number }>): ColorToken[] {
  const result: ColorToken[] = [];
  for (const item of colors) {
    const lum = colord(item.hex).luminance();
    const existing = result.find(d => {
      const rgbA = colord(d.hex).toRgb();
      const rgbB = colord(item.hex).toRgb();
      const dist = Math.sqrt(
        Math.pow((rgbA.r - rgbB.r) / 255, 2) +
        Math.pow((rgbA.g - rgbB.g) / 255, 2) +
        Math.pow((rgbA.b - rgbB.b) / 255, 2)
      );
      return dist < 0.05;
    });

    if (existing) {
      existing.count += item.count;
    } else {
      result.push({
        hex: item.hex,
        count: item.count,
        luminance: lum
      });
    }
  }
  return result.sort((a, b) => b.count - a.count);
}
