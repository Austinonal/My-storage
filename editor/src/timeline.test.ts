import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AudioClip, MediaAsset, MediaClip, TextClip } from './schema.ts';
import { SEC, addAudio, addMedia, applyTemplate, assertValid, deleteClip, findClip, fitContain, moveClip, newProject, outputSize, projectDuration, replaceClip, setAdjust, setAnim, setFilter, snap, snapPoints, trimEdge, addOverlay, setTransform, addCaptions, setSpeed, setCurve, setCrop, insertFreeze, setTransition, setTransformAt, toggleKeyframe, setFades, extractAudio, setReversed, setPhotoDuration, setTextTiming, splitAt, trimClip, updateText, addText, addEffect, setEffect, syncToBeats, keepParts, setReframe, setFollow, newThumbnail, applyLayout, setAspect, coverMain, moveLayer, type TemplateSlot } from './timeline.ts';
import { transformAt } from './keyframes.ts';

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

test('text: added on its own track at the playhead, overlap opens a new track, edits and timing', () => {
  const p = make();
  const a = addText(p, 1 * SEC, 'สวัสดี');
  const b = addText(p, 2 * SEC);
  assert.equal(p.tracks.filter((t) => t.kind === 'text').length, 2);
  updateText(p, a, { text: 'ซับไตเติ้ล', style: { colour: '#ff0000ff' }, transform: { y: 0.1, scale: 99 } });
  const c = findClip(p, a) as TextClip;
  assert.equal(c.text, 'ซับไตเติ้ล');
  assert.equal(c.style.colour, '#ff0000ff');
  assert.equal(c.style.fontId, 'kanit', 'other style fields kept');
  assert.equal(c.transform.scale, 8, 'scale clamps');
  setTextTiming(p, b, 6 * SEC, 1.5 * SEC);
  assert.equal(findClip(p, b).start, 6 * SEC);
  assert.equal(findClip(p, b).duration, 1.5 * SEC);
  assertValid(p);
});

test('text: loop replaces in/out and split keeps in on the left, out on the right', () => {
  const p = make();
  const id = addText(p, 0);
  setAnim(p, id, 'in', 'in:t-typewriter', 1 * SEC);
  setAnim(p, id, 'combo', 'combo:t-wave', 1.5 * SEC);
  const c = findClip(p, id) as TextClip;
  assert.equal(c.animIn, null);
  assert.equal(c.animLoop?.presetId, 'combo:t-wave');
  setAnim(p, id, 'in', 'in:t-pop', 0.5 * SEC);
  setAnim(p, id, 'out', 'out:t-fade', 0.5 * SEC);
  assert.equal((findClip(p, id) as TextClip).animLoop, null);
  const r = splitAt(p, id, 1.5 * SEC)!;
  const [left, right] = [findClip(p, id) as TextClip, findClip(p, r) as TextClip];
  assert.ok(left.animIn && !left.animOut && !right.animIn && right.animOut);
  assert.equal(right.text, left.text);
  assertValid(p);
});

test('colour: filter intensity and adjust sliders clamp; text and audio refuse colour', () => {
  const p = make();
  const id = p.tracks[0].clips[0].id;
  setFilter(p, id, 'film', 3);
  setAdjust(p, id, { brightness: 250, contrast: -40.4, temperature: -999 });
  const c = findClip(p, id) as MediaClip;
  assert.deepEqual(c.filter, { presetId: 'film', intensity: 1 });
  assert.equal(c.adjust.brightness, 100);
  assert.equal(c.adjust.contrast, -40);
  assert.equal(c.adjust.temperature, -100);
  assert.equal(c.adjust.saturation, 0, 'other sliders untouched');
  assertValid(p);
  setFilter(p, id, null);
  assert.equal(c.filter, null);
  assert.equal((findClip(p, id) as MediaClip).filter, null);
  assert.throws(() => setFilter(p, addText(p, 0), 'film'));
});

test('edge trims: video keeps its place on the main track, audio and text keep the rest in time, photos change length', () => {
  const p = make();
  const v = p.tracks[0].clips[0] as MediaClip;
  trimEdge(p, structuredClone(v), 'in', 1 * SEC);
  assert.equal(findClip(p, v.id).start, 0, 'main track closes the gap');
  assert.equal((findClip(p, v.id) as MediaClip).sourceIn, 1 * SEC);

  const a = addAudio(p, song, 2 * SEC);
  const before = structuredClone(findClip(p, a));
  trimEdge(p, before, 'in', 0.5 * SEC);
  const after = findClip(p, a) as AudioClip;
  assert.equal(after.start, 2.5 * SEC, 'audio start follows its left edge');
  assert.equal(after.sourceIn, 0.5 * SEC);
  assert.equal(after.start + after.duration, before.start + before.duration, 'right end stays put');
  trimEdge(p, structuredClone(after), 'in', -9 * SEC);
  assert.equal(findClip(p, a).start, 2 * SEC, 'cannot pull audio before its own first sample');

  const t = addText(p, 1 * SEC);
  trimEdge(p, structuredClone(findClip(p, t)), 'in', -5 * SEC);
  assert.equal(findClip(p, t).start, 0, 'text cannot start before 0');
  assert.equal(findClip(p, t).duration, 4 * SEC);
  assertValid(p);

  const ph = addMedia(p, [photo], 1)[0];
  trimEdge(p, structuredClone(findClip(p, ph)), 'out', 2 * SEC);
  assert.equal(findClip(p, ph).duration, 5 * SEC);
  assertValid(p);
});

test('snapping picks the nearest point within reach', () => {
  const p = make();
  const pts = snapPoints(p, 1.234 * SEC, 'nothing');
  assert.equal(snap(1.2 * SEC, pts, 0.1 * SEC), 1.234 * SEC);
  assert.equal(snap(2 * SEC, pts, 0.1 * SEC), null);
  assert.ok(pts.includes(projectDuration(p)));
});

test('overlays: own track under the text, free in time, never overlapping, transform clamps', () => {
  const p = make();
  const total = projectDuration(p);
  addText(p, 0);
  const a = addOverlay(p, photo, 1 * SEC);
  const b = addOverlay(p, photo, 2 * SEC); // overlaps a (3 s photo) -> second overlay track
  const kinds = p.tracks.map((t) => t.kind);
  assert.deepEqual(kinds, ['main', 'overlay', 'overlay', 'text'], 'overlays above main, below text');
  assert.equal(projectDuration(p), total, 'overlays do not change the length');
  assert.equal((findClip(p, a) as MediaClip).transform.scale, 0.5);
  setTransform(p, a, { x: 9, scale: 99, opacity: -1 });
  const t = (findClip(p, a) as MediaClip).transform;
  assert.deepEqual([t.x, t.scale, t.opacity], [1.5, 8, 0]);
  moveClip(p, a, { start: 2 * SEC }); // a and b on separate tracks; a stays on its own
  setPhotoDuration(p, b, 1 * SEC);
  moveClip(p, b, { start: 6 * SEC });
  moveClip(p, b, { start: 0 }); // b's own track is free there
  const lanes = () => p.tracks.filter((x) => x.kind === 'overlay').map((x) => x.clips.map((c) => c.id));
  assert.deepEqual(lanes(), [[a], [b]]);
  setPhotoDuration(p, b, 2 * SEC);
  moveClip(p, b, { start: 4 * SEC });
  setPhotoDuration(p, a, 3 * SEC); // a: 2-5 s and b: 4-6 s are on different tracks, nothing to do
  assertValid(p);
  moveClip(p, a, { start: 10 * SEC });
  setPhotoDuration(p, b, 9 * SEC); // b now runs into a's old time only; still valid
  assertValid(p);
  const right = splitAt(p, a, 11 * SEC);
  assert.ok(right && findClip(p, right).start === 11 * SEC);
  assertValid(p);
});

test('captions: many at once, styled like an existing one, overlaps go to another text track', () => {
  const p = make();
  const first = addText(p, 0, 'แรก');
  updateText(p, first, { style: { colour: '#ffd84dff' }, transform: { y: 0.1 } });
  const ids = addCaptions(p, [{ start: 0.5 * SEC, duration: SEC, text: 'ก' }, { start: 3 * SEC, duration: SEC, text: 'ข' }], findClip(p, first) as TextClip);
  const a = findClip(p, ids[0]) as TextClip;
  assert.equal(a.style.colour, '#ffd84dff');
  assert.equal(a.transform.y, 0.1);
  assert.equal(p.tracks.filter((t) => t.kind === 'text').length, 2, 'the first caption overlaps the existing text');
  assertValid(p);
});

test('speed keeps the recording range, scales keyframes; curves keep the length', () => {
  const p = make();
  const v = p.tracks[0].clips[0] as MediaClip;
  const span = v.duration * v.speed;
  toggleKeyframe(p, v.id, v.duration);
  setSpeed(p, v.id, 2);
  const c = findClip(p, v.id) as MediaClip;
  assert.equal(c.duration, span / 2);
  assert.equal(c.keyframes[0].at, c.duration, 'keyframe moved with the clip end');
  setSpeed(p, v.id, 1000);
  assert.equal((findClip(p, v.id) as MediaClip).speed, 100);
  setSpeed(p, v.id, 1);
  const before = findClip(p, v.id).duration;
  setCurve(p, v.id, [[0.2, 3], [0.9, 0.2]]);
  assert.deepEqual((findClip(p, v.id) as MediaClip).curve, [[0, 3], [1, 0.2]], 'ends pinned to 0 and 1');
  assert.equal(findClip(p, v.id).duration, before);
  assert.throws(() => setReversed(p, v.id, true), /not made yet/);
  assertValid(p);
});

test('transitions: between neighbours only, shortened or dropped when clips change', () => {
  const p = make();
  addMedia(p, [photo]);
  const [a, b] = p.tracks[0].clips;
  setTransition(p, a.id, 'dissolve', 99 * SEC);
  assert.equal(p.transitions.length, 1);
  assert.equal(p.transitions[0].duration, Math.floor(Math.min(a.duration, b.duration) / 2), 'clamped to half the shorter clip');
  setPhotoDuration(p, b.id, 1 * SEC);
  assert.equal(p.transitions[0].duration, 0.5 * SEC, 'follows the shorter clip');
  assertValid(p);
  moveClip(p, b.id, { index: 0 });
  assert.equal(p.transitions.length, 0, 'not neighbours in that order any more');
  assert.throws(() => setTransition(p, p.tracks[0].clips[1].id, 'dissolve', SEC), /next clip/);
});

test('keyframed transform edits, crop clamps, freeze inserts a still, fades and extracted sound', () => {
  const p = make();
  const v = p.tracks[0].clips[0] as MediaClip;
  setTransformAt(p, v.id, SEC, { scale: 2 }); // no keyframes yet: the clip itself
  assert.equal((findClip(p, v.id) as MediaClip).transform.scale, 2);
  toggleKeyframe(p, v.id, 0);
  setTransformAt(p, v.id, 2 * SEC, { x: 0.1 });
  assert.equal(new Set((findClip(p, v.id) as MediaClip).keyframes.map((k) => k.at)).size, 2);
  setCrop(p, v.id, { x: 0.9, y: -1, w: 0.5, h: 2, rotate: 450, mirror: true });
  assert.deepEqual((findClip(p, v.id) as MediaClip).crop, { x: 0.5, y: 0, w: 0.5, h: 1, rotate: 90, mirror: true });
  const still: MediaAsset = { ...photo, id: 'still' };
  const f = insertFreeze(p, v.id, 1 * SEC, still);
  const kinds = p.tracks[0].clips.map((c) => c.kind);
  assert.deepEqual(kinds, ['video', 'photo', 'video']);
  assert.equal(findClip(p, f).start, 1 * SEC);
  assert.equal((findClip(p, f) as MediaClip).crop.rotate, 90, 'the still keeps the look');
  setFades(p, v.id, 9 * SEC, 0.2 * SEC);
  assert.equal((findClip(p, v.id) as MediaClip).fadeIn, Math.floor(findClip(p, v.id).duration / 2));
  const a = extractAudio(p, v.id);
  assert.equal((findClip(p, v.id) as MediaClip).volume, 0);
  assert.equal(findClip(p, a).start, findClip(p, v.id).start);
  assertValid(p);
});

test('effects: own track on top, free in time, split and trimmed like text, no position or volume', () => {
  const p = make();
  const id = addEffect(p, 2 * SEC, 'vhs');
  const track = p.tracks.at(-1)!;
  assert.equal(track.kind, 'effect');
  assert.equal(findClip(p, id).start, 2 * SEC);
  const right = splitAt(p, id, 3 * SEC)!;
  assert.equal(findClip(p, right).start, 3 * SEC);
  setEffect(p, right, 'glitch');
  assert.equal((findClip(p, right) as { effect: string }).effect, 'glitch');
  trimEdge(p, findClip(p, id), 'in', -SEC);
  assert.equal(findClip(p, id).start, SEC);
  assert.throws(() => setTransformAt(p, id, 0, { x: 0.2 }));
  assertValid(p);
});

test('beat sync: cuts land on beats, every n-th beat, short videos keep what they have', () => {
  const p = make();
  const photo: MediaAsset = { ...asset, id: 'ph', kind: 'photo', duration: 0 };
  const short: MediaAsset = { ...asset, id: 's1', duration: 0.6 * SEC };
  addMedia(p, [photo, short, photo]);
  const beats = Array.from({ length: 40 }, (_, i) => Math.round((0.2 + i * 0.5) * SEC));
  syncToBeats(p, beats, 2);
  const ends = p.tracks[0].clips.map((c) => c.start + c.duration);
  assert.equal(ends[0], 0.7 * SEC); // the video ends on the 2nd beat
  assert.equal(ends[1], 1.7 * SEC); // the photo on the 4th
  assert.equal(ends[2], 2.3 * SEC); // the 0.6 s video cannot reach 2.7 s
  assert.equal(ends[3], 2.7 * SEC); // and the next clip is back on the beat
  assertValid(p);
});

test('keep parts: silent stretches of a main video are cut out and the rest moves up', () => {
  const p = make();
  addMedia(p, [{ ...asset, id: 'a2' }]);
  const removed = keepParts(p, clipOf(p).id, [[0, 2 * SEC], [5 * SEC, 7 * SEC]]);
  assert.equal(removed, 2);
  const main = p.tracks[0].clips as MediaClip[];
  assert.deepEqual(main.map((c) => [c.sourceIn / SEC, c.duration / SEC]), [[0, 2], [5, 2], [0, 10]]);
  assertValid(p);
});

test('reframe: a landscape clip in a portrait frame fills it and slides to keep the person centred', () => {
  const p = make();
  const [id] = addMedia(p, [{ ...asset, id: 'wide', width: 1920, height: 1080 }]);
  setReframe(p, id, [{ at: 0, fx: 0.5 }, { at: SEC, fx: 0.7 }, { at: 2 * SEC, fx: 0.99 }]);
  const c = findClip(p, id) as MediaClip;
  const bw = (16 / 9) / (9 / 16); // the picture is 3.16 frames wide once it fills the height
  assert.ok(Math.abs(transformAt(c, 0).scale - bw) < 0.01);
  assert.ok(Math.abs(transformAt(c, 0).x - 0.5) < 1e-6);
  assert.ok(Math.abs(transformAt(c, SEC).x - (0.5 - 0.2 * bw)) < 0.01); // the person at 0.7 lands in the middle
  assert.ok(Math.abs(transformAt(c, 2 * SEC).x - (0.5 - (bw - 1) / 2)) < 0.01); // near the edge: stops where the picture ends
  assertValid(p);
});

test('follow: a text keeps its offset from what it tracks and keeps its other keyframes', () => {
  const p = make();
  const id = addText(p, 0, 'hi');
  setFollow(p, id, [{ at: 0, dx: 0, dy: 0 }, { at: SEC, dx: 0.1, dy: -0.05 }, { at: 2 * SEC, dx: 0.2, dy: 0 }]);
  const c = findClip(p, id) as TextClip;
  assert.ok(Math.abs(transformAt(c, SEC).x - 0.6) < 1e-6 && Math.abs(transformAt(c, SEC).y - 0.77) < 1e-6);
  assert.ok(Math.abs(transformAt(c, 1.5 * SEC).x - 0.65) < 1e-6);
  assertValid(p);
});

test('thumbnail: 16:9 with the background filling it; a reference adds a cut-out person slot and styled text', () => {
  const portrait: MediaAsset = { ...asset, id: 'bg', kind: 'photo', duration: 0, width: 1080, height: 1920 };
  const p = newThumbnail('t1', 'cover', portrait, '2026-01-01T00:00:00Z');
  assert.equal(p.aspect, '16:9');
  assert.ok(p.still);
  assert.ok(Math.abs(clipOf(p).transform.scale - (16 / 9) / (9 / 16)) < 0.01); // a portrait photo zooms to cover the wide frame
  const ref: MediaAsset = { ...portrait, id: 'ref', width: 1280, height: 720 };
  const slot: MediaAsset = { ...portrait, id: 'slot', width: 900, height: 1200, placeholder: true };
  applyLayout(p, { aspect: '1:1', person: { cx: 0.7, cy: 0.6, w: 0.3, h: 0.72 }, texts: [{ cx: 0.3, cy: 0.2, w: 0.5, h: 0.1, fill: '#ffdd22', stroke: '#000000', background: null, angle: 0 }, { cx: 0.3, cy: 0.8, w: 0.4, h: 0.2, fill: '#ffffff', stroke: null, background: '#ff4f8b', angle: -8, text: 'ห้าม\nพลาด' }] }, ref, slot);
  assert.equal(p.aspect, '1:1');
  assert.equal(p.still?.reference, 'ref');
  assert.ok(Math.abs(clipOf(p).transform.scale - 16 / 9) < 0.01); // covers the new square frame
  const person = p.tracks.find((t) => t.kind === 'overlay')!.clips[0] as MediaClip;
  assert.deepEqual([person.transform.x, person.transform.y, Math.round(person.transform.scale * 100), person.cutout], [0.7, 0.6, 80, { bg: 'clear' }]);
  const text = p.tracks.find((t) => t.kind === 'text')!.clips[0] as TextClip;
  assert.deepEqual([text.transform.x, text.transform.y, text.style.colour, text.style.stroke?.colour, text.style.size, text.text], [0.3, 0.2, '#ffdd22ff', '#000000ff', 119, 'ใส่ข้อความ']);
  const read = p.tracks.filter((t) => t.kind === 'text')[1].clips[0] as TextClip;
  assert.deepEqual([read.text, read.transform.rotation, read.style.size, read.style.stroke, read.style.background], ['ห้าม\nพลาด', -8, 65, null, { colour: '#ff4f8bff', radius: 8 }]); // two lines share a label's height
  setAspect(p, '16:9');
  coverMain(p);
  assertValid(p);
});

test('layers: a text moves below a picture and back; the background and the ends stay put', () => {
  const p = newThumbnail('t2', 'cover', { ...asset, id: 'bg', kind: 'photo', duration: 0 }, '2026-01-01T00:00:00Z');
  const pic = addOverlay(p, { ...asset, id: 'pic', kind: 'photo', duration: 0 }, 0);
  const text = addText(p, 0, 'hi');
  const order = () => p.tracks.map((t) => t.kind);
  assert.deepEqual(order(), ['main', 'overlay', 'text']);
  assert.equal(moveLayer(p, text, 1), false); // already on top
  assert.equal(moveLayer(p, text, -1), true);
  assert.deepEqual(order(), ['main', 'text', 'overlay']);
  assert.equal(moveLayer(p, text, -1), false); // never under the background
  assert.equal(moveLayer(p, pic, -1), true);
  assert.deepEqual(order(), ['main', 'overlay', 'text']);
  assertValid(p);
});
