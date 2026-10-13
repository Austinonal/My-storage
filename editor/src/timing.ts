// Clip time -> source time: constant speed, speed curves (ramps) and reverse. Pure, so it is unit-tested.
// A curve is relative: `speed` stays the clip's average, so its length and source range never change when the curve does.
import type { AudioClip, MediaClip, Us } from './schema';

type Timed = Pick<MediaClip, 'sourceIn' | 'speed' | 'duration'> & { curve?: [number, number][] | null; reversed?: boolean };

// Integral of the piecewise-linear curve from 0 to x, divided by the whole integral (0 -> 0, 1 -> 1).
export function curveProgress(curve: [number, number][] | null | undefined) {
  if (!curve || curve.length < 2) return (x: number) => x;
  const pts = [...curve].sort((a, b) => a[0] - b[0]);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + ((pts[i][1] + pts[i - 1][1]) / 2) * (pts[i][0] - pts[i - 1][0]));
  const total = acc[acc.length - 1] || 1;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let i = 1;
    while (pts[i][0] < x) i++;
    const [x0, v0] = pts[i - 1];
    const [x1, v1] = pts[i];
    const u = x - x0;
    const v = v0 + ((v1 - v0) * u) / Math.max(1e-9, x1 - x0);
    return (acc[i - 1] + ((v0 + v) / 2) * u) / total;
  };
}

// Mean of the curve, so instantaneous speed = clip speed * v(x) / mean.
const curveMean = (curve: [number, number][]) => {
  const pts = [...curve].sort((a, b) => a[0] - b[0]);
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += ((pts[i][1] + pts[i - 1][1]) / 2) * (pts[i][0] - pts[i - 1][0]);
  return s || 1;
};

// Where in the original recording the clip is at clip time `t` (reversed clips run backwards through it).
export function sourceAt(c: Timed, t: Us): Us {
  const span = c.speed * c.duration;
  const along = span * curveProgress(c.curve)(Math.min(1, Math.max(0, t / Math.max(1, c.duration))));
  return Math.round(c.reversed ? c.sourceIn + span - along : c.sourceIn + along);
}

// Speed at clip time `t`, for media elements and audio.
export function rateAt(c: Timed, t: Us) {
  if (!c.curve || c.curve.length < 2) return c.speed;
  const x = Math.min(1, Math.max(0, t / Math.max(1, c.duration)));
  const pts = [...c.curve].sort((a, b) => a[0] - b[0]);
  let i = 1;
  while (i < pts.length - 1 && pts[i][0] < x) i++;
  const [x0, v0] = pts[i - 1];
  const [x1, v1] = pts[i];
  return (c.speed * (v0 + ((v1 - v0) * (x - x0)) / Math.max(1e-9, x1 - x0))) / curveMean(c.curve);
}

// Like sourceAt, but before the start or after the end it carries on at the edge speed, within the recording
// (a transition shows a little more of each clip; at the recording's ends the picture holds).
export function sourceAtEdge(c: Timed, t: Us, assetDuration: Us): Us {
  if (t >= 0 && t <= c.duration) return sourceAt(c, t);
  const edge = t < 0 ? 0 : c.duration;
  const s = sourceAt(c, edge) + (t - edge) * rateAt(c, edge) * (c.reversed ? -1 : 1);
  return Math.round(Math.min(assetDuration, Math.max(0, s)));
}

// Seconds into the file that is actually played: the original, or for reversed clips the reversed copy (whose time runs D - t).
export function fileSecondsAt(c: Timed, assetDuration: Us, t: Us) {
  const s = sourceAtEdge(c, t, assetDuration);
  return (c.reversed ? assetDuration - s : s) / 1e6;
}

export const SPEED_PRESETS: { id: string; name: string; curve: [number, number][] }[] = [
  { id: 'montage', name: 'มอนทาจ', curve: [[0, 2], [0.3, 2], [0.45, 0.4], [0.55, 0.4], [0.7, 2], [1, 2]] },
  { id: 'hero', name: 'ฮีโร่', curve: [[0, 1], [0.35, 1], [0.45, 0.2], [0.65, 0.2], [0.75, 1], [1, 1]] },
  { id: 'bullet', name: 'กระสุน', curve: [[0, 3], [0.4, 3], [0.5, 0.15], [0.6, 3], [1, 3]] },
  { id: 'jump-cut', name: 'จัมพ์คัท', curve: [[0, 0.8], [0.3, 0.8], [0.35, 5], [0.45, 5], [0.5, 0.8], [0.8, 0.8], [0.85, 5], [1, 5]] },
  { id: 'flash-in', name: 'แฟลชเข้า', curve: [[0, 6], [0.25, 6], [0.4, 1], [1, 1]] },
  { id: 'flash-out', name: 'แฟลชออก', curve: [[0, 1], [0.6, 1], [0.75, 6], [1, 6]] },
  { id: 'slow-mid', name: 'ช้ากลางคลิป', curve: [[0, 1.5], [0.4, 0.3], [0.6, 0.3], [1, 1.5]] },
  { id: 'ramp-up', name: 'เร่งขึ้นเรื่อยๆ', curve: [[0, 0.3], [1, 3]] },
];

export type AnyTimed = MediaClip | AudioClip;
