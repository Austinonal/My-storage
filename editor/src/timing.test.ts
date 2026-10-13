import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEED_PRESETS, curveProgress, fileSecondsAt, rateAt, sourceAt } from './timing.ts';

const SEC = 1_000_000;

test('constant speed and reverse', () => {
  const c = { sourceIn: 2 * SEC, speed: 2, duration: 3 * SEC };
  assert.equal(sourceAt(c, 0), 2 * SEC);
  assert.equal(sourceAt(c, 1.5 * SEC), 5 * SEC);
  assert.equal(sourceAt(c, 3 * SEC), 8 * SEC);
  const r = { ...c, reversed: true };
  assert.equal(sourceAt(r, 0), 8 * SEC, 'reversed starts at the out point');
  assert.equal(sourceAt(r, 3 * SEC), 2 * SEC);
  assert.equal(fileSecondsAt(r, 10 * SEC, 0), 2, 'reversed copy: 10 s file, original 8 s -> 2 s in');
});

test('curves keep the source range, move through it unevenly, and average to the clip speed', () => {
  for (const p of SPEED_PRESETS) {
    const f = curveProgress(p.curve);
    assert.equal(f(0), 0);
    assert.ok(Math.abs(f(1) - 1) < 1e-12, p.id);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = f(i / 100);
      assert.ok(v >= prev - 1e-12, `${p.id} monotone`);
      prev = v;
    }
    const c = { sourceIn: 0, speed: 1, duration: 10 * SEC, curve: p.curve };
    assert.equal(sourceAt(c, 10 * SEC), 10 * SEC);
    let mean = 0;
    for (let i = 0; i < 1000; i++) mean += rateAt(c, ((i + 0.5) / 1000) * 10 * SEC) / 1000;
    assert.ok(Math.abs(mean - 1) < 0.01, `${p.id} mean speed ${mean}`);
  }
  const hero = { sourceIn: 0, speed: 1, duration: 10 * SEC, curve: SPEED_PRESETS[1].curve };
  assert.ok(rateAt(hero, 5.5 * SEC) < rateAt(hero, 1 * SEC) / 3, 'hero slows down in the middle');
});
