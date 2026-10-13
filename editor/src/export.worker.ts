import { ExportError, renderVideo, type WorkerReply, type WorkerStart } from './export';

let ac: AbortController | null = null;
const reply = (m: WorkerReply) => postMessage(m);

onmessage = async (e: MessageEvent<WorkerStart | { type: 'cancel' }>) => {
  const m = e.data;
  if (m.type === 'cancel') return ac?.abort();
  ac = new AbortController();
  try {
    await renderVideo(m.project, m.settings, m.audio, (value) => reply({ type: 'progress', value }), ac.signal);
    reply({ type: 'done' });
  } catch (err) {
    const x = err instanceof Error || err instanceof DOMException ? err : new Error(String(err));
    reply({ type: 'error', name: x.name, message: x.message, code: err instanceof ExportError ? err.code : undefined });
  }
};
