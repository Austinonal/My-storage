// Reads the structure of an edited video: where it cuts, and which of our In / Out / Combo presets each shot looks like.
// Pure maths on small frames, so it runs anywhere and is unit-tested; decoding lives in reference.ts.

export const AW = 64; // analysis width in pixels
const TW = 16; // thumbnail width for frame differences

export interface Frame {
  t: number; // seconds
  mean: number; // luma 0..1
  sharp: number; // Laplacian variance
  hist: Float32Array; // 16 bins per RGB channel, sums to 1
  thumb: Float32Array; // TW-wide luma
  col: Float32Array; // mean luma per column
  row: Float32Array; // mean luma per row
}

export interface Motion {
  s: number; // scale from one frame to the next, about the centre
  dx: number; // content shift, fraction of width
  dy: number;
}

export interface Guess {
  presetId: string;
  seconds: number;
}

export interface Slot {
  start: number; // seconds
  seconds: number;
  in: Guess | null;
  out: Guess | null;
  combo: Guess | null;
}

export function features(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, t: number): Frame {
  const n = w * h;
  const luma = new Float32Array(n);
  const hist = new Float32Array(48);
  const col = new Float32Array(w);
  const row = new Float32Array(h);
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const v = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      luma[i] = v;
      sum += v;
      col[x] += v / h;
      row[y] += v / w;
      hist[r >> 4]++;
      hist[16 + (g >> 4)]++;
      hist[32 + (b >> 4)]++;
    }
  }
  for (let k = 0; k < 48; k++) hist[k] /= n * 3;
  let lap = 0;
  let lap2 = 0;
  let m = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
      lap += l;
      lap2 += l * l;
      m++;
    }
  }
  const th = Math.max(1, Math.round((TW * h) / w));
  const thumb = new Float32Array(TW * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < TW; x++) thumb[y * TW + x] = luma[Math.floor(((y + 0.5) * h) / th) * w + Math.floor(((x + 0.5) * w) / TW)];
  }
  return { t, mean: sum / n, sharp: m ? lap2 / m - (lap / m) ** 2 : 0, hist, thumb, col, row };
}

const histDiff = (a: Frame, b: Frame) => a.hist.reduce((s, v, i) => s + Math.abs(v - b.hist[i]), 0);
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function flat(a: Float32Array) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo < 0.02;
}

// How different two pictures are in layout, ignoring overall brightness (so a fade is not a cut). 0 = same.
function change(a: Frame, b: Frame) {
  const fa = flat(a.thumb);
  const fb = flat(b.thumb);
  if (fa || fb) return fa && fb ? Math.abs(a.mean - b.mean) : 1;
  const na = normalise(a.thumb);
  const nb = normalise(b.thumb);
  let d = 0;
  for (let i = 0; i < na.length; i++) d += Math.abs(na[i] - nb[i]);
  return d / na.length / 2 + 0.25 * histDiff(a, b);
}

// Indexes of the first frame of every shot after the first.
export function detectCuts(f: Frame[], minShot = 0.15): number[] {
  const d = f.map((fr, i) => (i ? change(f[i - 1], fr) : 0));
  const same = (i: number, j: number) => i >= 0 && j >= 0 && i < f.length && j < f.length && change(f[i], f[j]) < 0.15;
  const cuts: number[] = [];
  let last = 0;
  for (let i = 1; i < f.length; i++) {
    const local = median(d.slice(Math.max(1, i - 15), i).concat(d.slice(i + 1, i + 16)));
    if (d[i] < 0.35 || d[i] < 4 * local + 0.05) continue;
    // A cut is sudden. A big change right after other big changes is motion (a slide, a fast zoom) settling.
    if (i >= 3 && d[i - 1] > 0.4 * d[i] && d[i - 2] > 0.4 * d[i]) continue;
    // A flash or glitch is a short burst: the picture before it comes back right after.
    if ([1, 2, 3].some((k) => same(i - 1, i + k)) || [2, 3, 4].some((k) => same(i - k, i))) continue;
    if (f[i].t - f[last].t < minShot) continue;
    cuts.push(i);
    last = i;
  }
  // Fade to black, then a new shot: cut in the middle of the black.
  for (let i = 1; i < f.length; i++) {
    if (f[i].mean >= 0.04 || f[i - 1].mean < 0.04) continue;
    let e = i;
    while (e + 1 < f.length && f[e + 1].mean < 0.04) e++;
    const mid = Math.ceil((i + e + 1) / 2);
    if (e + 1 < f.length && mid < f.length && cuts.every((c) => Math.abs(f[c].t - f[mid].t) >= minShot)) cuts.push(mid);
    i = e;
  }
  return cuts.sort((a, b) => a - b);
}

function normalise(a: Float32Array) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  s = Math.sqrt(s / a.length) || 1;
  return a.map((v) => (v - m) / s);
}

// Best (scale, shift) so that b(x) ~ a((x - c - shift) / scale + c), on a 1-D luma profile.
function match1d(pa: Float32Array, pb: Float32Array) {
  // A black or flat frame carries no position information: report "no motion" rather than a random best fit.
  if (flat(pa) || flat(pb)) return { s: 1, d: 0, cost: 0 };
  const a = normalise(pa);
  const b = normalise(pb);
  const n = a.length;
  const c = (n - 1) / 2;
  const cost = (s: number, d: number) => {
    let sum = 0;
    let k = 0;
    for (let x = 0; x < n; x++) {
      const q = (x - c - d) / s + c;
      const i = Math.floor(q);
      if (i < 0 || i >= n - 1) continue;
      const v = a[i] + (a[i + 1] - a[i]) * (q - i);
      sum += (b[x] - v) ** 2;
      k++;
    }
    return k < n * 0.6 ? Infinity : sum / k;
  };
  // Coarse over a wide range (fast slides jump far), then fine around the best guess.
  let best = { s: 1, d: 0, cost: Infinity };
  const consider = (s: number, d: number) => {
    const e = cost(s, d);
    if (e < best.cost) best = { s, d, cost: e };
  };
  for (let s = 0.9; s <= 1.1001; s += 0.02) for (let d = -16; d <= 16; d += 1) consider(s, d);
  const { s: s0, d: d0 } = best;
  for (let s = s0 - 0.02; s <= s0 + 0.0201; s += 0.005) for (let d = d0 - 1; d <= d0 + 1.001; d += 0.25) consider(s, d);
  return best;
}

export function estimateMotion(a: Frame, b: Frame): Motion {
  const x = match1d(a.col, b.col);
  const y = match1d(a.row, b.row);
  return { s: (x.s + y.s) / 2, dx: x.d / a.col.length, dy: y.d / a.row.length };
}

const size = (m: Motion) => Math.abs(m.dx) + Math.abs(m.dy) + Math.abs(m.s - 1);

// `base` is the shot's typical movement: footage that always moves (handheld, animated) needs more to count as an effect.
const moving = (m: Motion, base = 0) =>
  size(m) > 3 * base && (Math.abs(m.dx) > 0.004 || Math.abs(m.dy) > 0.004 || Math.abs(m.s - 1) > 0.008);

// Leading run of motion: stops at the first two still pairs in a row.
function activeRun(ms: Motion[], base: number) {
  let quiet = 0;
  for (let i = 0; i < ms.length; i++) {
    quiet = moving(ms[i], base) ? 0 : quiet + 1;
    if (quiet === 2) return i - 1;
  }
  return ms.length;
}

function describe(ms: Motion[]) {
  let s = 1;
  let dx = 0;
  let dy = 0;
  let flipsX = 0;
  let flipsY = 0;
  let ax = 0;
  let ay = 0;
  ms.forEach((m, i) => {
    s *= m.s;
    dx += m.dx;
    dy += m.dy;
    ax += Math.abs(m.dx);
    ay += Math.abs(m.dy);
    if (i && Math.sign(m.dx) !== Math.sign(ms[i - 1].dx) && Math.abs(m.dx) > 0.003) flipsX++;
    if (i && Math.sign(m.dy) !== Math.sign(ms[i - 1].dy) && Math.abs(m.dy) > 0.003) flipsY++;
  });
  const n = Math.max(1, ms.length);
  return { s, dx, dy, flipsX, flipsY, ax: ax / n, ay: ay / n };
}

// Motion seen at one end of a shot -> preset id, in the direction the content actually moved.
// The biggest distance covered in one direction without turning back (spring and slide moves have one; shakes do not).
function longestPush(ms: Motion[], axis: 'dx' | 'dy') {
  let best = 0;
  let run = 0;
  for (const m of ms) {
    const v = m[axis];
    run = Math.sign(v) === Math.sign(run) || run === 0 ? run + v : v;
    if (Math.abs(run) > Math.abs(best)) best = run;
  }
  return best;
}

function motionPreset(slot: 'in' | 'out', ms: Motion[]): string | null {
  const m = describe(ms);
  // A spring is one big push and then wobbles in the same axis.
  const push = longestPush(ms, 'dx');
  const swingBack = longestPush(ms.map((x) => ({ ...x, dx: Math.sign(x.dx) === Math.sign(push) ? 0 : x.dx })), 'dx');
  if (Math.abs(push) > 0.2 && Math.abs(swingBack) > 0.04) return `${slot}:${push < 0 ? 'elastic-left' : 'elastic-right'}`;
  const pushY = longestPush(ms, 'dy');
  const swingBackY = longestPush(ms.map((x) => ({ ...x, dy: Math.sign(x.dy) === Math.sign(pushY) ? 0 : x.dy })), 'dy');
  if (slot === 'in' && pushY < -0.2 && Math.abs(swingBackY) > 0.04) return 'in:elastic-up';
  if (m.flipsX >= 3 && m.ax > 0.006 && m.ax >= m.ay) return `${slot}:shake-h`;
  if (m.flipsY >= 3 && m.ay > 0.006) return `${slot}:shake-v`;
  if (Math.max(Math.abs(m.dx), Math.abs(m.dy)) > 0.2) {
    if (Math.abs(m.dx) >= Math.abs(m.dy)) return `${slot}:${m.dx < 0 ? 'slide-left' : 'slide-right'}`;
    return `${slot}:${m.dy < 0 ? 'slide-up' : 'slide-down'}`;
  }
  if (m.s > 1.12) return `${slot}:zoom-in`;
  if (m.s < 0.88) return `${slot}:zoom-out`;
  return null;
}

function guessEnd(slot: 'in' | 'out', f: Frame[], ms: Motion[], fps: number): Guess | null {
  // Look from the end of the shot that matters: reverse everything for Out.
  const fr = slot === 'in' ? f : [...f].reverse();
  const mo = slot === 'in' ? ms : [...ms].reverse();
  const medMean = median(f.map((x) => x.mean));
  const medSharp = median(f.map((x) => x.sharp));
  const limit = Math.max(2, Math.floor(f.length * 0.45));
  const until = (ok: (x: Frame) => boolean) => {
    let k = 0;
    while (k < limit && !ok(fr[k])) k++;
    return Math.max(1, k) / fps;
  };
  const window = mo.slice(0, limit);
  const run = activeRun(window, median(ms.map(size)));
  if (run >= 2) {
    // Out runs were collected backwards; put them back in time order so directions read forwards.
    const used = slot === 'in' ? window.slice(0, run) : window.slice(0, run).reverse();
    const id = motionPreset(slot, used);
    if (id) return { presetId: id, seconds: (run + 1) / fps };
  }
  const first = fr[0];
  if (first.mean > 0.75 && first.mean > medMean * 1.35) return { presetId: `${slot}:flash`, seconds: until((x) => x.mean < medMean * 1.1) };
  if (first.mean < medMean * 0.4) {
    return { presetId: first.mean < 0.05 ? `${slot}:${slot === 'in' ? 'from-black' : 'to-black'}` : `${slot}:fade`, seconds: until((x) => x.mean >= medMean * 0.9) };
  }
  if (medSharp > 0 && first.sharp < medSharp * 0.35) return { presetId: `${slot}:blur`, seconds: until((x) => x.sharp >= medSharp * 0.8) };
  return null;
}

function guessCombo(f: Frame[], ms: Motion[], fps: number, seconds: number): Guess | null {
  if (ms.length >= 4 && ms.filter((x) => moving(x)).length >= ms.length * 0.6) {
    const m = describe(ms);
    const amp = m.ax + m.ay;
    if (m.flipsX + m.flipsY >= ms.length / 4 && amp > 0.004) return { presetId: amp > 0.012 ? 'combo:earthquake' : 'combo:jitter', seconds };
    const scales = ms.map((x) => x.s);
    const peaks = scales.filter((s, i) => i > 0 && i < scales.length - 1 && s > 1.02 && s >= scales[i - 1] && s > scales[i + 1]).length;
    if (peaks >= 3) return { presetId: 'combo:beat-zoom', seconds };
  }
  // Slow zooms and pans move too little per frame to measure; compare frames about 0.2 s apart so it adds up.
  const k = Math.max(1, Math.round(fps * 0.2));
  const spaced: Motion[] = [];
  for (let i = 0; i + k < f.length; i += k) spaced.push(estimateMotion(f[i], f[i + k]));
  if (spaced.length < 3) return null;
  const share = (ok: (m: Motion) => boolean) => spaced.filter(ok).length / spaced.length;
  const s = spaced.reduce((acc, m) => acc * m.s, 1);
  const dx = spaced.reduce((acc, m) => acc + m.dx, 0);
  if (s > 1.08 && share((m) => m.s > 1.004) >= 0.7) return { presetId: 'combo:kb-in', seconds };
  if (s < 0.93 && share((m) => m.s < 0.996) >= 0.7) return { presetId: 'combo:kb-out', seconds };
  if (Math.abs(dx) > 0.08 && share((m) => Math.sign(m.dx) === Math.sign(dx) && Math.abs(m.dx) > 0.004) >= 0.7) {
    return { presetId: dx < 0 ? 'combo:kb-pan-left' : 'combo:kb-pan-right', seconds };
  }
  return null;
}

// `motions[i]` is the motion from frame i to i + 1 (pairs across a cut are ignored). `end` is the video's length.
export function buildTemplate(f: Frame[], motions: Motion[], end: number): Slot[] {
  if (f.length === 0) return [];
  const t0 = f[0].t;
  const bounds = [0, ...detectCuts(f), f.length];
  const slots: Slot[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const shot = f.slice(a, b);
    const ms = motions.slice(a, b - 1);
    const start = f[a].t - t0;
    const stop = b < f.length ? f[b].t - t0 : end - t0;
    const seconds = stop - start;
    const fps = shot.length > 1 ? (shot.length - 1) / Math.max(1e-6, shot[shot.length - 1].t - shot[0].t) : 30;
    const inG = shot.length >= 3 ? guessEnd('in', shot, ms, fps) : null;
    const outG = shot.length >= 3 ? guessEnd('out', shot, ms, fps) : null;
    const combo = inG || outG ? null : guessCombo(shot, ms, fps, seconds);
    const cap = (g: Guess | null, share: number) => g && { ...g, seconds: Math.min(g.seconds, seconds * share) };
    slots.push({ start, seconds, in: cap(inG, outG ? 0.5 : 0.9), out: cap(outG, inG ? 0.5 : 0.9), combo });
  }
  return slots;
}
