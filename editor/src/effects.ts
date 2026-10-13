// Effect layers: a clip on an effect track restyles the whole frame drawn below it (every track) while it runs.
// One WebGL2 pass over the finished frame; preview and export both come through applyEffects.
import { fullFrame } from './colour';
import { SEC } from './timeline.ts';
import type { Project, Us } from './schema';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const EFFECTS = [
  { id: 'vhs', name: 'วีเอชเอส' },
  { id: 'glitch', name: 'กลิตช์' },
  { id: 'leak', name: 'แสงรั่ว' },
  { id: 'dust', name: 'ฝุ่นฟิล์ม' },
  { id: 'scan', name: 'เส้นสแกน' },
] as const;

export const effectName = (id: string) => EFFECTS.find((e) => e.id === id)?.name ?? id;

// Sizes are fractions of the frame, so the preview and a 4K export look alike. `t` is seconds into the effect clip.
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D img;
uniform float t, kind;
uniform vec2 res;
in vec2 uv;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 tex(vec2 p) { return texture(img, clamp(p, 0.0, 1.0)).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 p = uv;
  float frame = floor(t * 24.0);
  vec3 c;
  if (kind < 0.5) {
    // VHS: wobbling lines, a rolling tracking band, colour bleeding sideways, soft and noisy
    float band = fract(0.9 - t * 0.12);
    float inBand = smoothstep(0.0, 0.015, uv.y - band) * (1.0 - smoothstep(0.03, 0.06, uv.y - band));
    p.x += (noise(vec2(uv.y * 60.0, t * 4.0)) - 0.5) * 0.004 + sin(uv.y * 9.0 + t * 2.3) * 0.0012;
    p.x += inBand * (hash(vec2(floor(uv.y * res.y / 3.0), frame)) - 0.5) * 0.04;
    float b = 0.005;
    c = vec3(tex(p + vec2(b, 0.0)).r, tex(p).g, tex(p - vec2(b, 0.0)).b);
    c = mix(c, (tex(p + vec2(0.0025, 0.0)) + tex(p - vec2(0.0025, 0.0))) * 0.5, 0.35);
    c = mix(vec3(luma(c)), c, 0.8) * vec3(1.02, 0.98, 1.04);
    c += (hash(uv * res + frame) - 0.5) * 0.09 + inBand * 0.12;
    c *= 0.94 + 0.06 * sin(uv.y * 540.0 * 3.14159);
  } else if (kind < 1.5) {
    // Glitch: bursts of torn rows, split colour and the odd inverted block
    float k = floor(t * 12.0);
    float burst = step(0.45, hash(vec2(k, 3.7)));
    float row = floor(uv.y * 28.0);
    float tear = step(0.65, hash(vec2(row, k + 0.5))) * (hash(vec2(row + 9.0, k)) - 0.5) * 0.16 * burst;
    p.x += tear;
    float s = 0.012 * burst + 0.002;
    c = vec3(tex(p + vec2(s, 0.0)).r, tex(p).g, tex(p - vec2(s, s * 0.5)).b);
    vec2 cell = floor(uv * vec2(10.0, 18.0));
    if (burst > 0.5 && hash(cell + k) > 0.97) c = 1.0 - c;
    c += burst * step(0.985, hash(vec2(floor(uv.y * res.y / 2.0), k))) * 0.5;
  } else if (kind < 2.5) {
    // Light leak: warm light drifting in from the edges, blended like light on film
    c = tex(p);
    vec2 a = vec2(0.1 + 0.25 * sin(t * 0.7), 0.2 + 0.3 * cos(t * 0.5));
    vec2 b2 = vec2(0.95 - 0.2 * cos(t * 0.6), 0.75 + 0.2 * sin(t * 0.8));
    vec2 asp = vec2(res.x / res.y, 1.0);
    float la = exp(-pow(length((uv - a) * asp) / 0.45, 2.0));
    float lb = exp(-pow(length((uv - b2) * asp) / 0.35, 2.0));
    float pulse = 0.75 + 0.25 * sin(t * 1.7);
    vec3 leak = (vec3(1.0, 0.45, 0.12) * la + vec3(1.0, 0.25, 0.35) * lb * 0.9) * pulse;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(leak, 0.0, 1.0));
    c *= vec3(1.04, 1.0, 0.94);
  } else if (kind < 3.5) {
    // Film dust: specks and hairs of dust, a scratch now and then, flicker, a touch of sepia and a vignette
    c = tex(p);
    c = mix(c, vec3(luma(c)) * vec3(1.07, 0.98, 0.84), 0.3);
    c *= 0.95 + 0.06 * hash(vec2(frame, 1.3));
    vec2 g = uv * vec2(70.0 * res.x / res.y, 70.0);
    vec2 cell = floor(g);
    float r = hash(cell + frame * 1.7);
    if (r > 0.993) {
      vec2 at = vec2(hash(cell + 3.1 + frame), hash(cell + 5.3 + frame));
      float d = length(fract(g) - at);
      c = mix(c, vec3(r > 0.997 ? 0.95 : 0.08), 1.0 - smoothstep(0.08, 0.2, d));
    }
    float sf = floor(t * 6.0);
    if (hash(vec2(sf, 9.1)) > 0.55) {
      float x0 = hash(vec2(sf, 2.2));
      c += 0.22 * (1.0 - smoothstep(0.0, 1.2 / res.x, abs(uv.x - x0 - 0.01 * sin(uv.y * 7.0 + sf))));
    }
    c *= 1.0 - 0.4 * pow(length(uv - 0.5) * 1.35, 2.5);
  } else {
    // Scan lines: dark lines across the picture, a soft bright band rolling down, a slight flicker
    c = tex(p);
    float lines = 0.5 + 0.5 * sin(uv.y * 270.0 * 6.28318);
    c *= mix(0.62, 1.05, lines);
    float roll = fract(uv.y - t * 0.25);
    c += 0.07 * exp(-pow((roll - 0.5) * 9.0, 2.0));
    c *= 0.97 + 0.03 * sin(t * 50.0);
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

let ready: { gl: WebGL2RenderingContext; canvas: OffscreenCanvas; u: Record<string, WebGLUniformLocation | null> } | null = null;
let broken = false;

function setup() {
  if (ready || broken) return ready;
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) {
    broken = true; // shortcut: without WebGL2 effects are skipped, like colour; every phone this app targets has it
    return null;
  }
  const u = fullFrame(gl, FRAG, ['img', 't', 'kind', 'res']);
  gl.uniform1i(u.img, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  ready = { gl, canvas, u };
  return ready;
}

// Restyles what is already in `ctx` with every effect clip running at `t`, in track order (lowest first).
export function applyEffects(ctx: Ctx, W: number, H: number, p: Project, t: Us) {
  for (const track of p.tracks) {
    if (track.kind !== 'effect' || track.hidden) continue;
    for (const c of track.clips) {
      if (c.kind !== 'effect' || t < c.start || t >= c.start + c.duration) continue;
      const kind = EFFECTS.findIndex((e) => e.id === c.effect);
      const r = kind >= 0 ? setup() : null;
      if (!r) continue;
      const { gl, canvas, u } = r;
      canvas.width = W;
      canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas as TexImageSource);
      gl.uniform1f(u.t, (t - c.start) / SEC);
      gl.uniform1f(u.kind, kind);
      gl.uniform2f(u.res, W, H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.drawImage(canvas, 0, 0, W, H);
    }
  }
}
