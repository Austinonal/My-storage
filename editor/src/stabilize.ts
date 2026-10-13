// Video quality maths: steadying a shaky clip and evening out flicker, from a per-frame motion and brightness record.
// Pure, so it is unit-tested; quality.ts decodes the clip and records it.
import type { Frame, Motion } from './analyze.ts';

export interface Shake {
  t: number[]; // source seconds of each analysed frame
  x: number[]; // where the picture's content has drifted to, cumulative, frame-width fractions
  y: number[];
  r: number[]; // cumulative turn, degrees
  luma: number[]; // mean brightness 0..1
}

export const STAB_ZOOM = [1, 1.06, 1.12] as const; // off, light, strong: a little zoom hides the edges the correction moves in
const WINDOW = [0, 0.4, 1] as const; // seconds either side the camera path is averaged over

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function shakeFrom(frames: Frame[], motions: Motion[]): Shake {
  const s: Shake = { t: [], x: [], y: [], r: [], luma: [] };
  let x = 0;
  let y = 0;
  let r = 0;
  frames.forEach((f, i) => {
    if (i) {
      const m = motions[i - 1];
      x += m.dx;
      y += m.dy;
      r += m.r;
    }
    s.t.push(r4(f.t));
    s.x.push(r4(x));
    s.y.push(r4(y));
    s.r.push(r4(r));
    s.luma.push(r4(f.mean));
  });
  return s;
}

function nearest(t: number[], sec: number) {
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(t[lo - 1] - sec) < Math.abs(t[lo] - sec) ? lo - 1 : lo;
}

function average(a: number[], t: number[], i: number, half: number) {
  let sum = 0;
  let n = 0;
  for (let k = i; k >= 0 && t[i] - t[k] <= half; k--, n++) sum += a[k];
  for (let k = i + 1; k < a.length && t[k] - t[i] <= half; k++, n++) sum += a[k];
  return sum / Math.max(1, n);
}

// How far to move and turn the picture at `sec` so it follows the smoothed camera path instead of the shaky one.
// Limited to what the zoom can hide, so no black edge shows.
export function correctionAt(s: Shake, sec: number, level: 1 | 2) {
  if (!s.t.length) return { dx: 0, dy: 0, rot: 0 };
  const i = nearest(s.t, sec);
  const half = WINDOW[level];
  const room = ((STAB_ZOOM[level] - 1) / 2) * 0.9;
  const clamp = (v: number) => Math.max(-room, Math.min(room, v));
  return {
    dx: clamp(average(s.x, s.t, i, half) - s.x[i]),
    dy: clamp(average(s.y, s.t, i, half) - s.y[i]),
    rot: Math.max(-4, Math.min(4, average(s.r, s.t, i, half) - s.r[i])),
  };
}

// Brightness gain that brings a flickering frame back to the local average.
export function flickerGainAt(s: Shake, sec: number) {
  if (!s.t.length) return 1;
  const i = nearest(s.t, sec);
  const want = average(s.luma, s.t, i, 0.25);
  return s.luma[i] > 0.02 ? Math.max(0.7, Math.min(1.4, want / s.luma[i])) : 1;
}

// Auto levels: per channel, the values below which 0.5 % and above which 0.5 % of the pixels fall.
export function levelsOf(images: { data: Uint8ClampedArray | Uint8Array }[]) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (const img of images) {
    for (let i = 0; i < img.data.length; i += 4) {
      hist[0][img.data[i]]++;
      hist[1][img.data[i + 1]]++;
      hist[2][img.data[i + 2]]++;
      n++;
    }
  }
  const cut = n * 0.005;
  const at = (h: Uint32Array, fromTop: boolean) => {
    let acc = 0;
    for (let k = 0; k < 256; k++) {
      const v = fromTop ? 255 - k : k;
      acc += h[v];
      if (acc > cut) return v / 255;
    }
    return fromTop ? 1 : 0;
  };
  const lo = hist.map((h) => at(h, false)) as [number, number, number];
  const hi = hist.map((h, c) => Math.max(lo[c] + 0.2, at(h, true))) as [number, number, number];
  return { lo, hi };
}
