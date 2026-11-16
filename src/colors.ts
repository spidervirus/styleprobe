/**
 * Modern CSS Color Space Resolution & Conversion Engine
 *
 * Implements W3C CSS Color Module Level 4 & Level 5 specifications for:
 * - OKLCH: Polar coordinates in the Oklab color space (L: 0..1 or 0%..100%, C: 0..0.4, H: 0..360 deg)
 * - OKLAB: Perceptually uniform color space (L: 0..1 or 0%..100%, a, b: -0.4..0.4)
 * - CIE LAB: W3C Lab color space using D50 white point adapted to D65 via Bradford transform
 * - CIE LCH: Polar coordinates of CIE LAB (L: 0..100, C: 0..150, H: 0..360 deg)
 * - Display-P3: Wide-gamut color space with sRGB transfer curve and D65 white point
 *
 * Features:
 * - Deterministic, pure mathematical transformations matching browser rendering
 * - Gamut-safe clamping to canonical [0, 255] sRGB space
 * - Alpha threshold preservation (alpha < 0.1 returns null for consistency with cleanColor)
 * - Support for percentage, degree, radian, turn, and unitless notation
 */

export interface ModernColorComponents {
  space: 'oklch' | 'oklab' | 'lab' | 'lch' | 'p3';
  c1: number;
  c2: number;
  c3: number;
  alpha: number;
}

/**
 * Gamma-to-linear sRGB transfer function
 */
export function srgbToLinear(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.04045
    ? clamped / 12.92
    : Math.pow((clamped + 0.055) / 1.055, 2.4);
}

/**
 * Linear-to-gamma sRGB transfer function with out-of-gamut clamping
 */
export function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/**
 * Converts linear sRGB coordinates to a canonical 7-character #rrggbb hex string
 */
export function linearRgbToHex(rLin: number, gLin: number, bLin: number): string {
  const r = Math.round(Math.max(0, Math.min(255, linearToSrgb(rLin) * 255)));
  const g = Math.round(Math.max(0, Math.min(255, linearToSrgb(gLin) * 255)));
  const b = Math.round(Math.max(0, Math.min(255, linearToSrgb(bLin) * 255)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * OKLAB to linear sRGB conversion via inverse M1 and inverse M2 matrices
 */
export function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return [rLin, gLin, bLin];
}

/**
 * OKLCH to linear sRGB conversion
 */
export function oklchToLinearSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const rad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  return oklabToLinearSrgb(L, a, b);
}

/**
 * CIE LAB to linear sRGB conversion:
 * 1. LAB -> XYZ (D50)
 * 2. Bradford chromatic adaptation (D50 -> D65)
 * 3. XYZ (D65) -> linear sRGB
 */
export function labToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const eps = 216 / 24389; // ~0.008856
  const kappa = 24389 / 27; // ~903.3

  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const xr = Math.pow(fx, 3) > eps ? Math.pow(fx, 3) : (116 * fx - 16) / kappa;
  const yr = L > kappa * eps ? Math.pow((L + 16) / 116, 3) : L / kappa;
  const zr = Math.pow(fz, 3) > eps ? Math.pow(fz, 3) : (116 * fz - 16) / kappa;

  // D50 reference white
  const x50 = xr * 0.96422;
  const y50 = yr * 1.00000;
  const z50 = zr * 0.82521;

  // Bradford adaptation to D65
  const x65 =  0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
  const y65 = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
  const z65 =  0.0122982 * x50 - 0.0204830 * y50 + 1.3299098 * z50;

  // XYZ (D65) to linear sRGB
  const rLin =  3.2404542 * x65 - 1.5371385 * y65 - 0.4985314 * z65;
  const gLin = -0.9692660 * x65 + 1.8760108 * y65 + 0.0415560 * z65;
  const bLin =  0.0556434 * x65 - 0.2040259 * y65 + 1.0572252 * z65;

  return [rLin, gLin, bLin];
}

/**
 * CIE LCH to linear sRGB conversion
 */
export function lchToLinearSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const rad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  return labToLinearSrgb(L, a, b);
}

/**
 * Display-P3 to linear sRGB conversion:
 * P3 and sRGB share the same transfer function.
 * Multiplies linearized P3 by the M(P3 -> sRGB) matrix.
 */
export function p3ToLinearSrgb(rP3: number, gP3: number, bP3: number): [number, number, number] {
  const rLin = srgbToLinear(rP3);
  const gLin = srgbToLinear(gP3);
  const bLin = srgbToLinear(bP3);

  const rSrgbLin =  1.2249401760459524 * rLin - 0.2249401760459524 * gLin + 0.0 * bLin;
  const gSrgbLin = -0.04205695483606992 * rLin + 1.0420569548360699 * gLin + 0.0 * bLin;
  const bSrgbLin = -0.01963755458365287 * rLin - 0.0786360455998795 * gLin + 1.0982736001835323 * bLin;

  return [rSrgbLin, gSrgbLin, bSrgbLin];
}

// ─────────────────────────────────────────────────────────────────
// Parsing Helpers
// ─────────────────────────────────────────────────────────────────

function parsePercentOrFloat(val: string, maxHundred: number = 1): number {
  if (!val) return 0;
  const trimmed = val.trim();
  if (trimmed.endsWith('%')) {
    return (parseFloat(trimmed) / 100) * maxHundred;
  }
  return parseFloat(trimmed);
}

function parseAngleDegrees(val: string): number {
  if (!val) return 0;
  const trimmed = val.trim().toLowerCase();
  if (trimmed.endsWith('deg')) {
    return parseFloat(trimmed);
  }
  if (trimmed.endsWith('rad')) {
    return parseFloat(trimmed) * (180 / Math.PI);
  }
  if (trimmed.endsWith('turn')) {
    return parseFloat(trimmed) * 360;
  }
  return parseFloat(trimmed);
}

function parseAlphaValue(val?: string): number {
  if (!val) return 1.0;
  const trimmed = val.trim();
  if (trimmed.endsWith('%')) {
    return Math.max(0, Math.min(1, parseFloat(trimmed) / 100));
  }
  return Math.max(0, Math.min(1, parseFloat(trimmed)));
}

/**
 * Parses a CSS Color Module Level 4/5 string into component representation
 */
export function parseModernColor(raw: string): ModernColorComponents | null {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();

  // 1. OKLCH: oklch(L C H [/ A])
  const oklchMatch = str.match(/^oklch\(\s*([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)(?:\s*\/\s*([^\s/]+))?\s*\)$/i);
  if (oklchMatch) {
    const L = parsePercentOrFloat(oklchMatch[1], 1);
    const C = oklchMatch[2].endsWith('%') ? (parseFloat(oklchMatch[2]) / 100) * 0.4 : parseFloat(oklchMatch[2]);
    const H = parseAngleDegrees(oklchMatch[3]);
    const alpha = parseAlphaValue(oklchMatch[4]);
    if (isNaN(L) || isNaN(C) || isNaN(H)) return null;
    return { space: 'oklch', c1: L, c2: C, c3: H, alpha };
  }

  // 2. OKLAB: oklab(L a b [/ A])
  const oklabMatch = str.match(/^oklab\(\s*([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)(?:\s*\/\s*([^\s/]+))?\s*\)$/i);
  if (oklabMatch) {
    const L = parsePercentOrFloat(oklabMatch[1], 1);
    const a = oklabMatch[2].endsWith('%') ? (parseFloat(oklabMatch[2]) / 100) * 0.4 : parseFloat(oklabMatch[2]);
    const b = oklabMatch[3].endsWith('%') ? (parseFloat(oklabMatch[3]) / 100) * 0.4 : parseFloat(oklabMatch[3]);
    const alpha = parseAlphaValue(oklabMatch[4]);
    if (isNaN(L) || isNaN(a) || isNaN(b)) return null;
    return { space: 'oklab', c1: L, c2: a, c3: b, alpha };
  }

  // 3. CIE LAB: lab(L a b [/ A])
  const labMatch = str.match(/^lab\(\s*([^\s/,]+)[,\s]+([^\s/,]+)[,\s]+([^\s/,]+)(?:\s*\/\s*([^\s/,]+))?\s*\)$/i);
  if (labMatch) {
    const L = parsePercentOrFloat(labMatch[1], 100);
    const a = labMatch[2].endsWith('%') ? (parseFloat(labMatch[2]) / 100) * 125 : parseFloat(labMatch[2]);
    const b = labMatch[3].endsWith('%') ? (parseFloat(labMatch[3]) / 100) * 125 : parseFloat(labMatch[3]);
    const alpha = parseAlphaValue(labMatch[4]);
    if (isNaN(L) || isNaN(a) || isNaN(b)) return null;
    return { space: 'lab', c1: L, c2: a, c3: b, alpha };
  }

  // 4. CIE LCH: lch(L C H [/ A])
  const lchMatch = str.match(/^lch\(\s*([^\s/,]+)[,\s]+([^\s/,]+)[,\s]+([^\s/,]+)(?:\s*\/\s*([^\s/,]+))?\s*\)$/i);
  if (lchMatch) {
    const L = parsePercentOrFloat(lchMatch[1], 100);
    const C = lchMatch[2].endsWith('%') ? (parseFloat(lchMatch[2]) / 100) * 150 : parseFloat(lchMatch[2]);
    const H = parseAngleDegrees(lchMatch[3]);
    const alpha = parseAlphaValue(lchMatch[4]);
    if (isNaN(L) || isNaN(C) || isNaN(H)) return null;
    return { space: 'lch', c1: L, c2: C, c3: H, alpha };
  }

  // 5. Display-P3: color(display-p3 r g b [/ A])
  const p3Match = str.match(/^color\(\s*display-p3\s+([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)(?:\s*\/\s*([^\s/]+))?\s*\)$/i);
  if (p3Match) {
    const r = parsePercentOrFloat(p3Match[1], 1);
    const g = parsePercentOrFloat(p3Match[2], 1);
    const b = parsePercentOrFloat(p3Match[3], 1);
    const alpha = parseAlphaValue(p3Match[4]);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { space: 'p3', c1: r, c2: g, c3: b, alpha };
  }

  return null;
}

/**
 * Converts any supported modern CSS color format to canonical #rrggbb hex.
 * Returns null if string is unparseable or alpha < 0.1 (transparent).
 */
export function modernColorToHex(raw: string): string | null {
  const parsed = parseModernColor(raw);
  if (!parsed) return null;
  if (parsed.alpha < 0.1) return null;

  let lin: [number, number, number];
  switch (parsed.space) {
    case 'oklch':
      lin = oklchToLinearSrgb(parsed.c1, parsed.c2, parsed.c3);
      break;
    case 'oklab':
      lin = oklabToLinearSrgb(parsed.c1, parsed.c2, parsed.c3);
      break;
    case 'lab':
      lin = labToLinearSrgb(parsed.c1, parsed.c2, parsed.c3);
      break;
    case 'lch':
      lin = lchToLinearSrgb(parsed.c1, parsed.c2, parsed.c3);
      break;
    case 'p3':
      lin = p3ToLinearSrgb(parsed.c1, parsed.c2, parsed.c3);
      break;
    default:
      return null;
  }

  return linearRgbToHex(...lin);
}
