// Filters are 3D colour lookup tables. Ours are generated from small colour functions (no image assets);
// a user's own .cube files load into the same slot.

export const LUT_SIZE = 33;
type RGB = [number, number, number];
type Look = (r: number, g: number, b: number) => RGB;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
// S-curve around mid grey; k = 0 is flat, 1 is strong.
const curve = (x: number, k: number) => mix(x, smooth(0, 1, x), k);
const sat = ([r, g, b]: RGB, s: number): RGB => {
  const l = luma(r, g, b);
  return [mix(l, r, s), mix(l, g, s), mix(l, b, s)];
};
// Shadows pulled toward one colour and highlights toward another.
const split = ([r, g, b]: RGB, sh: RGB, hi: RGB, amount = 1): RGB => {
  const l = luma(r, g, b);
  const ws = (1 - smooth(0, 0.55, l)) * amount;
  const wh = smooth(0.45, 1, l) * amount;
  return [r + sh[0] * ws + hi[0] * wh, g + sh[1] * ws + hi[1] * wh, b + sh[2] * ws + hi[2] * wh];
};
const fadeTo = ([r, g, b]: RGB, black: number, white: number): RGB => [mix(black, white, r), mix(black, white, g), mix(black, white, b)];
const duo = (dark: RGB, light: RGB): Look => (r, g, b) => {
  const l = curve(luma(r, g, b), 0.3);
  return [mix(dark[0], light[0], l), mix(dark[1], light[1], l), mix(dark[2], light[2], l)];
};

export const FILTERS: { id: string; name: string; look: Look }[] = [
  { id: 'warm', name: 'อบอุ่น', look: (r, g, b) => [r * 1.06 + 0.02, g * 1.01, b * 0.88] },
  { id: 'cool', name: 'เย็นสบาย', look: (r, g, b) => [r * 0.9, g * 0.99 + 0.01, b * 1.08 + 0.03] },
  { id: 'vivid', name: 'สดใส', look: (r, g, b) => sat([curve(r, 0.25), curve(g, 0.25), curve(b, 0.25)], 1.45) },
  { id: 'film', name: 'ฟิล์ม', look: (r, g, b) => fadeTo(split([curve(r, 0.35), curve(g, 0.3), curve(b, 0.25)], [-0.02, 0.03, 0.02], [0.05, 0.02, -0.04]), 0.05, 0.97) },
  { id: 'cinema', name: 'ซีเนม่า', look: (r, g, b) => sat(split([curve(r, 0.5), curve(g, 0.5), curve(b, 0.5)], [-0.04, 0.03, 0.08], [0.06, 0.02, -0.05]), 0.85) },
  { id: 'teal-orange', name: 'ทีลแอนด์ออเรนจ์', look: (r, g, b) => sat(split([r, g, b], [-0.06, 0.04, 0.1], [0.1, 0.03, -0.08]), 1.1) },
  { id: 'vintage', name: 'วินเทจ', look: (r, g, b) => fadeTo(sat(split([r, g, b], [0.04, 0.02, -0.02], [0.06, 0.03, -0.06]), 0.7), 0.09, 0.9) },
  { id: 'matte', name: 'ด้าน', look: (r, g, b) => fadeTo(sat([r, g, b], 0.9), 0.12, 0.93) },
  { id: 'polaroid', name: 'โพลารอยด์', look: (r, g, b) => fadeTo(sat(split([r, g, b], [-0.03, 0.03, 0.06], [0.06, 0.05, -0.05]), 0.85), 0.07, 0.96) },
  { id: 'golden', name: 'ชั่วโมงทอง', look: (r, g, b) => split([r * 1.05, g, b * 0.9], [0.02, 0, -0.03], [0.12, 0.06, -0.08]) },
  { id: 'pink', name: 'โทนชมพู', look: (r, g, b) => fadeTo([r + 0.06, g * 0.95, b + 0.05], 0.04, 1) },
  { id: 'forest', name: 'ป่าเขียว', look: (r, g, b) => sat([curve(r * 0.94, 0.2), curve(g * 1.06, 0.2), curve(b * 0.96, 0.2)], 1.1) },
  { id: 'night', name: 'ราตรี', look: (r, g, b) => sat([r * 0.8, g * 0.88, b * 1.05 + 0.04], 0.75) },
  { id: 'chrome', name: 'โครม', look: (r, g, b) => sat(split([curve(r, 0.3), curve(g, 0.3), curve(b, 0.3)], [-0.03, 0.02, 0.05], [0.02, 0.02, 0]), 1.25) },
  { id: 'food', name: 'อาหารน่ากิน', look: (r, g, b) => sat([Math.pow(r, 0.9) * 1.04, Math.pow(g, 0.92), Math.pow(b, 0.95) * 0.95], 1.2) },
  { id: 'anime', name: 'สดแบบอนิเมะ', look: (r, g, b) => sat([Math.pow(r, 0.88), Math.pow(g, 0.86) + 0.02, Math.pow(b, 0.85) + 0.05 * b], 1.35) },
  { id: 'cross', name: 'ครอสโพรเซส', look: (r, g, b) => [curve(r, 0.6), curve(g, 0.35) * 1.03, mix(0.15, 0.85, b)] },
  { id: 'bleach', name: 'ฟอกสี', look: (r, g, b) => {
    const l = curve(luma(r, g, b), 0.6);
    return [mix(r, l, 0.55), mix(g, l, 0.55), mix(b, l, 0.55)];
  } },
  { id: 'fade-blue', name: 'ซีดฟ้า', look: (r, g, b) => fadeTo(sat([r * 0.95, g, b * 1.05 + 0.03], 0.75), 0.1, 0.95) },
  { id: 'sepia', name: 'ซีเปีย', look: (r, g, b) => [r * 0.393 + g * 0.769 + b * 0.189, r * 0.349 + g * 0.686 + b * 0.168, r * 0.272 + g * 0.534 + b * 0.131] },
  { id: 'bw', name: 'ขาวดำ', look: (r, g, b) => {
    const l = luma(r, g, b);
    return [l, l, l];
  } },
  { id: 'bw-hard', name: 'ขาวดำเข้ม', look: (r, g, b) => {
    const l = curve(curve(luma(r, g, b), 1), 0.5);
    return [l, l, l];
  } },
  { id: 'mono-blue', name: 'โมโนฟ้า', look: duo([0.03, 0.06, 0.2], [0.75, 0.95, 1]) },
  { id: 'duo-pink', name: 'ดูโอโทนชมพู', look: duo([0.2, 0.03, 0.35], [1, 0.8, 0.55]) },
];

export interface Lut {
  size: number;
  data: Uint8Array; // RGBA, red fastest, then green, then blue (the .cube order)
}

const built = new Map<string, Lut>();

export function bakeLut(look: Look, size = LUT_SIZE): Lut {
  const data = new Uint8Array(size ** 3 * 4);
  let o = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = look(r / (size - 1), g / (size - 1), b / (size - 1));
        data[o++] = Math.round(clamp01(out[0]) * 255);
        data[o++] = Math.round(clamp01(out[1]) * 255);
        data[o++] = Math.round(clamp01(out[2]) * 255);
        data[o++] = 255;
      }
  return { size, data };
}

export class CubeError extends Error {}

// Adobe/Resolve .cube, 3D only.
export function parseCube(text: string): Lut & { title: string } {
  let size = 0;
  let title = '';
  let lo = [0, 0, 0];
  let hi = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE') throw new CubeError('1d');
    else if (key === 'DOMAIN_MIN') lo = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') hi = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(key) && parts.length >= 3) vals.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new CubeError('size');
  if (vals.length !== size ** 3 * 3 || vals.some((v) => !Number.isFinite(v))) throw new CubeError('data');
  const data = new Uint8Array(size ** 3 * 4);
  for (let i = 0, o = 0; i < vals.length; i += 3) {
    for (let c = 0; c < 3; c++) data[o++] = Math.round(clamp01((vals[i + c] - lo[c]) / (hi[c] - lo[c] || 1)) * 255);
    data[o++] = 255;
  }
  return { size, data, title };
}

// Built-in looks are baked on first use; imported ones are put here by `rememberLut`.
export function lutFor(presetId: string): Lut | null {
  let lut = built.get(presetId);
  if (!lut) {
    const f = FILTERS.find((x) => x.id === presetId);
    if (!f) return null;
    lut = bakeLut(f.look);
    built.set(presetId, lut);
  }
  return lut;
}

export const rememberLut = (presetId: string, lut: Lut) => built.set(presetId, lut);
