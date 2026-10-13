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
  background: string | null; // a label: letters on a filled box
  angle: number; // degrees, clockwise; w and h are along the text and across it
  text?: string; // what it says, when it could be read
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
// colours (letters, their outline, what is behind them) rather than a busy texture. A block's own long axis gives the
// slant of tilted text. `person` (1 per pixel) is skipped; the largest `limit` blocks are returned.
export function findText(rgba: ArrayLike<number>, w: number, h: number, person: ArrayLike<number> | null, limit = 8): TextSpot[] {
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
    let [x0, y0, x1, y1] = [cw, ch, -1, -1];
    const cells: [number, number][] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % cw;
      const y = (i - x) / cw;
      cells.push([x, y]);
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      for (const j of [x > 0 ? i - 1 : -1, x < cw - 1 ? i + 1 : -1, y > 0 ? i - cw : -1, y < ch - 1 ? i + cw : -1]) {
        if (j >= 0 && texty[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const n = cells.length;
    const box = along(cells);
    const [bw, bh] = [box.len, box.across];
    if (n < 6 || bw < 3 || bh < 2 || n / (bw * bh) < 0.35 || (x1 - x0 + 1) * (y1 - y0 + 1) > 0.3 * cw * ch || bw < bh * 0.8) continue;
    const spot = colours(rgba, L, w, h, x0 * cell, y0 * cell, (x1 + 1) * cell, (y1 + 1) * cell, cell);
    // Length along the text over the frame's width, thickness across it over the frame's height.
    if (spot) out.push({ ...spot, angle: box.angle, cx: ((box.cx + 0.5) * cell) / w, cy: ((box.cy + 0.5) * cell) / h, w: (bw * cell) / w, h: (bh * cell) / h, area: n });
  }
  return out
    .sort((a, b) => b.area - a.area)
    .slice(0, limit)
    .map(({ area: _, ...t }) => t);
}

// A block of cells measured along its long axis: the slant (only when clearly tilted and clearly longer than tall,
// otherwise level), its middle, and its length and thickness in cells.
export function along(cells: [number, number][]) {
  const n = cells.length;
  const mx = cells.reduce((s, c) => s + c[0], 0) / n;
  const my = cells.reduce((s, c) => s + c[1], 0) / n;
  let [xx, yy, xy] = [0, 0, 0];
  for (const [x, y] of cells) [xx, yy, xy] = [xx + (x - mx) ** 2, yy + (y - my) ** 2, xy + (x - mx) * (y - my)];
  const tilt = 0.5 * Math.atan2(2 * xy, xx - yy);
  const spread = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  const long = (xx + yy + spread) / 2;
  const short = (xx + yy - spread) / 2;
  const deg = (tilt * 180) / Math.PI;
  const extent = (a: number) => {
    const us = cells.map(([x, y]) => (x - mx) * Math.cos(a) + (y - my) * Math.sin(a));
    const vs = cells.map(([x, y]) => -(x - mx) * Math.sin(a) + (y - my) * Math.cos(a));
    return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  };
  const area = ([u0, u1, v0, v1]: number[]) => (u1 - u0 + 1) * (v1 - v0 + 1);
  // Tilted only when a slanted box fits the block clearly better than a level one (a level word touching a slanted
  // edge, like a collar, does not count).
  const slanted = Math.abs(deg) >= 4 && Math.abs(deg) <= 45 && long > 4 * Math.max(short, 0.25) && area(extent((Math.round(deg) * Math.PI) / 180)) * 1.15 < area(extent(0));
  const angle = slanted ? Math.round(deg) : 0;
  const a = (angle * Math.PI) / 180;
  const [u0, u1, v0, v1] = extent(a);
  const [cu, cv] = [(u0 + u1) / 2, (v0 + v1) / 2];
  return { angle, cx: mx + cu * Math.cos(a) - cv * Math.sin(a), cy: my + cu * Math.sin(a) + cv * Math.cos(a), len: Math.round(u1 - u0) + 1, across: Math.round(v1 - v0) + 1 };
}

// The letters' colour and their outline (a clearly darker or lighter part that is the one touching the surroundings), or
// for a label the box colour; null when the block is a busy texture.
function colours(rgba: ArrayLike<number>, L: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, pad: number) {
  const hist = new Float32Array(16);
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, total++) hist[Math.min(15, L[y * w + x] >> 4)]++;
  const peaks = [...hist].sort((a, b) => b - a);
  if ((peaks[0] + peaks[1] + peaks[2]) / total < 0.6) return null;
  // What is around the block: the most common colour in a ring just outside it (a mean would blend a label's edge in).
  const counts = new Map<number, number[]>();
  for (let y = Math.max(0, y0 - pad); y < Math.min(h, y1 + pad); y++) {
    for (let x = Math.max(0, x0 - pad); x < Math.min(w, x1 + pad); x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const i = (y * w + x) * 4;
      const key = ((rgba[i] >> 5) << 6) | ((rgba[i + 1] >> 5) << 3) | (rgba[i + 2] >> 5);
      const c = counts.get(key) ?? [0, 0, 0, 0];
      counts.set(key, [c[0] + rgba[i], c[1] + rgba[i + 1], c[2] + rgba[i + 2], c[3] + 1]);
    }
  }
  const top = [...counts.values()].sort((a, b) => b[3] - a[3])[0] ?? [0, 0, 0, 1];
  const bg = [top[0] / top[3], top[1] / top[3], top[2] / top[3]];
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
  const apart = Math.abs(lumaOf(...(mean(dark) as [number, number, number])) - lumaOf(...(mean(light) as [number, number, number]))) > 70;
  // A label: one colour fills most of the block (outlined letters never cover more than about 40 % of theirs).
  const [most, fewer] = dark.length >= light.length ? [dark, light] : [light, dark];
  if (apart && most.length >= (x1 - x0) * (y1 - y0) * 0.55 && fewer.length >= ink.length * 0.05) return { fill: hex(mean(fewer)), stroke: null, background: hex(mean(most)) };
  const [outer, inner] = outside(dark) >= outside(light) ? [dark, light] : [light, dark];
  const outlined = apart && Math.min(dark.length, light.length) >= ink.length * 0.15;
  return { fill: hex(outlined ? mean(inner) : mean(ink)), stroke: outlined ? hex(mean(outer)) : null, background: null };
}
