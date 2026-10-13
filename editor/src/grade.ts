// Colour tools beyond the sliders: per-colour HSL, curves, colour wheels and colour match.
// Pure maths so it is unit-tested; colour.ts turns the results into shader inputs.
import type { Grade } from './schema';

export const HSL_COLOURS = [
  { id: 'red', name: 'แดง', hue: 0, swatch: '#ff3b30' },
  { id: 'orange', name: 'ส้ม', hue: 30, swatch: '#ff9500' },
  { id: 'yellow', name: 'เหลือง', hue: 60, swatch: '#ffd60a' },
  { id: 'green', name: 'เขียว', hue: 120, swatch: '#34c759' },
  { id: 'aqua', name: 'ฟ้า', hue: 180, swatch: '#32ade6' },
  { id: 'blue', name: 'น้ำเงิน', hue: 225, swatch: '#0a5cff' },
  { id: 'purple', name: 'ม่วง', hue: 270, swatch: '#af52de' },
  { id: 'pink', name: 'ชมพู', hue: 315, swatch: '#ff4f8b' },
] as const;

export const CURVE_CHANNELS = ['rgb', 'r', 'g', 'b'] as const;
export const WHEELS = ['shadows', 'midtones', 'highlights'] as const;

export const neutralGrade = (): Grade => ({
  hsl: HSL_COLOURS.map(() => [0, 0, 0]),
  curves: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
  wheels: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
});

const straight = (pts: [number, number][]) => pts.every(([x, y]) => Math.abs(x - y) < 1e-6);
export const hslUsed = (g?: Grade) => !!g && g.hsl.some((v) => v.some((x) => x !== 0));
export const curvesUsed = (g?: Grade) => !!g && CURVE_CHANNELS.some((k) => !straight(g.curves[k]));
export const wheelsUsed = (g?: Grade) => !!g && WHEELS.some((k) => g.wheels[k].some((x) => x !== 0));
export const gradeUsed = (g?: Grade) => hslUsed(g) || curvesUsed(g) || wheelsUsed(g);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Monotone cubic through the points (Fritsch-Carlson): smooth, and never overshoots between two points.
export function curveFn(points: [number, number][]) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return (x: number) => x;
  const h: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]);
    m[i] = (p[i + 1][1] - p[i][1]) / h[i];
  }
  const t: number[] = [m[0], ...p.slice(1, -1).map((_, k) => (m[k] * m[k + 1] <= 0 ? 0 : (m[k] + m[k + 1]) / 2)), m[n - 2]];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      t[i] = (3 / Math.sqrt(s)) * a * m[i];
      t[i + 1] = (3 / Math.sqrt(s)) * b * m[i];
    }
  }
  return (x: number) => {
    if (x <= p[0][0]) return clamp(p[0][1], 0, 1);
    if (x >= p[n - 1][0]) return clamp(p[n - 1][1], 0, 1);
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const u = (x - p[i][0]) / h[i];
    const y = (2 * u ** 3 - 3 * u ** 2 + 1) * p[i][1] + (u ** 3 - 2 * u ** 2 + u) * h[i] * t[i] + (-2 * u ** 3 + 3 * u ** 2) * p[i + 1][1] + (u ** 3 - u ** 2) * h[i] * t[i + 1];
    return clamp(y, 0, 1);
  };
}

// 256 steps per channel, RGBA; the master curve is applied first, then each colour's own.
export function curveTable(curves: Grade['curves']) {
  const [all, r, g, b] = CURVE_CHANNELS.map((k) => curveFn(curves[k]));
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = all(i / 255);
    out[i * 4] = Math.round(r(v) * 255);
    out[i * 4 + 1] = Math.round(g(v) * 255);
    out[i * 4 + 2] = Math.round(b(v) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// A wheel's dot pushes its tonal range toward that hue (without changing brightness); its slider adds brightness.
export function wheelOffset([x, y, light]: [number, number, number]): [number, number, number] {
  const strength = Math.min(1, Math.hypot(x, y)) * 0.25;
  const hue = Math.atan2(-y, x); // screen y points down; up on the wheel is 90°
  const rgb = [0, 2, 4].map((k) => 0.5 + 0.5 * Math.cos(hue - (k * Math.PI) / 3));
  const mean = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [0, 1, 2].map((i) => (rgb[i] - mean) * strength + (light / 100) * 0.25) as [number, number, number];
}

// ---- colour match: move one picture's colour statistics onto another's, in Lab (Reinhard et al. 2001) ----

type Vec3 = [number, number, number];
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const fi = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);

export function rgbToLab(r: number, g: number, b: number): Vec3 {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function labToRgb(L: number, a: number, b: number): Vec3 {
  const fy = (L + 16) / 116;
  const X = fi(fy + a / 500) * 0.95047;
  const Y = fi(fy);
  const Z = fi(fy - b / 200) * 1.08883;
  return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map((c) => clamp(gam(Math.max(0, c)), 0, 1)) as Vec3;
}

export interface ColourStats {
  mean: Vec3;
  std: Vec3;
}

// Mean and spread of a picture's colours, from RGBA pixels (sampled, so big frames stay quick).
export function statsOf(rgba: Uint8ClampedArray | Uint8Array): ColourStats {
  const n = rgba.length / 4;
  const step = Math.max(1, Math.floor(n / 20000));
  const sum: Vec3 = [0, 0, 0];
  const sq: Vec3 = [0, 0, 0];
  let k = 0;
  for (let i = 0; i < n; i += step) {
    if (rgba[i * 4 + 3] < 128) continue;
    const lab = rgbToLab(rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255);
    for (let c = 0; c < 3; c++) {
      sum[c] += lab[c];
      sq[c] += lab[c] ** 2;
    }
    k++;
  }
  k = Math.max(1, k);
  const mean = sum.map((s) => s / k) as Vec3;
  return { mean, std: sq.map((s, c) => Math.sqrt(Math.max(0, s / k - mean[c] ** 2))) as Vec3 };
}

export function mergeStats(list: ColourStats[]): ColourStats {
  const avg = (pick: (s: ColourStats) => Vec3) => [0, 1, 2].map((c) => list.reduce((a, s) => a + pick(s)[c], 0) / Math.max(1, list.length)) as Vec3;
  return { mean: avg((s) => s.mean), std: avg((s) => s.std) };
}

// The colour function that makes `from` look like `to`. Spreads are limited so a flat picture cannot explode.
export function matchLook(from: ColourStats, to: ColourStats) {
  const k = [0, 1, 2].map((c) => clamp(to.std[c] / Math.max(1e-3, from.std[c]), c === 0 ? 0.6 : 0.4, c === 0 ? 1.6 : 2.5));
  return (r: number, g: number, b: number): Vec3 => {
    const lab = rgbToLab(r, g, b);
    return labToRgb(...([0, 1, 2].map((c) => (lab[c] - from.mean[c]) * k[c] + to.mean[c]) as Vec3));
  };
}
