import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Media } from '@capacitor-community/media';
import { Share } from '@capacitor/share';

const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so every base64 chunk decodes on its own
const ALBUM = 'Movies/Editor';
const native = Capacitor.isNativePlatform();

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'video';

async function write(file: File, path: string, directory: Directory) {
  for (let at = 0; at < file.size; at += CHUNK) {
    const data = await base64(file.slice(at, at + CHUNK));
    if (at === 0) await Filesystem.writeFile({ path, data, directory, recursive: true });
    else await Filesystem.appendFile({ path, data, directory });
  }
}

// The WebView cannot hand a blob to Android, so the APK first copies the export into its cache folder (in chunks,
// to keep memory flat). Saving and sharing both start from that copy; only the latest export is kept.
let cached: { file: File; path: string; uri: string } | null = null;
async function inCache(file: File, name: string) {
  if (cached?.file === file) return cached.uri;
  if (cached) await Filesystem.deleteFile({ path: cached.path, directory: Directory.Cache }).catch(() => {});
  const path = `exports/${safeName(name)}.mp4`;
  await write(file, path, Directory.Cache);
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  cached = { file, path, uri };
  return uri;
}

// Returns a description of where the file went on the phone, or null when the browser handled it as a download.
export async function saveVideo(file: File, name: string): Promise<string | null> {
  const safe = safeName(name);
  if (!native) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  }
  const uri = await inCache(file, name);
  try {
    // Public Movies/Editor, added to the gallery's index right away; it stays when the app is uninstalled.
    await Filesystem.mkdir({ path: ALBUM, directory: Directory.ExternalStorage, recursive: true }).catch(() => {}); // already there
    const album = decodeURIComponent((await Filesystem.getUri({ path: ALBUM, directory: Directory.ExternalStorage })).uri.replace(/^file:\/\//, ''));
    await Media.saveVideo({ path: uri, albumIdentifier: album, fileName: `${safe}-${Date.now()}` });
    return 'แกลเลอรี (อัลบั้ม Editor)';
  } catch (e) {
    // Never lose the export: if the gallery refuses, keep the old place.
    console.warn('gallery save failed, writing to Documents:', e);
    const path = `${safe}-${Date.now()}.mp4`;
    await write(file, path, Directory.Documents);
    return `Documents/${path}`;
  }
}

export const canShare = (file: File) => native || !!navigator.canShare?.({ files: [file] });

export async function shareVideo(file: File, name: string) {
  try {
    if (native) await Share.share({ title: name, files: [await inCache(file, name)], dialogTitle: 'แชร์วิดีโอ' });
    else await navigator.share({ files: [file], title: name });
  } catch (e) {
    if (!/cancel|abort/i.test(String((e as Error)?.message ?? e)) && (e as DOMException)?.name !== 'AbortError') throw e; // closing the share sheet is not an error
  }
}
