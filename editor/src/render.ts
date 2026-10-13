import { SHAPES, glyphAt, poseAt, type Copy, type Pose, type Reveal } from './anim.ts';
import { textImage } from './text';
import { fitContain } from './timeline.ts';
import type { MediaClip, Project, TextClip, Us } from './schema';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let mosaic: OffscreenCanvas | null = null;

function sourceSize(img: CanvasImageSource): [number, number] {
  if (img instanceof HTMLVideoElement) return [img.videoWidth, img.videoHeight];
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
  const tr = c.transform;
  const box = { cx: tr.x * W, cy: tr.y * H, w: img.w * tr.scale, h: img.h * tr.scale };
  const pose = poseAt(c, t);
  drawClip(ctx, img.canvas, img.w, img.h, W, H, { ...pose, rot: pose.rot + tr.rotation, alpha: pose.alpha * tr.opacity }, box);
  return { id: c.id, ...box, rot: tr.rotation };
}

// One frame at timeline time `t`: the main-track clip (`img` is null while its frame is still decoding), then text on top.
// Returns where each visible text was drawn, for tapping and dragging on the preview.
export function renderFrame(ctx: Ctx, W: number, H: number, p: Project, t: Us, clip: MediaClip | undefined, img: CanvasImageSource | null): TextBox[] {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.canvas.kind === 'colour' ? p.canvas.colour : '#000000';
  ctx.fillRect(0, 0, W, H);
  if (clip && img) {
    const a = p.assets[clip.assetId];
    drawClip(ctx, img, a.width, a.height, W, H, poseAt(clip, Math.min(clip.duration, Math.max(0, t - clip.start))));
  }
  const boxes: TextBox[] = [];
  for (const track of p.tracks) {
    if (track.kind !== 'text' || track.hidden) continue;
    for (const c of track.clips) if (c.kind === 'text' && t >= c.start && t < c.start + c.duration) boxes.push(drawText(ctx, W, H, c, t - c.start));
  }
  ctx.restore();
  return boxes;
}
