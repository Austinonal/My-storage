import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { MediaAsset } from './schema';
import { SEC } from './timeline.ts';

export class ImportError extends Error {
  constructor(readonly code: 'unsupported-format' | 'no-video' | 'no-audio' | 'unsupported-codec' | 'bad-image') {
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

async function probeAudio(file: Blob) {
  const input = openInput(file);
  try {
    if (!(await input.canRead())) throw new ImportError('unsupported-format');
    const audio = await input.getPrimaryAudioTrack();
    if (!audio) throw new ImportError('no-audio');
    if (!(await audio.canDecode())) throw new ImportError('unsupported-codec');
    return { duration: Math.floor((await input.computeDuration([audio])) * SEC), width: 0, height: 0, rotation: 0 as const, hasAudio: true };
  } finally {
    input.dispose();
  }
}

async function probePhoto(file: Blob) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { ...size, duration: 0, rotation: 0 as const, hasAudio: false };
  } catch {
    throw new ImportError('bad-image');
  }
}

// `as: 'audio'` takes only the sound, so a video file works too (that is "extract audio").
// shortcut: copies the whole file into OPFS (doubles storage on the phone); reference Android content URIs once the APK has a native file plugin.
export async function importMedia(projectId: string, file: File, as: 'visual' | 'audio' = 'visual'): Promise<MediaAsset> {
  const kind = as === 'audio' ? 'audio' : file.type.startsWith('image/') ? 'photo' : 'video';
  const probe = kind === 'audio' ? await probeAudio(file) : kind === 'photo' ? await probePhoto(file) : await probeVideo(file);
  const id = crypto.randomUUID();
  const handle = await (await dir('media', projectId)).getFileHandle(id, { create: true });
  await file.stream().pipeTo(await handle.createWritable());
  return { id, kind, name: file.name, file: `media/${projectId}/${id}`, bytes: file.size, ...probe };
}

export async function openMedia(path: string): Promise<File> {
  const [, projectId, id] = path.split('/');
  return (await (await dir('media', projectId)).getFileHandle(id)).getFile();
}

// Saves a file the app made itself (a still frame, a recording, a reversed copy) next to the project's media.
export async function storeMedia(projectId: string, id: string, blob: Blob) {
  const handle = await (await dir('media', projectId)).getFileHandle(id, { create: true });
  await blob.stream().pipeTo(await handle.createWritable());
  return `media/${projectId}/${id}`;
}

// Copies every media file of a project into another project's folder (for "ทำสำเนา").
export async function copyProjectMedia(from: string, to: string) {
  const src = await dir('media', from);
  for await (const [name] of (src as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    await storeMedia(to, name, await (await src.getFileHandle(name)).getFile());
  }
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
