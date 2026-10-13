import {
  AudioBufferSink,
  AudioBufferSource,
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
} from 'mediabunny';
import type { ExportSettings, MediaClip, Project } from './schema';
import { FRAME_NUDGE, SEC, fitContain, outputSize, projectDuration, sourceOut } from './timeline.ts';
import { deleteExport, exportFile, openInput, openMedia } from './media';
import { renderFrame } from './render';

export class ExportError extends Error {
  constructor(readonly code: 'no-video-encoder') {
    super(code);
  }
}

const quality = { low: QUALITY_MEDIUM, medium: QUALITY_HIGH, high: QUALITY_VERY_HIGH };
const SAMPLE_RATE = 48_000;

export async function exportProject(
  p: Project,
  s: ExportSettings,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<File> {
  const [width, height] = outputSize(p.aspect, s.height);
  const prefer: VideoCodec[] = s.codec === 'hevc' ? ['hevc', 'avc', 'vp9', 'av1'] : ['avc', 'hevc', 'vp9', 'av1'];
  const videoCodec = await getFirstEncodableVideoCodec(prefer, { width, height, frameRate: s.fps, quality: quality[s.bitrate] });
  if (!videoCodec) throw new ExportError('no-video-encoder');

  // shortcut: only the main track's video clips are rendered; overlays, text and audio tracks come with those features.
  const clips = p.tracks[0].clips as MediaClip[];
  const total = projectDuration(p);
  const wantsAudio = !p.tracks[0].muted && clips.some((c) => p.assets[c.assetId].hasAudio && c.volume > 0);
  const audioCodec = wantsAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }) : null;

  const handle = await exportFile(p.id);
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(await handle.createWritable()) });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const video = new CanvasSource(canvas, { codec: videoCodec, quality: quality[s.bitrate] });
  output.addVideoTrack(video, { frameRate: s.fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);

  try {
    await output.start();
    // Audio goes in first: it is small, so the muxer can hold it while the video streams in.
    if (audio) await audio.add(await mixAudio(p, clips, total));
    const frames = Math.max(1, Math.round((total / SEC) * s.fps));
    const frameTime = (i: number) => Math.round((i * SEC) / s.fps);
    let i = 0;
    for (const clip of clips) {
      const asset = p.assets[clip.assetId];
      const box = fitContain(asset.width, asset.height, width, height);
      const timestamps: number[] = [];
      for (; i < frames && frameTime(i) < clip.start + clip.duration; i++) {
        timestamps.push((clip.sourceIn + (frameTime(i) - clip.start) * clip.speed) / SEC + FRAME_NUDGE);
      }
      const input = openInput(await openMedia(asset.file));
      try {
        const sink = new CanvasSink((await input.getPrimaryVideoTrack())!, { width: box.w, height: box.h, fit: 'fill', poolSize: 2 });
        let n = i - timestamps.length;
        for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
          signal.throwIfAborted();
          renderFrame(ctx, width, height, p, clip, frame?.canvas ?? null, frameTime(n) - clip.start);
          await video.add(n / s.fps, 1 / s.fps);
          onProgress(++n / frames);
        }
      } finally {
        input.dispose();
      }
    }
    await output.finalize();
  } catch (e) {
    if (output.state !== 'finalized') await output.cancel();
    await deleteExport(p.id);
    throw e;
  }
  return handle.getFile();
}

// shortcut: renders the whole mix in memory (about 23 MB per stereo minute); render in chunks once exports run past a few minutes.
async function mixAudio(p: Project, clips: MediaClip[], total: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((total / SEC) * SAMPLE_RATE)), SAMPLE_RATE);
  for (const clip of clips) {
    const asset = p.assets[clip.assetId];
    if (!asset.hasAudio || clip.volume === 0) continue;
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
