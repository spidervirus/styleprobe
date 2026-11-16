import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import { ColorToken } from './types.js';
import { modernColorToHex } from './colors.js';

extend([a11yPlugin]);

export function cleanColor(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'transparent' || trimmed === 'inherit' || trimmed === 'initial' || trimmed === 'none' || trimmed === 'currentColor') {
    return null;
  }

  // 1. Try colord for standard formats (hex, rgb, hsl, named)
  const c = colord(trimmed);
  if (c.isValid()) {
    if (c.alpha() < 0.1) return null;
    return c.toHex();
  }

  // 2. Try modern CSS color formats (oklch, oklab, lab, lch, display-p3)
  const modern = modernColorToHex(trimmed);
  if (modern) return modern;

  return null;
}

/**
 * Normalizes CSS custom properties that may be HSL values, hex, raw rgb, or modern color coordinates
 */
export function normalizeCssVarValue(val: string): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  
  // Direct cleanColor (hex, rgb, hsl, oklch, oklab, lab, lch, display-p3)
  const direct = cleanColor(trimmed);
  if (direct) return direct;

  // Many shadcn/Tailwind sites define variables as raw HSL numbers: "222.2 84% 4.9%"
  const spaceHsl = trimmed.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (spaceHsl) {
    const c = colord(`hsl(${spaceHsl[1]}, ${spaceHsl[2]}%, ${spaceHsl[3]}%)`);
    if (c.isValid()) return c.toHex();
  }

  // Tailwind v4 / shadcn raw OKLCH numbers: "0.6 0.2 240" or "60% 0.2 240" or "0.6 0.2 240 / 0.8"
  // Note: OKLCH chroma is in range 0..0.5 (or percentage where 100% = 0.4). Values > 1.0 are LAB coordinates.
  const spaceOklch = trimmed.match(/^([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+(?:deg|rad|turn)?)(?:\s*\/\s*([\d.]+%?))?$/);
  if (spaceOklch) {
    const chroma = spaceOklch[2].endsWith('%') ? (parseFloat(spaceOklch[2]) / 100) * 0.4 : parseFloat(spaceOklch[2]);
    if (chroma <= 0.6) {
      const converted = cleanColor(`oklch(${trimmed})`);
      if (converted) return converted;
    }
  }

  // Raw RGB triplets: "79 70 229"
  const spaceRgb = trimmed.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (spaceRgb) {
    const r = parseInt(spaceRgb[1], 10);
    const g = parseInt(spaceRgb[2], 10);
    const b = parseInt(spaceRgb[3], 10);
    if (r <= 255 && g <= 255 && b <= 255) {
      const c = colord(`rgb(${r}, ${g}, ${b})`);
      if (c.isValid()) return c.toHex();
    }
  }

  // Raw LAB coordinates: "50% 40 50" or "50 40 50"
  const spaceLab = trimmed.match(/^([\d.]+%?)\s+([-\d.]+%?)\s+([-\d.]+%?)(?:\s*\/\s*([\d.]+%?))?$/);
  if (spaceLab) {
    const converted = cleanColor(`lab(${trimmed})`);
    if (converted) return converted;
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
