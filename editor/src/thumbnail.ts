// Thumbnails: reading a reference picture's layout on the device, and the assets a layout needs.
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { findText, nearestAspect, personBox, type Layout, type TextSpot } from './layout.ts';
import { loadSegmenter, personMask } from './segment';
import { importMedia } from './media';
import { placeholderFile } from './screens/TemplateSheet';
import type { MediaAsset } from './schema';

// Text reading (Thai and English) ships with the app in public/ocr (scripts/ocr.mjs), so it works offline.
let reader: Promise<Worker> | null = null;
const own = (path: string) => new URL(path, document.baseURI).href;
function ocr() {
  reader ??= createWorker(['tha', 'eng'], 1, { workerPath: own('ocr/worker.min.js'), corePath: own('ocr/tesseract-core-simd-lstm.wasm.js'), langPath: own('ocr'), workerBlobURL: false, gzip: true })
    .then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return w;
    })
    .catch((e) => {
      reader = null;
      throw e;
    });
  return reader;
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const far = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// One spot, turned level and redrawn as dark letters on white (pixels nearer the letters' colour than the outline's or
// the label's, and than what is outside the spot), then read. Lines read with little confidence or under two letters
// (a collar, a stripe) are dropped; Thai comes back with spaces between letters, and those go too.
async function read(w: Worker, img: ImageBitmap, s: TextSpot) {
  const [pw, ph] = [s.w * img.width * 1.15, s.h * img.height * 1.3];
  const k = Math.min(4, Math.max(0.25, 72 / ph)); // letters about 45 px tall: measured best for Thai display fonts
  const ctx = new OffscreenCanvas(Math.max(8, Math.round(pw * k)), Math.max(8, Math.round(ph * k))).getContext('2d', { willReadFrequently: true })!;
  const { width: cw, height: ch } = ctx.canvas;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((-s.angle * Math.PI) / 180);
  ctx.scale(k, k);
  ctx.drawImage(img, -s.cx * img.width, -s.cy * img.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const source = ctx.getImageData(0, 0, cw, ch);
  const edge = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < cw * ch; i++) {
    const x = i % cw;
    const y = (i - x) / cw;
    if ((x > 1 && y > 1 && x < cw - 2 && y < ch - 2) || source.data[i * 4 + 3] < 128) continue; // past the picture's edge
    for (let c = 0; c < 3; c++) edge[c] += source.data[i * 4 + c];
    n++;
  }
  const outside = edge.map((v) => v / Math.max(1, n));
  const around = s.background ? rgbOf(s.background) : outside;
  const fill = rgbOf(s.fill);
  const other = s.stroke ? rgbOf(s.stroke) : around;
  const letter = (c: number[]) => far(c, fill) < Math.min(far(c, other), far(c, outside)) && far(c, fill) < 160;
  const data = new ImageData(cw, ch);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = source.data[i + 3] > 127 && letter([source.data[i], source.data[i + 1], source.data[i + 2]]) ? 0 : 255;
    data.data.set([v, v, v, 255], i);
  }
  ctx.putImageData(data, 0, 0);
  const { data: out } = await w.recognize(ctx.canvas, {}, { text: true, blocks: true });
  const lines = (out.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).filter((l) => l.confidence >= 55 && (l.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2);
  if (!lines.length) return null;
  // The read lines' own box, back in the picture: a tighter place and size than the block (which may take in a collar).
  const [x0, y0, x1, y1] = [Math.min(...lines.map((l) => l.bbox.x0)), Math.min(...lines.map((l) => l.bbox.y0)), Math.max(...lines.map((l) => l.bbox.x1)), Math.max(...lines.map((l) => l.bbox.y1))];
  const [dx, dy] = [((x0 + x1) / 2 - cw / 2) / k, ((y0 + y1) / 2 - ch / 2) / k];
  const a = (s.angle * Math.PI) / 180;
  return {
    ...s,
    text: lines.map((l) => l.text.replace(/(?<=[\u0E00-\u0E7F])[ \t]+(?=[\u0E00-\u0E7F])/g, '').trim()).join('\n'),
    cx: s.cx + (dx * Math.cos(a) - dy * Math.sin(a)) / img.width,
    cy: s.cy + (dx * Math.sin(a) + dy * Math.cos(a)) / img.height,
    w: (x1 - x0) / k / img.width,
    h: (y1 - y0) / k / img.height,
  };
}

// Where the reference's person and big text are, the text's colours, slant and words, from a 320-pixel-wide copy.
// Each text candidate is read; one that reads as nothing is a busy patch, not text, and is dropped. That also lets text
// over the person count. Without the reader (it failed to load) candidates on the person are dropped instead.
export async function analyzeThumbnail(file: File, onStatus: (s: string) => void = () => {}): Promise<Layout> {
  onStatus('กำลังหาคนในรูป…');
  await loadSegmenter();
  const bmp = await createImageBitmap(file);
  const W = 320;
  const H = Math.max(2, Math.round((W * bmp.height) / bmp.width));
  const aspect = nearestAspect(bmp.width, bmp.height);
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, W, H);
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const mask = personMask(ctx.canvas, W, H, `reference|${crypto.randomUUID()}`);
  let alpha: Uint8Array | null = null;
  if (mask) {
    const m = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    m.drawImage(mask, 0, 0, W, H);
    const d = m.getImageData(0, 0, W, H).data;
    alpha = Uint8Array.from({ length: W * H }, (_, i) => d[i * 4 + 3]);
  }
  const onPerson = alpha && alpha.map((a) => (a > 64 ? 1 : 0));
  let texts: TextSpot[];
  try {
    onStatus('กำลังอ่านข้อความในรูป…');
    const w = await ocr();
    texts = [];
    for (const s of findText(rgba, W, H, null, 16)) {
      const r = await read(w, bmp, s);
      if (r) texts.push(s.background ? { ...s, text: r.text } : r); // a label keeps its box: its font size comes from that
      if (texts.length === 8) break;
    }
  } catch (e) {
    console.warn('text reader unavailable, keeping text off the person:', e);
    texts = findText(rgba, W, H, onPerson);
  } finally {
    bmp.close();
  }
  return { aspect, person: alpha && personBox(alpha, W, H), texts };
}

// The reference kept with the project (for its colours later) and, when it shows a person, an empty portrait slot.
export async function layoutAssets(projectId: string, reference: File, layout: Layout): Promise<{ reference: MediaAsset; slot: MediaAsset | null }> {
  return {
    reference: await importMedia(projectId, reference),
    slot: layout.person ? { ...(await importMedia(projectId, await placeholderFile('3:4'))), placeholder: true } : null,
  };
}
