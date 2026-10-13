import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, REST, TEXT_PRESETS, poseAt, poseOf, type Pose, type Preset } from './anim.ts';
import type { MediaAsset, MediaClip } from './schema.ts';
import { SEC, assertValid, newProject, setAnim, trimClip } from './timeline.ts';

const NUMERIC = ['x', 'y', 'scale', 'sx', 'sy', 'rot', 'skew', 'alpha', 'blur', 'gray', 'bright', 'invert', 'hue', 'sat', 'sepia', 'contrast', 'flash', 'pixel'] as const;

// Pivot only matters while rotated/scaled, so it is not compared.
function assertRest(pose: Pose, label: string) {
  for (const k of NUMERIC) assert.ok(Math.abs(pose[k] - REST[k]) < 1e-6, `${label}: ${k} = ${pose[k]}`);
  assert.equal(pose.reveal, null, `${label}: reveal`);
  assert.equal(pose.copies, null, `${label}: copies`);
  assert.equal(pose.strips, null, `${label}: strips`);
}

const all: Preset[] = Object.values(PRESETS).flat();

test('catalogue sizes and unique ids', () => {
  assert.ok(PRESETS.in.length >= 50, `in: ${PRESETS.in.length}`);
  assert.ok(PRESETS.out.length >= 50, `out: ${PRESETS.out.length}`);
  assert.ok(PRESETS.combo.length >= 50, `combo: ${PRESETS.combo.length}`);
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
});

test('every preset is finite everywhere', () => {
  for (const preset of all) {
    for (let i = 0; i <= 40; i++) {
      const pose = poseOf(preset, i / 40);
      for (const k of NUMERIC) assert.ok(Number.isFinite(pose[k]), `${preset.id} at ${i / 40}: ${k} = ${pose[k]}`);
      for (const c of pose.copies ?? []) for (const v of Object.values(c)) if (typeof v === 'number') assert.ok(Number.isFinite(v), preset.id);
      for (const s of pose.strips ?? []) assert.ok(Number.isFinite(s), preset.id);
    }
  }
});

test('in presets end at rest, out presets start at rest', () => {
  for (const preset of PRESETS.in) assertRest(poseOf(preset, 1), preset.id);
  for (const preset of PRESETS.out) assertRest(poseOf(preset, 0), preset.id);
});

const asset: MediaAsset = { id: 'a', kind: 'video', name: 'a.mp4', file: 'media/p/a', bytes: 1, duration: 4 * SEC, width: 720, height: 1280, rotation: 0, hasAudio: false };
const make = () => newProject('p', 't', asset, '2026-01-01T00:00:00Z');
const clipOf = (p: ReturnType<typeof make>) => p.tracks[0].clips[0] as MediaClip;

test('combo replaces in/out and the reverse', () => {
  const p = make();
  const id = clipOf(p).id;
  setAnim(p, id, 'in', 'in:fade', 0.5 * SEC);
  setAnim(p, id, 'out', 'out:fade', 0.5 * SEC);
  setAnim(p, id, 'combo', 'combo:wine', 4 * SEC);
  assert.equal(clipOf(p).animIn, null);
  assert.equal(clipOf(p).animOut, null);
  setAnim(p, id, 'in', 'in:pop', 0.5 * SEC);
  assert.equal(clipOf(p).animCombo, null);
  assertValid(p);
});

test('a new in shrinks an out that no longer fits, durations clamp to the clip', () => {
  const p = make();
  const id = clipOf(p).id;
  setAnim(p, id, 'out', 'out:fade', 3 * SEC);
  setAnim(p, id, 'in', 'in:fade', 2 * SEC);
  assert.equal(clipOf(p).animOut?.duration, 2 * SEC);
  setAnim(p, id, 'combo', 'combo:wine', 99 * SEC);
  assert.equal(clipOf(p).animCombo?.duration, 4 * SEC);
  assertValid(p);
});

test('trimming squeezes animations to fit', () => {
  const p = make();
  const id = clipOf(p).id;
  setAnim(p, id, 'in', 'in:fade', 1.5 * SEC);
  setAnim(p, id, 'out', 'out:fade', 1.5 * SEC);
  trimClip(p, id, 'out', 2 * SEC);
  const c = clipOf(p);
  assert.ok(c.animIn!.duration + c.animOut!.duration <= c.duration);
  assertValid(p);
});

test('poseAt picks in at the start, out at the end, rest in between', () => {
  const p = make();
  const id = clipOf(p).id;
  setAnim(p, id, 'in', 'in:fade', 1 * SEC);
  setAnim(p, id, 'out', 'out:fade', 1 * SEC);
  const c = clipOf(p);
  assert.equal(poseAt(c, 0).alpha, 0);
  assert.equal(poseAt(c, 2 * SEC).alpha, 1);
  assert.ok(Math.abs(poseAt(c, 4 * SEC).alpha) < 1e-6);
  c.animIn = { presetId: 'in:removed-preset', duration: SEC };
  assert.equal(poseAt(c, 0).alpha, 1, 'unknown preset renders as rest');
});

test('text letter presets: In ends with every letter at rest, Out starts there, loops stay finite', () => {
  const rest = { x: 0, y: 0, scale: 1, sx: 1, sy: 1, rot: 0, alpha: 1, hue: 0 };
  const check = (preset: Preset, p: number) => {
    for (let i = 0; i < 7; i++) {
      const g = { ...rest, ...preset.glyph!(p, i, 7) };
      for (const [k, v] of Object.entries(rest)) assert.ok(Math.abs(g[k as keyof typeof g] - v) < 1e-6, `${preset.id} letter ${i} ${k}=${g[k as keyof typeof g]}`);
    }
  };
  const glyphOnly = (list: Preset[]) => list.filter((x) => x.glyph);
  assert.ok(glyphOnly(TEXT_PRESETS.in).length >= 12 && glyphOnly(TEXT_PRESETS.combo).length >= 8);
  for (const preset of glyphOnly(TEXT_PRESETS.in)) check(preset, 1);
  for (const preset of glyphOnly(TEXT_PRESETS.out)) check(preset, 0);
  for (const preset of glyphOnly(TEXT_PRESETS.combo)) {
    for (let k = 0; k <= 20; k++) for (const v of Object.values(preset.glyph!(k / 20, 3, 7))) assert.ok(Number.isFinite(v), preset.id);
  }
  assert.ok(TEXT_PRESETS.in.length > PRESETS.in.length, 'text also gets every clip preset');
});
