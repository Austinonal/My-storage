import {
  AudioBufferSink,
  AudioSample,
  AudioSampleSource,
  CanvasSink,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import type { AudioClip, ExportSettings, MediaClip, Project } from './schema';
import { FRAME_NUDGE, SEC, fitContain, outputSize, projectDuration, sourceOut } from './timeline.ts';
import { deleteExport, exportFile, openInput, openMedia } from './media';
import { renderFrame, visibleAt } from './render';
import { fileSecondsAt } from './timing.ts';
import { loadFonts } from './fonts';
import { prepareLuts } from './colour';

export class ExportError extends Error {
  constructor(readonly code: 'no-video-encoder') {
    super(code);
  }
}

const quality = { low: QUALITY_MEDIUM, medium: QUALITY_HIGH, high: QUALITY_VERY_HIGH };
const SAMPLE_RATE = 48_000;

export interface MixedAudio {
  channels: Float32Array[]; // left, right
  sampleRate: number;
}

// The whole soundtrack, mixed. Main thread only: workers have no OfflineAudioContext.
export async function prepareAudio(p: Project): Promise<MixedAudio | null> {
  const total = projectDuration(p);
  const audible = p.tracks
    .filter((t) => !t.muted)
    .flatMap((t) => t.clips)
    .filter((c): c is MediaClip | AudioClip => (c.kind === 'video' || c.kind === 'audio') && p.assets[c.assetId].hasAudio && c.volume > 0 && c.start < total);
  if (!audible.length) return null;
  const buf = await mixAudio(p, audible, total);
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: buf.sampleRate };
}

class WorkerUnavailable extends Error {}

// Rendering runs in a worker so the app stays responsive; a WebView whose workers lack a needed API falls back to this thread.
export async function exportProject(p: Project, s: ExportSettings, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<File> {
  const mixed = await prepareAudio(p);
  signal.throwIfAborted();
  try {
    await inWorker(p, s, mixed, onProgress, signal);
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e;
    console.warn('export worker unavailable, rendering on the main thread:', e.message);
    await renderVideo(p, s, mixed, onProgress, signal);
  }
  return (await exportFile(p.id)).getFile();
}

function inWorker(p: Project, s: ExportSettings, mixed: MixedAudio | null, onProgress: (fraction: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      return reject(new WorkerUnavailable(String(e)));
    }
    let started = false;
    const cancel = () => w.postMessage({ type: 'cancel' });
    const end = () => {
      w.terminate();
      signal.removeEventListener('abort', cancel);
    };
    signal.addEventListener('abort', cancel, { once: true });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.type === 'progress') {
        started = true;
        return onProgress(m.value);
      }
      end();
      if (m.type === 'done') resolve();
      else if (!started && !signal.aborted && m.name !== 'AbortError') reject(new WorkerUnavailable(m.message));
      else reject(m.code ? new ExportError(m.code) : m.name === 'Error' ? new Error(m.message) : new DOMException(m.message, m.name));
    };
    w.onerror = (e) => {
      e.preventDefault();
      end();
      reject(started ? new Error(e.message) : new WorkerUnavailable(e.message));
    };
    w.postMessage({ type: 'start', project: p, settings: s, audio: mixed } satisfies WorkerStart);
  });
}

export type WorkerStart = { type: 'start'; project: Project; settings: ExportSettings; audio: MixedAudio | null };
export type WorkerReply = { type: 'progress'; value: number } | { type: 'done' } | { type: 'error'; name: string; message: string; code?: ExportError['code'] };

// Renders every frame and writes the finished MP4 into the project's export file.
export async function renderVideo(p: Project, s: ExportSettings, mixed: MixedAudio | null, onProgress: (fraction: number) => void, signal: AbortSignal) {
  const [width, height] = outputSize(p.aspect, s.height);
  const prefer: VideoCodec[] = s.codec === 'hevc' ? ['hevc', 'avc', 'vp9', 'av1'] : ['avc', 'hevc', 'vp9', 'av1'];
  const videoCodec = await getFirstEncodableVideoCodec(prefer, { width, height, frameRate: s.fps, quality: quality[s.bitrate] });
  if (!videoCodec) throw new ExportError('no-video-encoder');

  const total = projectDuration(p);
  const audioCodec = mixed ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: mixed.sampleRate }) : null;

  const handle = await exportFile(p.id);
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(await handle.createWritable()) });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const video = new CanvasSource(canvas, { codec: videoCodec, quality: quality[s.bitrate] });
  output.addVideoTrack(video, { frameRate: s.fps });
  const audio = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);

  try {
    await Promise.all([loadFonts(), prepareLuts(p)]);
    await output.start();
    // Audio goes in first: it is small, so the muxer can hold it while the video streams in.
    if (audio && mixed) {
      const [left, right] = mixed.channels;
      const rate = mixed.sampleRate;
      for (let at = 0; at < left.length; at += rate) {
        const n = Math.min(rate, left.length - at);
        const data = new Float32Array(n * 2);
        data.set(left.subarray(at, at + n));
        data.set(right.subarray(at, at + n), n);
        const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: rate, timestamp: at / rate });
        await audio.add(sample);
        sample.close();
      }
    }
    const frames = Math.max(1, Math.round((total / SEC) * s.fps));
    const frameTime = (i: number) => Math.round((i * SEC) / s.fps);
    const feed = clipFeeder(p, width, height, frames, frameTime);
    for (let n = 0; n < frames; ) {
      signal.throwIfAborted();
      renderFrame(ctx, width, height, p, frameTime(n), await feed.at(n));
      await video.add(n / s.fps, 1 / s.fps);
      onProgress(++n / frames);
    }
    feed.dispose();
    await output.finalize();
  } catch (e) {
    if (output.state !== 'finalized') await output.cancel();
    await deleteExport(p.id);
    throw e;
  }
}

// Pictures for every clip that shows in the frame (main clips, two during a transition, and overlays), pulled in frame order.
// Each video gets its own decoder, opened when it first shows and closed after its last frame; the time asked of it
// follows the clip's speed, speed curve and direction (reversed clips read their reversed copy).
function clipFeeder(p: Project, width: number, height: number, frames: number, frameTime: (n: number) => number) {
  type Feed = { c: MediaClip; frames: number[]; locals: number[]; next: number; bmp?: ImageBitmap; input?: ReturnType<typeof openInput>; it?: AsyncIterator<WrappedCanvas | null> };
  const feeds = new Map<string, Feed>();
  for (let n = 0; n < frames; n++) {
    for (const v of visibleAt(p, frameTime(n))) {
      let f = feeds.get(v.clip.id);
      if (!f) feeds.set(v.clip.id, (f = { c: v.clip, frames: [], locals: [], next: 0 }));
      f.frames.push(n);
      f.locals.push(v.local);
    }
  }
  const close = (f: Feed) => {
    f.bmp?.close();
    f.input?.dispose();
    f.bmp = f.input = f.it = undefined;
  };
  const last = (f: Feed) => f.frames[f.frames.length - 1];
  return {
    async at(n: number) {
      const out = new Map<string, CanvasImageSource | null>();
      for (const f of feeds.values()) if (n > last(f) && (f.bmp || f.input)) close(f); // after its last frame was drawn
      for (const f of feeds.values()) {
        if (f.frames[f.next] !== n) continue;
        f.next++;
        const { c } = f;
        const asset = p.assets[c.assetId];
        if (c.kind === 'photo') {
          f.bmp ??= await createImageBitmap(await openMedia(asset.file));
          out.set(c.id, f.bmp);
          continue;
        }
        if (!f.it) {
          // Decode at the size it is drawn (bigger when zoomed or cropped), never above the source.
          const zoom = Math.min(3, Math.max(0.1, c.transform.scale, ...c.keyframes.filter((k) => k.prop === 'scale').map((k) => k.value)) / Math.min(c.crop.w, c.crop.h));
          const box = fitContain(asset.width, asset.height, width * zoom, height * zoom);
          f.input = openInput(await openMedia(c.reversed && asset.reversedFile ? asset.reversedFile : asset.file));
          const sink = new CanvasSink((await f.input.getPrimaryVideoTrack())!, { width: Math.min(asset.width, box.w), height: Math.min(asset.height, box.h), fit: 'fill', poolSize: 2 });
          f.it = sink.canvasesAtTimestamps(f.locals.map((local) => fileSecondsAt(c, asset.duration, local) + FRAME_NUDGE))[Symbol.asyncIterator]();
        }
        const r = await f.it.next();
        out.set(c.id, r.done ? null : (r.value?.canvas ?? null));
      }
      return out;
    },
    dispose: () => feeds.forEach(close),
  };
}

// shortcut: renders the whole mix in memory (about 23 MB per stereo minute); render in chunks once exports run past a few minutes.
async function mixAudio(p: Project, clips: (MediaClip | AudioClip)[], total: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((total / SEC) * SAMPLE_RATE)), SAMPLE_RATE);
  for (const clip of clips) {
    const asset = p.assets[clip.assetId];
    const input = openInput(await openMedia(asset.file));
    try {
      const sink = new AudioBufferSink((await input.getPrimaryAudioTrack())!);
      const from = clip.sourceIn / SEC;
      const to = sourceOut(clip) / SEC;
      const gain = ctx.createGain();
      gain.gain.value = clip.volume;
      gain.connect(ctx.destination);
      for await (const { buffer, timestamp } of sink.buffers(from, to)) {
        const offset = Math.max(0, from - timestamp);
        const length = Math.min(buffer.duration - offset, to - (timestamp + offset));
        if (length <= 0) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = clip.speed;
        node.connect(gain);
        node.start(clip.start / SEC + Math.max(0, timestamp - from) / clip.speed, offset, length);
      }
    } finally {
      input.dispose();
    }
  }
  return ctx.startRendering();
}
