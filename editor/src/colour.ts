import { createStore, entries, get, set } from 'idb-keyval';
import { lutFor, parseCube, rememberLut, type Lut } from './luts';
import type { Adjust, MediaClip, Project } from './schema';

// One WebGL2 pass per frame: adjust sliders, then the filter's 3D LUT mixed by its intensity.
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
uniform float lutMix, lutSize;
uniform vec2 texel;
uniform float exposure, brightness, contrast, saturation, temperature, tint, highlights, shadows, sharpen;
in vec2 uv;
out vec4 o;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec4 s = texture(img, uv);
  vec3 c = s.rgb;
  if (sharpen != 0.0) {
    vec3 b = (texture(img, uv + vec2(texel.x, 0.0)).rgb + texture(img, uv - vec2(texel.x, 0.0)).rgb
            + texture(img, uv + vec2(0.0, texel.y)).rgb + texture(img, uv - vec2(0.0, texel.y)).rgb) * 0.25;
    c += sharpen * (c - b);
  }
  c *= exp2(exposure);
  c += vec3(temperature * 0.1 + tint * 0.05, -tint * 0.1, -temperature * 0.1 + tint * 0.05);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / (1.0 + brightness * 0.6)));
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(clamp(c, 0.0, 1.0), W);
  c += highlights * 0.3 * smoothstep(0.5, 1.0, l) + shadows * 0.3 * (1.0 - smoothstep(0.0, 0.5, l));
  c = mix(vec3(dot(c, W)), c, 1.0 + saturation);
  c = clamp(c, 0.0, 1.0);
  if (lutMix > 0.0) c = mix(c, texture(lut, c * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb, lutMix);
  o = vec4(c * s.a, s.a);
}`;

const SLIDERS = ['exposure', 'brightness', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows', 'sharpen'] as const;

let ready: { gl: WebGL2RenderingContext; canvas: OffscreenCanvas; u: Record<string, WebGLUniformLocation | null>; src: WebGLTexture } | null = null;
let broken = false;
const lutTextures = new Map<Lut, WebGLTexture>();

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
  const u = Object.fromEntries(['img', 'lut', 'lutMix', 'lutSize', 'texel', ...SLIDERS].map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.uniform1i(u.img, 0);
  gl.uniform1i(u.lut, 1);
  const src = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  ready = { gl, canvas, u, src };
  return ready;
}

function lutTexture(gl: WebGL2RenderingContext, lut: Lut) {
  let t = lutTextures.get(lut);
  if (!t) {
    t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    lutTextures.set(lut, t);
  }
  return t;
}

type Grade = Pick<MediaClip, 'filter' | 'adjust'>;
export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, exposure: 0, sharpen: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0 };

export const isGraded = (c: Grade) => (!!c.filter && c.filter.intensity > 0) || SLIDERS.some((k) => c.adjust[k] !== 0);

// The clip's image with its colour applied, w x h; the original image when there is nothing to do.
export function graded(img: CanvasImageSource, w: number, h: number, c: Grade): CanvasImageSource {
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
  for (const k of SLIDERS) {
    const v = c.adjust[k] / 100;
    gl.uniform1f(u[k], k === 'exposure' ? v * 1.5 : k === 'sharpen' ? Math.max(0, v) * 1.5 : v);
  }
  const lut = c.filter && c.filter.intensity > 0 ? lutFor(c.filter.presetId) : null;
  gl.uniform1f(u.lutMix, lut ? c.filter!.intensity : 0);
  if (lut) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTexture(gl, lut));
    gl.uniform1f(u.lutSize, lut.size);
  }
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
  const all = (await entries<string, Stored>(lutDb)).map(([id, v]) => {
    rememberLut(id, { size: v.size, data: v.data });
    return { id, name: v.name };
  });
  return all.sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

// Imported LUTs are read from storage before a frame needs them.
export async function prepareLuts(p: Project) {
  for (const c of p.tracks[0].clips) {
    const id = c.kind === 'video' || c.kind === 'photo' ? c.filter?.presetId : undefined;
    if (!id?.startsWith('cube:') || lutFor(id)) continue;
    const v = await get<Stored>(id, lutDb);
    if (v) rememberLut(id, { size: v.size, data: v.data });
  }
}
