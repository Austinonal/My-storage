// Auto reframe and tracking: both watch the video on the device and turn what they see into keyframes.
import { CanvasSink } from 'mediabunny';
import { ImportError, openInput, openMedia } from './media';
import { clipFeeder } from './export';
import { renderFrame } from './render';
import { loadSegmenter, personCentre } from './segment';
import { grayOf, matchPatch } from './track.ts';
import { sourceAt } from './timing.ts';
import { FRAME_NUDGE, SEC, outputSize } from './timeline.ts';
import type { MediaClip, Project, Us } from './schema';

const average = (xs: number[], i: number, half: number) => {
  const part = xs.slice(Math.max(0, i - half), i + half + 1);
  return part.reduce((s, v) => s + v, 0) / part.length;
};

// Where the person is across the clip (0 = left edge of the cropped picture, 1 = right), every half second, smoothed
// so the virtual camera glides instead of jittering. Frames without anyone keep the last known place.
export async function personPath(p: Project, c: MediaClip, onProgress: (f: number) => void, signal: AbortSignal) {
  await loadSegmenter();
  const asset = p.assets[c.assetId];
  const W = 256;
  const H = Math.max(2, Math.round((W * asset.height) / asset.width));
  const found: (number | null)[] = [];
  const times: Us[] = [];
  if (c.kind === 'photo') {
    const bmp = await createImageBitmap(await openMedia(asset.file));
    found.push(personCentre(bmp, W, H, `reframe|${c.id}`));
    times.push(0);
    bmp.close();
  } else {
    const input = openInput(await openMedia(asset.file));
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new ImportError('unsupported-codec');
      for (let at = 0; at <= c.duration; at += SEC / 4) times.push(at);
      const sink = new CanvasSink(track, { width: W, height: H, fit: 'fill', poolSize: 1 });
      let i = 0;
      for await (const f of sink.canvasesAtTimestamps(times.map((at) => sourceAt(c, at) / SEC + FRAME_NUDGE))) {
        signal.throwIfAborted();
        found.push(f ? personCentre(f.canvas, W, H, `reframe|${c.id}|${i}`) : null);
        onProgress(++i / times.length);
      }
    } finally {
      input.dispose();
    }
  }
  // shortcut: a quarter-turned picture is not followed (it stays centred); turn it back to use reframe on it.
  if (c.crop.rotate) return [{ at: 0, fx: 0.5 }];
  // Into the cropped (and maybe mirrored) picture's own 0..1.
  const inCrop = (x: number) => ((x - c.crop.x) / c.crop.w) * (c.crop.mirror ? -1 : 1) + (c.crop.mirror ? 1 : 0);
  let last = inCrop(found.find((x) => x !== null) ?? 0.5);
  const xs = found.map((x) => (last = x === null ? last : inCrop(x)));
  const smooth = xs.map((_, i) => average(xs, i, 2)).map((_, i, s) => average(s, i, 2));
  return times.map((at, i) => ({ at, fx: smooth[i] })).filter((_, i) => i % 2 === 0 || i === times.length - 1);
}

// Follows the spot at `point` (frame fractions) in the main track from `from` to `to` (timeline times), 10 times a
// second, by rendering the main track small and matching a square around the spot frame to frame.
// Returns how far it moved, in frame fractions, five times a second.
export async function trackSpot(p: Project, from: Us, to: Us, point: { x: number; y: number }, onProgress: (f: number) => void, signal: AbortSignal) {
  const [ow, oh] = outputSize(p.aspect, 1080);
  const W = 240;
  const H = Math.max(2, Math.round((W * oh) / ow));
  const solo: Project = { ...p, tracks: [p.tracks[0]] }; // only what the spot sits on
  const step = SEC / 10;
  const n = Math.max(1, Math.floor((to - from) / step) + 1);
  const time = (i: number) => Math.min(to, from + i * step);
  const feed = clipFeeder(solo, W, H, n, time);
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  const half = Math.round(Math.min(W, H) * 0.04);
  const radius = Math.round(Math.min(W, H) * 0.08);
  let x = point.x * W;
  let y = point.y * H;
  let prev: Float32Array | null = null;
  const path: { at: Us; dx: number; dy: number }[] = [];
  try {
    for (let i = 0; i < n; i++) {
      signal.throwIfAborted();
      renderFrame(ctx, W, H, solo, time(i), await feed.at(i));
      const gray = grayOf(ctx.getImageData(0, 0, W, H).data, W, H);
      if (prev) ({ x, y } = matchPatch(prev, gray, W, H, x, y, half, radius));
      path.push({ at: time(i), dx: x / W - point.x, dy: y / H - point.y });
      prev = gray;
      onProgress((i + 1) / n);
      if (i % 10 === 9) await new Promise((r) => setTimeout(r)); // let the progress show
    }
  } finally {
    feed.dispose();
  }
  const dx = path.map((q) => q.dx);
  const dy = path.map((q) => q.dy);
  return path.map((q, i) => ({ at: q.at, dx: average(dx, i, 1), dy: average(dy, i, 1) })).filter((_, i) => i % 2 === 0 || i === path.length - 1);
}
