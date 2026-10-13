// Auto captions: the project's whole soundtrack, as heard in the export, goes to Whisper in a worker; what it hears
// comes back as timed captions.
import { prepareAudio } from './export';
import { chunksToCaptions, type Caption } from './captions';
import type { SpeechReply, SpeechRequest } from './speech.worker';
import type { Project } from './schema';

const RATE = 16_000; // what Whisper listens at

// Both sides averaged and brought down to 16 kHz (each output sample averages the input samples it covers).
function mono16k(channels: Float32Array[], rate: number) {
  const ratio = rate / RATE;
  const out = new Float32Array(Math.floor(channels[0].length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (const ch of channels) for (let k = a; k < b; k++) s += ch[k];
    out[i] = s / ((b - a) * channels.length);
  }
  return out;
}

let worker: Worker | null = null; // kept between runs so the model loads once per session

export async function transcribe(p: Project, language: string, onStatus: (s: { download?: number; listening?: boolean }) => void, signal: AbortSignal): Promise<Caption[]> {
  const mixed = await prepareAudio(p);
  if (!mixed) return [];
  const audio = mono16k(mixed.channels, mixed.sampleRate);
  signal.throwIfAborted();
  worker ??= new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    const stop = () => {
      w.terminate(); // the only way to stop a running model
      worker = null;
      reject(signal.reason);
    };
    signal.addEventListener('abort', stop, { once: true });
    w.onmessage = (e: MessageEvent<SpeechReply>) => {
      const m = e.data;
      if (m.type === 'download') return onStatus({ download: m.fraction });
      if (m.type === 'listening') return onStatus({ listening: true });
      signal.removeEventListener('abort', stop);
      if (m.type === 'done') resolve(chunksToCaptions(m.chunks, audio.length / RATE));
      else reject(new Error(m.message));
    };
    w.onerror = (e) => {
      e.preventDefault();
      signal.removeEventListener('abort', stop);
      worker = null;
      reject(new Error(e.message));
    };
    w.postMessage({ audio, language } satisfies SpeechRequest, [audio.buffer]);
  });
}
