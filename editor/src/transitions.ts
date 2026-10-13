// Transitions between two main-track clips: during the overlap the outgoing clip (a) and the incoming one (b, drawn on top)
// each get a pose, from progress q = 0 (all a) to 1 (all b). Pure, so it is unit-tested.
import { ease, type Pose } from './anim.ts';

type Pair = { a: Partial<Pose>; b: Partial<Pose> };
const e = ease.inOutCubic;
const mid = (q: number) => Math.min(1, Math.max(0, (q - 0.4) / 0.2)); // a quick swap around the middle
const noise = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

export const TRANSITIONS: { id: string; name: string; seconds: number; pair: (q: number) => Pair }[] = [
  { id: 'dissolve', name: 'ซ้อนจาง', seconds: 0.6, pair: (q) => ({ a: {}, b: { alpha: q } }) },
  { id: 'fade-black', name: 'ผ่านสีดำ', seconds: 0.8, pair: (q) => ({ a: { alpha: Math.max(0, 1 - 2 * q) }, b: { alpha: Math.max(0, 2 * q - 1) } }) },
  { id: 'fade-white', name: 'ผ่านสีขาว', seconds: 0.8, pair: (q) => ({ a: { flash: Math.min(1, 2 * q), alpha: q < 0.5 ? 1 : 0 }, b: { flash: Math.min(1, 2 - 2 * q), alpha: q < 0.5 ? 0 : 1 } }) },
  { id: 'slide-left', name: 'สไลด์ซ้าย', seconds: 0.5, pair: (q) => ({ a: { x: -e(q) }, b: { x: 1 - e(q) } }) },
  { id: 'slide-right', name: 'สไลด์ขวา', seconds: 0.5, pair: (q) => ({ a: { x: e(q) }, b: { x: e(q) - 1 } }) },
  { id: 'slide-up', name: 'สไลด์ขึ้น', seconds: 0.5, pair: (q) => ({ a: { y: -e(q) }, b: { y: 1 - e(q) } }) },
  { id: 'slide-down', name: 'สไลด์ลง', seconds: 0.5, pair: (q) => ({ a: { y: e(q) }, b: { y: e(q) - 1 } }) },
  { id: 'zoom-in', name: 'ซูมทะลุ', seconds: 0.6, pair: (q) => ({ a: { scale: 1 + 2 * e(q), alpha: 1 - mid(q) }, b: { scale: 0.6 + 0.4 * e(q), alpha: mid(q) } }) },
  { id: 'zoom-out', name: 'ซูมถอย', seconds: 0.6, pair: (q) => ({ a: { scale: 1 - 0.5 * e(q), alpha: 1 - mid(q) }, b: { scale: 1.6 - 0.6 * e(q), alpha: mid(q) } }) },
  { id: 'blur', name: 'เบลอ', seconds: 0.6, pair: (q) => ({ a: { blur: 0.04 * Math.min(1, 2 * q), alpha: 1 - mid(q) }, b: { blur: 0.04 * Math.min(1, 2 - 2 * q), alpha: mid(q) } }) },
  { id: 'spin', name: 'หมุน', seconds: 0.6, pair: (q) => ({ a: { rot: 180 * e(q), scale: 1 - e(q), alpha: 1 - mid(q) }, b: { rot: -180 * (1 - e(q)), scale: e(q), alpha: mid(q) } }) },
  {
    id: 'glitch',
    name: 'กลิตช์',
    seconds: 0.4,
    pair: (q) => {
      const n = Math.floor(q * 12);
      const k = 1 - Math.abs(2 * q - 1);
      const strips = Array.from({ length: 8 }, (_, i) => noise(n * 8 + i) * 0.2 * k);
      return { a: { strips, alpha: q < 0.5 ? 1 : 0, hue: 60 * k }, b: { strips, alpha: q < 0.5 ? 0 : 1, hue: -60 * k } };
    },
  },
  { id: 'flash', name: 'แฟลช', seconds: 0.4, pair: (q) => ({ a: { flash: Math.min(1, 2 * q), alpha: q < 0.5 ? 1 : 0 }, b: { flash: Math.max(0, 2 - 2 * q), alpha: q < 0.5 ? 0 : 1 } }) },
  { id: 'wipe', name: 'กวาด', seconds: 0.5, pair: (q) => ({ a: {}, b: { reveal: q < 1 ? { kind: 'rect', x0: -0.5, y0: -0.5, x1: -0.5 + e(q), y1: 0.5 } : null } }) },
  { id: 'circle', name: 'วงกลม', seconds: 0.6, pair: (q) => ({ a: {}, b: { reveal: q < 1 ? { kind: 'circle', r: e(q) } : null } }) },
  { id: 'heart', name: 'หัวใจ', seconds: 0.7, pair: (q) => ({ a: {}, b: { reveal: q < 1 ? { kind: 'shape', shape: 'heart', r: e(q) } : null } }) },
  { id: 'star', name: 'ดาว', seconds: 0.7, pair: (q) => ({ a: {}, b: { reveal: q < 1 ? { kind: 'shape', shape: 'star', r: e(q), rot: 144 * (1 - q) } : null } }) },
  { id: 'clock', name: 'เข็มนาฬิกา', seconds: 0.6, pair: (q) => ({ a: {}, b: { reveal: q < 1 ? { kind: 'clock', deg: 360 * e(q) } : null } }) },
];

export const transitionById = (id: string) => TRANSITIONS.find((t) => t.id === id) ?? TRANSITIONS[0];

// Adds a transition pose on top of a clip's own pose.
export function mergePose(base: Pose, extra: Partial<Pose>): Pose {
  return {
    ...base,
    x: base.x + (extra.x ?? 0),
    y: base.y + (extra.y ?? 0),
    scale: base.scale * (extra.scale ?? 1),
    rot: base.rot + (extra.rot ?? 0),
    alpha: base.alpha * (extra.alpha ?? 1),
    blur: base.blur + (extra.blur ?? 0),
    hue: base.hue + (extra.hue ?? 0),
    flash: Math.max(base.flash, extra.flash ?? 0),
    reveal: extra.reveal !== undefined ? extra.reveal : base.reveal,
    strips: extra.strips ?? base.strips,
  };
}
