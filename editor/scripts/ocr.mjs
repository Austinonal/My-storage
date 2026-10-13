// Text reading for thumbnails ships with the app (works offline): the tesseract.js worker, its SIMD core and the
// Thai and English data are copied into public/ocr with the fixed names tesseract.js asks for. The data goes in
// unzipped: the Android build unzips .gz assets itself and drops the extension, so a .gz name would not be found.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const out = new URL('../public/ocr/', import.meta.url);
const from = (path) => new URL(`../node_modules/${path}`, import.meta.url);
mkdirSync(out, { recursive: true });
for (const [src, name] of [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
]) copyFileSync(from(src), new URL(name, out));
for (const lang of ['tha', 'eng']) writeFileSync(new URL(`${lang}.traineddata`, out), gunzipSync(readFileSync(from(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`))));
