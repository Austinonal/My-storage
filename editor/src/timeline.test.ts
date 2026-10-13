import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaAsset, MediaClip } from './schema.ts';
import { SEC, assertValid, fitContain, newProject, outputSize, projectDuration, trimClip } from './timeline.ts';

const asset: MediaAsset = {
  id: 'a1',
  kind: 'video',
  name: 'clip.mp4',
  file: 'media/p1/a1',
  bytes: 1,
  duration: 10 * SEC,
  width: 1080,
  height: 1920,
  rotation: 0,
  hasAudio: true,
};
const make = () => newProject('p1', 'test', asset, '2026-01-01T00:00:00Z');
const clipOf = (p: ReturnType<typeof make>) => p.tracks[0].clips[0] as MediaClip;

test('new project is valid, portrait source picks 9:16', () => {
  const p = make();
  assertValid(p);
  assert.equal(p.aspect, '9:16');
  assert.equal(projectDuration(p), 10 * SEC);
});

test('trim in and out moves the source range', () => {
  const p = make();
  const c = clipOf(p);
  trimClip(p, c.id, 'in', 2 * SEC);
  trimClip(p, c.id, 'out', 7 * SEC);
  assert.equal(clipOf(p).sourceIn, 2 * SEC);
  assert.equal(clipOf(p).duration, 5 * SEC);
  assertValid(p);
});

test('trim clamps to the asset and to one frame', () => {
  const p = make();
  const c = clipOf(p);
  trimClip(p, c.id, 'out', 99 * SEC);
  assert.equal(clipOf(p).duration, 10 * SEC);
  trimClip(p, c.id, 'in', 99 * SEC);
  assert.ok(clipOf(p).duration >= Math.round(SEC / p.fps));
  assertValid(p);
  trimClip(p, c.id, 'in', -5);
  assert.equal(clipOf(p).sourceIn, 0);
});

test('trim drops keyframes that fall outside', () => {
  const p = make();
  const c = clipOf(p);
  c.keyframes = [
    { at: 1 * SEC, prop: 'scale', value: 1, easing: 'linear' },
    { at: 8 * SEC, prop: 'scale', value: 2, easing: 'linear' },
  ];
  trimClip(p, c.id, 'in', 2 * SEC);
  trimClip(p, c.id, 'out', 6 * SEC);
  assert.deepEqual(clipOf(p).keyframes, []);
});

test('assertValid catches a gap on the main track', () => {
  const p = make();
  clipOf(p).start = 5;
  assert.throws(() => assertValid(p), /gap or overlap/);
});

test('output size follows the aspect, short side = resolution', () => {
  assert.deepEqual(outputSize('9:16', 720), [720, 1280]);
  assert.deepEqual(outputSize('16:9', 1080), [1920, 1080]);
  assert.deepEqual(outputSize('1:1', 720), [720, 720]);
});

test('fitContain letterboxes a landscape clip in a portrait frame', () => {
  assert.deepEqual(fitContain(1920, 1080, 720, 1280), { x: 0, y: 438, w: 720, h: 405 });
});
