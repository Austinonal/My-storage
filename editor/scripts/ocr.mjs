// Text reading for thumbnails ships with the app (works offline): the tesseract.js worker, its SIMD core and the
// Thai and English data are copied into public/ocr with the fixed names tesseract.js asks for.
import { copyFileSync, mkdirSync } from 'node:fs';

const out = new URL('../public/ocr/', import.meta.url);
const from = (path) => new URL(`../node_modules/${path}`, import.meta.url);
mkdirSync(out, { recursive: true });
for (const [src, name] of [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'tha.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
]) copyFileSync(from(src), new URL(name, out));
