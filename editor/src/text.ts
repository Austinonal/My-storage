import { fontCss } from './fonts';
import type { TextClip } from './schema';

// Per-letter pose for text presets like typewriter or wave. x / y are in ems.
export interface GlyphPose {
  x: number;
  y: number;
  scale: number;
  sx: number;
  sy: number;
  rot: number;
  alpha: number;
  hue: number;
}
export type GlyphFn = (p: number, i: number, n: number) => Partial<GlyphPose>;
const REST_GLYPH: GlyphPose = { x: 0, y: 0, scale: 1, sx: 1, sy: 1, rot: 0, alpha: 1, hue: 0 };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
const words = new Intl.Segmenter('th', { granularity: 'word' });

let scratch: OffscreenCanvas | null = null;
const measurer = () => (scratch ??= new OffscreenCanvas(1, 1)).getContext('2d')!;

interface Layout {
  px: number;
  lineH: number;
  width: number;
  lines: { width: number; glyphs: { g: string; x: number; w: number }[] }[];
  count: number;
}

// Wraps on Thai word boundaries (the browser's dictionary segmenter), never inside a letter cluster.
function layout(c: TextClip, unit: number, maxWidth: number): Layout {
  const px = Math.max(4, c.style.size * unit);
  const ctx = measurer();
  ctx.font = fontCss(c.style.fontId, px);
  const lines: string[] = [];
  for (const para of c.text.split('\n')) {
    let line = '';
    for (const { segment } of words.segment(para)) {
      if (line && ctx.measureText(line + segment).width > maxWidth) {
        lines.push(line.trimEnd());
        line = segment.trimStart();
      } else line += segment;
    }
    lines.push(line);
  }
  let count = 0;
  const laid = lines.map((text) => {
    let x = 0;
    const glyphs = [...graphemes.segment(text)].map(({ segment }) => {
      const w = ctx.measureText(segment).width;
      const g = { g: segment, x, w };
      x += w;
      return g;
    });
    count += glyphs.length;
    return { width: x, glyphs };
  });
  return { px, lineH: px * 1.35, width: Math.max(1, ...laid.map((l) => l.width)), lines: laid, count };
}

const cache = new Map<string, { canvas: OffscreenCanvas; w: number; h: number }>();

// The text block as an image, sized for a W x H frame. Per-letter animations redraw it every frame; static text is cached.
export function textImage(c: TextClip, W: number, H: number, glyph?: { fn: GlyphFn; p: number }) {
  const unit = Math.min(W, H) / 1080;
  const key = glyph ? '' : JSON.stringify([c.text, c.style, Math.round(W), Math.round(H)]);
  const hit = key && cache.get(key);
  if (hit) return hit;
  const s = c.style;
  const L = layout(c, unit, W * 0.9);
  const stroke = s.stroke ? s.stroke.width * unit : 0;
  const shadow = s.shadow ? (s.shadow.blur + Math.max(Math.abs(s.shadow.dx), Math.abs(s.shadow.dy))) * unit : 0;
  const bgPad = s.background ? L.px * 0.35 : 0;
  const pad = Math.ceil(L.px * 0.6 + stroke + shadow + bgPad);
  const w = Math.ceil(L.width + pad * 2);
  const h = Math.ceil(L.lines.length * L.lineH + pad * 2);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  if (s.background) {
    ctx.fillStyle = s.background.colour;
    ctx.beginPath();
    ctx.roundRect(pad - bgPad, pad - bgPad * 0.6, L.width + bgPad * 2, L.lines.length * L.lineH + bgPad * 1.2, s.background.radius * unit);
    ctx.fill();
  }
  ctx.font = fontCss(s.fontId, L.px);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  let i = 0;
  L.lines.forEach((line, li) => {
    const x0 = pad + (s.align === 'left' ? 0 : s.align === 'right' ? L.width - line.width : (L.width - line.width) / 2);
    const y = pad + (li + 0.5) * L.lineH;
    for (const g of line.glyphs) {
      const gp: GlyphPose = glyph ? { ...REST_GLYPH, ...glyph.fn(glyph.p, i, L.count) } : REST_GLYPH;
      i++;
      if (gp.alpha <= 0.001) continue;
      drawGlyph(ctx, g.g, x0 + g.x + g.w / 2, y, gp, L.px, c, unit);
    }
  });
  const out = { canvas, w, h };
  if (key) {
    if (cache.size > 64) cache.clear();
    cache.set(key, out);
  }
  return out;
}

function drawGlyph(ctx: Ctx, g: string, cx: number, cy: number, gp: GlyphPose, px: number, c: TextClip, unit: number) {
  const s = c.style;
  ctx.save();
  ctx.translate(cx + gp.x * px, cy + gp.y * px);
  ctx.rotate((gp.rot * Math.PI) / 180);
  ctx.scale(gp.scale * gp.sx, gp.scale * gp.sy);
  ctx.globalAlpha = gp.alpha;
  if (gp.hue) ctx.filter = `hue-rotate(${gp.hue}deg)`;
  ctx.textAlign = 'center';
  if (s.shadow) {
    ctx.shadowColor = s.shadow.colour;
    ctx.shadowBlur = s.shadow.blur * unit;
    ctx.shadowOffsetX = s.shadow.dx * unit;
    ctx.shadowOffsetY = s.shadow.dy * unit;
  }
  if (s.stroke && s.stroke.width > 0) {
    ctx.strokeStyle = s.stroke.colour;
    ctx.lineWidth = s.stroke.width * unit * 2; // half of a stroke sits under the fill
    ctx.strokeText(g, 0, 0);
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = s.colour;
  ctx.fillText(g, 0, 0);
  ctx.restore();
}
