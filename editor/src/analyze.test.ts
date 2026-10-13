import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AW, buildTemplate, detectCuts, estimateMotion, features, type Frame } from './analyze.ts';
import { getPreset } from './anim.ts';

const W = AW;
const H = 114;
const FPS = 30;

type Look = { seed: number; s?: number; dx?: number; dy?: number; bright?: number; flat?: number };

// A textured picture, transformed like our compositor does: content moved by dx/dy (canvas fractions), scaled by s, black outside.
function frame(look: Look, t: number): Frame {
  const { seed, s = 1, dx = 0, dy = 0, bright = 1 } = look;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x - cx - dx * W) / s + cx;
      const v = (y - cy - dy * H) / s + cy;
      let val = 0;
      if (look.flat !== undefined) val = look.flat;
      else if (u >= 0 && u < W && v >= 0 && v < H) {
        val = 0.5 + 0.12 * Math.sin(u * 0.23 + seed) + 0.1 * Math.sin(u * 0.071 + 2 * seed) + 0.12 * Math.cos(v * 0.17 + seed) + 0.1 * Math.cos(v * 0.053 + 3 * seed);
      }
      const i = (y * W + x) * 4;
      const c = Math.max(0, Math.min(255, val * bright * 255));
      rgba[i] = c * (0.6 + 0.4 * ((seed * 37) % 7) / 7);
      rgba[i + 1] = c;
      rgba[i + 2] = c * (1 - 0.4 * ((seed * 13) % 5) / 5);
      rgba[i + 3] = 255;
    }
  }
  return features(rgba, W, H, t);
}

function clip(looks: Look[], t0 = 0) {
  return looks.map((l, i) => frame(l, t0 + i / FPS));
}

test('motion: a shift and a zoom are measured', () => {
  const a = frame({ seed: 1 }, 0);
  const m = estimateMotion(a, frame({ seed: 1, dx: 0.04 }, 1 / FPS));
  assert.ok(Math.abs(m.dx - 0.04) < 0.01, `dx ${m.dx}`);
  assert.ok(Math.abs(m.s - 1) < 0.015, `s ${m.s}`);
  const z = estimateMotion(a, frame({ seed: 1, s: 1.05 }, 1 / FPS));
  assert.ok(Math.abs(z.s - 1.05) < 0.015, `s ${z.s}`);
  assert.deepEqual(estimateMotion(frame({ seed: 1, flat: 0 }, 0), a), { s: 1, dx: 0, dy: 0 }, 'black frame gives no motion');
});

test('cuts: hard cut found, a flash is not a cut, a black gap is', () => {
  const f = clip([...Array(12).fill({ seed: 1 }), ...Array(12).fill({ seed: 5, bright: 0.7 })]);
  assert.deepEqual(detectCuts(f), [12]);
  const flash = clip([...Array(10).fill({ seed: 1 }), { seed: 1, flat: 1 }, ...Array(10).fill({ seed: 1 })]);
  assert.deepEqual(detectCuts(flash), []);
  const gap = clip([...Array(10).fill({ seed: 1 }), ...Array(4).fill({ seed: 1, flat: 0 }), ...Array(10).fill({ seed: 4 })]);
  const cuts = detectCuts(gap);
  assert.ok(cuts.some((c) => c >= 10 && c <= 14), `cuts ${cuts}`);
});

test('template: four shots read back as fade in, slide from the right, zoom-in exit, slow zoom', () => {
  const ease = (p: number) => 1 - (1 - p) ** 3;
  const looks: Look[] = [
    ...Array.from({ length: 24 }, (_, i) => ({ seed: 1, bright: Math.min(1, i / 8) })),
    ...Array.from({ length: 24 }, (_, i) => ({ seed: 7, bright: 0.8, dx: i < 10 ? 1 - ease(i / 10) : 0 })),
    ...Array.from({ length: 24 }, (_, i) => ({ seed: 3, bright: 0.9, s: i < 14 ? 1 : 1 + 0.5 * ((i - 13) / 10) ** 2 })),
    ...Array.from({ length: 24 }, (_, i) => ({ seed: 11, bright: 0.75, s: 1 + 0.2 * (i / 23) })),
  ];
  const f = clip(looks);
  const motions = f.slice(1).map((b, i) => estimateMotion(f[i], b));
  const slots = buildTemplate(f, motions, looks.length / FPS);
  const summary = slots.map((s) => [s.start.toFixed(2), s.in?.presetId, s.out?.presetId, s.combo?.presetId]);
  assert.equal(slots.length, 4, JSON.stringify(summary));
  assert.ok(['in:fade', 'in:from-black'].includes(slots[0].in?.presetId ?? ''), JSON.stringify(summary));
  assert.equal(slots[1].in?.presetId, 'in:slide-left', JSON.stringify(summary));
  assert.equal(slots[2].out?.presetId, 'out:zoom-in', JSON.stringify(summary));
  assert.equal(slots[3].combo?.presetId, 'combo:kb-in', JSON.stringify(summary));
  assert.ok(Math.abs(slots[1].start - 24 / FPS) < 1e-6);
  for (const s of slots) {
    for (const g of [s.in, s.out, s.combo]) if (g) assert.ok(getPreset(g.presetId), `unknown preset ${g.presetId}`);
    assert.ok((s.in?.seconds ?? 0) + (s.out?.seconds ?? 0) <= s.seconds + 1e-9);
  }
});

test('a spring from the left reads as the spring preset, not a shake', () => {
  const elastic = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
  const looks: Look[] = [
    ...Array.from({ length: 20 }, () => ({ seed: 2, bright: 0.8 })),
    ...Array.from({ length: 40 }, (_, i) => ({ seed: 9, dx: i < 30 ? -0.6 * (1 - elastic(i / 30)) : 0 })),
  ];
  const f = clip(looks);
  const slots = buildTemplate(f, f.slice(1).map((b, i) => estimateMotion(f[i], b)), looks.length / FPS);
  assert.equal(slots.length, 2);
  assert.equal(slots[1].in?.presetId, 'in:elastic-right', JSON.stringify(slots.map((s) => s.in?.presetId)));
});
