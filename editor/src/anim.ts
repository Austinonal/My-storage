import type { Anim, MediaClip, TextClip, Us } from './schema';
import type { GlyphFn } from './text';

// Shapes are in clip-box coordinates: the box spans -0.5..0.5 on both axes.
export type Reveal =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'circle'; r: number; cx?: number; cy?: number } // 1 = covers the box, centre in box fractions
  | { kind: 'clock'; deg: number } // sweeps clockwise from 12 o'clock around the centre
  | { kind: 'grid'; n: number; amount: number } // n x n cells growing from their centres
  | { kind: 'blinds'; n: number; amount: number; vertical: boolean }
  | { kind: 'wedge'; deg: number } // sweeps from the left around the bottom centre
  | { kind: 'diagonal'; amount: number };

export interface Copy {
  dx?: number; // canvas fractions
  dy?: number;
  scale?: number;
  sx?: number;
  alpha?: number;
  reveal?: Reveal;
}

export interface Pose {
  x: number; // canvas fractions
  y: number;
  scale: number;
  sx: number; // negative = mirrored
  sy: number;
  rot: number; // degrees
  skew: number; // degrees
  px: number; // pivot, box fractions, 0 = centre
  py: number;
  alpha: number;
  blur: number; // canvas-height fraction
  gray: number;
  bright: number;
  invert: number;
  hue: number; // degrees
  sat: number; // 1 = unchanged
  sepia: number;
  contrast: number; // 1 = unchanged
  flash: number; // white over the clip, 0..1
  pixel: number; // mosaic block, canvas-height fraction
  reveal: Reveal | null;
  copies: Copy[] | null; // replaces the single draw; drawn in order
  strips: number[] | null; // horizontal strips shifted by box-width fractions
}

export const REST: Pose = {
  x: 0, y: 0, scale: 1, sx: 1, sy: 1, rot: 0, skew: 0, px: 0, py: 0, alpha: 1,
  blur: 0, gray: 0, bright: 1, invert: 0, hue: 0, sat: 1, sepia: 0, contrast: 1, flash: 0, pixel: 0, reveal: null, copies: null, strips: null,
};

type Fn = (p: number) => Partial<Pose>;
export type Slot = 'in' | 'out' | 'combo';
export interface Preset {
  id: string;
  slot: Slot;
  name: string;
  seconds: number;
  pose: Fn;
  glyph?: GlyphFn; // per-letter motion, text only
}

const PI = Math.PI;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sin = Math.sin;
const cos = Math.cos;
// Deterministic noise in -1..1, so preview and export shake identically.
const noise = (n: number) => {
  const s = sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) ** 2,
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t ** 3,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outQuint: (t: number) => 1 - (1 - t) ** 5,
  inBack: (t: number) => 2.70158 * t ** 3 - 1.70158 * t * t,
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outElastic: (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * sin((t * 10 - 0.75) * ((2 * PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
const { outCubic, outBack } = ease;

type Dir = 'left' | 'right' | 'up' | 'down' | 'up-left' | 'up-right' | 'down-left' | 'down-right';
const DIR: Record<Dir, [number, number]> = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  'up-left': [-1, -1], 'up-right': [1, -1], 'down-left': [-1, 1], 'down-right': [1, 1],
};

// ---- entrances: p = 0 is the first frame, p = 1 is at rest ----

const fade: Fn = (p) => ({ alpha: p });
const zoomFrom = (s0: number, fadeIn = true, e = outCubic): Fn => (p) => ({ scale: lerp(s0, 1, e(p)), alpha: fadeIn ? clamp01(p * 2.5) : 1 });
const slideFrom = (d: Dir, dist = 1): Fn => (p) => {
  const k = 1 - outCubic(p);
  return { x: DIR[d][0] * dist * k, y: DIR[d][1] * dist * k };
};
const slideBlurFrom = (d: Dir): Fn => (p) => ({ ...slideFrom(d, 0.6)(p), blur: 0.03 * (1 - p), alpha: clamp01(p * 2) });
const swingFrom = (d: Dir): Fn => (p) => {
  const k = 1 - outBack(p);
  return { x: DIR[d][0] * 0.6 * k, y: DIR[d][1] * 0.6 * k, rot: (DIR[d][0] || DIR[d][1]) * 25 * k, alpha: clamp01(p * 3) };
};
const turnFrom = (px: number, py: number, deg: number): Fn => (p) => ({ px, py, rot: deg * (1 - outCubic(p)), alpha: clamp01(p * 2) });
const spinIn: Fn = (p) => ({ rot: -180 * (1 - outCubic(p)), scale: lerp(0.3, 1, outCubic(p)), alpha: clamp01(p * 2) });
const vortexIn: Fn = (p) => ({ rot: 540 * (1 - outCubic(p)), scale: outCubic(p), blur: 0.03 * (1 - p) });
const spinOpen: Fn = (p) => ({ rot: 90 * (1 - outCubic(p)), scale: outCubic(p) });
const uprightIn: Fn = (p) => ({ rot: 180 * (1 - outBack(p)), scale: lerp(0.6, 1, outCubic(p)), alpha: clamp01(p * 3) });
const shake = (ax: number, ay: number): Fn => (p) => ({ x: sin(p * PI * 8) * ax * (1 - p), y: sin(p * PI * 8) * ay * (1 - p), alpha: clamp01(p * 4) });
const tremble = (amp: number, seed: number): Fn => (p) => {
  const n = Math.floor(p * 20);
  return { x: noise(n + seed) * amp * (1 - p), y: noise(n + seed + 99) * amp * (1 - p) };
};
const shakeDrop: Fn = (p) => ({ y: -0.4 * (1 - outCubic(p)), x: sin(p * PI * 10) * 0.03 * (1 - p), alpha: clamp01(p * 3) });
const pendulumIn: Fn = (p) => ({ py: -0.5, rot: 35 * cos(p * PI * 2.5) * (1 - p), alpha: clamp01(p * 3) });
const wiperIn: Fn = (p) => ({ reveal: p < 1 ? { kind: 'wedge', deg: 180 * outCubic(p) } : null });
const mirrorFlip: Fn = (p) => ({ sx: cos((1 - outCubic(p)) * PI) });
const blindsIn = (vertical: boolean): Fn => (p) => ({ reveal: p < 1 ? { kind: 'blinds', n: 8, amount: outCubic(p), vertical } : null });
const blurIn: Fn = (p) => ({ blur: 0.05 * (1 - p), alpha: clamp01(p * 2) });
const grayIn: Fn = (p) => ({ gray: 1 - p, bright: lerp(0.5, 1, p) });
const tvOn: Fn = (p) => ({ sy: Math.max(0.005, outCubic(clamp01(p * 1.6))), flash: 1 - p });
const trailFrom = (d: Dir): Fn => (p) => {
  const k = 1 - outCubic(p);
  const [dx, dy] = DIR[d];
  return {
    x: dx * 0.5 * k,
    y: dy * 0.5 * k,
    copies: p < 1 ? [3, 2, 1, 0].map((i) => ({ dx: dx * i * 0.07 * k, dy: dy * i * 0.07 * k, alpha: i === 0 ? 1 : 0.3 / i })) : null,
  };
};
const stripsIn: Fn = (p) => ({ strips: p < 1 ? Array.from({ length: 8 }, (_, i) => (i % 2 ? 1 : -1) * (1 - outCubic(p))) : null });
const glitchIn: Fn = (p) => {
  const n = Math.floor(p * 12);
  return {
    strips: p < 1 ? Array.from({ length: 12 }, (_, i) => noise(i * 7 + n) * 0.15 * (1 - p)) : null,
    flash: p < 0.15 ? 0.5 : 0,
    x: noise(n + 5) * 0.02 * (1 - p),
  };
};
const pixelIn: Fn = (p) => ({ pixel: p < 1 ? 0.08 * (1 - ease.outQuad(p)) : 0 });
const flashIn: Fn = (p) => ({ flash: 1 - ease.outQuad(p) });
const jellyIn: Fn = (p) => {
  const w = sin(p * PI * 4) * 0.25 * (1 - p);
  return { sx: 1 + w, sy: 1 - w, alpha: clamp01(p * 4) };
};
const bounceDrop: Fn = (p) => ({ y: -1 * (1 - ease.outBounce(p)) });
const cardFlip: Fn = (p) => ({ sx: Math.max(0.001, sin((outCubic(p) * PI) / 2)), bright: lerp(0.5, 1, p) });
const curtainIn: Fn = (p) => {
  const e = outCubic(p);
  return { reveal: p < 1 ? { kind: 'rect', x0: -0.5 * e, y0: -0.5, x1: 0.5 * e, y1: 0.5 } : null };
};
const circleIn: Fn = (p) => ({ reveal: p < 1 ? { kind: 'circle', r: outCubic(p) } : null });
const diagonalIn: Fn = (p) => ({ reveal: p < 1 ? { kind: 'diagonal', amount: ease.inOutQuad(p) } : null });
const wipeFrom = (d: 'left' | 'up'): Fn => (p) => {
  const e = ease.inOutQuad(p);
  if (p >= 1) return {};
  return { reveal: d === 'left' ? { kind: 'rect', x0: -0.5, y0: -0.5, x1: -0.5 + e, y1: 0.5 } : { kind: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: -0.5 + e } };
};
const invertIn: Fn = (p) => ({ invert: 1 - clamp01(p * 1.5) });
const flyIn: Fn = (p) => ({ scale: lerp(3, 1, outCubic(p)), blur: 0.04 * (1 - p), alpha: clamp01(p * 2) });
const splitIn: Fn = (p) => {
  const k = 1 - outCubic(p);
  return { copies: p < 1 ? [{ dx: -0.35 * k, alpha: 0.6 }, { dx: 0.35 * k, alpha: 0.6 }, {}] : null };
};
const skewIn: Fn = (p) => ({ skew: 35 * (1 - outCubic(p)), x: 0.3 * (1 - outCubic(p)), alpha: clamp01(p * 2) });
const popIn: Fn = (p) => ({ scale: outBack(p) });
const riseIn: Fn = (p) => ({ y: 0.12 * (1 - outCubic(p)), alpha: p });
const elasticIn: Fn = (p) => ({ scale: ease.outElastic(p) });
const dropShakeX: Fn = (p) => ({ ...tremble(0.06, 7)(p), scale: lerp(1.2, 1, outCubic(p)) });

// ---- more entrances ----

const bounceFrom = (d: Dir): Fn => (p) => {
  const k = 1 - ease.outBounce(p);
  return { x: DIR[d][0] * k, y: DIR[d][1] * k };
};
const elasticFrom = (d: Dir): Fn => (p) => {
  const k = 1 - ease.outElastic(p);
  return { x: DIR[d][0] * 0.6 * k, y: DIR[d][1] * 0.6 * k, alpha: clamp01(p * 4) };
};
const overshootFrom = (d: Dir): Fn => (p) => {
  const k = 1 - outBack(p);
  return { x: DIR[d][0] * 0.7 * k, y: DIR[d][1] * 0.7 * k };
};
const flipXIn: Fn = (p) => ({ sy: cos((1 - outCubic(p)) * PI), bright: lerp(0.6, 1, p) });
const zoomSpinIn: Fn = (p) => ({ scale: outCubic(p), rot: 360 * (1 - outCubic(p)) });
const strobeIn: Fn = (p) => ({ alpha: p >= 1 ? 1 : Math.floor(p * 10) % 2 ? clamp01(p * 1.2) : 0.15 * p });
const heartbeatIn: Fn = (p) => ({ scale: 1 + 0.25 * Math.abs(sin(p * PI * 3)) * (1 - p), alpha: clamp01(p * 4) });
const steppedWipe: Fn = (p) => ({ reveal: p < 1 ? { kind: 'rect', x0: -0.5, y0: -0.5, x1: -0.5 + Math.ceil(p * 8) / 8, y1: 0.5 } : null });
const irisCorner: Fn = (p) => ({ reveal: p < 1 ? { kind: 'circle', r: outCubic(p), cx: -0.5, cy: -0.5 } : null });
const clockIn: Fn = (p) => ({ reveal: p < 1 ? { kind: 'clock', deg: 360 * ease.inOutQuad(p) } : null });
const barnDoor: Fn = (p) => {
  const e = outCubic(p);
  return { reveal: p < 1 ? { kind: 'rect', x0: -0.5, y0: -0.5 * e, x1: 0.5, y1: 0.5 * e } : null };
};
const boxIn: Fn = (p) => {
  const e = outCubic(p);
  return { reveal: p < 1 ? { kind: 'rect', x0: -0.5 * e, y0: -0.5 * e, x1: 0.5 * e, y1: 0.5 * e } : null };
};
const checkerIn: Fn = (p) => ({ reveal: p < 1 ? { kind: 'grid', n: 6, amount: outCubic(p) } : null });
const halvesIn: Fn = (p) => {
  const k = 1 - outCubic(p);
  return {
    copies: p < 1 ? [
      { dx: -k, reveal: { kind: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0 } },
      { dx: k, reveal: { kind: 'rect', x0: -0.5, y0: 0, x1: 0.5, y1: 0.5 } },
    ] : null,
  };
};
const quadIn: Fn = (p) => {
  const k = 1 - outCubic(p);
  return {
    copies: p < 1 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({
      dx: sx * 0.6 * k,
      dy: sy * 0.6 * k,
      reveal: { kind: 'rect' as const, x0: sx < 0 ? -0.5 : 0, y0: sy < 0 ? -0.5 : 0, x1: sx < 0 ? 0 : 0.5, y1: sy < 0 ? 0 : 0.5 },
    })) : null,
  };
};
const earthquakeIn: Fn = (p) => {
  const n = Math.floor(p * 30);
  return { x: noise(n) * 0.06 * (1 - p), y: noise(n + 40) * 0.06 * (1 - p), blur: 0.01 * (1 - p), alpha: clamp01(p * 3) };
};
const vertigoIn: Fn = (p) => ({ scale: lerp(1.4, 1, outCubic(p)), rot: 12 * (1 - outCubic(p)), blur: 0.02 * (1 - p), alpha: clamp01(p * 2) });
const fromBlack: Fn = (p) => ({ bright: p });
const overexpose: Fn = (p) => ({ bright: lerp(3, 1, outCubic(p)) });
const sepiaIn: Fn = (p) => ({ sepia: 1 - p, contrast: lerp(0.8, 1, p) });
const hueIn: Fn = (p) => ({ hue: 360 * (1 - outCubic(p)), sat: lerp(2, 1, p) });
const satIn: Fn = (p) => ({ sat: lerp(3, 1, outCubic(p)) });
const contrastIn: Fn = (p) => ({ contrast: lerp(3, 1, outCubic(p)) });
const zoomTrailIn: Fn = (p) => {
  const k = 1 - outCubic(p);
  return { scale: lerp(0.6, 1, outCubic(p)), copies: p < 1 ? [3, 2, 1, 0].map((i) => ({ scale: 1 + i * 0.12 * k, alpha: i ? 0.25 / i : 1 })) : null };
};
const dropSquash: Fn = (p) => {
  const sq = sin(clamp01((p - 0.6) / 0.4) * PI) * 0.25;
  return { y: -(1 - ease.inQuad(clamp01(p / 0.6))), py: 0.5, sx: 1 + sq, sy: 1 - sq };
};
const rubberIn: Fn = (p) => {
  const w = sin(p * PI * 3) * 0.3 * (1 - p);
  return { sx: 1 + w, sy: 1 - w, scale: lerp(0.5, 1, outCubic(p)) };
};
const tadaIn: Fn = (p) => ({ scale: lerp(0.8, 1, outCubic(p)) + 0.05 * sin(p * PI * 6) * (1 - p), rot: 4 * sin(p * PI * 8) * (1 - p), alpha: clamp01(p * 3) });
const lightSpeed: Fn = (p) => ({ x: 1 - outCubic(p), skew: -30 * (1 - outCubic(p)), alpha: clamp01(p * 2) });
const skewFromLeft: Fn = (p) => ({ skew: -35 * (1 - outCubic(p)), x: -0.3 * (1 - outCubic(p)), alpha: clamp01(p * 2) });
const sinkOut: Fn = (p) => {
  const sq = 0.2 * sin(clamp01(p * 2) * PI);
  return { y: 1.2 * ease.inBack(p), sx: 1 + sq, sy: 1 - sq };
};

type Entry = [id: string, name: string, seconds: number, fn: Fn];

const IN: Entry[] = [
  ['fade', 'ค่อยๆ ชัด', 0.5, fade],
  ['zoom-in', 'ขยายเข้า', 0.5, zoomFrom(0.5)],
  ['zoom-out', 'ย่อเข้า', 0.5, zoomFrom(1.6)],
  ['punch', 'ซูมกระแทก', 0.5, zoomFrom(1.35, false, ease.outQuint)],
  ['slight-zoom', 'ซูมเบาๆ', 0.5, zoomFrom(1.08, false)],
  ['pop', 'เด้งออกมา', 0.5, popIn],
  ['elastic', 'สปริง', 0.8, elasticIn],
  ['slide-left', 'สไลด์จากขวา', 0.5, slideFrom('right')],
  ['slide-right', 'สไลด์จากซ้าย', 0.5, slideFrom('left')],
  ['slide-up', 'สไลด์จากล่าง', 0.5, slideFrom('down')],
  ['slide-down', 'สไลด์จากบน', 0.5, slideFrom('up')],
  ['blur-slide-left', 'สไลด์เบลอจากขวา', 0.5, slideBlurFrom('right')],
  ['blur-slide-right', 'สไลด์เบลอจากซ้าย', 0.5, slideBlurFrom('left')],
  ['swing-down', 'เหวี่ยงลงมา', 0.5, swingFrom('up')],
  ['swing-right', 'เหวี่ยงจากซ้าย', 0.5, swingFrom('left')],
  ['swing-left', 'เหวี่ยงจากขวา', 0.5, swingFrom('right')],
  ['swing-up-right', 'เหวี่ยงจากล่างซ้าย', 0.5, swingFrom('down-left')],
  ['swing-up-left', 'เหวี่ยงจากล่างขวา', 0.5, swingFrom('down-right')],
  ['swing-down-right', 'เหวี่ยงจากบนซ้าย', 0.5, swingFrom('up-left')],
  ['swing-down-left', 'เหวี่ยงจากบนขวา', 0.5, swingFrom('up-right')],
  ['turn-left', 'พลิกเข้าจากซ้าย', 0.5, turnFrom(-0.5, 0.5, -90)],
  ['turn-right', 'พลิกเข้าจากขวา', 0.5, turnFrom(0.5, 0.5, 90)],
  ['turn-up', 'พลิกขึ้น', 0.5, turnFrom(-0.5, 0.5, 90)],
  ['turn-down', 'พลิกลง', 0.5, turnFrom(-0.5, -0.5, -90)],
  ['spin', 'หมุนเข้า', 0.5, spinIn],
  ['vortex', 'หมุนวน', 0.5, vortexIn],
  ['spin-open', 'หมุนเปิด', 1, spinOpen],
  ['upright', 'กลับหัวตั้งตรง', 1.3, uprightIn],
  ['shake-v', 'สั่นขึ้นลง', 0.5, shake(0, 0.06)],
  ['shake-h', 'สั่นซ้ายขวา', 0.5, shake(0.06, 0)],
  ['tremble', 'สั่นเบาๆ', 0.5, tremble(0.02, 1)],
  ['tremble-2', 'สั่นเบาๆ 2', 0.5, tremble(0.035, 2)],
  ['shake-zoom', 'สั่นแล้วซูม', 0.8, dropShakeX],
  ['shake-drop', 'สั่นตกลงมา', 0.5, shakeDrop],
  ['pendulum', 'ลูกตุ้ม', 0.5, pendulumIn],
  ['wiper', 'ปัดน้ำฝน', 0.5, wiperIn],
  ['mirror', 'พลิกกระจก', 0.5, mirrorFlip],
  ['blinds', 'มู่ลี่', 0.5, blindsIn(false)],
  ['blinds-v', 'มู่ลี่แนวตั้ง', 0.5, blindsIn(true)],
  ['blur', 'เบลอจนชัด', 1, blurIn],
  ['gray', 'จากขาวดำ', 1, grayIn],
  ['tv-on', 'เปิดทีวี', 1, tvOn],
  ['trail', 'ลากแสง', 1, trailFrom('right')],
  ['strips', 'แถบสลับ', 0.5, stripsIn],
  ['glitch', 'กลิตช์', 1, glitchIn],
  ['pixel', 'โมเสก', 1, pixelIn],
  ['flash', 'แฟลชขาว', 0.5, flashIn],
  ['jelly', 'เยลลี่', 0.8, jellyIn],
  ['bounce-drop', 'ตกเด้ง', 1, bounceDrop],
  ['card-flip', 'พลิกการ์ด', 1, cardFlip],
  ['curtain', 'เปิดม่าน', 1, curtainIn],
  ['circle', 'วงกลมเปิด', 1, circleIn],
  ['diagonal', 'ปาดเฉียง', 1, diagonalIn],
  ['wipe-right', 'กวาดจากซ้าย', 0.6, wipeFrom('left')],
  ['wipe-down', 'กวาดจากบน', 0.6, wipeFrom('up')],
  ['negative', 'เนกาทีฟ', 0.5, invertIn],
  ['fly-in', 'พุ่งเข้าหา', 1, flyIn],
  ['split', 'รวมร่าง', 0.8, splitIn],
  ['skew', 'เฉียงเข้า', 0.5, skewIn],
  ['rise', 'ลอยขึ้นมา', 0.5, riseIn],
  ['bounce-left', 'เด้งเข้าจากขวา', 1, bounceFrom('right')],
  ['bounce-right', 'เด้งเข้าจากซ้าย', 1, bounceFrom('left')],
  ['bounce-up', 'เด้งขึ้นจากล่าง', 1, bounceFrom('down')],
  ['elastic-left', 'สปริงจากขวา', 1, elasticFrom('right')],
  ['elastic-right', 'สปริงจากซ้าย', 1, elasticFrom('left')],
  ['elastic-up', 'สปริงจากล่าง', 1, elasticFrom('down')],
  ['overshoot-up', 'พุ่งเกินจากล่าง', 0.6, overshootFrom('down')],
  ['overshoot-down', 'พุ่งเกินจากบน', 0.6, overshootFrom('up')],
  ['overshoot-left', 'พุ่งเกินจากขวา', 0.6, overshootFrom('right')],
  ['overshoot-right', 'พุ่งเกินจากซ้าย', 0.6, overshootFrom('left')],
  ['corner-tl', 'สไลด์จากมุมซ้ายบน', 0.6, slideFrom('up-left')],
  ['corner-tr', 'สไลด์จากมุมขวาบน', 0.6, slideFrom('up-right')],
  ['corner-bl', 'สไลด์จากมุมซ้ายล่าง', 0.6, slideFrom('down-left')],
  ['corner-br', 'สไลด์จากมุมขวาล่าง', 0.6, slideFrom('down-right')],
  ['flip-x', 'ตีลังกาเข้า', 0.6, flipXIn],
  ['zoom-spin', 'ซูมหมุนเข้า', 0.8, zoomSpinIn],
  ['strobe', 'กะพริบเข้า', 0.8, strobeIn],
  ['heartbeat', 'หัวใจเต้นเข้า', 1, heartbeatIn],
  ['stepped-wipe', 'กวาดเป็นจังหวะ', 0.8, steppedWipe],
  ['iris-corner', 'วงกลมจากมุม', 1, irisCorner],
  ['clock', 'หมุนเข็มนาฬิกา', 1, clockIn],
  ['barn-door', 'เปิดประตูบนล่าง', 0.8, barnDoor],
  ['box', 'กล่องขยาย', 0.8, boxIn],
  ['checker', 'ตารางผุด', 1, checkerIn],
  ['halves', 'สองซีกประกบ', 0.8, halvesIn],
  ['quad', 'สี่มุมประกบ', 1, quadIn],
  ['earthquake', 'แผ่นดินไหว', 1, earthquakeIn],
  ['vertigo', 'เวียนหัว', 1, vertigoIn],
  ['from-black', 'จากความมืด', 0.8, fromBlack],
  ['overexpose', 'สว่างจ้า', 0.8, overexpose],
  ['sepia', 'จากภาพเก่า', 1, sepiaIn],
  ['hue', 'สีรุ้งหมุน', 1, hueIn],
  ['saturate', 'สีสดพุ่ง', 0.8, satIn],
  ['contrast', 'คอนทราสต์จัด', 0.8, contrastIn],
  ['zoom-trail', 'ซูมทิ้งเงา', 0.8, zoomTrailIn],
  ['drop-squash', 'ตกแล้วยุบ', 1, dropSquash],
  ['rubber', 'ยางยืด', 1, rubberIn],
  ['tada', 'ตาด้า', 1, tadaIn],
  ['light-speed', 'ความเร็วแสง', 0.6, lightSpeed],
  ['skew-left', 'เฉียงจากซ้าย', 0.5, skewFromLeft],
];

// ---- exits: an entrance played backwards; p = 0 at rest, p = 1 gone ----

const back = (fn: Fn): Fn => (p) => fn(1 - p);
const fallOut: Fn = (p) => ({ y: 1.2 * ease.inBack(p), rot: 10 * p });
const tvOff: Fn = (p) => ({ sy: Math.max(0.005, 1 - outCubic(clamp01(p * 1.4))), sx: p > 0.7 ? lerp(1, 0.01, (p - 0.7) / 0.3) : 1, flash: p });
const flyAway: Fn = (p) => ({ scale: lerp(1, 3, ease.inCubic(p)), blur: 0.04 * p, alpha: 1 - clamp01((p - 0.4) / 0.6) });

const OUT: Entry[] = [
  ['fade', 'ค่อยๆ จาง', 0.5, back(fade)],
  ['zoom-in', 'ขยายหาย', 0.5, back(zoomFrom(1.6))],
  ['zoom-out', 'ย่อหาย', 0.5, back(zoomFrom(0.5))],
  ['punch', 'ซูมกระแทกออก', 0.5, back(zoomFrom(1.35, false, ease.outQuint))],
  ['slight-zoom', 'ซูมเบาๆ ออก', 0.5, back(zoomFrom(1.08, false))],
  ['pop', 'ยุบหาย', 0.5, back(popIn)],
  ['slide-left', 'สไลด์ออกซ้าย', 0.5, back(slideFrom('left'))],
  ['slide-right', 'สไลด์ออกขวา', 0.5, back(slideFrom('right'))],
  ['slide-up', 'สไลด์ออกบน', 0.5, back(slideFrom('up'))],
  ['slide-down', 'สไลด์ออกล่าง', 0.5, back(slideFrom('down'))],
  ['blur-slide-left', 'สไลด์เบลอออกซ้าย', 0.5, back(slideBlurFrom('left'))],
  ['blur-slide-right', 'สไลด์เบลอออกขวา', 0.5, back(slideBlurFrom('right'))],
  ['swing-up', 'เหวี่ยงขึ้นไป', 0.5, back(swingFrom('up'))],
  ['swing-left', 'เหวี่ยงออกซ้าย', 0.5, back(swingFrom('left'))],
  ['swing-right', 'เหวี่ยงออกขวา', 0.5, back(swingFrom('right'))],
  ['swing-down', 'เหวี่ยงลงไป', 0.5, back(swingFrom('down'))],
  ['turn-left', 'พลิกออกซ้าย', 0.5, back(turnFrom(-0.5, 0.5, -90))],
  ['turn-right', 'พลิกออกขวา', 0.5, back(turnFrom(0.5, 0.5, 90))],
  ['turn-up', 'พลิกขึ้นไป', 0.5, back(turnFrom(-0.5, -0.5, -90))],
  ['turn-down', 'พลิกลงไป', 0.5, back(turnFrom(-0.5, 0.5, 90))],
  ['spin', 'หมุนออก', 0.5, back(spinIn)],
  ['vortex', 'หมุนวนหาย', 0.5, back(vortexIn)],
  ['spin-close', 'หมุนปิด', 1, back(spinOpen)],
  ['shake-v', 'สั่นขึ้นลงหาย', 0.5, back(shake(0, 0.06))],
  ['shake-h', 'สั่นซ้ายขวาหาย', 0.5, back(shake(0.06, 0))],
  ['tremble', 'สั่นเบาๆ หาย', 0.5, back(tremble(0.02, 3))],
  ['pendulum', 'ลูกตุ้มหาย', 0.5, back(pendulumIn)],
  ['wiper', 'ปัดน้ำฝนปิด', 0.5, back(wiperIn)],
  ['mirror', 'พลิกกระจกออก', 0.5, back(mirrorFlip)],
  ['blinds', 'มู่ลี่ปิด', 0.5, back(blindsIn(false))],
  ['blinds-v', 'มู่ลี่แนวตั้งปิด', 0.5, back(blindsIn(true))],
  ['blur', 'ค่อยๆ เบลอหาย', 1, back(blurIn)],
  ['gray', 'จางเป็นขาวดำ', 1, back(grayIn)],
  ['tv-off', 'ปิดทีวี', 0.8, tvOff],
  ['trail', 'ลากแสงออก', 1, back(trailFrom('left'))],
  ['strips', 'แถบสลับหาย', 0.5, back(stripsIn)],
  ['glitch', 'กลิตช์หาย', 1, back(glitchIn)],
  ['pixel', 'โมเสกหาย', 1, back(pixelIn)],
  ['flash', 'แฟลชขาวหาย', 0.5, back(flashIn)],
  ['jelly', 'เยลลี่หาย', 0.8, back(jellyIn)],
  ['fall', 'ร่วงลง', 0.8, fallOut],
  ['card-flip', 'พลิกการ์ดออก', 1, back(cardFlip)],
  ['curtain', 'ปิดม่าน', 1, back(curtainIn)],
  ['circle', 'วงกลมปิด', 1, back(circleIn)],
  ['diagonal', 'ปาดเฉียงหาย', 1, back(diagonalIn)],
  ['wipe-left', 'กวาดไปซ้าย', 0.6, back(wipeFrom('left'))],
  ['wipe-up', 'กวาดขึ้นบน', 0.6, back(wipeFrom('up'))],
  ['negative', 'เนกาทีฟหาย', 0.5, back(invertIn)],
  ['fly-away', 'พุ่งทะลุจอ', 1, flyAway],
  ['split', 'แยกร่างหาย', 0.8, back(splitIn)],
  ['skew', 'เฉียงออก', 0.5, back(skewIn)],
  ['elastic-left', 'สปริงออกซ้าย', 1, back(elasticFrom('left'))],
  ['elastic-right', 'สปริงออกขวา', 1, back(elasticFrom('right'))],
  ['overshoot-up', 'ถอยแล้วพุ่งขึ้น', 0.6, back(overshootFrom('up'))],
  ['overshoot-down', 'ถอยแล้วพุ่งลง', 0.6, back(overshootFrom('down'))],
  ['overshoot-left', 'ถอยแล้วพุ่งซ้าย', 0.6, back(overshootFrom('left'))],
  ['overshoot-right', 'ถอยแล้วพุ่งขวา', 0.6, back(overshootFrom('right'))],
  ['corner-tl', 'สไลด์ออกมุมซ้ายบน', 0.6, back(slideFrom('up-left'))],
  ['corner-tr', 'สไลด์ออกมุมขวาบน', 0.6, back(slideFrom('up-right'))],
  ['corner-bl', 'สไลด์ออกมุมซ้ายล่าง', 0.6, back(slideFrom('down-left'))],
  ['corner-br', 'สไลด์ออกมุมขวาล่าง', 0.6, back(slideFrom('down-right'))],
  ['flip-x', 'ตีลังกาออก', 0.6, back(flipXIn)],
  ['zoom-spin', 'ซูมหมุนหาย', 0.8, back(zoomSpinIn)],
  ['strobe', 'กะพริบหาย', 0.8, back(strobeIn)],
  ['heartbeat', 'หัวใจเต้นหาย', 1, back(heartbeatIn)],
  ['stepped-wipe', 'กวาดหายเป็นจังหวะ', 0.8, back(steppedWipe)],
  ['iris-corner', 'วงกลมหดเข้ามุม', 1, back(irisCorner)],
  ['clock', 'เข็มนาฬิกาปิด', 1, back(clockIn)],
  ['barn-door', 'ปิดประตูบนล่าง', 0.8, back(barnDoor)],
  ['box', 'กล่องหด', 0.8, back(boxIn)],
  ['checker', 'ตารางหาย', 1, back(checkerIn)],
  ['halves', 'สองซีกแยก', 0.8, back(halvesIn)],
  ['quad', 'สี่มุมแตก', 1, back(quadIn)],
  ['earthquake', 'แผ่นดินไหวหาย', 1, back(earthquakeIn)],
  ['vertigo', 'เวียนหัวหาย', 1, back(vertigoIn)],
  ['to-black', 'มืดลง', 0.8, back(fromBlack)],
  ['overexpose', 'สว่างจ้าหาย', 0.8, back(overexpose)],
  ['sepia', 'กลายเป็นภาพเก่า', 1, back(sepiaIn)],
  ['hue', 'สีรุ้งหมุนหาย', 1, back(hueIn)],
  ['saturate', 'สีสดจัดหาย', 0.8, back(satIn)],
  ['contrast', 'คอนทราสต์จัดหาย', 0.8, back(contrastIn)],
  ['zoom-trail', 'ซูมทิ้งเงาหาย', 0.8, back(zoomTrailIn)],
  ['sink', 'จมลง', 0.8, sinkOut],
  ['rubber', 'ยางยืดหาย', 1, back(rubberIn)],
  ['light-speed', 'ความเร็วแสงออก', 0.6, back(lightSpeed)],
  ['skew-left', 'เฉียงออกซ้าย', 0.5, back(skewFromLeft)],
];

// ---- combos: one motion across the clip, p = 0..1 over its duration ----

// Enter during the first `part`, rest in the middle (or `mid`), leave during the last `part`.
const inOut = (enter: Fn, leave: Fn, part = 0.3, mid?: Fn): Fn => (p) => {
  if (p < part) return enter(p / part);
  if (p > 1 - part) return leave((p - (1 - part)) / part);
  return mid ? mid((p - part) / (1 - 2 * part)) : {};
};
const edges = (p: number, part = 0.15) => clamp01(Math.min(p, 1 - p) / part);
const trainFrom = (d: Dir, bob: boolean): Fn => (p) => {
  const [dx, dy] = DIR[d];
  const t = lerp(-1.3, 1.3, p);
  return {
    x: -dx * t,
    y: -dy * t + (bob ? sin(p * PI * 8) * 0.03 : 0),
    copies: [2, 1, 0].map((i) => ({ dx: dx * i * 0.42, dy: dy * i * 0.42, scale: 1 - i * 0.12 })),
  };
};
const pirate = (amp: number, cycles: number): Fn => (p) => ({ py: 1.6, rot: amp * sin(p * PI * 2 * cycles), alpha: edges(p) });
const orbit = (dir: 1 | -1): Fn => (p) => ({ scale: 0.6, x: 0.25 * sin(dir * p * PI * 2), y: -0.25 * cos(p * PI * 2) + 0.25, alpha: edges(p) });
const coaster = (dir: 1 | -1): Fn => (p) => ({ x: dir * lerp(-1.1, 1.1, p), y: 0.22 * sin(p * PI * 3), rot: dir * 25 * cos(p * PI * 3) });
const halves = (vertical: boolean): Fn => (p) => {
  const k = 0.3 * sin(p * PI);
  const a: Reveal = vertical ? { kind: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0 } : { kind: 'rect', x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 };
  const b: Reveal = vertical ? { kind: 'rect', x0: -0.5, y0: 0, x1: 0.5, y1: 0.5 } : { kind: 'rect', x0: 0, y0: -0.5, x1: 0.5, y1: 0.5 };
  return { copies: [vertical ? { dy: -k, reveal: a } : { dx: -k, reveal: a }, vertical ? { dy: k, reveal: b } : { dx: k, reveal: b }] };
};
const thirds: Fn = (p) => ({
  copies: [-1, 0, 1].map((i) => {
    const t = clamp01(p * 3 - (i + 1) * 0.4);
    const off = (1 - outCubic(t)) * (i % 2 ? -1 : 1) + (p > 0.75 ? outCubic((p - 0.75) / 0.25) * (i % 2 ? 1 : -1) : 0);
    return { dy: off, reveal: { kind: 'rect' as const, x0: i / 3 - 1 / 6, y0: -0.5, x1: i / 3 + 1 / 6, y1: 0.5 } };
  }),
});
const grid4: Fn = (p) => ({
  copies: [0, 1, 2, 3].map((i) => ({
    dx: (i % 2 ? 0.25 : -0.25),
    dy: (i < 2 ? -0.25 : 0.25),
    scale: 0.5,
    sx: cos(clamp01(p * 1.5 - i * 0.12) * PI * 2),
  })),
});
const clones = (vertical: boolean): Fn => (p) => {
  const k = 0.18 * sin(p * PI);
  return { copies: [vertical ? { dy: -k, alpha: 0.45 } : { dx: -k, alpha: 0.45 }, vertical ? { dy: k, alpha: 0.45 } : { dx: k, alpha: 0.45 }, {}] };
};
const stack: Fn = (p) => ({ copies: [3, 2, 1, 0].map((i) => ({ dy: -i * 0.05 * sin(p * PI), scale: 1 - i * 0.08 * sin(p * PI), alpha: i ? 0.5 : 1 })) });
const sandwich: Fn = (p) => {
  const s = lerp(1, 1 / 3, sin(p * PI));
  return { copies: [-1, 0, 1].map((i) => ({ dy: i * s, scale: s })) };
};
const cube: Fn = (p) => {
  const t = ease.inOutCubic(p) * (PI / 2);
  return { copies: [{ sx: Math.max(0.001, cos(t)), dx: -0.5 * (1 - cos(t)) }, { sx: Math.max(0.001, sin(t)), dx: 0.5 * cos(t) }] };
};

// 0 -> 1 -> 0 over each whole unit of p
const tri = (p: number) => 1 - Math.abs((((p % 1) + 1) % 1) * 2 - 1);

const COMBO: Entry[] = [
  ['zoom-in-out', 'ซูมเข้า-ออก', 2, inOut(zoomFrom(0.5), back(zoomFrom(0.5)))],
  ['spin-in-out', 'หมุนเข้า-ออก', 2, inOut(spinIn, back(spinIn))],
  ['bounce-spin', 'เด้งหมุน', 2, inOut((p) => ({ scale: outBack(p), rot: 360 * (1 - p) }), back(zoomFrom(0.3)))],
  ['spin-rise', 'หมุนลอยขึ้น', 2, (p) => ({ y: lerp(0.4, -0.4, p), rot: lerp(-30, 30, p), alpha: edges(p) })],
  ['spin-fall', 'หมุนร่วง', 2, (p) => ({ y: lerp(-0.4, 0.4, p), rot: lerp(30, -30, p), alpha: edges(p) })],
  ['drop-right', 'ตกแล้วไปขวา', 2, inOut(bounceDrop, back(slideFrom('right')), 0.4)],
  ['drop-left', 'ตกแล้วไปซ้าย', 2, inOut(bounceDrop, back(slideFrom('left')), 0.4)],
  ['shrink-right', 'ย่อไปขวา', 2, inOut(zoomFrom(1.4), (p) => ({ scale: lerp(1, 0.2, outCubic(p)), x: 0.5 * outCubic(p), alpha: 1 - p }))],
  ['shrink-left', 'ย่อไปซ้าย', 2, inOut(zoomFrom(1.4), (p) => ({ scale: lerp(1, 0.2, outCubic(p)), x: -0.5 * outCubic(p), alpha: 1 - p }))],
  ['funhouse', 'กระจกบิดเบี้ยว', 2, (p) => ({ sx: 1 + 0.3 * sin(p * PI * 4), sy: 1 - 0.3 * sin(p * PI * 4) })],
  ['funhouse-2', 'กระจกบิดเบี้ยว 2', 2, (p) => ({ skew: 20 * sin(p * PI * 4), sy: 1 + 0.15 * sin(p * PI * 2) })],
  ['grid-flip', 'สี่ช่องพลิก', 2, grid4],
  ['elastic', 'ยืดหดเด้ง', 2, (p) => ({ sy: 1 + 0.35 * sin(p * PI * 6) * (1 - p), sx: 1 - 0.2 * sin(p * PI * 6) * (1 - p), scale: outBack(clamp01(p * 4)) })],
  ['train', 'รถไฟ', 3, trainFrom('right', false)],
  ['train-2', 'รถไฟ 2', 3, trainFrom('left', false)],
  ['train-3', 'รถไฟเด้ง', 3, trainFrom('right', true)],
  ['train-4', 'รถไฟแนวตั้ง', 3, trainFrom('down', false)],
  ['top', 'ลูกข่าง', 2, (p) => ({ rot: 720 * p, x: 0.08 * sin(p * PI * 6), scale: 0.75, alpha: edges(p) })],
  ['top-2', 'ลูกข่าง 2', 2, (p) => ({ rot: -720 * p, y: 0.06 * sin(p * PI * 6), scale: 0.75, alpha: edges(p) })],
  ['lens-left', 'ดึงเลนส์ซ้าย', 2, (p) => ({ scale: 1 + 0.4 * sin(p * PI), x: -0.15 * sin(p * PI) })],
  ['lens-right', 'ดึงเลนส์ขวา', 2, (p) => ({ scale: 1 + 0.4 * sin(p * PI), x: 0.15 * sin(p * PI) })],
  ['bounce-in-spin', 'เด้งเข้าหมุน', 2, inOut(popIn, back(spinIn), 0.35)],
  ['deform', 'บีบหด', 2, (p) => ({ sx: lerp(1, 0.7, sin(p * PI)), sy: lerp(1, 1.25, sin(p * PI)), scale: p > 0.8 ? 1 - outCubic((p - 0.8) / 0.2) : 1 })],
  ['deform-left', 'บีบหดไปซ้าย', 2, (p) => ({ sx: lerp(1, 0.7, sin(p * PI)), x: -0.4 * ease.inCubic(p), scale: 1 - 0.7 * ease.inCubic(p) })],
  ['deform-right', 'บีบหดไปขวา', 2, (p) => ({ sx: lerp(1, 0.7, sin(p * PI)), x: 0.4 * ease.inCubic(p), scale: 1 - 0.7 * ease.inCubic(p) })],
  ['yoyo', 'โยโย่', 2, (p) => ({ y: -0.35 * Math.abs(sin(p * PI * 2)), sy: 1 - 0.15 * (1 - Math.abs(sin(p * PI * 2))) })],
  ['yoyo-2', 'โยโย่ 2', 2, (p) => ({ y: 0.35 * Math.abs(sin(p * PI * 3)), scale: 0.85 })],
  ['twist', 'บิดยืด', 2, (p) => ({ skew: 25 * sin(p * PI * 2), sy: 1 + 0.2 * sin(p * PI * 4) })],
  ['shake-then-zoom', 'สั่นแล้วซูม', 2, (p) => (p < 0.4 ? shake(0.04, 0.02)(p / 0.4) : { scale: lerp(1, 1.3, outCubic((p - 0.4) / 0.6)) })],
  ['zoom-bounce', 'ซูมเด้ง', 2, (p) => ({ scale: 1 + 0.3 * Math.abs(sin(p * PI * 3)) * Math.exp(-2 * p) })],
  ['tilt', 'หมุนเอียง', 2, (p) => ({ rot: 45 * sin(p * PI), skew: 15 * sin(p * PI) })],
  ['spin-wobble', 'หมุนเข้าแล้วโยก', 2, inOut(spinIn, back(fade), 0.3, (p) => ({ rot: 10 * sin(p * PI * 6) * (1 - p) }))],
  ['spin-out-fade', 'หมุนออกจาง', 2, (p) => (p < 0.6 ? {} : { rot: 360 * ((p - 0.6) / 0.4), alpha: 1 - (p - 0.6) / 0.4, scale: lerp(1, 0.5, (p - 0.6) / 0.4) })],
  ['spin-suck', 'หมุนดูดกลับ', 2, (p) => ({ scale: 1 - 0.6 * sin(p * PI), rot: 360 * p })],
  ['wobble-spin-out', 'โยกแล้วหมุนออก', 2, (p) => (p < 0.6 ? { rot: 12 * sin((p / 0.6) * PI * 4) } : back(spinIn)((p - 0.6) / 0.4))],
  ['wave-out', 'พลิ้วแล้วสไลด์ออก', 2, inOut(fade, back(slideFrom('right')), 0.25, (p) => ({ y: 0.05 * sin(p * PI * 4) }))],
  ['pirate', 'เรือไวกิ้ง', 2, pirate(30, 1.5)],
  ['pirate-2', 'เรือไวกิ้ง 2', 2, pirate(18, 3)],
  ['slide-wave', 'สไลด์เข้าแล้วพลิ้ว', 2, inOut(slideFrom('left'), back(fade), 0.3, (p) => ({ y: 0.05 * sin(p * PI * 4) }))],
  ['slope', 'สไลเดอร์', 2, (p) => ({ x: lerp(-0.9, 0.9, ease.inOutCubic(p)), y: lerp(-0.9, 0.9, ease.inOutCubic(p)), rot: 10 })],
  ['slope-2', 'สไลเดอร์ 2', 2, (p) => ({ x: lerp(0.9, -0.9, ease.inOutCubic(p)), y: lerp(-0.9, 0.9, ease.inOutCubic(p)), rot: -10 })],
  ['blinds', 'มู่ลี่เปิด-ปิด', 2, (p) => ({ reveal: { kind: 'blinds', n: 8, amount: clamp01(sin(p * PI) * 1.3), vertical: false } })],
  ['orbit', 'วนเป็นวง', 2, orbit(1)],
  ['orbit-2', 'วนเป็นวง 2', 2, orbit(-1)],
  ['shrink-bounce', 'หดแล้วเด้ง', 2, (p) => ({ scale: p < 0.4 ? lerp(1, 0.6, outCubic(p / 0.4)) : lerp(0.6, 1, ease.outElastic((p - 0.4) / 0.6)) })],
  ['shrink-spin', 'หดหมุน', 2, (p) => ({ scale: lerp(1, 0.4, ease.inOutQuad(p)), rot: 180 * p, alpha: edges(p, 0.1) })],
  ['pulse', 'ซูมพองยุบ', 2, (p) => ({ scale: 1 + 0.25 * sin(p * PI) })],
  ['pulse-2', 'ซูมยุบพอง', 2, (p) => ({ scale: 1 - 0.2 * sin(p * PI) })],
  ['flip', 'พลิกหน้า', 2, (p) => ({ sx: cos(p * PI * 2) })],
  ['flip-2', 'พลิกตีลังกา', 2, (p) => ({ sy: cos(p * PI * 2) })],
  ['swing', 'ชิงช้า', 2, (p) => ({ py: -1.2, rot: 25 * sin(p * PI * 4) })],
  ['swing-2', 'ชิงช้า 2', 2, (p) => ({ py: -1.2, rot: 15 * sin(p * PI * 6) * (1 - p * 0.5) })],
  ['spin-around', 'หมุนรอบตัว', 2, (p) => ({ rot: 360 * ease.inOutCubic(p) })],
  ['spin-around-2', 'หมุนรอบตัว 2', 2, (p) => ({ rot: -360 * ease.inOutCubic(p), scale: 1 - 0.2 * sin(p * PI) })],
  ['coaster', 'รถไฟเหาะ', 3, coaster(1)],
  ['coaster-2', 'รถไฟเหาะ 2', 3, coaster(-1)],
  ['fall-spin', 'ตกหมุน', 2, inOut((p) => ({ y: -0.8 * (1 - outCubic(p)), rot: 180 * (1 - outCubic(p)) }), back(fade), 0.4)],
  ['clones', 'แยกร่าง', 2, clones(false)],
  ['clones-v', 'แยกร่างแนวตั้ง', 2, clones(true)],
  ['stack', 'ซ้อนชั้น', 2, stack],
  ['candy', 'ป็อปปิ้ง', 2, (p) => {
    const n = Math.floor(p * 12);
    return { x: noise(n) * 0.08, y: noise(n + 50) * 0.08, scale: 1 + 0.08 * noise(n + 9) };
  }],
  ['fall', 'ร่วงหล่น', 2, (p) => (p < 0.5 ? {} : { y: 1.3 * ease.inQuad((p - 0.5) / 0.5), rot: 20 * ((p - 0.5) / 0.5) })],
  ['sandwich', 'แซนด์วิช', 2, sandwich],
  ['rush', 'พุ่งชนจอ', 2, (p) => {
    const k = Math.exp(-(((p - 0.5) / 0.08) ** 2));
    return { scale: 1 + 0.6 * k, flash: 0.6 * k };
  }],
  ['cube', 'ลูกบาศก์', 2, cube],
  ['wine', 'แกว่งแก้วไวน์', 2, (p) => ({ rot: 8 * sin(p * PI * 4), x: 0.05 * sin(p * PI * 2), y: 0.03 * cos(p * PI * 4) })],
  ['flash-zoom', 'แฟลชซูม', 2, (p) => ({ scale: 1 + 0.2 * outCubic(p), flash: Math.max(0, 1 - p * 4) })],
  ['thirds', 'แยกสามส่วน', 2, thirds],
  ['halves', 'แยกกลางจอ', 2, halves(false)],
  ['halves-v', 'แยกบนล่าง', 2, halves(true)],
  ['heartbeat', 'หัวใจเต้น', 2, (p) => {
    const b = (p * 4) % 1;
    return { scale: 1 + 0.12 * Math.exp(-(((b - 0.15) / 0.07) ** 2)) + 0.08 * Math.exp(-(((b - 0.45) / 0.07) ** 2)) };
  }],
  ['breathe', 'หายใจ', 3, (p) => ({ scale: 1 + 0.06 * sin(p * PI * 2) ** 2 })],
  ['float', 'ลอยตัว', 3, (p) => ({ y: 0.03 * sin(p * PI * 4), rot: 1.5 * sin(p * PI * 2) })],
  ['strobe', 'แสงกะพริบ', 2, (p) => ({ alpha: Math.floor(p * 16) % 2 ? 0.35 : 1 })],
  ['hue-cycle', 'สีรุ้งวน', 3, (p) => ({ hue: 360 * p, sat: 1.4 })],
  ['sepia-flash', 'ภาพเก่าแวบ', 2, (p) => ({ sepia: Math.max(0, sin(p * PI * 4)), contrast: 1 + 0.2 * Math.max(0, sin(p * PI * 4)) })],
  ['earthquake', 'แผ่นดินไหว', 2, (p) => {
    const n = Math.floor(p * 40);
    return { x: noise(n) * 0.03, y: noise(n + 77) * 0.03, rot: noise(n + 13) * 2 };
  }],
  ['jitter', 'สั่นระริก', 2, (p) => {
    const n = Math.floor(p * 60);
    return { x: noise(n) * 0.008, y: noise(n + 3) * 0.008 };
  }],
  ['vertigo', 'เวียนหัว', 3, (p) => ({ rot: 6 * sin(p * PI * 4), scale: 1.1 + 0.08 * sin(p * PI * 2) })],
  ['spiral', 'เกลียวหมุน', 3, (p) => {
    const r = 0.35 * (1 - sin(p * PI));
    const a = p * PI * 6;
    return { x: r * cos(a), y: r * sin(a), scale: lerp(0.3, 1, sin(p * PI)), rot: 360 * p };
  }],
  ['zoom-trail', 'ซูมเงาซ้อน', 2, (p) => {
    const k = sin(p * PI);
    return { copies: [3, 2, 1, 0].map((i) => ({ scale: 1 + i * 0.1 * k, alpha: i ? 0.25 / i : 1 })) };
  }],
  ['four-corners', 'สี่มุมมาประกบ', 3, inOut(quadIn, back(quadIn))],
  ['split-slide', 'สองซีกสวนกัน', 2, (p) => {
    const k = sin(p * PI) * 0.35;
    return {
      copies: [
        { dx: -k, reveal: { kind: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0 } },
        { dx: k, reveal: { kind: 'rect', x0: -0.5, y0: 0, x1: 0.5, y1: 0.5 } },
      ],
    };
  }],
  ['dvd', 'เด้งรอบจอ', 4, (p) => ({ scale: 0.45, x: (tri(p * 3) - 0.5) * 0.55, y: (tri(p * 2.3 + 0.25) - 0.5) * 0.55 })],
  ['pendulum', 'ลูกตุ้มแกว่ง', 2, (p) => ({ py: -0.5, rot: 20 * sin(p * PI * 4) })],
  ['rubber-band', 'ยางยืดเด้ง', 2, (p) => {
    const w = 0.2 * sin(p * PI * 6) * Math.exp(-2 * p);
    return { sx: 1 + w, sy: 1 - w };
  }],
  ['tada', 'ตาด้า', 2, (p) => {
    const b = (p * 2) % 1;
    return b < 0.5 ? { scale: 1 + 0.08 * sin(b * 2 * PI), rot: 4 * sin(b * PI * 8) } : {};
  }],
  ['head-shake', 'ส่ายหน้า', 2, (p) => ({ x: 0.05 * sin(p * PI * 8) * sin(p * PI), rot: 4 * sin(p * PI * 8) * sin(p * PI) })],
  ['jello', 'เจลลี่บิด', 2, (p) => ({ skew: 18 * sin(p * PI * 6) * (1 - p), sy: 1 + 0.05 * sin(p * PI * 6) })],
  ['flip-flop', 'พลิกไปมา', 2, (p) => ({ sx: cos(p * PI * 4) })],
  ['tumble', 'กลิ้ง', 3, (p) => ({ x: lerp(-0.9, 0.9, p), rot: 720 * p, scale: 0.6, alpha: edges(p) })],
  ['domino', 'โดมิโนล้ม', 2, (p) => (p < 0.6 ? {} : { px: 0.5, py: 0.5, rot: 90 * ease.inCubic((p - 0.6) / 0.4) })],
  ['page-turn', 'เปิดหน้ากระดาษ', 2, (p) =>
    p < 0.6 ? {} : { px: -0.5, sx: Math.max(0.001, 1 - ease.inOutQuad((p - 0.6) / 0.4)), bright: lerp(1, 0.6, (p - 0.6) / 0.4) }],
  ['iris', 'ม่านวงกลม', 2, (p) => ({ reveal: { kind: 'circle', r: clamp01(sin(p * PI) * 1.4) } })],
  ['clock', 'นาฬิกาเปิดปิด', 2, (p) => ({ reveal: { kind: 'clock', deg: 360 * clamp01(sin(p * PI) * 1.3) } })],
  ['checker', 'ตารางผุดหาย', 2, (p) => ({ reveal: { kind: 'grid', n: 6, amount: clamp01(sin(p * PI) * 1.3) } })],
  ['glow', 'เรืองแสง', 2, (p) => ({ bright: 1 + 0.4 * sin(p * PI * 2) ** 2, sat: 1.2 })],
  ['contrast-beat', 'คอนทราสต์ตามจังหวะ', 2, (p) => ({ contrast: 1 + 0.6 * Math.max(0, sin(p * PI * 8)) })],
  ['ghost', 'ภาพหลอน', 2, (p) => {
    const k = 0.05 + 0.04 * sin(p * PI * 6);
    return { copies: [{ dx: -k, alpha: 0.35 }, { dx: k, alpha: 0.35 }, {}] };
  }],
  ['beat-zoom', 'ซูมตามบีท', 2, (p) => ({ scale: 1 + 0.15 * Math.exp(-((p * 4) % 1) / 0.12) })],
  ['kb-in', 'ซูมช้าเข้า', 3, (p) => ({ scale: lerp(1, 1.2, p) })],
  ['kb-out', 'ซูมช้าออก', 3, (p) => ({ scale: lerp(1.2, 1, p) })],
  ['kb-pan-left', 'แพนซ้าย', 3, (p) => ({ scale: 1.2, x: lerp(0.08, -0.08, p) })],
  ['kb-pan-right', 'แพนขวา', 3, (p) => ({ scale: 1.2, x: lerp(-0.08, 0.08, p) })],
  ['zoom-shake', 'ซูมสั่น', 2, (p) => {
    const n = Math.floor(p * 30);
    return { scale: 1.15, x: noise(n) * 0.02, y: noise(n + 9) * 0.02 };
  }],
];

const build = (slot: Slot, entries: Entry[]): Preset[] => entries.map(([id, name, seconds, pose]) => ({ id: `${slot}:${id}`, slot, name, seconds, pose }));

export const PRESETS: Record<Slot, Preset[]> = {
  in: build('in', IN),
  out: build('out', OUT),
  combo: build('combo', COMBO),
};

// ---- text: letter-by-letter presets ----

// Letter i of n starts at (i / n) * spread of the way through and takes the rest.
const each = (p: number, i: number, n: number, spread = 0.6) => clamp01((p - (n > 1 ? (i / (n - 1)) * spread : 0)) / (1 - spread));
const order = (i: number) => (noise(i * 31 + 7) + 1) / 2;
const still: Fn = () => ({});
type GlyphEntry = [id: string, name: string, seconds: number, glyph: GlyphFn];

const GLYPH_IN: GlyphEntry[] = [
  ['t-typewriter', 'พิมพ์ทีละตัว', 1.5, (p, i, n) => ({ alpha: i < Math.floor(p * n + 1e-9) || p >= 1 ? 1 : 0 })],
  ['t-fade', 'ค่อยๆ ชัดทีละตัว', 1, (p, i, n) => ({ alpha: each(p, i, n) })],
  ['t-pop', 'เด้งทีละตัว', 1, (p, i, n) => ({ scale: outBack(each(p, i, n)), alpha: clamp01(each(p, i, n) * 3) })],
  ['t-drop', 'ตกทีละตัว', 1.2, (p, i, n) => ({ y: -1.5 * (1 - ease.outBounce(each(p, i, n))), alpha: clamp01(each(p, i, n) * 3) })],
  ['t-rise', 'ลอยขึ้นทีละตัว', 1, (p, i, n) => ({ y: 0.8 * (1 - outCubic(each(p, i, n))), alpha: each(p, i, n) })],
  ['t-spin', 'หมุนทีละตัว', 1, (p, i, n) => ({ rot: 180 * (1 - outCubic(each(p, i, n))), scale: each(p, i, n) })],
  ['t-zoom', 'ซูมทีละตัว', 1, (p, i, n) => ({ scale: lerp(3, 1, outCubic(each(p, i, n))), alpha: each(p, i, n) })],
  ['t-slide', 'สไลด์ทีละตัว', 1, (p, i, n) => ({ x: 2 * (1 - outCubic(each(p, i, n))), alpha: each(p, i, n) })],
  ['t-random', 'สุ่มโผล่', 1, (p, i) => ({ alpha: clamp01((p - order(i) * 0.7) / 0.3) })],
  ['t-swing', 'แกว่งทีละตัว', 1.2, (p, i, n) => ({ rot: 40 * (1 - ease.outElastic(each(p, i, n))), alpha: clamp01(each(p, i, n) * 4) })],
  ['t-flip', 'พลิกทีละตัว', 1, (p, i, n) => ({ sy: cos((1 - outCubic(each(p, i, n))) * PI) })],
  ['t-wave', 'คลื่นเข้า', 1.2, (p, i, n) => ({ y: -0.6 * sin(each(p, i, n) * PI), alpha: each(p, i, n) })],
  ['t-stretch', 'ยืดทีละตัว', 1, (p, i, n) => ({ sx: lerp(3, 1, outCubic(each(p, i, n))), sy: lerp(0.2, 1, outCubic(each(p, i, n))), alpha: each(p, i, n) })],
];

const GLYPH_LOOP: GlyphEntry[] = [
  ['t-wave', 'คลื่น', 1.5, (p, i, n) => ({ y: -0.25 * sin(2 * PI * (p - i / Math.max(4, n))) })],
  ['t-jump', 'กระโดดทีละตัว', 1.5, (p, i, n) => ({ y: -0.5 * Math.max(0, sin(2 * PI * (p - i / n)) ** 9) })],
  ['t-flicker', 'กะพริบทีละตัว', 1, (p, i) => ({ alpha: noise(i * 13 + Math.floor(p * 12)) > -0.5 ? 1 : 0.2 })],
  ['t-beat', 'ตุบๆ ทีละตัว', 1, (p, i, n) => ({ scale: 1 + 0.25 * Math.max(0, sin(2 * PI * (p - i / n))) ** 4 })],
  ['t-shake', 'สั่นทีละตัว', 1, (p, i) => {
    const k = Math.floor(p * 24);
    return { x: noise(i * 7 + k) * 0.06, y: noise(i * 11 + k + 50) * 0.06 };
  }],
  ['t-rock', 'โยกทีละตัว', 1.5, (p, i, n) => ({ rot: 12 * sin(2 * PI * (p + i / n)) })],
  ['t-rainbow', 'สีรุ้งวิ่ง', 2, (p, i, n) => ({ hue: (360 * (p + i / n)) % 360 })],
  ['t-jelly', 'เยลลี่ทีละตัว', 1.2, (p, i, n) => {
    const w = 0.2 * sin(2 * PI * (p - i / n));
    return { sx: 1 + w, sy: 1 - w };
  }],
  ['t-float', 'ลอยเบาๆ', 2, (p, i, n) => ({ y: -0.08 * sin(2 * PI * (p + i / (n * 2))) })],
];

const glyphs = (slot: Slot, list: GlyphEntry[], reverse = false): Preset[] =>
  list.map(([id, name, seconds, fn]) => ({ id: `${slot}:${id}`, slot, name, seconds, pose: still, glyph: reverse ? (p, i, n) => fn(1 - p, i, n) : fn }));

const OUT_NAMES: Record<string, string> = {
  't-typewriter': 'ลบทีละตัว', 't-fade': 'จางทีละตัว', 't-pop': 'ยุบทีละตัว', 't-drop': 'ร่วงทีละตัว', 't-rise': 'จมทีละตัว',
  't-spin': 'หมุนหายทีละตัว', 't-zoom': 'ซูมหายทีละตัว', 't-slide': 'สไลด์ออกทีละตัว', 't-random': 'สุ่มหาย', 't-swing': 'แกว่งหายทีละตัว',
  't-flip': 'พลิกหายทีละตัว', 't-wave': 'คลื่นออก', 't-stretch': 'ยืดหายทีละตัว',
};

// Text gets the letter-by-letter presets first, then every clip preset (the whole block moves). Its third tab loops.
export const TEXT_PRESETS: Record<Slot, Preset[]> = {
  in: [...glyphs('in', GLYPH_IN), ...PRESETS.in],
  out: [...glyphs('out', GLYPH_IN.map(([id, , s, fn]) => [id, OUT_NAMES[id], s, fn]), true), ...PRESETS.out],
  combo: [...glyphs('combo', GLYPH_LOOP), ...PRESETS.combo],
};

const byId = new Map([...Object.values(PRESETS), ...Object.values(TEXT_PRESETS)].flat().map((p) => [p.id, p]));
export const getPreset = (id: string) => byId.get(id);

export function poseOf(preset: Preset, p: number): Pose {
  return { ...REST, ...preset.pose(clamp01(p)) };
}

type Active = { preset: Preset; p: number } | null;

function active(anim: Anim | null, t: Us, start: Us): Active {
  if (!anim) return null;
  const preset = getPreset(anim.presetId);
  if (!preset || anim.duration <= 0) return null;
  return { preset, p: clamp01((t - start) / anim.duration) };
}

// `t` is time inside the clip (0 = its first frame). At most one animation is active at a time.
function activeAt(c: MediaClip | TextClip, t: Us): Active {
  const solo = c.kind === 'text' ? c.animLoop : c.animCombo;
  if (solo) {
    if (c.kind === 'text') return active(solo, t % solo.duration, 0); // a loop repeats for as long as the text is on screen
    return t < solo.duration ? active(solo, t, 0) : null;
  }
  if (c.animIn && t < c.animIn.duration) return active(c.animIn, t, 0);
  if (c.animOut && t >= c.duration - c.animOut.duration) return active(c.animOut, t, c.duration - c.animOut.duration);
  return null;
}

export function poseAt(c: MediaClip | TextClip, t: Us): Pose {
  const a = activeAt(c, t);
  return a ? poseOf(a.preset, a.p) : REST;
}

export function glyphAt(c: TextClip, t: Us): { fn: GlyphFn; p: number } | undefined {
  const a = activeAt(c, t);
  return a?.preset.glyph ? { fn: a.preset.glyph, p: a.p } : undefined;
}
