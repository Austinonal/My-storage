import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPatch } from './track.ts';

// A textured background with a bright square at (sx, sy); `light` brightens the whole picture.
function frame(w: number, h: number, sx: number, sy: number, light = 0) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 60 + 30 * Math.sin(x * 0.7) * Math.cos(y * 0.5) + light;
  for (let y = sy - 6; y <= sy + 6; y++) for (let x = sx - 6; x <= sx + 6; x++) g[y * w + x] = 220 - ((x - sx) ** 2 + (y - sy) ** 2) + light;
  return g;
}

test('track: a moving square is followed step by step, even when the light changes', () => {
  const w = 120;
  const h = 90;
  let at = { x: 30, y: 40 };
  const path = [[30, 40], [36, 43], [44, 45], [52, 44], [61, 40]];
  for (let i = 1; i < path.length; i++) {
    at = matchPatch(frame(w, h, path[i - 1][0], path[i - 1][1], i * 5), frame(w, h, path[i][0], path[i][1], i * 5 + 5), w, h, at.x, at.y, 8, 12);
    assert.deepEqual([at.x, at.y], path[i]);
  }
});

test('track: a still picture stays put and edges are respected', () => {
  const f = frame(120, 90, 10, 10);
  assert.deepEqual(matchPatch(f, f, 120, 90, 10, 10, 8, 12), { x: 10, y: 10 });
  const r = matchPatch(f, f, 120, 90, 2, 2, 8, 12); // too close to the edge for a full square: measured from inside
  assert.deepEqual(r, { x: 2, y: 2 });
});
