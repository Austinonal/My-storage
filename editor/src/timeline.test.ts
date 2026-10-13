import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaAsset, MediaClip } from './schema.ts';
import { SEC, addAudio, addMedia, applyTemplate, assertValid, deleteClip, findClip, fitContain, moveClip, newProject, outputSize, projectDuration, replaceClip, setAnim, setPhotoDuration, splitAt, trimClip, type TemplateSlot } from './timeline.ts';

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

const photo: MediaAsset = { id: 'ph', kind: 'photo', name: 'p.jpg', file: 'media/p1/ph', bytes: 1, duration: 0, width: 1080, height: 1080, rotation: 0, hasAudio: false };
const song: MediaAsset = { id: 'au', kind: 'audio', name: 'song.mp3', file: 'media/p1/au', bytes: 1, duration: 3 * SEC, width: 0, height: 0, rotation: 0, hasAudio: true };

test('add video and photo to the main track, photos last 3 s', () => {
  const p = make();
  const [id] = addMedia(p, [photo]);
  assert.equal(p.tracks[0].clips.length, 2);
  assert.equal((findClip(p, id) as MediaClip).kind, 'photo');
  assert.equal(projectDuration(p), 13 * SEC);
  addMedia(p, [{ ...asset, id: 'a2' }], 0);
  assert.equal(p.tracks[0].clips[0].assetId, 'a2');
  assertValid(p);
});

test('audio goes on its own track; overlapping audio opens a new track', () => {
  const p = make();
  addAudio(p, song, 1 * SEC);
  const b = addAudio(p, song, 2 * SEC);
  assert.equal(p.tracks.filter((t) => t.kind === 'audio').length, 2);
  assert.equal(findClip(p, b).start, 2 * SEC);
  assert.equal(projectDuration(p), 10 * SEC, 'audio does not lengthen the video');
  assertValid(p);
});

test('move audio in time and reorder main clips', () => {
  const p = make();
  const a = addAudio(p, song, 0);
  moveClip(p, a, { start: 4.5 * SEC });
  assert.equal(findClip(p, a).start, 4.5 * SEC);
  moveClip(p, a, { start: -3 });
  assert.equal(findClip(p, a).start, 0);
  const [ph] = addMedia(p, [photo]);
  moveClip(p, ph, { index: 0 });
  assert.equal(p.tracks[0].clips[0].id, ph);
  assert.equal(p.tracks[0].clips[1].start, 3 * SEC);
  assertValid(p);
});

test('delete keeps the last main clip and drops empty audio tracks', () => {
  const p = make();
  deleteClip(p, clipOf(p).id);
  assert.equal(p.tracks[0].clips.length, 1);
  const a = addAudio(p, song, 0);
  deleteClip(p, a);
  assert.equal(p.tracks.length, 1);
  assertValid(p);
});

test('split a video: halves line up in source and keep in/out on the outer ends', () => {
  const p = make();
  const c = clipOf(p);
  c.animIn = { presetId: 'in:fade', duration: SEC / 2 };
  c.animOut = { presetId: 'out:fade', duration: SEC / 2 };
  const r = splitAt(p, c.id, 4 * SEC)!;
  const [left, right] = p.tracks[0].clips as MediaClip[];
  assert.equal(left.duration, 4 * SEC);
  assert.equal(right.id, r);
  assert.equal(right.sourceIn, 4 * SEC);
  assert.equal(right.start, 4 * SEC);
  assert.ok(left.animIn && !left.animOut && !right.animIn && right.animOut);
  assert.equal(splitAt(p, left.id, 10), null, 'too close to the edge');
  assertValid(p);
});

test('photo duration clamps and squeezes its animations', () => {
  const p = make();
  const [ph] = addMedia(p, [photo]);
  setAnim(p, ph, 'combo', 'combo:wine', 3 * SEC);
  setPhotoDuration(p, ph, 1 * SEC);
  const c = findClip(p, ph) as MediaClip;
  assert.equal(c.duration, 1 * SEC);
  assert.equal(c.animCombo?.duration, 1 * SEC);
  setPhotoDuration(p, ph, 999 * SEC);
  assert.equal(c.duration, 120 * SEC);
  assert.throws(() => trimClip(p, ph, 'out', SEC));
  assertValid(p);
});

const hole: MediaAsset = { ...photo, id: 'hole', name: 'empty.png', placeholder: true };
const slot = (seconds: number, extra: Partial<TemplateSlot> = {}): TemplateSlot => ({ seconds, in: null, out: null, combo: null, ...extra });

test('template: own clips fill the first slots, the rest are placeholders with the template animations', () => {
  const p = make();
  addMedia(p, [photo]);
  applyTemplate(p, [
    slot(0.8, { in: { presetId: 'in:fade', seconds: 0.3 } }),
    slot(1.2, { combo: { presetId: 'combo:kb-in', seconds: 1.2 } }),
    slot(0.5, { out: { presetId: 'out:slide-left', seconds: 2 } }),
  ], hole);
  const [a, b, c] = p.tracks[0].clips as MediaClip[];
  assert.equal(a.assetId, 'a1');
  assert.equal(a.duration, 0.8 * SEC);
  assert.equal(a.animIn?.presetId, 'in:fade');
  assert.equal(b.assetId, 'ph');
  assert.equal(b.animCombo?.duration, 1.2 * SEC);
  assert.equal(c.assetId, 'hole');
  assert.equal(c.animOut?.duration, 0.5 * SEC, 'an animation longer than its slot is squeezed');
  assert.equal(projectDuration(p), 2.5 * SEC);
  assertValid(p);
  // Applying again reuses the same own clips and drops old placeholders.
  applyTemplate(p, [slot(1), slot(1)], hole);
  assert.deepEqual(p.tracks[0].clips.map((x) => x.assetId), ['a1', 'ph']);
  assertValid(p);
});

test('template: a video shorter than its slot ends early; replacing keeps place and animations', () => {
  const p = make();
  applyTemplate(p, [slot(30), slot(2, { in: { presetId: 'in:pop', seconds: 0.5 } })], hole);
  const [v, h] = p.tracks[0].clips as MediaClip[];
  assert.equal(v.duration, 10 * SEC);
  replaceClip(p, h.id, photo);
  const r = p.tracks[0].clips[1] as MediaClip;
  assert.equal(r.kind, 'photo');
  assert.equal(r.duration, 2 * SEC);
  assert.equal(r.animIn?.presetId, 'in:pop');
  replaceClip(p, r.id, { ...asset, id: 'short', duration: 1 * SEC });
  assert.equal((p.tracks[0].clips[1] as MediaClip).duration, 1 * SEC);
  assertValid(p);
});
