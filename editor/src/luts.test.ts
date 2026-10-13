import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CubeError, FILTERS, bakeLut, parseCube } from './luts.ts';

const identityCube = (n: number) => {
  const rows = [`TITLE "Test look"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  return rows.join('\n');
};

test('parses a 3D .cube in red-fastest order', () => {
  const lut = parseCube(identityCube(3));
  assert.equal(lut.size, 3);
  assert.equal(lut.title, 'Test look');
  // entry (r=2, g=0, b=1) sits at index r + g*n + b*n*n
  const i = (2 + 0 * 3 + 1 * 9) * 4;
  assert.deepEqual([...lut.data.slice(i, i + 4)], [255, 0, 128, 255]);
});

test('rejects broken .cube files', () => {
  assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0'), CubeError);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1'), CubeError);
  assert.throws(() => parseCube('hello'), CubeError);
});

test('every built-in filter bakes, stays in range and changes the picture', () => {
  assert.ok(FILTERS.length >= 20);
  assert.equal(new Set(FILTERS.map((f) => f.id)).size, FILTERS.length);
  const identity = bakeLut((r, g, b) => [r, g, b], 9);
  for (const f of FILTERS) {
    const lut = bakeLut(f.look, 9);
    let diff = 0;
    for (let i = 0; i < lut.data.length; i++) diff += Math.abs(lut.data[i] - identity.data[i]);
    assert.ok(diff / lut.data.length > 2, `${f.id} looks like no filter`);
  }
});
