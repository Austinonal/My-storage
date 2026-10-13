// Speech to text with Whisper, on the device, off the main thread. The model downloads once (about 80 MB) from the
// model hub and is kept in the browser's cache for the next times; the ONNX runtime ships with the app.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasm }; // the bundled copy, not the CDN

const MODEL = 'Xenova/whisper-base';

export type SpeechRequest = { audio: Float32Array; language: string }; // 16 kHz mono
export type SpeechReply =
  | { type: 'download'; fraction: number }
  | { type: 'listening' }
  | { type: 'done'; chunks: { timestamp: [number, number | null]; text: string }[] }
  | { type: 'error'; message: string };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const files = new Map<string, { loaded: number; total: number }>();
const reply = (m: SpeechReply) => postMessage(m);

onmessage = async (e: MessageEvent<SpeechRequest>) => {
  try {
    asr ??= pipeline('automatic-speech-recognition', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (x: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (x.status !== 'progress' || !x.file || !x.total) return;
        files.set(x.file, { loaded: x.loaded ?? 0, total: x.total });
        const all = [...files.values()].reduce((a, f) => ({ loaded: a.loaded + f.loaded, total: a.total + f.total }), { loaded: 0, total: 0 });
        reply({ type: 'download', fraction: all.loaded / all.total });
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    const run = await asr;
    reply({ type: 'listening' });
    const out = await run(e.data.audio, { language: e.data.language, task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    const first = Array.isArray(out) ? out[0] : out;
    reply({ type: 'done', chunks: (first.chunks as { timestamp: [number, number | null]; text: string }[] | undefined) ?? [{ timestamp: [0, null], text: first.text }] });
  } catch (err) {
    asr = null;
    reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
