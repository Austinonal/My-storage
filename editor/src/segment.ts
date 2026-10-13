// Person cutout on the device: MediaPipe's selfie segmenter (a 250 KB model that ships with the app) marks which pixels
// belong to a person. Preview, export, auto reframe and "text behind the person" all come through here.
import { ImageSegmenter } from '@mediapipe/tasks-vision';
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelUrl from './models/selfie_segmenter.tflite?url';
import { openMedia } from './media';
import type { MediaClip, Project } from './schema';

type Cutout = NonNullable<MediaClip['cutout']>;

let loading: Promise<ImageSegmenter> | null = null;
let segmenter: ImageSegmenter | null = null;
const backgrounds = new Map<string, ImageBitmap>(); // photo assets used as a new background, by id

// shortcut: the classic (non-module) loader is bundled, so this runs on the main thread only; an export that needs it
// falls back from the worker to the main thread. Bundle vision_wasm_module_internal too if that gets slow.
export function loadSegmenter() {
  loading ??= ImageSegmenter.createFromOptions(
    { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl },
    { baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false },
  )
    .then((s) => (segmenter = s))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export const needsPerson = (p: Project) =>
  p.tracks.some((t) => !t.hidden && t.clips.some((c) => ((c.kind === 'video' || c.kind === 'photo') && !!c.cutout) || (c.kind === 'text' && !!c.behind)));

// Loads the model and the background pictures the project uses, so drawing a frame stays synchronous.
export async function preparePerson(p: Project) {
  if (!needsPerson(p)) return;
  await loadSegmenter();
  for (const t of p.tracks) {
    for (const c of t.clips) {
      const id = (c.kind === 'video' || c.kind === 'photo') && c.cutout?.bg === 'image' ? c.cutout.image : undefined;
      if (id && p.assets[id] && !backgrounds.has(id)) backgrounds.set(id, await createImageBitmap(await openMedia(p.assets[id].file)));
    }
  }
}

const SIDE = 256; // the model looks at 256 x 256
const masks = new Map<string, OffscreenCanvas>(); // the last few, by frame
let small: OffscreenCanvas | null = null;

// Where the person is in `img` (drawn at w x h): a small canvas whose alpha is how sure the model is. Null until loaded.
export function personMask(img: CanvasImageSource, w: number, h: number, key: string): OffscreenCanvas | null {
  const hit = masks.get(key);
  if (hit || !segmenter) return hit ?? null;
  const k = SIDE / Math.max(w, h);
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  small ??= new OffscreenCanvas(1, 1);
  small.width = sw;
  small.height = sh;
  small.getContext('2d')!.drawImage(img, 0, 0, sw, sh);
  const r = segmenter.segment(small);
  try {
    const conf = r.confidenceMasks?.at(-1)?.getAsFloat32Array(); // the person channel is the last one
    if (!conf) return null;
    let mask: OffscreenCanvas;
    if (masks.size >= 8) {
      const [oldest, reuse] = masks.entries().next().value!;
      masks.delete(oldest);
      mask = reuse;
    } else mask = new OffscreenCanvas(1, 1);
    mask.width = sw;
    mask.height = sh;
    const data = new ImageData(sw, sh);
    for (let i = 0; i < conf.length; i++) data.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (conf[i] - 0.3) / 0.4))); // firmer edges
    mask.getContext('2d')!.putImageData(data, 0, 0);
    masks.set(key, mask);
    return mask;
  } finally {
    r.close();
  }
}

let person: OffscreenCanvas | null = null;
let composed: OffscreenCanvas | null = null;

// The picture with only the person kept ('clear'), or the person over a blurred copy or over a background photo.
// Until the model has loaded the picture shows as it is.
export function cutout(img: CanvasImageSource, w: number, h: number, key: string, c: Cutout): CanvasImageSource {
  const mask = personMask(img, w, h, key);
  if (!mask) return img;
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  person ??= new OffscreenCanvas(1, 1);
  person.width = W;
  person.height = H;
  const pc = person.getContext('2d')!;
  pc.drawImage(img, 0, 0, W, H);
  pc.globalCompositeOperation = 'destination-in';
  pc.drawImage(mask, 0, 0, W, H);
  pc.globalCompositeOperation = 'source-over';
  if (c.bg === 'clear') return person;
  composed ??= new OffscreenCanvas(1, 1);
  composed.width = W;
  composed.height = H;
  const oc = composed.getContext('2d')!;
  const bg = c.bg === 'image' && c.image ? backgrounds.get(c.image) : undefined;
  if (c.bg === 'blur') {
    oc.filter = `blur(${(Math.max(W, H) * 0.025).toFixed(1)}px)`;
    oc.drawImage(img, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1); // a little larger, so the blur does not fade at the edges
    oc.filter = 'none';
  } else if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    oc.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  oc.drawImage(person, 0, 0);
  return composed;
}

// Where the person's middle is across the picture (0 = left, 1 = right), or null when nobody is in it.
export function personCentre(img: CanvasImageSource, w: number, h: number, key: string): number | null {
  const mask = personMask(img, w, h, key);
  if (!mask) return null;
  const { data, width } = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height);
  let sum = 0;
  let sx = 0;
  for (let i = 3; i < data.length; i += 4) {
    sum += data[i];
    sx += data[i] * (((i - 3) / 4) % width);
  }
  return sum > 255 * data.length * 0.002 ? (sx / sum + 0.5) / width : null;
}
