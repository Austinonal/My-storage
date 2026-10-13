import { SCHEMA_VERSION, type Adjust, type Aspect, type AudioClip, type Clip, type MediaAsset, type MediaClip, type Project, type TextClip, type TextStyle, type Transform, type Us } from './schema.ts';

export const SEC = 1_000_000;
// Seconds added when sampling a source frame: containers round timestamps (WebM to whole ms), which would otherwise land one frame early.
export const FRAME_NUDGE = 0.001;
export const frameUs = (p: Project): Us => Math.round(SEC / p.fps);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

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
    adjust: { brightness: 0, contrast: 0, saturation: 0, exposure: 0, sharpen: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0 },
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
function place(p: Project, c: AudioClip | TextClip) {
  const fits = (clips: Clip[]) => clips.every((o) => o.id === c.id || o.start + o.duration <= c.start || c.start + c.duration <= o.start);
  let track = p.tracks.find((t) => t.kind === c.kind && fits(t.clips));
  if (!track) {
    track = { id: crypto.randomUUID(), kind: c.kind, muted: false, hidden: false, clips: [] };
    p.tracks.push(track);
  }
  track.clips.push(c);
  normalize(p);
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
    } else place(p, c as AudioClip | TextClip);
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
  if (c.kind !== 'photo' && c.kind !== 'text' && right.kind !== 'text' && right.kind !== 'photo') right.sourceIn = c.sourceIn + Math.round(cut * c.speed);
  right.keyframes = c.keyframes.filter((k) => k.at >= cut).map((k) => ({ ...k, at: k.at - cut }));
  c.keyframes = c.keyframes.filter((k) => k.at <= cut);
  if (c.kind === 'audio' && right.kind === 'audio') {
    c.fadeOut = 0;
    right.fadeIn = 0;
    c.fadeIn = Math.min(c.fadeIn, c.duration);
    right.fadeOut = Math.min(right.fadeOut, right.duration);
  } else if (c.kind !== 'audio' && right.kind !== 'audio') {
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
  for (const [k, v] of Object.entries(patch) as [keyof Adjust, number][]) if (k in c.adjust) c.adjust[k] = clamp(Math.round(v), -100, 100);
}

export function setVolume(p: Project, clipId: string, volume: number) {
  const c = findClip(p, clipId);
  if (c.kind === 'text') throw new Error('text has no volume');
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
  if (c.kind === 'text' || c.kind === 'photo') throw new Error('text and photos change duration, not source range');
  const assetDuration = p.assets[c.assetId].duration;
  const minSpan = Math.ceil(frameUs(p) * c.speed);
  const out = sourceOut(c);
  if (edge === 'in') {
    const s = Math.round(clamp(at, 0, out - minSpan));
    const shift = Math.round((s - c.sourceIn) / c.speed);
    c.sourceIn = s;
    c.duration = Math.floor((out - s) / c.speed);
    c.keyframes = c.keyframes.map((k) => ({ ...k, at: k.at - shift }));
  } else {
    const e = Math.round(clamp(at, c.sourceIn + minSpan, assetDuration));
    c.duration = Math.floor((e - c.sourceIn) / c.speed);
  }
  c.keyframes = c.keyframes.filter((k) => k.at >= 0 && k.at <= c.duration);
  if (c.kind !== 'audio') fitAnims(c);
  normalize(p);
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
  if (c.kind === 'audio') throw new Error('audio has no animations');
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

export function updateText(p: Project, clipId: string, patch: { text?: string; style?: Partial<TextStyle>; transform?: Partial<Transform> }) {
  const c = findClip(p, clipId);
  if (c.kind !== 'text') throw new Error('not a text clip');
  if (patch.text !== undefined) c.text = patch.text;
  if (patch.style) c.style = { ...c.style, ...patch.style };
  if (patch.transform) c.transform = { ...c.transform, ...patch.transform };
  c.transform.scale = clamp(c.transform.scale, 0.2, 8);
}

// Text sits anywhere in time: set its start and length directly (the trim handles use this).
export function setTextTiming(p: Project, clipId: string, start: Us, duration: Us) {
  const c = findClip(p, clipId);
  if (c.kind !== 'text') throw new Error('not a text clip');
  c.start = Math.max(0, Math.round(start));
  c.duration = Math.max(frameUs(p), Math.round(duration));
  fitAnims(c);
  moveClip(p, c.id, { start: c.start });
}

export function normalize(p: Project) {
  let t = 0;
  for (const c of p.tracks[0].clips) {
    c.start = t;
    t += c.duration;
  }
  for (const track of p.tracks.slice(1)) track.clips.sort((a, b) => a.start - b.start);
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
  '2:1': [2, 1],
};

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
