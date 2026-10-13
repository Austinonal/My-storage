import { CanvasSink } from 'mediabunny';
import { AW, buildTemplate, estimateMotion, features, type Frame, type Motion, type Slot } from './analyze.ts';
import { ImportError, openInput } from './media';

const MAX_SECONDS = 180; // templates are short; this keeps analysis quick on a phone

// Decodes the reference edit at a tiny size and reads its cuts and animations. Nothing leaves the device.
export async function analyzeReference(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Slot[]> {
  const input = openInput(file);
  try {
    if (!(await input.canRead())) throw new ImportError('unsupported-format');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new ImportError('no-video');
    if (!(await track.canDecode())) throw new ImportError('unsupported-codec');
    const end = Math.min(MAX_SECONDS, await input.computeDuration());
    const w = AW;
    const h = Math.max(8, Math.round((AW * (await track.getDisplayHeight())) / (await track.getDisplayWidth())));
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 1 });
    const frames: Frame[] = [];
    for await (const { canvas, timestamp } of sink.canvases(0, end)) {
      signal.throwIfAborted();
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      frames.push(features(ctx.getImageData(0, 0, w, h).data, w, h, timestamp));
      onProgress(0.7 * Math.min(1, timestamp / end));
    }
    const motions: Motion[] = [];
    for (let i = 1; i < frames.length; i++) {
      motions.push(estimateMotion(frames[i - 1], frames[i]));
      if (i % 30 === 0) {
        signal.throwIfAborted();
        onProgress(0.7 + (0.3 * i) / frames.length);
        await new Promise((r) => setTimeout(r));
      }
    }
    return buildTemplate(frames, motions, end);
  } finally {
    input.dispose();
  }
}
