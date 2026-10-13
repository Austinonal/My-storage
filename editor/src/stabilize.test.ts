import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctionAt, flickerGainAt, levelsOf, shakeFrom, STAB_ZOOM } from './stabilize.ts';
import type { Frame, Motion } from './analyze.ts';

const frames = (n: number, mean = (i: number) => 0.5) => Array.from({ length: n }, (_, i) => ({ t: i / 30, mean: mean(i) }) as Frame);

test('stabilize: a jitter around a steady pan is cancelled, the pan is kept', () => {
  const n = 90;
  // content pans right 0.002 per frame and jitters +-0.01
  const pos = (i: number) => 0.002 * i + (i % 2 ? 0.01 : -0.01);
  const motions: Motion[] = Array.from({ length: n - 1 }, (_, i) => ({ s: 1, dx: pos(i + 1) - pos(i), dy: 0, r: i % 2 ? -1 : 1 }));
  const s = shakeFrom(frames(n), motions);
  for (const i of [30, 31, 60]) {
    const c = correctionAt(s, i / 30, 2);
    const fixed = s.x[i] + c.dx;
    assert.ok(Math.abs(fixed - (s.x[i] - pos(i) + 0.002 * i)) < 0.003, `frame ${i}: ${fixed}`);
    assert.ok(Math.abs(c.rot) <= 1.01);
  }
  const big = shakeFrom(frames(3), [{ s: 1, dx: 0.5, dy: 0, r: 0 }, { s: 1, dx: -0.5, dy: 0, r: 0 }]);
  assert.ok(Math.abs(correctionAt(big, 1 / 30, 1).dx) <= ((STAB_ZOOM[1] - 1) / 2) * 0.9 + 1e-9, 'never more than the zoom hides');
});

test('deflicker: a bright frame among steady ones is pulled back, steady footage is untouched', () => {
  const s = shakeFrom(frames(31, (i) => (i === 15 ? 0.7 : 0.5)), Array(30).fill({ s: 1, dx: 0, dy: 0, r: 0 }));
  assert.ok(flickerGainAt(s, 15 / 30) < 0.8);
  assert.ok(Math.abs(flickerGainAt(s, 2 / 30) - 1) < 0.05);
});

test('auto levels find the real black and white of a dull picture', () => {
  const data = new Uint8ClampedArray(1000 * 4);
  for (let i = 0; i < 1000; i++) data.set([60 + (i % 100), 70 + (i % 100), 80 + (i % 100), 255], i * 4);
  const { lo, hi } = levelsOf([{ data }]);
  assert.ok(Math.abs(lo[0] - 60 / 255) < 0.01 && Math.abs(hi[0] - 159 / 255) < 0.01, `${lo} ${hi}`);
});
