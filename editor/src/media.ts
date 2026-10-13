import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { MediaAsset } from './schema';
import { SEC } from './timeline.ts';

export class ImportError extends Error {
  constructor(readonly code: 'unsupported-format' | 'no-video' | 'unsupported-codec') {
    super(code);
  }
}

async function root() {
  return navigator.storage.getDirectory();
}

async function dir(name: 'media' | 'exports', sub?: string) {
  const d = await (await root()).getDirectoryHandle(name, { create: true });
  return sub ? d.getDirectoryHandle(sub, { create: true }) : d;
}

export function openInput(blob: Blob) {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
}

async function probeVideo(file: Blob) {
  const input = openInput(file);
  try {
    if (!(await input.canRead())) throw new ImportError('unsupported-format');
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new ImportError('no-video');
    if (!(await video.canDecode())) throw new ImportError('unsupported-codec');
    const audio = await input.getPrimaryAudioTrack();
    return {
      duration: Math.floor((await input.computeDuration()) * SEC),
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      rotation: await video.getRotation(),
      hasAudio: !!audio && (await audio.canDecode()),
    };
  } finally {
    input.dispose();
  }
}

// shortcut: copies the whole file into OPFS (doubles storage on the phone); reference Android content URIs once the APK has a native file plugin.
export async function importVideo(projectId: string, file: File): Promise<MediaAsset> {
  const probe = await probeVideo(file);
  const id = crypto.randomUUID();
  const handle = await (await dir('media', projectId)).getFileHandle(id, { create: true });
  await file.stream().pipeTo(await handle.createWritable());
  return { id, kind: 'video', name: file.name, file: `media/${projectId}/${id}`, bytes: file.size, ...probe };
}

export async function openMedia(path: string): Promise<File> {
  const [, projectId, id] = path.split('/');
  return (await (await dir('media', projectId)).getFileHandle(id)).getFile();
}

async function removeDir(name: 'media' | 'exports', projectId: string) {
  try {
    await (await dir(name)).removeEntry(projectId, { recursive: true });
  } catch (e) {
    if ((e as DOMException).name !== 'NotFoundError') throw e;
  }
}

export async function deleteProjectMedia(projectId: string) {
  await removeDir('media', projectId);
  await removeDir('exports', projectId);
}

export async function exportFile(projectId: string) {
  return (await dir('exports', projectId)).getFileHandle('export.mp4', { create: true });
}

export const deleteExport = (projectId: string) => removeDir('exports', projectId);
