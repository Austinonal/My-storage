import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveFn, curveTable, labToRgb, matchLook, neutralGrade, rgbToLab, statsOf, wheelOffset, gradeUsed } from './grade.ts';

test('curves: straight line is identity, points are hit, no overshoot between them', () => {
  const id = curveFn([[0, 0], [1, 1]]);
  for (const x of [0, 0.25, 0.5, 1]) assert.ok(Math.abs(id(x) - x) < 1e-9);
  const s = curveFn([[0, 0], [0.25, 0.15], [0.75, 0.9], [1, 1]]);
  assert.ok(Math.abs(s(0.25) - 0.15) < 1e-9 && Math.abs(s(0.75) - 0.9) < 1e-9);
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const v = s(i / 100);
    assert.ok(v >= prev - 1e-9 && v >= 0 && v <= 1, `monotone at ${i}`);
    prev = v;
  }
  const t = curveTable(neutralGrade().curves);
  for (let i = 0; i < 256; i += 51) assert.deepEqual([...t.slice(i * 4, i * 4 + 3)], [i, i, i]);
  const red = curveTable({ ...neutralGrade().curves, r: [[0, 0], [0.5, 0.75], [1, 1]] });
  assert.ok(red[128 * 4] > 180 && red[128 * 4 + 1] === 128, 'only the red channel lifts');
});

test('wheels: centre does nothing, a dot tints without changing brightness', () => {
  assert.deepEqual(wheelOffset([0, 0, 0]), [0, 0, 0]);
  const warm = wheelOffset([1, 0, 0]); // right of the wheel = red
  assert.ok(warm[0] > 0 && warm[2] < 0, JSON.stringify(warm));
  assert.ok(Math.abs(0.2126 * warm[0] + 0.7152 * warm[1] + 0.0722 * warm[2]) < 1e-9);
  assert.ok(wheelOffset([0, 0, 100]).every((v) => v > 0.2));
  assert.equal(gradeUsed(neutralGrade()), false);
});

test('colour match: Lab round trip, and a picture takes on the reference look', () => {
  for (const c of [[0.2, 0.5, 0.8], [1, 1, 1], [0.9, 0.3, 0.1]] as [number, number, number][]) {
    const back = labToRgb(...rgbToLab(...c));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - c[i]) < 2e-3, `${c} -> ${back}`);
  }
  const pixels = (fn: (i: number) => [number, number, number]) => {
    const a = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 400; i++) a.set([...fn(i), 255], i * 4);
    return a;
  };
  const cool = pixels((i) => [40 + (i % 40), 80 + (i % 40), 160 + (i % 60)]);
  const warm = pixels((i) => [180 + (i % 50), 120 + (i % 30), 60 + (i % 20)]);
  const look = matchLook(statsOf(cool), statsOf(warm));
  const out = pixels((i) => look(...([40 + (i % 40), 80 + (i % 40), 160 + (i % 60)].map((v) => v / 255) as [number, number, number])).map((v) => Math.round(v * 255)) as [number, number, number]);
  const after = statsOf(out);
  const target = statsOf(warm);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(after.mean[c] - target.mean[c]) < 4, `channel ${c}: ${after.mean[c]} vs ${target.mean[c]}`);
});
