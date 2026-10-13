import {
  AudioBufferSink,
  AudioSample,
  AudioSampleSource,
  CanvasSink,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { ImportError, openInput, openMedia } from './media';
import type { MediaAsset } from './schema';

// Playing backwards needs a reversed copy: decoders only run forwards. The copy is made once per video, half a second at a
// time from the end (only that half second is held in memory), at up to 1080p; its sound is reversed too.
// The original stays; reversed clips read the copy, where original time t sits at (duration - t).
export async function buildReversed(projectId: string, asset: MediaAsset, onProgress: (f: number) => void, signal: AbortSignal) {
  const input = openInput(await openMedia(asset.file));
  const id = `${asset.id}-rev`;
  const path = `media/${projectId}/${id}`;
  const handle = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('media')).getDirectoryHandle(projectId);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new ImportError('unsupported-codec');
    const end = await input.computeDuration();
    const k = Math.min(1, 1080 / Math.min(asset.width, asset.height));
    const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
    const [w, h] = [even(asset.width), even(asset.height)];
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'hevc', 'av1'], { width: w, height: h });
    if (!codec) throw new ImportError('unsupported-codec');
    const audioTrack = asset.hasAudio ? await input.getPrimaryAudioTrack() : null;
    const audioCodec = audioTrack && (await audioTrack.canDecode()) ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 }) : null;

    const file = await handle.getFileHandle(id, { create: true });
    const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(await file.createWritable()) });
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    const video = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH });
    output.addVideoTrack(video);
    const audio = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
    if (audio) output.addAudioTrack(audio);
    try {
      await output.start();
      // Sound first (small): the whole track, sample order flipped.
      if (audio && audioTrack) {
        const parts: AudioBuffer[] = [];
        for await (const { buffer } of new AudioBufferSink(audioTrack).buffers()) parts.push(buffer);
        const rate = parts[0]?.sampleRate ?? 48000;
        const length = parts.reduce((n, b) => n + b.length, 0);
        const chans = [new Float32Array(length), new Float32Array(length)];
        let at = length;
        for (const b of parts) {
          at -= b.length;
          for (let c = 0; c < 2; c++) {
            const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
            for (let i = 0; i < b.length; i++) chans[c][at + b.length - 1 - i] = src[i];
          }
        }
        for (let i = 0; i < length; i += rate) {
          const n = Math.min(rate, length - i);
          const data = new Float32Array(n * 2);
          data.set(chans[0].subarray(i, i + n));
          data.set(chans[1].subarray(i, i + n), n);
          const s = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: rate, timestamp: i / rate });
          await audio.add(s);
          s.close();
        }
      }
      const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 1 });
      const step = 0.5;
      for (let to = end; to > 0; to -= step) {
        signal.throwIfAborted();
        const from = Math.max(0, to - step);
        const frames: { bmp: ImageBitmap; t: number; d: number }[] = [];
        for await (const f of sink.canvases(from, to)) {
          if (f.timestamp < from || f.timestamp >= to) continue;
          frames.push({ bmp: await createImageBitmap(f.canvas), t: f.timestamp, d: f.duration });
        }
        for (const f of frames.reverse()) {
          ctx.drawImage(f.bmp, 0, 0, w, h);
          f.bmp.close();
          await video.add(Math.max(0, end - f.t - f.d), f.d);
        }
        onProgress(1 - from / end);
      }
      await output.finalize();
    } catch (e) {
      if (output.state !== 'finalized') await output.cancel();
      await handle.removeEntry(id).catch(() => {});
      throw e;
    }
    return path;
  } finally {
    input.dispose();
  }
}
