// Thumbnails: reading a reference picture's layout on the device, and the assets a layout needs.
import { findText, nearestAspect, personBox, type Layout } from './layout.ts';
import { loadSegmenter, personMask } from './segment';
import { importMedia } from './media';
import { placeholderFile } from './screens/TemplateSheet';
import type { MediaAsset } from './schema';

// Where the reference's person and big text are (and the text's colours), from a 320-pixel-wide copy.
export async function analyzeThumbnail(file: File): Promise<Layout> {
  await loadSegmenter();
  const bmp = await createImageBitmap(file);
  const W = 320;
  const H = Math.max(2, Math.round((W * bmp.height) / bmp.width));
  const aspect = nearestAspect(bmp.width, bmp.height);
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const mask = personMask(ctx.canvas, W, H, `reference|${crypto.randomUUID()}`);
  let alpha: Uint8Array | null = null;
  if (mask) {
    const m = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    m.drawImage(mask, 0, 0, W, H);
    const d = m.getImageData(0, 0, W, H).data;
    alpha = Uint8Array.from({ length: W * H }, (_, i) => d[i * 4 + 3]);
  }
  return {
    aspect,
    person: alpha && personBox(alpha, W, H),
    texts: findText(rgba, W, H, alpha && alpha.map((a) => (a > 64 ? 1 : 0))),
  };
}

// The reference kept with the project (for its colours later) and, when it shows a person, an empty portrait slot.
export async function layoutAssets(projectId: string, reference: File, layout: Layout): Promise<{ reference: MediaAsset; slot: MediaAsset | null }> {
  return {
    reference: await importMedia(projectId, reference),
    slot: layout.person ? { ...(await importMedia(projectId, await placeholderFile('3:4'))), placeholder: true } : null,
  };
}
