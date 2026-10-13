import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasKeys, keyTimes, setEasing, setKeys, toggleKey, transformAt, valueAt } from './keyframes.ts';
import type { Keyframe, Transform } from './schema.ts';

const clip = () => ({ keyframes: [] as Keyframe[], transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } as Transform });
const SEC = 1_000_000;

test('no keyframes: edits change the clip, values are constant', () => {
  const c = clip();
  setKeys(c, 2 * SEC, { x: 0.2 }, 1000);
  assert.equal(c.transform.x, 0.2);
  assert.equal(hasKeys(c), false);
  assert.equal(transformAt(c, 5 * SEC).x, 0.2);
});

test('two keyframes interpolate with their easing; edits between them add a keyframe', () => {
  const c = clip();
  assert.equal(toggleKey(c, 0, 1000), true);
  setKeys(c, 2 * SEC, { x: 0.9, scale: 2 }, 1000); // makes a keyframe at 2 s
  assert.deepEqual(keyTimes(c), [0, 2 * SEC]);
  setEasing(c, 0, 'linear', 1000);
  assert.ok(Math.abs(valueAt(c, 'x', 1 * SEC) - 0.7) < 1e-9, 'linear halfway');
  setEasing(c, 0, 'easeIn', 1000);
  assert.ok(valueAt(c, 'x', 1 * SEC) < 0.6, 'ease in starts slow');
  assert.equal(transformAt(c, 9 * SEC).scale, 2, 'holds after the last keyframe');
  assert.equal(transformAt(c, 0).x, 0.5, 'holds before the first');
  setKeys(c, 1 * SEC, { y: 0.1 }, 1000);
  assert.deepEqual(keyTimes(c), [0, 1 * SEC, 2 * SEC]);
  assert.equal(valueAt(c, 'y', 1 * SEC), 0.1);
  assert.equal(toggleKey(c, 1 * SEC + 500, 1000), false, 'tapping near a keyframe removes it');
  assert.deepEqual(keyTimes(c), [0, 2 * SEC]);
});
