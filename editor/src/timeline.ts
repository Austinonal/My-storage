import { SCHEMA_VERSION, type Adjust, type Aspect, type Easing, type EffectClip, type Grade, type Voice, type AudioClip, type Clip, type MediaAsset, type MediaClip, type Project, type TextClip, type TextStyle, type Transform, type Us } from './schema.ts';
import { CURVE_CHANNELS, HSL_COLOURS, WHEELS, neutralGrade } from './grade.ts';
import { KEY_PROPS, setEasing, setKeys, toggleKey, transformAt } from './keyframes.ts';
import type { Layout } from './layout.ts';

export const SEC = 1_000_000;
// Seconds added when sampling a source frame: containers round timestamps (WebM to whole ms), which would otherwise land one frame early.
export const FRAME_NUDGE = 0.001;
export const frameUs = (p: Project): Us => Math.round(SEC / p.fps);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const ADJUST_KEYS: (keyof Adjust)[] = [
  'brightness', 'contrast', 'saturation', 'exposure', 'sharpen', 'highlights', 'shadows', 'temperature', 'tint',
  'ambient', 'clarity', 'whites', 'blacks', 'fade', 'vignette',
];

export const PHOTO_SECONDS = 3;

function mediaClip(asset: MediaAsset): MediaClip {
  return {
    id: crypto.randomUUID(),
    kind: asset.kind === 'photo' ? 'photo' : 'video',
    assetId: asset.id,
    start: 0,
    duration: asset.kind === 'photo' ? PHOTO_SECONDS * SEC : asset.duration,
    keyframes: [],
    sourceIn: 0,
    speed: 1,
    reversed: false,
    volume: 1,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    crop: { x: 0, y: 0, w: 1, h: 1, rotate: 0, mirror: false },
    filter: null,
    adjust: Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])) as unknown as Adjust,
    animIn: null,
    animOut: null,
    animCombo: null,
  };
}

export function newProject(id: string, name: string, asset: MediaAsset, now: string): Project {
  return {
    version: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    aspect: asset.height > asset.width ? '9:16' : '16:9',
    fps: 30,
    canvas: { kind: 'colour', colour: '#000000' },
    assets: { [asset.id]: asset },
    tracks: [{ id: crypto.randomUUID(), kind: 'main', muted: false, hidden: false, clips: [mediaClip(asset)] }],
    transitions: [],
  };
}

// Videos and photos go onto the main track at `index` (end by default), in the order given.
// A thumbnail: one picture, 16:9 like a video cover, its background photo filling the frame.
export function newThumbnail(id: string, name: string, background: MediaAsset, now: string): Project {
  const p = newProject(id, name, background, now);
  p.still = {};
  p.aspect = '16:9';
  coverMain(p);
  return p;
}

// The background of a thumbnail fills the frame (after a new photo or a new aspect).
export function coverMain(p: Project) {
  const c = p.tracks[0].clips[0] as MediaClip;
  c.keyframes = c.keyframes.filter((k) => !(KEY_PROPS as readonly string[]).includes(k.prop));
  c.transform = { ...c.transform, x: 0.5, y: 0.5, scale: fillOf(p, c).scale };
}

export function addMedia(p: Project, assets: MediaAsset[], index = p.tracks[0].clips.length) {
  const clips = assets.map((a) => {
    p.assets[a.id] = a;
    return mediaClip(a);
  });
  p.tracks[0].clips.splice(clamp(index, 0, p.tracks[0].clips.length), 0, ...clips);
  normalize(p);
  return clips.map((c) => c.id);
}

// Puts a clip on the first track of its kind where it does not overlap anything, or on a new track.
// Pictures and videos off the main track are overlays.
function place(p: Project, c: Clip) {
  const kind = c.kind === 'audio' || c.kind === 'text' || c.kind === 'effect' ? c.kind : 'overlay';
  const fits = (clips: Clip[]) => clips.every((o) => o.id === c.id || o.start + o.duration <= c.start || c.start + c.duration <= o.start);
  let track = p.tracks.find((t) => t.kind === kind && fits(t.clips));
  if (!track) {
    track = { id: crypto.randomUUID(), kind, muted: false, hidden: false, clips: [] };
    // Overlays sit right above the main track and below text, so text stays readable on top.
    const firstText = p.tracks.findIndex((t) => t.kind === 'text');
    if (kind === 'overlay' && firstText > 0) p.tracks.splice(firstText, 0, track);
    else p.tracks.push(track);
  }
  track.clips.push(c);
  normalize(p);
}

// A picture or video on top of the main track, half the frame's size, centred, at the playhead.
export function addOverlay(p: Project, asset: MediaAsset, at: Us) {
  if (asset.kind === 'audio') throw new Error('overlays are pictures or videos');
  p.assets[asset.id] = asset;
  const c = mediaClip(asset);
  c.start = Math.max(0, Math.round(at));
  c.transform = { ...c.transform, scale: 0.5 };
  place(p, c);
  return c.id;
}

// Where an overlay sits: centre (frame fractions), size (1 = fits the frame), turn and opacity.
export function setTransform(p: Project, clipId: string, patch: Partial<Transform>) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' && c.kind !== 'photo') throw new Error('not a picture or video');
  const t = { ...c.transform, ...patch };
  c.transform = { x: clamp(t.x, -0.5, 1.5), y: clamp(t.y, -0.5, 1.5), scale: clamp(t.scale, 0.05, 8), rotation: t.rotation, opacity: clamp(t.opacity, 0, 1) };
}

export function addAudio(p: Project, asset: MediaAsset, at: Us) {
  p.assets[asset.id] = asset;
  const c: AudioClip = { id: crypto.randomUUID(), kind: 'audio', assetId: asset.id, start: Math.max(0, Math.round(at)), duration: asset.duration, keyframes: [], sourceIn: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
  place(p, c);
  return c.id;
}

function trackOf(p: Project, clipId: string) {
  const track = p.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!track) throw new Error(`no clip ${clipId}`);
  return track;
}

function dropEmptyTracks(p: Project) {
  p.tracks = p.tracks.filter((t, i) => i === 0 || t.clips.length > 0);
  const main = p.tracks[0].clips;
  p.transitions = p.transitions.filter((tr) => {
    const i = main.findIndex((c) => c.id === tr.fromClipId);
    return i >= 0 && main[i + 1]?.id === tr.toClipId;
  });
}

// Main-track clips move to a new position in the order; clips on other tracks move to a new start time.
export function moveClip(p: Project, clipId: string, to: { index: number } | { start: Us }) {
  const track = trackOf(p, clipId);
  const i = track.clips.findIndex((c) => c.id === clipId);
  const [c] = track.clips.splice(i, 1);
  if (track.kind === 'main') {
    if (!('index' in to)) throw new Error('main-track clips move by index');
    track.clips.splice(clamp(to.index, 0, track.clips.length), 0, c);
    normalize(p);
  } else {
    if (!('start' in to)) throw new Error('clips off the main track move by start time');
    c.start = Math.max(0, Math.round(to.start));
    const ownTrackFree = track.clips.every((o) => o.start + o.duration <= c.start || c.start + c.duration <= o.start);
    if (ownTrackFree) {
      track.clips.push(c);
      normalize(p);
    } else place(p, c);
  }
  dropEmptyTracks(p);
}

// The main track always keeps at least one clip.
export function deleteClip(p: Project, clipId: string) {
  const track = trackOf(p, clipId);
  if (track.kind === 'main' && track.clips.length === 1) return;
  track.clips = track.clips.filter((c) => c.id !== clipId);
  normalize(p);
  dropEmptyTracks(p);
}

// Splits at timeline time `at`; In stays on the left half, Out and fades on the outer ends. Returns the right half's id.
export function splitAt(p: Project, clipId: string, at: Us) {
  const track = trackOf(p, clipId);
  const c = findClip(p, clipId);
  const f = frameUs(p);
  const cut = Math.round(at - c.start);
  if (cut < f || c.duration - cut < f) return null;
  const right = structuredClone(c);
  right.id = crypto.randomUUID();
  right.start = c.start + cut;
  right.duration = c.duration - cut;
  c.duration = cut;
  if ((c.kind === 'video' || c.kind === 'audio') && (right.kind === 'video' || right.kind === 'audio')) right.sourceIn = c.sourceIn + Math.round(cut * c.speed);
  right.keyframes = c.keyframes.filter((k) => k.at >= cut).map((k) => ({ ...k, at: k.at - cut }));
  c.keyframes = c.keyframes.filter((k) => k.at <= cut);
  if (c.kind === 'audio' && right.kind === 'audio') {
    c.fadeOut = 0;
    right.fadeIn = 0;
    c.fadeIn = Math.min(c.fadeIn, c.duration);
    right.fadeOut = Math.min(right.fadeOut, right.duration);
  } else if (c.kind !== 'audio' && c.kind !== 'effect' && right.kind !== 'audio' && right.kind !== 'effect') {
    c.animOut = null;
    right.animIn = null;
    if (right.kind !== 'text') right.animCombo = null;
    fitAnims(c);
    fitAnims(right);
  }
  track.clips.splice(track.clips.indexOf(c) + 1, 0, right);
  normalize(p);
  dropEmptyTracks(p);
  return right.id;
}

export interface TemplateSlot {
  seconds: number;
  in: { presetId: string; seconds: number } | null;
  out: { presetId: string; seconds: number } | null;
  combo: { presetId: string; seconds: number } | null;
  dissolve?: number | null; // seconds of a cross-dissolve from the slot before
}

// Gives the main track the template's rhythm: your clips fill the first slots in order, empty slots get the placeholder,
// and each slot takes the template's In / Out / Combo. Clips beyond the template stay at the end, untouched.
export function applyTemplate(p: Project, slots: TemplateSlot[], placeholder: MediaAsset) {
  p.assets[placeholder.id] = placeholder;
  const own = (p.tracks[0].clips as MediaClip[]).filter((c) => !p.assets[c.assetId].placeholder);
  const f = frameUs(p);
  const filled = slots.map((s, i) => {
    const c = own[i] ?? mediaClip(placeholder);
    const want = Math.max(f, Math.round(s.seconds * SEC));
    if (c.kind === 'video') {
      const asset = p.assets[c.assetId];
      if (asset.duration - c.sourceIn < want) c.sourceIn = 0;
      c.duration = Math.max(f, Math.min(want, asset.duration - c.sourceIn));
    } else c.duration = want;
    const anim = (g: TemplateSlot['in']) => (g ? { presetId: g.presetId, duration: Math.max(f, Math.round(g.seconds * SEC)) } : null);
    c.animCombo = anim(s.combo);
    c.animIn = s.combo ? null : anim(s.in);
    c.animOut = s.combo ? null : anim(s.out);
    fitAnims(c);
    return c;
  });
  p.tracks[0].clips = [...filled, ...own.slice(slots.length)];
  normalize(p);
  dropEmptyTracks(p);
  slots.forEach((s, i) => {
    if (!s.dissolve || i === 0) return;
    try {
      setTransition(p, filled[i - 1].id, 'dissolve', Math.round(s.dissolve * SEC));
    } catch {
      // clips too short for it: leave the cut plain
    }
  });
}

// Swaps the picture or video in a main-track clip and keeps its place, length and animations.
export function replaceClip(p: Project, clipId: string, asset: MediaAsset) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' && c.kind !== 'photo') throw new Error('only videos and photos can be replaced');
  if (asset.kind === 'audio') throw new Error('replace a picture with a picture or a video');
  p.assets[asset.id] = asset;
  c.assetId = asset.id;
  c.kind = asset.kind;
  c.sourceIn = 0;
  if (asset.kind === 'video') c.duration = Math.max(frameUs(p), Math.min(c.duration, asset.duration));
  fitAnims(c);
  normalize(p);
}

export function setPhotoDuration(p: Project, clipId: string, duration: Us) {
  const c = findClip(p, clipId);
  if (c.kind !== 'photo') throw new Error('only photos have a free duration');
  c.duration = Math.round(clamp(duration, frameUs(p), 120 * SEC));
  fitAnims(c);
  normalize(p);
  if (trackOf(p, clipId).kind !== 'main') moveClip(p, clipId, { start: c.start }); // a longer overlay may now overlap the next one
}

function visualClip(p: Project, clipId: string) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' && c.kind !== 'photo') throw new Error('only videos and photos take colour');
  return c;
}

export function setFilter(p: Project, clipId: string, presetId: string | null, intensity = 1) {
  visualClip(p, clipId).filter = presetId ? { presetId, intensity: clamp(intensity, 0, 1) } : null;
}

export function setAdjust(p: Project, clipId: string, patch: Partial<Adjust>) {
  const c = visualClip(p, clipId);
  for (const [k, v] of Object.entries(patch) as [keyof Adjust, number][]) if (ADJUST_KEYS.includes(k) && Number.isFinite(v)) c.adjust[k] = clamp(Math.round(v), -100, 100);
}

const clampPair = ([x, y]: [number, number]): [number, number] => [clamp(x, 0, 1), clamp(y, 0, 1)];

// HSL, curves and wheels; anything left out of the patch stays as it was.
export function setGrade(p: Project, clipId: string, patch: Partial<Grade>) {
  const c = visualClip(p, clipId);
  const g: Grade = structuredClone(c.grade ?? neutralGrade());
  if (patch.hsl) g.hsl = HSL_COLOURS.map((_, i) => (patch.hsl![i] ?? [0, 0, 0]).map((v) => clamp(Math.round(v), -100, 100)) as [number, number, number]);
  if (patch.curves) {
    for (const k of CURVE_CHANNELS) {
      const pts = patch.curves[k];
      if (!pts) continue;
      const inner = pts.map(clampPair).filter(([x]) => x > 0 && x < 1).sort((a, b) => a[0] - b[0]).slice(0, 14);
      const ends = pts.map(clampPair).sort((a, b) => a[0] - b[0]);
      g.curves[k] = [[0, ends[0]?.[0] === 0 ? ends[0][1] : 0], ...inner, [1, ends.at(-1)?.[0] === 1 ? ends.at(-1)![1] : 1]];
    }
  }
  if (patch.wheels) {
    for (const k of WHEELS) {
      const w = patch.wheels[k];
      if (!w) continue;
      const r = Math.hypot(w[0], w[1]);
      const s = r > 1 ? 1 / r : 1;
      g.wheels[k] = [w[0] * s, w[1] * s, clamp(Math.round(w[2]), -100, 100)];
    }
  }
  c.grade = g;
}

export function setQuality(p: Project, clipId: string, patch: Partial<NonNullable<MediaClip['quality']>>) {
  const c = visualClip(p, clipId);
  const q = { enhance: null, stabilize: 0 as const, deflicker: false, ...c.quality, ...patch };
  if (c.kind === 'photo') {
    q.stabilize = 0; // a still picture has nothing to steady or flicker
    q.deflicker = false;
  }
  c.quality = q;
}

export function setShake(p: Project, assetId: string, shake: MediaAsset['shake']) {
  p.assets[assetId].shake = shake;
}

export function setAspect(p: Project, aspect: Aspect) {
  if (!(aspect in ratios)) throw new Error(`unknown aspect ${aspect}`);
  p.aspect = aspect;
}

export function setCanvas(p: Project, canvas: Project['canvas']) {
  p.canvas = canvas.kind === 'blur' ? { kind: 'blur', level: clamp(Math.round(canvas.level), 1, 4) as 1 | 2 | 3 | 4 } : { kind: 'colour', colour: /^#[0-9a-f]{6}$/i.test(canvas.colour) ? canvas.colour : '#000000' };
}

// Speed keeps the part of the recording the clip uses; the clip gets longer or shorter.
export function setSpeed(p: Project, clipId: string, speed: number) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' && c.kind !== 'audio') throw new Error('only videos and sounds have a speed');
  const span = c.duration * c.speed;
  const old = c.duration;
  c.speed = clamp(speed, 0.1, 100);
  c.duration = Math.max(frameUs(p), Math.round(span / c.speed));
  c.keyframes = c.keyframes.map((k) => ({ ...k, at: Math.round((k.at * c.duration) / old) }));
  if (c.kind === 'audio') {
    c.fadeIn = Math.min(c.fadeIn, Math.floor(c.duration / 2));
    c.fadeOut = Math.min(c.fadeOut, Math.floor(c.duration / 2));
  } else fitAnims(c);
  normalize(p);
  if (trackOf(p, clipId).kind !== 'main') moveClip(p, clipId, { start: c.start });
}

// A speed ramp: relative speeds along the clip; the clip's length and the recording it uses do not change.
export function setCurve(p: Project, clipId: string, curve: [number, number][] | null) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video') throw new Error('only videos have a speed curve');
  if (!curve) return void (c.curve = null);
  const pts = curve.map(([x, v]) => [clamp(x, 0, 1), clamp(v, 0.1, 10)] as [number, number]).sort((a, b) => a[0] - b[0]).slice(0, 12);
  if (pts.length < 2) throw new Error('a curve needs two points');
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 1;
  c.curve = pts;
}

export function setReversed(p: Project, clipId: string, on: boolean) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video') throw new Error('only videos play backwards');
  if (on && !p.assets[c.assetId].reversedFile) throw new Error('the reversed copy is not made yet');
  c.reversed = on;
}

export function setReversedFile(p: Project, assetId: string, path: string) {
  p.assets[assetId].reversedFile = path;
}

export function setCrop(p: Project, clipId: string, crop: MediaClip['crop']) {
  const c = visualClip(p, clipId);
  const w = clamp(crop.w, 0.05, 1);
  const h = clamp(crop.h, 0.05, 1);
  c.crop = { x: clamp(crop.x, 0, 1 - w), y: clamp(crop.y, 0, 1 - h), w, h, rotate: ((((Math.round(crop.rotate / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270, mirror: !!crop.mirror };
}

// A still of the clip at `at` (already saved as a photo asset) goes in at that point, splitting the clip around it.
export function insertFreeze(p: Project, clipId: string, at: Us, still: MediaAsset, seconds = 3) {
  const c = findClip(p, clipId) as MediaClip;
  const main = p.tracks[0].clips;
  if (!main.includes(c)) throw new Error('freeze works on the main track');
  splitAt(p, c.id, at);
  const index = main.indexOf(c) + (at <= c.start ? 0 : 1);
  const [id] = addMedia(p, [still], index);
  const f = findClip(p, id) as MediaClip;
  f.duration = Math.max(frameUs(p), Math.round(seconds * SEC));
  Object.assign(f, structuredClone({ filter: c.filter, adjust: c.adjust, grade: c.grade, match: c.match, crop: c.crop, transform: c.transform }));
  normalize(p);
  return id;
}

export function setTransition(p: Project, fromClipId: string, presetId: string | null, duration: Us) {
  const main = p.tracks[0].clips;
  const i = main.findIndex((c) => c.id === fromClipId);
  const to = main[i + 1];
  if (i < 0 || !to) throw new Error('a transition needs a next clip');
  p.transitions = p.transitions.filter((t) => t.fromClipId !== fromClipId);
  if (!presetId) return;
  const max = Math.floor(Math.min(main[i].duration, to.duration) / 2);
  if (max < frameUs(p)) throw new Error('these clips are too short for a transition');
  p.transitions.push({ id: crypto.randomUUID(), fromClipId, toClipId: to.id, presetId, duration: clamp(Math.round(duration), frameUs(p), max) });
}

// Moves or resizes a picture or text at clip time `at`: on a keyframe there when the clip has keyframes, else on the clip.
export function setTransformAt(p: Project, clipId: string, at: Us, patch: Partial<Transform>) {
  const c = findClip(p, clipId);
  if (c.kind === 'audio' || c.kind === 'effect') throw new Error('sound and effects have no position');
  const clean: Partial<Transform> = { ...patch };
  if (clean.x !== undefined) clean.x = clamp(clean.x, -0.5, 1.5);
  if (clean.y !== undefined) clean.y = clamp(clean.y, -0.5, 1.5);
  if (clean.scale !== undefined) clean.scale = clamp(clean.scale, c.kind === 'text' ? 0.2 : 0.05, 8);
  if (clean.opacity !== undefined) clean.opacity = clamp(clean.opacity, 0, 1);
  setKeys(c, clamp(Math.round(at), 0, c.duration), clean, frameUs(p) / 2);
}

export function toggleKeyframe(p: Project, clipId: string, at: Us) {
  const c = findClip(p, clipId);
  if (c.kind === 'audio' || c.kind === 'effect') throw new Error('sound and effects have no position');
  return toggleKey(c, clamp(Math.round(at), 0, c.duration), frameUs(p) / 2);
}

export function setKeyEasing(p: Project, clipId: string, at: Us, easing: Easing) {
  const c = findClip(p, clipId);
  if (c.kind === 'audio' || c.kind === 'effect') throw new Error('sound and effects have no position');
  setEasing(c, at, easing, frameUs(p) / 2);
}

// Sound fading in at the start and out at the end of a clip (each at most half the clip).
export function setFades(p: Project, clipId: string, fadeIn: Us, fadeOut: Us) {
  const c = findClip(p, clipId);
  if (c.kind !== 'audio' && c.kind !== 'video') throw new Error('only sound fades');
  c.fadeIn = clamp(Math.round(fadeIn), 0, Math.floor(c.duration / 2));
  c.fadeOut = clamp(Math.round(fadeOut), 0, Math.floor(c.duration / 2));
}

export function setVoice(p: Project, clipId: string, voice: Voice | null) {
  const c = findClip(p, clipId);
  if (c.kind !== 'audio' && c.kind !== 'video') throw new Error('only sound has a voice');
  c.voice = voice;
}

// The sound of a video becomes its own clip on an audio track (same time and part); the video goes quiet.
export function extractAudio(p: Project, clipId: string) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' || !p.assets[c.assetId].hasAudio) throw new Error('this clip has no sound');
  const a: AudioClip = {
    id: crypto.randomUUID(), kind: 'audio', assetId: c.assetId, start: c.start, duration: c.duration, keyframes: [],
    sourceIn: c.sourceIn, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, voice: c.voice ?? null,
  };
  c.volume = 0;
  place(p, a);
  return a.id;
}

export function setMatch(p: Project, clipId: string, match: MediaClip['match']) {
  visualClip(p, clipId).match = match ? { ...match, intensity: clamp(match.intensity, 0, 1) } : null;
}

export function setVolume(p: Project, clipId: string, volume: number) {
  const c = findClip(p, clipId);
  if (c.kind === 'text' || c.kind === 'effect') throw new Error('text and effects have no volume');
  c.volume = clamp(volume, 0, 2);
}

export function findClip(p: Project, clipId: string): Clip {
  for (const t of p.tracks) for (const c of t.clips) if (c.id === clipId) return c;
  throw new Error(`no clip ${clipId}`);
}

export const sourceOut = (c: MediaClip | AudioClip): Us => c.sourceIn + Math.round(c.duration * c.speed);

// `at` is a time in the source file; the edge moves there, clamped so the clip stays at least one frame long.
export function trimClip(p: Project, clipId: string, edge: 'in' | 'out', at: Us) {
  const c = findClip(p, clipId);
  if (c.kind === 'text' || c.kind === 'photo' || c.kind === 'effect') throw new Error('text, photos and effects change duration, not source range');
  const assetDuration = p.assets[c.assetId].duration;
  const minSpan = Math.ceil(frameUs(p) * c.speed);
  const out = sourceOut(c);
  const free = trackOf(p, clipId).kind !== 'main';
  if (edge === 'in') {
    // Off the main track the rest of the clip stays where it is in time, so its start moves with the cut.
    const s = Math.round(clamp(at, free ? Math.max(0, c.sourceIn - c.start * c.speed) : 0, out - minSpan));
    const shift = Math.round((s - c.sourceIn) / c.speed);
    c.sourceIn = s;
    c.duration = Math.floor((out - s) / c.speed);
    c.keyframes = c.keyframes.map((k) => ({ ...k, at: k.at - shift }));
    if (free) c.start = Math.max(0, c.start + shift);
  } else {
    const e = Math.round(clamp(at, c.sourceIn + minSpan, assetDuration));
    c.duration = Math.floor((e - c.sourceIn) / c.speed);
  }
  c.keyframes = c.keyframes.filter((k) => k.at >= 0 && k.at <= c.duration);
  if (c.kind !== 'audio') fitAnims(c);
  normalize(p);
  if (free) moveClip(p, c.id, { start: c.start }); // an earlier start may now overlap a neighbour
}

// Dragging a clip's edge by `dt` on the timeline, measured from `from` (the clip as it was when the drag began).
export function trimEdge(p: Project, from: Clip, edge: 'in' | 'out', dt: Us) {
  if (from.kind === 'text' || from.kind === 'effect') {
    if (edge === 'in') {
      const d = clamp(dt, -from.start, from.duration - frameUs(p));
      setTextTiming(p, from.id, from.start + d, from.duration - d);
    } else setTextTiming(p, from.id, from.start, from.duration + dt);
  } else if (from.kind === 'photo') {
    setPhotoDuration(p, from.id, from.duration + (edge === 'in' ? -dt : dt));
  } else if (edge === 'in') {
    trimClip(p, from.id, 'in', from.sourceIn + dt * from.speed);
  } else {
    trimClip(p, from.id, 'out', sourceOut(from) + dt * from.speed);
  }
}

// Times a dragged edge sticks to: the playhead, the ends of the video, every other clip's edges and the music's beats.
export function snapPoints(p: Project, playhead: Us, exceptId: string): Us[] {
  const pts = [0, playhead, projectDuration(p)];
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (c.id === exceptId) continue;
      pts.push(c.start, c.start + c.duration);
      if (c.kind === 'audio') for (const s of p.assets[c.assetId].beats ?? []) pts.push(c.start + Math.round((s * SEC - c.sourceIn) / c.speed)); // the music's beats
    }
  }
  return pts;
}

export function snap(t: Us, points: Us[], within: Us): Us | null {
  let best: Us | null = null;
  for (const s of points) if (Math.abs(s - t) <= within && (best === null || Math.abs(s - t) < Math.abs(best - t))) best = s;
  return best;
}

// A shorter clip squeezes its animations proportionally instead of dropping them.
function fitAnims(c: MediaClip | TextClip) {
  const solo = c.kind === 'text' ? c.animLoop : c.animCombo;
  if (solo) solo.duration = Math.min(solo.duration, c.duration);
  const total = (c.animIn?.duration ?? 0) + (c.animOut?.duration ?? 0);
  if (total <= c.duration) return;
  const k = c.duration / total;
  if (c.animIn) c.animIn.duration = Math.floor(c.animIn.duration * k);
  if (c.animOut) c.animOut.duration = Math.floor(c.animOut.duration * k);
}

// The animation just chosen wins: Combo (Loop for text) clears In/Out and the reverse; an In/Out that no longer fits beside it shrinks.
export function setAnim(p: Project, clipId: string, slot: 'in' | 'out' | 'combo', presetId: string | null, duration: Us) {
  const c = findClip(p, clipId);
  if (c.kind === 'audio' || c.kind === 'effect') throw new Error('audio and effects have no animations');
  const anim = presetId ? { presetId, duration: Math.round(clamp(duration, Math.min(frameUs(p), c.duration), c.duration)) } : null;
  if (slot === 'combo') {
    if (c.kind === 'text') c.animLoop = anim;
    else c.animCombo = anim;
    if (anim) c.animIn = c.animOut = null;
    return;
  }
  c[slot === 'in' ? 'animIn' : 'animOut'] = anim;
  if (!anim) return;
  if (c.kind === 'text') c.animLoop = null;
  else c.animCombo = null;
  const other = slot === 'in' ? 'animOut' : 'animIn';
  const o = c[other];
  if (o && o.duration + anim.duration > c.duration) c[other] = c.duration - anim.duration >= frameUs(p) ? { ...o, duration: c.duration - anim.duration } : null;
}

export const SUBTITLE: TextStyle = {
  fontId: 'kanit',
  size: 64,
  colour: '#ffffffff',
  align: 'center',
  stroke: { colour: '#000000ff', width: 6 },
  shadow: null,
  background: null,
};

export function addText(p: Project, at: Us, text = 'ข้อความ', style: TextStyle = SUBTITLE, seconds = 3) {
  const c: TextClip = {
    id: crypto.randomUUID(),
    kind: 'text',
    text,
    style: structuredClone(style),
    transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0, opacity: 1 },
    start: Math.max(0, Math.round(at)),
    duration: Math.max(frameUs(p), Math.round(seconds * SEC)),
    keyframes: [],
    animIn: null,
    animOut: null,
    animLoop: null,
  };
  place(p, c);
  return c.id;
}

// An effect layer at the playhead; effect tracks sit on top, so they restyle everything below them.
export function addEffect(p: Project, at: Us, effect: string, seconds = 3) {
  const c: EffectClip = { id: crypto.randomUUID(), kind: 'effect', effect, start: Math.max(0, Math.round(at)), duration: Math.max(frameUs(p), Math.round(seconds * SEC)), keyframes: [] };
  place(p, c);
  return c.id;
}

export function setEffect(p: Project, clipId: string, effect: string) {
  const c = findClip(p, clipId);
  if (c.kind !== 'effect') throw new Error('not an effect clip');
  c.effect = effect;
}

// Person cutout: keep the person and remove, blur or swap the background (`image` is a photo asset, registered here).
export function setCutout(p: Project, clipId: string, cutout: MediaClip['cutout'], image?: MediaAsset) {
  const c = visualClip(p, clipId);
  if (cutout?.bg === 'image') {
    if (!image || image.kind !== 'photo') throw new Error('a background picture is a photo');
    p.assets[image.id] = image;
    c.cutout = { bg: 'image', image: image.id };
  } else c.cutout = cutout ? { bg: cutout.bg } : null;
}

export function setBehind(p: Project, clipId: string, on: boolean) {
  const c = findClip(p, clipId);
  if (c.kind !== 'text') throw new Error('not a text clip');
  c.behind = on;
}

// Replaces a clip's position keyframes between the first and last `at` with one full keyframe per point (linear between).
function keyPath(c: MediaClip | TextClip, points: { at: Us; values: Transform }[]) {
  const from = points[0].at;
  const to = points[points.length - 1].at;
  c.keyframes = c.keyframes.filter((k) => !(KEY_PROPS as readonly string[]).includes(k.prop) || k.at < from || k.at > to);
  for (const { at, values } of points) for (const prop of KEY_PROPS) c.keyframes.push({ at, prop, value: values[prop], easing: 'linear' });
}

// The zoom (1 = fits inside) at which a clip covers the whole frame, and its width then, in frame widths.
function fillOf(p: Project, c: MediaClip) {
  const a = p.assets[c.assetId];
  const [ew, eh] = c.crop.rotate % 180 ? [a.height * c.crop.h, a.width * c.crop.w] : [a.width * c.crop.w, a.height * c.crop.h];
  const [W, H] = outputSize(p.aspect, 1080);
  const fit = fitContain(ew, eh, W, H);
  const scale = Math.max(W / fit.w, H / fit.h);
  return { scale, bw: (fit.w * scale) / W };
}

// Auto reframe: the clip zooms to fill the frame and slides so the person (`fx`, 0..1 across the picture) stays centred.
export function setReframe(p: Project, clipId: string, path: { at: Us; fx: number }[]) {
  const c = visualClip(p, clipId);
  if (!path.length) return;
  const { scale, bw } = fillOf(p, c);
  const base = { ...c.transform, y: 0.5, scale };
  c.keyframes = c.keyframes.filter((k) => !(KEY_PROPS as readonly string[]).includes(k.prop));
  c.transform = { ...base, x: 0.5 };
  if (bw <= 1.001) return; // the picture is not wider than the frame: nothing to follow
  const room = (bw - 1) / 2;
  const at = (k: number) => Math.round(clamp(path[k].at, 0, c.duration));
  keyPath(c, path.map((pt, k) => ({ at: at(k), values: { ...base, x: 0.5 + clamp(-(pt.fx - 0.5) * bw, -room, room) } })));
}

// Tracking: from the first point on, the clip moves with whatever it follows (dx, dy in frame fractions since then).
export function setFollow(p: Project, clipId: string, path: { at: Us; dx: number; dy: number }[]) {
  const c = findClip(p, clipId);
  if ((c.kind !== 'text' && c.kind !== 'video' && c.kind !== 'photo') || !path.length) throw new Error('only pictures and text follow');
  const start = transformAt(c, path[0].at);
  const points = path
    .filter((pt) => pt.at >= 0 && pt.at <= c.duration)
    .map((pt) => ({ at: Math.round(pt.at), values: { ...transformAt(c, pt.at), x: clamp(start.x + pt.dx, -0.5, 1.5), y: clamp(start.y + pt.dy, -0.5, 1.5) } }));
  if (points.length) keyPath(c, points);
}

export function setBeats(p: Project, assetId: string, beats: number[]) {
  p.assets[assetId].beats = beats;
}

// Main-track cuts land on beats (timeline times): each clip ends on the first of every `every`-th beat it can reach.
// A video too short for the next one keeps all it has; once the beats run out the rest stay as they are.
export function syncToBeats(p: Project, beats: Us[], every = 1) {
  const marks = beats.filter((_, i) => (i + 1) % every === 0).sort((a, b) => a - b);
  const shortest = Math.max(frameUs(p), SEC / 4);
  let t = 0;
  for (const c of p.tracks[0].clips as MediaClip[]) {
    const room = c.kind === 'photo' ? Infinity : Math.floor((p.assets[c.assetId].duration - c.sourceIn) / c.speed);
    const end = marks.find((m) => m - t >= shortest);
    if (end === undefined) break;
    c.duration = Math.max(frameUs(p), end - t <= room ? end - t : room);
    c.keyframes = c.keyframes.filter((k) => k.at <= c.duration);
    fitAnims(c);
    t += c.duration;
  }
  normalize(p);
}

// Keeps only the given parts of a main-track video (clip times), cutting out the rest; the clips after it move up.
export function keepParts(p: Project, clipId: string, parts: [Us, Us][]) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' || trackOf(p, clipId).kind !== 'main') throw new Error('works on videos on the main track');
  const cuts = [...new Set(parts.flat().map((x) => Math.round(clamp(x, 0, c.duration))))].sort((a, b) => b - a);
  const pieces: { id: string; from: Us; to: Us }[] = [];
  let to = c.duration;
  for (const at of cuts) {
    const id = splitAt(p, c.id, c.start + at); // from the end, so the clip being cut keeps its id and start
    if (!id) continue;
    pieces.push({ id, from: at, to });
    to = at;
  }
  pieces.push({ id: c.id, from: 0, to });
  let removed = 0;
  for (const piece of pieces) {
    const mid = (piece.from + piece.to) / 2;
    if (parts.some(([a, b]) => mid >= a && mid <= b)) continue;
    deleteClip(p, piece.id);
    removed++;
  }
  return removed;
}

// A thumbnail laid out like a reference picture: its shape, a slot for the person where it has one (cut out once a photo
// is put in) and text where it has text, in its colours and about its size. Layers already there stay.
export function applyLayout(p: Project, layout: Layout, reference: MediaAsset, slot: MediaAsset | null) {
  p.assets[reference.id] = reference;
  p.still = { ...p.still, reference: reference.id };
  setAspect(p, layout.aspect);
  coverMain(p);
  if (layout.person && slot) {
    const c = findClip(p, addOverlay(p, slot, 0)) as MediaClip;
    c.transform = { ...c.transform, x: layout.person.cx, y: layout.person.cy, scale: clamp(layout.person.h / 0.9, 0.2, 1.5) }; // the person fills about 90 % of their photo's height
    c.cutout = { bg: 'clear' };
  }
  const [, H] = outputSize(p.aspect, 1080); // text sizes are pixels on a frame whose short side is 1080
  for (const t of layout.texts) {
    const size = clamp(Math.round(t.h * H * 1.1), 16, 240); // the letters' ink is about 0.9 of the font size
    const id = addText(p, 0, 'ใส่ข้อความ', { ...SUBTITLE, colour: `${t.fill}ff`, size, stroke: t.stroke ? { colour: `${t.stroke}ff`, width: Math.max(4, Math.round(size * 0.1)) } : null });
    updateText(p, id, { transform: { x: t.cx, y: t.cy } });
  }
}

// Many captions at once (pasted lines or a subtitle file), each looking like `like` when given.
export function addCaptions(p: Project, caps: { start: Us; duration: Us; text: string }[], like?: TextClip) {
  return caps.map((c) => {
    const id = addText(p, c.start, c.text, like?.style ?? SUBTITLE, c.duration / SEC);
    if (like) updateText(p, id, { transform: like.transform });
    return id;
  });
}

export function updateText(p: Project, clipId: string, patch: { text?: string; style?: Partial<TextStyle>; transform?: Partial<Transform> }) {
  const c = findClip(p, clipId);
  if (c.kind !== 'text') throw new Error('not a text clip');
  if (patch.text !== undefined) c.text = patch.text;
  if (patch.style) c.style = { ...c.style, ...patch.style };
  if (patch.transform) c.transform = { ...c.transform, ...patch.transform };
  c.transform.scale = clamp(c.transform.scale, 0.2, 8);
}

// Text and effects sit anywhere in time: set the start and length directly (the trim handles use this).
export function setTextTiming(p: Project, clipId: string, start: Us, duration: Us) {
  const c = findClip(p, clipId);
  if (c.kind !== 'text' && c.kind !== 'effect') throw new Error('not a text or effect clip');
  c.start = Math.max(0, Math.round(start));
  c.duration = Math.max(frameUs(p), Math.round(duration));
  if (c.kind === 'text') fitAnims(c);
  moveClip(p, c.id, { start: c.start });
}

export function normalize(p: Project) {
  let t = 0;
  for (const c of p.tracks[0].clips) {
    c.start = t;
    t += c.duration;
  }
  for (const track of p.tracks.slice(1)) track.clips.sort((a, b) => a.start - b.start);
  // Transitions follow their clips: gone when the two are no longer neighbours, shorter when a clip got shorter.
  const main = p.tracks[0].clips;
  p.transitions = (p.transitions ?? []).filter((tr) => {
    const i = main.findIndex((c) => c.id === tr.fromClipId);
    if (i < 0 || main[i + 1]?.id !== tr.toClipId) return false;
    tr.duration = Math.min(tr.duration, Math.floor(Math.min(main[i].duration, main[i + 1].duration) / 2));
    return tr.duration >= frameUs(p);
  });
}

// The video is as long as the main track; anything on other tracks past its end is cut.
export const projectDuration = (p: Project): Us => p.tracks[0].clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);

// Throws on the first broken invariant from replica/architecture.md.
export function assertValid(p: Project) {
  const fail = (msg: string) => {
    throw new Error(`invalid project: ${msg}`);
  };
  const minDur = frameUs(p);
  if (p.tracks[0]?.kind !== 'main') fail('tracks[0] must be the main track');
  p.tracks.forEach((track, i) => {
    let end = 0;
    for (const c of track.clips) {
      if (i === 0 ? c.start !== end : c.start < end) fail(`${i === 0 ? 'gap or overlap' : 'overlap'} at clip ${c.id}`);
      end = c.start + c.duration;
      if (c.duration < minDur) fail(`clip ${c.id} shorter than one frame`);
      if (c.keyframes.some((k) => k.at < 0 || k.at > c.duration)) fail(`keyframe outside clip ${c.id}`);
      if (c.kind === 'effect') continue;
      if (c.kind !== 'audio') {
        const solo = c.kind === 'text' ? c.animLoop : c.animCombo;
        if (solo && (c.animIn || c.animOut)) fail(`${c.kind === 'text' ? 'loop' : 'combo'} together with in/out on ${c.id}`);
        if ((c.animIn?.duration ?? 0) + (c.animOut?.duration ?? 0) > c.duration || (solo?.duration ?? 0) > c.duration) {
          fail(`animations longer than ${c.id}`);
        }
      }
      if (c.kind === 'text') continue;
      const asset = p.assets[c.assetId];
      if (!asset) fail(`missing asset ${c.assetId}`);
      if (c.speed < 0.1 || c.speed > 100) fail(`speed ${c.speed} on ${c.id}`);
      if (c.kind !== 'photo' && (c.sourceIn < 0 || sourceOut(c) > asset.duration)) fail(`source range outside asset on ${c.id}`);
      if (c.kind !== 'audio' && c.filter && !(c.filter.intensity >= 0 && c.filter.intensity <= 1)) fail(`filter intensity on ${c.id}`);
      if (c.kind !== 'audio' && Object.values(c.adjust).some((v) => !(v >= -100 && v <= 100))) fail(`adjust out of range on ${c.id}`);
      if (c.kind !== 'audio' && c.match && !(c.match.intensity >= 0 && c.match.intensity <= 1)) fail(`colour match intensity on ${c.id}`);
      if (c.kind === 'audio' && c.fadeIn + c.fadeOut > c.duration) fail(`fades longer than ${c.id}`);
    }
  });
  const main = p.tracks[0].clips;
  for (const t of p.transitions) {
    const i = main.findIndex((c) => c.id === t.fromClipId);
    if (i < 0 || main[i + 1]?.id !== t.toClipId) fail(`transition ${t.id} not between adjacent clips`);
    if (t.duration > Math.min(main[i].duration, main[i + 1].duration) / 2) fail(`transition ${t.id} too long`);
  }
}

const ratios: Record<Aspect, [number, number]> = {
  '9:16': [9, 16],
  '16:9': [16, 9],
  '1:1': [1, 1],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '4:5': [4, 5],
  '2:1': [2, 1],
};
export const ASPECTS = Object.keys(ratios) as Aspect[];

// `short` is the "720p / 1080p" number: the short side of the frame. Encoders want even sizes.
export function outputSize(aspect: Aspect, short: number): [number, number] {
  const [a, b] = ratios[aspect];
  const even = (n: number) => Math.round(n / 2) * 2;
  return a < b ? [even(short), even((short * b) / a)] : [even((short * a) / b), even(short)];
}

export function fitContain(w: number, h: number, boxW: number, boxH: number) {
  const s = Math.min(boxW / w, boxH / h);
  const fw = Math.round(w * s);
  const fh = Math.round(h * s);
  return { x: Math.round((boxW - fw) / 2), y: Math.round((boxH - fh) / 2), w: fw, h: fh };
}

export function formatTime(us: Us, tenths = false) {
  const s = us / SEC;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return tenths ? `${mm}:${ss}.${Math.floor((s * 10) % 10)}` : `${mm}:${ss}`;
}
