import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so every base64 chunk decodes on its own

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Returns where the file went on the phone, or null when the browser handled it as a download.
export async function saveVideo(file: File, name: string): Promise<string | null> {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'video';
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  }
  // The WebView cannot download blobs, so the APK writes the file itself, in chunks to keep memory flat.
  const path = `${safe}-${Date.now()}.mp4`;
  for (let at = 0; at < file.size; at += CHUNK) {
    const data = await base64(file.slice(at, at + CHUNK));
    if (at === 0) await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Documents });
  }
  return `Documents/${path}`;
}
