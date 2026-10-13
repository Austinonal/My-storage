import { createStore, entries, get, set } from 'idb-keyval';
import { CanvasSink } from 'mediabunny';
import { ImportError, openInput, openMedia } from './media';
import { bakeLut, lutFor, parseCube, rememberLut, type Lut } from './luts';
import type { Adjust, MediaAsset, MediaClip, Project } from './schema';
import { ADJUST_KEYS, SEC, sourceOut } from './timeline.ts';
import { WHEELS, curveTable, curvesUsed, gradeUsed, hslUsed, matchLook, mergeStats, neutralGrade, statsOf, wheelOffset, wheelsUsed, type ColourStats } from './grade';

// One WebGL2 pass per frame: sliders, colour wheels, per-colour HSL, curves, colour match, the filter, then fade and vignette.
const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D img;
uniform sampler3D lut;
uniform sampler3D matchLut;
uniform sampler2D curve;
uniform float lutMix, lutSize, matchMix, matchSize, useCurve, useHsl, aspect;
uniform vec2 texel;
uniform float exposure, brightness, contrast, saturation, temperature, tint, highlights, shadows, sharpen;
uniform float ambient, clarity, whites, blacks, fade, vignette;
uniform vec3 hsl[8];
uniform vec3 wheelS, wheelM, wheelH;
in vec2 uv;
out vec4 o;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
const float HUES[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 225.0, 270.0, 315.0);
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 px(vec2 d) { return texture(img, uv + d).rgb; }
vec3 look(sampler3D t, float n, vec3 c) { return texture(t, c * ((n - 1.0) / n) + 0.5 / n).rgb; }
void main() {
  vec4 s = texture(img, uv);
  vec3 c = s.rgb;
  float l0 = dot(c, W);
  if (sharpen != 0.0) {
    vec3 b = (px(vec2(texel.x, 0.0)) + px(-vec2(texel.x, 0.0)) + px(vec2(0.0, texel.y)) + px(-vec2(0.0, texel.y))) * 0.25;
    c += sharpen * (c - b);
  }
  if (clarity != 0.0) {
    vec2 r = texel * 6.0;
    vec3 b = (px(vec2(r.x, 0.0)) + px(-vec2(r.x, 0.0)) + px(vec2(0.0, r.y)) + px(-vec2(0.0, r.y)) + px(r) + px(-r) + px(vec2(r.x, -r.y)) + px(vec2(-r.x, r.y))) * 0.125;
    c += clarity * (c - b) * (1.0 - abs(2.0 * l0 - 1.0));
  }
  c *= exp2(exposure);
  c += vec3(temperature * 0.1 + tint * 0.05, -tint * 0.1, -temperature * 0.1 + tint * 0.05);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / (1.0 + brightness * 0.6)));
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(clamp(c, 0.0, 1.0), W);
  c += highlights * 0.3 * smoothstep(0.5, 1.0, l) + shadows * 0.3 * (1.0 - smoothstep(0.0, 0.5, l));
  c += whites * 0.2 * smoothstep(0.7, 1.0, l) + blacks * 0.2 * (1.0 - smoothstep(0.0, 0.3, l));
  c += ambient * l * (1.0 - l);
  l = dot(clamp(c, 0.0, 1.0), W);
  c += wheelS * (1.0 - smoothstep(0.0, 0.5, l)) + wheelM * (1.0 - abs(2.0 * l - 1.0)) + wheelH * smoothstep(0.5, 1.0, l);
  c = mix(vec3(dot(c, W)), c, 1.0 + saturation);
  c = clamp(c, 0.0, 1.0);
  if (useHsl > 0.5) {
    vec3 h = rgb2hsv(c);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float d = abs(mod(h.x * 360.0 - HUES[i] + 540.0, 360.0) - 180.0);
      acc += hsl[i] * (1.0 - smoothstep(0.0, 40.0, d));
    }
    h.x = fract(h.x + acc.x * (30.0 / 360.0) + 1.0);
    h.y = clamp(h.y * (1.0 + acc.y), 0.0, 1.0);
    h.z = clamp(h.z * (1.0 + acc.z * 0.6 * h.y), 0.0, 1.0); // greys keep their brightness
    c = hsv2rgb(h);
  }
  if (useCurve > 0.5) {
    vec3 k = c * (255.0 / 256.0) + 0.5 / 256.0;
    c = vec3(texture(curve, vec2(k.r, 0.5)).r, texture(curve, vec2(k.g, 0.5)).g, texture(curve, vec2(k.b, 0.5)).b);
  }
  if (matchMix > 0.0) c = mix(c, look(matchLut, matchSize, c), matchMix);
  if (lutMix > 0.0) c = mix(c, look(lut, lutSize, c), lutMix);
  if (fade > 0.0) c = mix(vec3(dot(c, W)), c * (1.0 - 0.25 * fade) + 0.12 * fade, 1.0 - 0.2 * fade);
  if (vignette != 0.0) {
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float m = smoothstep(0.3, 1.0, length(d) / length(vec2(aspect, 1.0) * 0.5)) * 0.9;
    c = vignette > 0.0 ? c * (1.0 - vignette * m) : mix(c, vec3(1.0), -vignette * m);
  }
  c = clamp(c, 0.0, 1.0);
  o = vec4(c * s.a, s.a);
}`;

const SLIDERS = ADJUST_KEYS;
const UNIFORMS = ['img', 'lut', 'matchLut', 'curve', 'lutMix', 'lutSize', 'matchMix', 'matchSize', 'useCurve', 'useHsl', 'aspect', 'texel', 'hsl', 'wheelS', 'wheelM', 'wheelH', ...SLIDERS];

let ready: { gl: WebGL2RenderingContext; canvas: OffscreenCanvas; u: Record<string, WebGLUniformLocation | null>; src: WebGLTexture; curve: WebGLTexture } | null = null;
let broken = false;
const lutTextures = new Map<Lut, WebGLTexture>();
let curveKey = '';

function setup() {
  if (ready || broken) return ready;
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) {
    broken = true; // shortcut: without WebGL2 clips play ungraded; every phone this app targets (Android 8+, Chrome) has it
    return null;
  }
  const shader = (type: number, code: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(prog, 'pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.uniform1i(u.img, 0);
  gl.uniform1i(u.lut, 1);
  gl.uniform1i(u.curve, 2);
  gl.uniform1i(u.matchLut, 3);
  const texture2d = (unit: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  // Every unit gets a texture of the right kind up front, so a sampler the pass does not use is never left unbound.
  const curve = texture2d(2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveTable(neutralGrade().curves));
  const src = texture2d(0);
  const none = { size: 2, data: new Uint8Array(32) };
  for (const unit of [1, 3]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, lutTexture(gl, none));
  }
  ready = { gl, canvas, u, src, curve };
  return ready;
}

function lutTexture(gl: WebGL2RenderingContext, lut: Lut) {
  let t = lutTextures.get(lut);
  if (!t) {
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    lutTextures.set(lut, t);
  }
  return t;
}

type Look = Pick<MediaClip, 'filter' | 'adjust' | 'grade' | 'match'>;
export const NO_ADJUST: Adjust = Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])) as unknown as Adjust;

export const isGraded = (c: Look) =>
  (!!c.filter && c.filter.intensity > 0) || (!!c.match && c.match.intensity > 0) || SLIDERS.some((k) => (c.adjust[k] ?? 0) !== 0) || gradeUsed(c.grade);

// The clip's image with its colour applied, w x h; the original image when there is nothing to do.
export function graded(img: CanvasImageSource, w: number, h: number, c: Look): CanvasImageSource {
  if (!isGraded(c)) return img;
  const r = setup();
  if (!r) return img;
  const { gl, canvas, u } = r;
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, r.src);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource);
  gl.uniform2f(u.texel, 1 / canvas.width, 1 / canvas.height);
  gl.uniform1f(u.aspect, canvas.width / canvas.height);
  for (const k of SLIDERS) {
    const v = (c.adjust[k] ?? 0) / 100;
    gl.uniform1f(u[k], k === 'exposure' ? v * 1.5 : k === 'sharpen' ? Math.max(0, v) * 1.5 : k === 'clarity' ? v * 1.2 : k === 'fade' ? Math.max(0, v) : v);
  }
  const g = c.grade;
  gl.uniform1f(u.useHsl, hslUsed(g) ? 1 : 0);
  if (g && hslUsed(g)) gl.uniform3fv(u.hsl, new Float32Array(g.hsl.flat().map((v) => v / 100)));
  const wheels = g && wheelsUsed(g) ? WHEELS.map((k) => wheelOffset(g.wheels[k])) : [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  gl.uniform3fv(u.wheelS, wheels[0]);
  gl.uniform3fv(u.wheelM, wheels[1]);
  gl.uniform3fv(u.wheelH, wheels[2]);
  const curves = g && curvesUsed(g);
  gl.uniform1f(u.useCurve, curves ? 1 : 0);
  if (g && curves) {
    const key = JSON.stringify(g.curves);
    if (key !== curveKey) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, r.curve);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveTable(g.curves));
      curveKey = key;
    }
  }
  const bind = (unit: number, id: string | undefined, amount: number, mix: WebGLUniformLocation | null, size: WebGLUniformLocation | null) => {
    const lut = id && amount > 0 ? lutFor(id) : null;
    gl.uniform1f(mix, lut ? amount : 0);
    if (!lut) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, lutTexture(gl, lut));
    gl.uniform1f(size, lut.size);
  };
  bind(1, c.filter?.presetId, c.filter?.intensity ?? 0, u.lutMix, u.lutSize);
  bind(3, c.match?.lutId, c.match?.intensity ?? 0, u.matchMix, u.matchSize);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}

// A user's own .cube files, kept on this device for every project.
const lutDb = createStore('editor-luts', 'luts');
type Stored = { name: string; size: number; data: Uint8Array };

export async function importCube(file: File) {
  const lut = parseCube(await file.text());
  const id = `cube:${crypto.randomUUID()}`;
  const name = lut.title || file.name.replace(/\.cube$/i, '');
  await set(id, { name, size: lut.size, data: lut.data } satisfies Stored, lutDb);
  rememberLut(id, lut);
  return { id, name };
}

export async function myLuts() {
  const all = (await entries<string, Stored>(lutDb)).filter(([id]) => id.startsWith('cube:')).map(([id, v]) => {
    rememberLut(id, { size: v.size, data: v.data });
    return { id, name: v.name };
  });
  return all.sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

// Imported LUTs are read from storage before a frame needs them.
export async function prepareLuts(p: Project) {
  for (const c of p.tracks.flatMap((t) => t.clips)) {
    if (c.kind !== 'video' && c.kind !== 'photo') continue;
    for (const id of [c.filter?.presetId, c.match?.lutId]) {
      if (!id || !/^(cube|match):/.test(id) || lutFor(id)) continue;
      const v = await get<Stored>(id, lutDb);
      if (v) rememberLut(id, { size: v.size, data: v.data });
    }
  }
}

// Colour statistics of a photo or a clip (eight frames across `from`..`to` seconds), read small.
async function statsOfMedia(blob: Blob, isPhoto: boolean, from = 0, to = Infinity): Promise<ColourStats> {
  if (isPhoto) {
    const bmp = await createImageBitmap(blob);
    const w = 160;
    const h = Math.max(1, Math.round((w * bmp.height) / bmp.width));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return statsOf(ctx.getImageData(0, 0, w, h).data);
  }
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new ImportError('unsupported-codec');
    const end = Math.min(to, await input.computeDuration());
    const sink = new CanvasSink(track, { width: 160, height: Math.max(1, Math.round((160 * (await track.getDisplayHeight())) / (await track.getDisplayWidth()))), fit: 'fill', poolSize: 1 });
    const all: ColourStats[] = [];
    for await (const frame of sink.canvasesAtTimestamps(Array.from({ length: 8 }, (_, i) => from + ((i + 0.5) / 8) * (end - from)))) {
      if (!frame) continue;
      const c = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
      all.push(statsOf((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data));
    }
    return mergeStats(all);
  } finally {
    input.dispose();
  }
}

// Colour match: a LUT that gives the clip the reference's colours, kept with the imported LUTs.
export async function makeMatch(reference: File, clip: MediaClip, asset: MediaAsset) {
  const to = await statsOfMedia(reference, reference.type.startsWith('image/'));
  const from = await statsOfMedia(await openMedia(asset.file), asset.kind === 'photo', clip.sourceIn / SEC, sourceOut(clip) / SEC);
  const lut = bakeLut(matchLook(from, to));
  const id = `match:${crypto.randomUUID()}`;
  const name = reference.name.replace(/\.[^.]+$/, '');
  await set(id, { name, size: lut.size, data: lut.data } satisfies Stored, lutDb);
  rememberLut(id, lut);
  return { lutId: id, name };
}
