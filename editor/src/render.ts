import { SHAPES, glyphAt, poseAt, type Copy, type Pose, type Reveal } from './anim.ts';
import { textImage } from './text';
import { STAB_ZOOM, correctionAt, flickerGainAt } from './stabilize.ts';
import { transformAt } from './keyframes.ts';
import { sourceAt } from './timing.ts';
import { mergePose, transitionById } from './transitions.ts';
import { graded } from './colour';
import { applyEffects } from './effects';
import { cutout } from './segment';
import { SEC, fitContain } from './timeline.ts';
import type { MediaClip, Project, TextClip, Us } from './schema';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let mosaic: OffscreenCanvas | null = null;

function sourceSize(img: CanvasImageSource): [number, number] {
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) return [img.videoWidth, img.videoHeight]; // no DOM in the export worker
  if (img instanceof VideoFrame) return [img.displayWidth, img.displayHeight];
  const s = img as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  return [Number(s.width), Number(s.height)];
}

function clipTo(ctx: Ctx, r: Reveal, w: number, h: number) {
  ctx.beginPath();
  switch (r.kind) {
    case 'rect':
      ctx.rect(r.x0 * w, r.y0 * h, (r.x1 - r.x0) * w, (r.y1 - r.y0) * h);
      break;
    case 'circle': {
      const cx = r.cx ?? 0;
      const cy = r.cy ?? 0;
      ctx.arc(cx * w, cy * h, r.r * Math.hypot(w * (0.5 + Math.abs(cx)), h * (0.5 + Math.abs(cy))), 0, Math.PI * 2);
      break;
    }
    case 'clock':
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, Math.hypot(w, h), -Math.PI / 2, -Math.PI / 2 + (r.deg * Math.PI) / 180);
      ctx.closePath();
      break;
    case 'grid': {
      const cw = w / r.n;
      const ch = h / r.n;
      for (let i = 0; i < r.n; i++)
        for (let j = 0; j < r.n; j++) ctx.rect(-w / 2 + (i + 0.5 - r.amount / 2) * cw, -h / 2 + (j + 0.5 - r.amount / 2) * ch, cw * r.amount, ch * r.amount);
      break;
    }
    case 'blinds':
      for (let i = 0; i < r.n; i++) {
        if (r.vertical) ctx.rect(-w / 2 + (i * w) / r.n, -h / 2, (w / r.n) * r.amount, h);
        else ctx.rect(-w / 2, -h / 2 + (i * h) / r.n, w, (h / r.n) * r.amount);
      }
      break;
    case 'wedge':
      ctx.moveTo(0, h / 2);
      ctx.arc(0, h / 2, Math.hypot(w, h), Math.PI, Math.PI + (r.deg * Math.PI) / 180);
      ctx.closePath();
      break;
    case 'shape': {
      const s = SHAPES[r.shape];
      const R = (r.r * s.cover * Math.hypot(w, h)) / 2;
      const turn = ((r.rot ?? 0) * Math.PI) / 180;
      s.pts.forEach(([x, y], i) => {
        const px = (x * Math.cos(turn) - y * Math.sin(turn)) * R;
        const py = (x * Math.sin(turn) + y * Math.cos(turn)) * R;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      break;
    }
    case 'diagonal': {
      // the half-plane x/w + y/h <= 2·amount - 1, as a triangle big enough to cover the box
      const a = r.amount * 2 - 1;
      ctx.moveTo(-w, -h);
      ctx.lineTo((a + 1) * w, -h);
      ctx.lineTo(-w, (a + 1) * h);
      ctx.closePath();
      break;
    }
  }
  ctx.clip();
}

function drawImage(ctx: Ctx, img: CanvasImageSource, w: number, h: number, pose: Pose, H: number) {
  let src = img;
  if (pose.pixel > 0.002) {
    const block = Math.max(1, pose.pixel * H);
    mosaic ??= new OffscreenCanvas(1, 1);
    mosaic.width = Math.max(1, Math.round(w / block));
    mosaic.height = Math.max(1, Math.round(h / block));
    mosaic.getContext('2d')!.drawImage(img, 0, 0, mosaic.width, mosaic.height);
    src = mosaic;
    ctx.imageSmoothingEnabled = false;
  }
  if (pose.strips) {
    const [iw, ih] = sourceSize(src);
    const n = pose.strips.length;
    pose.strips.forEach((off, i) => ctx.drawImage(src, 0, (i * ih) / n, iw, ih / n, -w / 2 + off * w, -h / 2 + (i * h) / n, w, h / n));
  } else {
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
  }
  ctx.imageSmoothingEnabled = true;
}

// Draws one clip frame into a W x H canvas with an animation pose. Preview and export both come through here.
// `box` places the image (centre and size in canvas pixels); without it the image is fitted to the middle of the frame.
export function drawClip(ctx: Ctx, img: CanvasImageSource, srcW: number, srcH: number, W: number, H: number, pose: Pose, box?: { cx: number; cy: number; w: number; h: number }) {
  const { w, h } = box ?? fitContain(srcW, srcH, W, H);
  const rad = Math.PI / 180;
  ctx.save();
  ctx.translate((box?.cx ?? W / 2) + pose.x * W, (box?.cy ?? H / 2) + pose.y * H);
  ctx.translate(pose.px * w, pose.py * h);
  ctx.rotate(pose.rot * rad);
  if (pose.skew) ctx.transform(1, 0, Math.tan(pose.skew * rad), 1, 0, 0);
  ctx.scale(pose.scale * pose.sx, pose.scale * pose.sy);
  ctx.translate(-pose.px * w, -pose.py * h);
  const filter = [
    pose.blur > 0 && `blur(${(pose.blur * H).toFixed(2)}px)`,
    pose.gray > 0 && `grayscale(${pose.gray})`,
    pose.bright !== 1 && `brightness(${pose.bright})`,
    pose.invert > 0 && `invert(${pose.invert})`,
    pose.hue !== 0 && `hue-rotate(${pose.hue.toFixed(1)}deg)`,
    pose.sat !== 1 && `saturate(${pose.sat})`,
    pose.sepia > 0 && `sepia(${pose.sepia})`,
    pose.contrast !== 1 && `contrast(${pose.contrast})`,
  ].filter(Boolean);
  const draws: Copy[] = pose.copies ?? [{}];
  for (const c of draws) {
    ctx.save();
    ctx.translate((c.dx ?? 0) * W, (c.dy ?? 0) * H);
    ctx.scale((c.scale ?? 1) * (c.sx ?? 1), c.scale ?? 1);
    ctx.globalAlpha = pose.alpha * (c.alpha ?? 1);
    const reveal = c.reveal ?? pose.reveal;
    if (reveal) clipTo(ctx, reveal, w, h);
    ctx.filter = filter.length ? filter.join(' ') : 'none';
    drawImage(ctx, img, w, h, pose, H);
    if (pose.flash > 0) {
      ctx.filter = 'none';
      ctx.globalAlpha = pose.alpha * (c.alpha ?? 1) * pose.flash;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }
  ctx.restore();
}

// Where a text or overlay was drawn, in canvas pixels, for tapping and dragging on the preview.
export interface TextBox {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

function drawText(ctx: Ctx, W: number, H: number, c: TextClip, t: Us): TextBox {
  const glyph = glyphAt(c, t);
  const img = textImage(c, W, H, glyph);
  const tr = transformAt(c, t);
  const box = { cx: tr.x * W, cy: tr.y * H, w: img.w * tr.scale, h: img.h * tr.scale };
  const pose = poseAt(c, t);
  drawClip(ctx, img.canvas, img.w, img.h, W, H, { ...pose, rot: pose.rot + tr.rotation, alpha: pose.alpha * tr.opacity }, box);
  return { id: c.id, ...box, rot: tr.rotation };
}

// Steadying and deflicker ride on the animation pose: a small zoom plus the shift that cancels the shake, and a brightness gain.
function withQuality(p: Project, c: MediaClip, t: Us, pose: Pose, box: { w: number; h: number }, W: number, H: number): Pose {
  const q = c.quality;
  const s = p.assets[c.assetId].shake;
  if (!q || !s || c.kind !== 'video' || (!q.stabilize && !q.deflicker)) return pose;
  const sec = sourceAt(c, Math.min(c.duration, Math.max(0, t))) / SEC;
  const out = { ...pose };
  if (q.stabilize) {
    const k = correctionAt(s, sec, q.stabilize);
    const z = STAB_ZOOM[q.stabilize];
    out.scale *= z;
    out.x += (k.dx * box.w * z) / W; // drift is measured in fractions of the clip's own width and height
    out.y += (k.dy * box.h * z) / H;
    out.rot += k.rot;
  }
  if (q.deflicker) out.bright *= flickerGainAt(s, sec);
  return out;
}

type Crop = MediaClip['crop'];
const fullCrop = (c: Crop | undefined) => !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1 && !c.rotate && !c.mirror);

// The picture's size after cropping and quarter turns.
export function cropSize(a: { width: number; height: number }, c: Crop | undefined): [number, number] {
  if (fullCrop(c)) return [a.width, a.height];
  const w = Math.max(1, c!.w * a.width);
  const h = Math.max(1, c!.h * a.height);
  return c!.rotate % 180 ? [h, w] : [w, h];
}

let cropCanvas: OffscreenCanvas | null = null;
function cropped(img: CanvasImageSource, c: Crop | undefined): CanvasImageSource {
  if (fullCrop(c)) return img;
  const [iw, ih] = sourceSize(img);
  const sw = Math.max(1, c!.w * iw);
  const sh = Math.max(1, c!.h * ih);
  cropCanvas ??= new OffscreenCanvas(1, 1);
  cropCanvas.width = Math.round(c!.rotate % 180 ? sh : sw);
  cropCanvas.height = Math.round(c!.rotate % 180 ? sw : sh);
  const ctx = cropCanvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, cropCanvas.width / 2, cropCanvas.height / 2);
  ctx.rotate((c!.rotate * Math.PI) / 180);
  if (c!.mirror) ctx.scale(-1, 1);
  ctx.drawImage(img, c!.x * iw, c!.y * ih, sw, sh, -sw / 2, -sh / 2, sw, sh);
  return cropCanvas;
}

export const overlayClips = (p: Project) => p.tracks.filter((tr) => tr.kind === 'overlay' && !tr.hidden).flatMap((tr) => tr.clips as MediaClip[]);

export interface Visible {
  clip: MediaClip;
  local: Us; // clip time; outside 0..duration during a transition
  extra: Partial<Pose> | null; // the transition's pose
  main: boolean;
}

// Which pictures make up the frame at `t`, bottom to top: the main clip (two of them during a transition), then overlays.
export function visibleAt(p: Project, t: Us): Visible[] {
  const main = p.tracks[0].clips as MediaClip[];
  const out: Visible[] = [];
  const tr = p.transitions
    .map((x) => ({ x, b: main.find((c) => c.id === x.toClipId) }))
    .find(({ x, b }) => b && t >= b.start - x.duration / 2 && t < b.start + x.duration / 2);
  const a = tr && main.find((c) => c.id === tr.x.fromClipId);
  if (tr && tr.b && a) {
    const pair = transitionById(tr.x.presetId).pair((t - (tr.b.start - tr.x.duration / 2)) / tr.x.duration);
    out.push({ clip: a, local: t - a.start, extra: pair.a, main: true }, { clip: tr.b, local: t - tr.b.start, extra: pair.b, main: true });
  } else {
    const c = main.find((x) => t >= x.start && t < x.start + x.duration) ?? main.at(-1);
    if (c) out.push({ clip: c, local: Math.min(c.duration, t - c.start), extra: null, main: true });
  }
  for (const c of overlayClips(p)) if (t >= c.start && t < c.start + c.duration) out.push({ clip: c, local: t - c.start, extra: null, main: false });
  return out;
}

// `personOnly` draws just the person (over text set behind them).
function drawMedia(ctx: Ctx, W: number, H: number, p: Project, v: Visible, img: CanvasImageSource, background: boolean, personOnly = false): TextBox {
  const c = v.clip;
  const a = p.assets[c.assetId];
  const [ew, eh] = cropSize(a, c.crop);
  const local = Math.min(c.duration, Math.max(0, v.local));
  const tr = transformAt(c, local);
  const fit = fitContain(ew, eh, W, H);
  const box = { cx: tr.x * W, cy: tr.y * H, w: fit.w * tr.scale, h: fit.h * tr.scale };
  const k = Math.min(1, Math.max(box.w, box.h, 1) / Math.max(ew, eh)); // grade at the size it is drawn, never above the source
  let src = graded(cropped(img, c.crop), ew * k, eh * k, c);
  if (c.cutout || personOnly) {
    // One mask per frame: a playing video's own time, a photo once, an export frame by its clip time.
    const frame = typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement ? img.currentTime : c.kind === 'photo' ? 0 : v.local;
    const key = `${c.id}|${frame}|${Math.round(ew * k)}x${Math.round(eh * k)}|${JSON.stringify(c.crop)}`;
    src = cutout(src, ew * k, eh * k, key, personOnly ? { bg: 'clear' } : c.cutout!);
  }
  // Blurred background: the same picture, filling the frame, behind the clip (for a landscape clip in a portrait frame).
  if (background && !personOnly && p.canvas.kind === 'blur') {
    const s = Math.max(W / ew, H / eh) * 1.08;
    ctx.filter = `blur(${(p.canvas.level * 0.012 * Math.max(W, H)).toFixed(1)}px) brightness(0.85)`;
    ctx.drawImage(src, (W - ew * s) / 2, (H - eh * s) / 2, ew * s, eh * s);
    ctx.filter = 'none';
  }
  let pose = withQuality(p, c, v.local, poseAt(c, local), box, W, H);
  if (v.extra) pose = mergePose(pose, v.extra);
  drawClip(ctx, src, ew, eh, W, H, { ...pose, rot: pose.rot + tr.rotation, alpha: pose.alpha * tr.opacity }, box);
  return { id: c.id, ...box, rot: tr.rotation };
}

// One frame at timeline time `t`. `frames` holds each visible clip's picture by clip id (missing or null while it decodes).
// Returns where each overlay and text was drawn, for tapping and dragging on the preview.
export function renderFrame(ctx: Ctx, W: number, H: number, p: Project, t: Us, frames: Map<string, CanvasImageSource | null>): TextBox[] {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.canvas.kind === 'colour' ? p.canvas.colour : '#000000';
  ctx.fillRect(0, 0, W, H);
  const boxes: TextBox[] = [];
  const visible = visibleAt(p, t).filter((v) => frames.get(v.clip.id));
  const main = visible.filter((v) => v.main);
  main.forEach((v, i) => drawMedia(ctx, W, H, p, v, frames.get(v.clip.id)!, i === 0));
  const texts = p.tracks.filter((tr) => tr.kind === 'text' && !tr.hidden).flatMap((tr) => tr.clips).filter((c): c is TextClip => c.kind === 'text' && t >= c.start && t < c.start + c.duration);
  // Text behind the person: drawn over the main video, then the person from that video is drawn again on top.
  const behind = texts.filter((c) => c.behind);
  for (const c of behind) boxes.push(drawText(ctx, W, H, c, t - c.start));
  if (behind.length) for (const v of main) drawMedia(ctx, W, H, p, v, frames.get(v.clip.id)!, false, true);
  for (const v of visible) if (!v.main) boxes.push(drawMedia(ctx, W, H, p, v, frames.get(v.clip.id)!, false));
  for (const c of texts) if (!c.behind) boxes.push(drawText(ctx, W, H, c, t - c.start));
  applyEffects(ctx, W, H, p, t);
  ctx.restore();
  return boxes;
}
