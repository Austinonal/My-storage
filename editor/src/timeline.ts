import { SCHEMA_VERSION, type Aspect, type AudioClip, type Clip, type MediaAsset, type MediaClip, type Project, type Us } from './schema.ts';

export const SEC = 1_000_000;
// Seconds added when sampling a source frame: containers round timestamps (WebM to whole ms), which would otherwise land one frame early.
export const FRAME_NUDGE = 0.001;
export const frameUs = (p: Project): Us => Math.round(SEC / p.fps);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function newProject(id: string, name: string, asset: MediaAsset, now: string): Project {
  const clip: MediaClip = {
    id: crypto.randomUUID(),
    kind: 'video',
    assetId: asset.id,
    start: 0,
    duration: asset.duration,
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
    tracks: [{ id: crypto.randomUUID(), kind: 'main', muted: false, hidden: false, clips: [clip] }],
    transitions: [],
  };
}

export function findClip(p: Project, clipId: string): Clip {
  for (const t of p.tracks) for (const c of t.clips) if (c.id === clipId) return c;
  throw new Error(`no clip ${clipId}`);
}

export const sourceOut = (c: MediaClip | AudioClip): Us => c.sourceIn + Math.round(c.duration * c.speed);

// `at` is a time in the source file; the edge moves there, clamped so the clip stays at least one frame long.
export function trimClip(p: Project, clipId: string, edge: 'in' | 'out', at: Us) {
  const c = findClip(p, clipId);
  if (c.kind === 'text') throw new Error('text clips are trimmed by start/duration');
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
function fitAnims(c: MediaClip) {
  if (c.animCombo) c.animCombo.duration = Math.min(c.animCombo.duration, c.duration);
  const total = (c.animIn?.duration ?? 0) + (c.animOut?.duration ?? 0);
  if (total <= c.duration) return;
  const k = c.duration / total;
  if (c.animIn) c.animIn.duration = Math.floor(c.animIn.duration * k);
  if (c.animOut) c.animOut.duration = Math.floor(c.animOut.duration * k);
}

const slotKey = { in: 'animIn', out: 'animOut', combo: 'animCombo' } as const;

// The animation just chosen wins: Combo clears In/Out (and the reverse), and an In/Out that no longer fits beside it shrinks.
export function setAnim(p: Project, clipId: string, slot: 'in' | 'out' | 'combo', presetId: string | null, duration: Us) {
  const c = findClip(p, clipId);
  if (c.kind !== 'video' && c.kind !== 'photo') throw new Error('clip animations need a video or photo clip');
  if (!presetId) {
    c[slotKey[slot]] = null;
    return;
  }
  const d = Math.round(clamp(duration, Math.min(frameUs(p), c.duration), c.duration));
  c[slotKey[slot]] = { presetId, duration: d };
  if (slot === 'combo') {
    c.animIn = null;
    c.animOut = null;
    return;
  }
  c.animCombo = null;
  const other = slot === 'in' ? 'animOut' : 'animIn';
  const o = c[other];
  if (o && o.duration + d > c.duration) c[other] = c.duration - d >= frameUs(p) ? { ...o, duration: c.duration - d } : null;
}

export function normalize(p: Project) {
  let t = 0;
  for (const c of p.tracks[0].clips) {
    c.start = t;
    t += c.duration;
  }
  for (const track of p.tracks.slice(1)) track.clips.sort((a, b) => a.start - b.start);
}

export const projectDuration = (p: Project): Us =>
  Math.max(0, ...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));

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
      if (c.sourceIn < 0 || sourceOut(c) > asset.duration) fail(`source range outside asset on ${c.id}`);
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
