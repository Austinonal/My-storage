// Reading a thumbnail: where its person and its big text sit, and the text's colours. Pure, so it is unit-tested;
// thumbnail.ts decodes the picture and finds the person with the cutout model.
import type { Aspect } from './schema';

export interface Box {
  cx: number; // centre and size, frame fractions
  cy: number;
  w: number;
  h: number;
}
export interface TextSpot extends Box {
  fill: string; // #rrggbb
  stroke: string | null;
}
export interface Layout {
  aspect: Aspect;
  person: Box | null;
  texts: TextSpot[];
}

const RATIOS: [Aspect, number][] = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['4:5', 4 / 5], ['2:1', 2]];
export const nearestAspect = (w: number, h: number): Aspect =>
  RATIOS.reduce((best, r) => (Math.abs(Math.log(w / h / r[1])) < Math.abs(Math.log(w / h / best[1])) ? r : best))[0];

// The box around the person (alpha 0..255 per pixel), or null when nobody is there.
export function personBox(alpha: ArrayLike<number>, w: number, h: number): Box | null {
  let [x0, y0, x1, y1, n] = [w, h, -1, -1, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < 128) continue;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (n < w * h * 0.03) return null;
  return { cx: (x0 + x1 + 1) / 2 / w, cy: (y0 + y1 + 1) / 2 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// Big text: small cells crowded with sharp edges, joined into blocks, kept when the block is mostly two or three flat
// colours (letters, their outline, what is behind them) rather than a busy texture. `person` (1 per pixel) is skipped.
export function findText(rgba: ArrayLike<number>, w: number, h: number, person: ArrayLike<number> | null): TextSpot[] {
  const L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = lumaOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  const cell = Math.max(3, Math.round(Math.min(w, h) / 45));
  const cw = Math.floor(w / cell);
  const ch = Math.floor(h / cell);
  const texty = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let edges = 0;
      let people = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          if (person?.[y * w + x]) people++;
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
          const i = y * w + x;
          if (Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]) > 60) edges++;
        }
      }
      texty[cy * cw + cx] = people < cell * cell * 0.2 && edges > cell * cell * 0.2 ? 1 : 0;
    }
  }
  // Letters leave narrow gaps between them.
  for (let cy = 0; cy < ch; cy++) for (let cx = 1; cx < cw - 1; cx++) if (!texty[cy * cw + cx] && texty[cy * cw + cx - 1] && texty[cy * cw + cx + 1]) texty[cy * cw + cx] = 2;
  const seen = new Uint8Array(cw * ch);
  const out: (TextSpot & { area: number })[] = [];
  for (let start = 0; start < texty.length; start++) {
    if (!texty[start] || seen[start]) continue;
    let [x0, y0, x1, y1, n] = [cw, ch, -1, -1, 0];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % cw;
      const y = (i - x) / cw;
      n++;
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      for (const j of [x > 0 ? i - 1 : -1, x < cw - 1 ? i + 1 : -1, y > 0 ? i - cw : -1, y < ch - 1 ? i + cw : -1]) {
        if (j >= 0 && texty[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (n < 6 || bw < 3 || bh < 2 || n / (bw * bh) < 0.35 || bw * bh > 0.3 * cw * ch || bw < bh * 0.8) continue;
    const spot = colours(rgba, L, w, h, x0 * cell, y0 * cell, (x1 + 1) * cell, (y1 + 1) * cell, cell);
    if (spot) out.push({ ...spot, cx: ((x0 + x1 + 1) / 2) * cell / w, cy: ((y0 + y1 + 1) / 2) * cell / h, w: (bw * cell) / w, h: (bh * cell) / h, area: bw * bh });
  }
  return out
    .sort((a, b) => b.area - a.area)
    .slice(0, 4)
    .map(({ area: _, ...t }) => t);
}

// The letters' colour and their outline (a clearly darker or lighter part that is the one touching the surroundings),
// or null when the block is a busy texture rather than a few flat colours.
function colours(rgba: ArrayLike<number>, L: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, pad: number) {
  const hist = new Float32Array(16);
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, total++) hist[Math.min(15, L[y * w + x] >> 4)]++;
  const peaks = [...hist].sort((a, b) => b - a);
  if ((peaks[0] + peaks[1] + peaks[2]) / total < 0.6) return null;
  // What is around the block, from a ring just outside it.
  const bg = [0, 0, 0];
  let nb = 0;
  for (let y = Math.max(0, y0 - pad); y < Math.min(h, y1 + pad); y++) {
    for (let x = Math.max(0, x0 - pad); x < Math.min(w, x1 + pad); x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const i = (y * w + x) * 4;
      bg[0] += rgba[i];
      bg[1] += rgba[i + 1];
      bg[2] += rgba[i + 2];
      nb++;
    }
  }
  bg.forEach((_, k) => (bg[k] /= Math.max(1, nb)));
  const ink: number[] = [];
  const isInk = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2]) > 90) {
        ink.push(i);
        isInk[i / 4] = 1;
      }
    }
  }
  // Share of a group's pixels next to the surroundings: high for an outline, low for the letters inside it.
  const outside = (ids: number[]) =>
    ids.filter((i) => {
      const k = i / 4;
      const x = k % w;
      return (x > 0 && !isInk[k - 1]) || (x < w - 1 && !isInk[k + 1]) || (k >= w && !isInk[k - w]) || (k + w < w * h && !isInk[k + w]);
    }).length / Math.max(1, ids.length);
  if (ink.length < 20) return null;
  // Two groups by brightness (Otsu's split).
  const lum = ink.map((i) => lumaOf(rgba[i], rgba[i + 1], rgba[i + 2]));
  let split = 128;
  let best = -1;
  for (let t = 16; t < 240; t += 8) {
    const a = lum.filter((v) => v < t);
    const b = lum.filter((v) => v >= t);
    if (!a.length || !b.length) continue;
    const ma = a.reduce((s, v) => s + v, 0) / a.length;
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    const between = a.length * b.length * (ma - mb) ** 2;
    if (between > best) [best, split] = [between, t];
  }
  const mean = (ids: number[]) => [0, 1, 2].map((k) => ids.reduce((s, i) => s + rgba[i + k], 0) / Math.max(1, ids.length));
  const dark = ink.filter((_, k) => lum[k] < split);
  const light = ink.filter((_, k) => lum[k] >= split);
  const [line, letters] = outside(dark) >= outside(light) ? [dark, light] : [light, dark];
  const outlined = Math.min(dark.length, light.length) >= ink.length * 0.15 && Math.abs(lumaOf(...(mean(dark) as [number, number, number])) - lumaOf(...(mean(light) as [number, number, number]))) > 70;
  return { fill: hex(outlined ? mean(letters) : mean(ink)), stroke: outlined ? hex(mean(line)) : null };
}
