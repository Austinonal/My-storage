import { AudioBufferSink, CanvasSink } from 'mediabunny';
import { openInput, openMedia } from './media';
import type { MediaAsset } from './schema';
import { SEC } from './timeline.ts';

// Pictures for the timeline: a filmstrip per video or photo, a loudness curve per sound. Built once per asset per session.
export const THUMB_H = 96; // px; the main track is 56 css px tall, so this is sharp at 2x
export const PEAK_RATE = 50; // loudness values per second of source

export interface Strip {
  url: string; // frames side by side, each w x THUMB_H
  w: number;
  step: number; // seconds of source between frames
  count: number;
}

const strips = new Map<string, Promise<Strip | null>>();
const peaks = new Map<string, Promise<Float32Array | null>>();

export const stripOf = (a: MediaAsset) => {
  let s = strips.get(a.id);
  if (!s) {
    s = makeStrip(a).catch(() => null); // a missing picture never blocks editing
    strips.set(a.id, s);
  }
  return s;
};

export const peaksOf = (a: MediaAsset) => {
  let s = peaks.get(a.id);
  if (!s) {
    s = makePeaks(a).catch(() => null);
    peaks.set(a.id, s);
  }
  return s;
};

async function makeStrip(a: MediaAsset): Promise<Strip | null> {
  if (a.kind === 'audio' || a.placeholder || !a.width || !a.height) return null;
  const w = Math.round(Math.min(THUMB_H * 2, Math.max(THUMB_H / 2, (THUMB_H * a.width) / a.height)));
  const seconds = a.duration / SEC;
  const count = a.kind === 'photo' ? 1 : Math.min(60, Math.max(1, Math.ceil(seconds)));
  const step = a.kind === 'photo' ? 1 : seconds / count;
  const out = new OffscreenCanvas(w * count, THUMB_H);
  const ctx = out.getContext('2d')!;
  const blob = await openMedia(a.file);
  if (a.kind === 'photo') {
    const bmp = await createImageBitmap(blob);
    const s = Math.max(w / bmp.width, THUMB_H / bmp.height);
    ctx.drawImage(bmp, (w - bmp.width * s) / 2, (THUMB_H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    bmp.close();
  } else {
    const input = openInput(blob);
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) return null;
      const sink = new CanvasSink(track, { width: w, height: THUMB_H, fit: 'cover', poolSize: 1 });
      let i = 0;
      for await (const frame of sink.canvasesAtTimestamps(Array.from({ length: count }, (_, k) => (k + 0.5) * step))) {
        if (frame) ctx.drawImage(frame.canvas, i * w, 0);
        i++;
      }
    } finally {
      input.dispose();
    }
  }
  return { url: URL.createObjectURL(await out.convertToBlob({ type: 'image/jpeg', quality: 0.7 })), w, step, count };
}

async function makePeaks(a: MediaAsset): Promise<Float32Array | null> {
  if (!a.hasAudio || a.placeholder) return null;
  const input = openInput(await openMedia(a.file));
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const out = new Float32Array(Math.ceil((a.duration / SEC) * PEAK_RATE) + 1);
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const ch = buffer.getChannelData(0); // one channel is enough for a picture
      const k0 = timestamp * PEAK_RATE;
      const perPeak = buffer.sampleRate / PEAK_RATE;
      for (let i = 0; i < ch.length; i += 8) {
        const k = Math.floor(k0 + i / perPeak);
        const v = Math.abs(ch[i]);
        if (k >= 0 && k < out.length && v > out[k]) out[k] = v;
      }
    }
    let max = 0;
    for (const v of out) max = Math.max(max, v);
    if (max > 0) for (let k = 0; k < out.length; k++) out[k] /= max;
    return out;
  } finally {
    input.dispose();
  }
}

// A file's sound from `from` to `to` seconds as one channel (the sides averaged), for finding beats and speech.
export async function monoOf(a: MediaAsset, from = 0, to = a.duration / SEC) {
  const input = openInput(await openMedia(a.file));
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const parts: Float32Array[] = [];
    let rate = 0;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(from, to)) {
      rate = buffer.sampleRate;
      const skip = Math.max(0, Math.round((from - timestamp) * rate));
      const take = Math.min(buffer.length, Math.round((to - timestamp) * rate));
      if (take <= skip) continue;
      const out = new Float32Array(take - skip);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < out.length; i++) out[i] += ch[skip + i] / buffer.numberOfChannels;
      }
      parts.push(out);
    }
    const samples = new Float32Array(parts.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of parts) {
      samples.set(x, at);
      at += x.length;
    }
    return rate ? { samples, rate } : null;
  } finally {
    input.dispose();
  }
}

const covers = new Map<string, Promise<string | null>>();

// One frame (half a second in, or the photo) as a small JPEG, for the project list.
export function coverOf(a: MediaAsset) {
  let c = covers.get(a.id);
  if (!c) {
    c = (async () => {
      if (a.kind === 'audio' || !a.width) return null;
      const w = 320;
      const h = Math.max(1, Math.round((w * a.height) / a.width));
      const out = new OffscreenCanvas(w, h);
      const ctx = out.getContext('2d')!;
      const blob = await openMedia(a.file);
      if (a.kind === 'photo') {
        const bmp = await createImageBitmap(blob);
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close();
      } else {
        const input = openInput(blob);
        try {
          const track = await input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) return null;
          const frame = await new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 1 }).getCanvas(Math.min(0.5, a.duration / SEC / 2));
          if (!frame) return null;
          ctx.drawImage(frame.canvas, 0, 0);
        } finally {
          input.dispose();
        }
      }
      return URL.createObjectURL(await out.convertToBlob({ type: 'image/jpeg', quality: 0.75 }));
    })().catch(() => null);
    covers.set(a.id, c);
  }
  return c;
}
