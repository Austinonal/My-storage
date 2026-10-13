import { CanvasSink } from 'mediabunny';
import { AW, estimateMotion, features, type Frame, type Motion } from './analyze.ts';
import { ImportError, openInput, openMedia } from './media';
import { sampleImages } from './colour';
import { levelsOf, shakeFrom, type Shake } from './stabilize.ts';
import { SEC, sourceOut } from './timeline.ts';
import type { MediaAsset, MediaClip } from './schema';

// Records how a video's picture drifts and how bright each frame is (small frames, all on the device).
// Done once per video; steadying and deflicker both read it.
export async function recordShake(asset: MediaAsset, onProgress: (f: number) => void, signal: AbortSignal): Promise<Shake> {
  const input = openInput(await openMedia(asset.file));
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new ImportError('unsupported-codec');
    const end = await input.computeDuration();
    const h = Math.max(8, Math.round((AW * (await track.getDisplayHeight())) / (await track.getDisplayWidth())));
    const sink = new CanvasSink(track, { width: AW, height: h, fit: 'fill', poolSize: 1 });
    const frames: Frame[] = [];
    for await (const { canvas, timestamp } of sink.canvases(0, end)) {
      signal.throwIfAborted();
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      frames.push(features(ctx.getImageData(0, 0, AW, h).data, AW, h, timestamp));
      onProgress(0.6 * Math.min(1, timestamp / end));
    }
    const motions: Motion[] = [];
    for (let i = 1; i < frames.length; i++) {
      motions.push(estimateMotion(frames[i - 1], frames[i]));
      if (i % 30 === 0) {
        signal.throwIfAborted();
        onProgress(0.6 + (0.4 * i) / frames.length);
        await new Promise((r) => setTimeout(r));
      }
    }
    return shakeFrom(frames, motions);
  } finally {
    input.dispose();
  }
}

// Auto levels from eight frames of the clip's own range (or the photo).
export async function autoLevels(clip: MediaClip, asset: MediaAsset) {
  return levelsOf(await sampleImages(await openMedia(asset.file), asset.kind === 'photo', clip.sourceIn / SEC, sourceOut(clip) / SEC));
}
