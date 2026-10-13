// Beats in music and speech in talking clips, from how loud the sound is every 10 ms. Pure, so it is unit-tested;
// thumbs.ts decodes the file.

export const HOP = 0.01; // about how many seconds per analysis step (a whole number of samples)

const hopOf = (rate: number) => Math.max(1, Math.round(rate * HOP));

// How much louder each step got than the one before (log scale, rising only), for the whole sound plus its bass,
// so both drums and plucked or sung notes count.
export function onsetStrength(samples: Float32Array, rate: number): Float32Array {
  const hop = hopOf(rate);
  const n = Math.floor(samples.length / hop);
  const out = new Float32Array(n);
  const a = 1 - Math.exp((-2 * Math.PI * 150) / rate); // one-pole low-pass at 150 Hz
  let lp = 0;
  let prevAll = 0;
  let prevLow = 0;
  for (let i = 0; i < n; i++) {
    let all = 0;
    let low = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) {
      const x = samples[k];
      lp += a * (x - lp);
      all += x * x;
      low += lp * lp;
    }
    const la = Math.log1p((1000 * all) / hop);
    const ll = Math.log1p((1000 * low) / hop);
    if (i) out[i] = Math.max(0, la - prevAll) + Math.max(0, ll - prevLow);
    prevAll = la;
    prevLow = ll;
  }
  return out;
}

// Beat times in seconds: the tempo from the onsets' autocorrelation (70-180 BPM, leaning towards 120 so a song is not
// read at double or half speed), then beat to beat, each one nudged onto the strongest onset near where it is due.
export function findBeats(samples: Float32Array, rate: number): { beats: number[]; bpm: number } {
  const o = onsetStrength(samples, rate);
  const n = o.length;
  const step = hopOf(rate) / rate;
  const minLag = Math.round(60 / 180 / step);
  const maxLag = Math.round(60 / 70 / step);
  if (n < maxLag * 4) return { beats: [], bpm: 0 };
  let mean = 0;
  for (const v of o) mean += v / n;
  const ac = (lag: number) => {
    let s = 0;
    for (let i = lag; i < n; i++) s += (o[i] - mean) * (o[i - lag] - mean);
    return s / (n - lag);
  };
  let best = 0;
  let bestScore = -Infinity;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * step);
    const s = ac(lag) * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    scores[lag] = s;
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  if (!(bestScore > 0)) return { beats: [], bpm: 0 };
  // Fractional period from the neighbours, so long songs do not drift.
  const [l, m, r] = [scores[best - 1] ?? bestScore, bestScore, scores[best + 1] ?? bestScore];
  const den = l - 2 * m + r;
  const p = best + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0);
  // Phase: the offset whose grid collects the most onset.
  let phase = 0;
  let phaseScore = -1;
  for (let ph = 0; ph < p; ph++) {
    let s = 0;
    for (let x = ph; x < n; x += p) s += o[Math.round(x)] ?? 0;
    if (s > phaseScore) {
      phaseScore = s;
      phase = ph;
    }
  }
  const reach = Math.max(2, Math.round(p * 0.1));
  const snapNear = (x: number) => {
    let at = Math.round(x);
    let v = -1;
    for (let i = Math.max(0, Math.round(x) - reach); i <= Math.min(n - 1, Math.round(x) + reach); i++) {
      const w = o[i] * Math.exp(-0.5 * ((i - x) / reach) ** 2);
      if (w > v) {
        v = w;
        at = i;
      }
    }
    return v > 0 ? at : x;
  };
  const beats: number[] = [];
  let x = snapNear(phase);
  while (x < n) {
    beats.push(Math.round(x * step * 1000) / 1000);
    x = snapNear(x + p);
  }
  return { beats, bpm: Math.round((60 / (p * step)) * 10) / 10 };
}

// Where someone is talking, as [from, to] seconds: steps louder than a threshold between the noise floor and the speech
// level; quiet stretches shorter than `minGap` stay, and `pad` is kept around each part so words are not clipped.
export function speechRanges(samples: Float32Array, rate: number, minGap = 0.35, pad = 0.1): [number, number][] {
  const hop = hopOf(rate);
  const step = hop / rate;
  const n = Math.floor(samples.length / hop);
  const total = samples.length / rate;
  if (!n) return [[0, total]];
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) s += samples[k] * samples[k];
    db[i] = 10 * Math.log10(1e-10 + s / hop);
  }
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.1)];
  const loud = sorted[Math.floor(n * 0.95)];
  if (loud - floor < 10) return [[0, total]]; // no clear difference between talking and pauses: leave it alone
  const threshold = floor + Math.max(6, (loud - floor) * 0.3);
  const parts: [number, number][] = [];
  let i = 0;
  while (i < n) {
    if (db[i] < threshold) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && db[j] >= threshold) j++;
    const from = i * step;
    const to = j * step;
    const last = parts.at(-1);
    if (last && from - last[1] < minGap) last[1] = to;
    else parts.push([from, to]);
    i = j;
  }
  if (!parts.length) return [[0, total]];
  const out: [number, number][] = [];
  for (const [a, b] of parts) {
    const from = Math.max(0, a - pad);
    const to = Math.min(total, b + pad);
    const last = out.at(-1);
    if (last && from <= last[1]) last[1] = to;
    else out.push([from, to]);
  }
  return out.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}
