import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findText, nearestAspect, personBox } from './layout.ts';

const W = 320;
const H = 180;
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// A smooth blue-to-purple background; "letters" (yellow blocks with a black outline) at the top left; a busy texture
// at the bottom left; a noisy "person" on the right that the mask covers.
function thumbnail() {
  const px = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, c: number[]) => px.set([...c, 255], (y * W + x) * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [40 + y / 3, 60, 160 + x / 8]);
  for (let k = 0; k < 5; k++) {
    const x0 = 20 + k * 26;
    for (let y = 20; y < 70; y++) for (let x = x0; x < x0 + 20; x++) put(x, y, x - x0 < 3 || x - x0 > 16 || y < 23 || y > 66 ? [0, 0, 0] : [255, 220, 40]);
    for (let y = 30; y < 60; y++) for (let x = x0 + 8; x < x0 + 12; x++) put(x, y, [0, 0, 0]); // the middle of each letter
  }
  for (let y = 110; y < 160; y++) for (let x = 20; x < 120; x++) put(x, y, [rand() * 255, rand() * 255, rand() * 255]);
  const person = new Uint8Array(W * H);
  for (let y = 30; y < H; y++) for (let x = 210; x < 300; x++) if (((x - 255) / 45) ** 2 + ((y - 110) / 80) ** 2 < 1) {
    person[y * W + x] = 1;
    put(x, y, rand() > 0.5 ? [250, 250, 250] : [10, 10, 10]);
  }
  return { px, person };
}

test('thumbnail: the outlined letters are found with their colours; texture and the person are not text', () => {
  const { px, person } = thumbnail();
  const texts = findText(px, W, H, person);
  assert.equal(texts.length, 1, JSON.stringify(texts));
  const t = texts[0];
  assert.ok(Math.abs(t.cx * W - 77) < 8 && Math.abs(t.cy * H - 45) < 8, JSON.stringify(t));
  assert.ok(t.w * W > 110 && t.h * H > 35, JSON.stringify(t));
  assert.equal(t.fill.slice(1, 3), 'ff'); // yellow: lots of red
  assert.ok(parseInt(t.fill.slice(5, 7), 16) < 90, t.fill); // little blue
  assert.equal(t.stroke, '#000000');
});

test('thumbnail: the person box and the frame shape', () => {
  const { person } = thumbnail();
  const b = personBox(Uint8Array.from(person, (v) => v * 255), W, H)!;
  assert.ok(Math.abs(b.cx * W - 255) < 3 && Math.abs(b.w * W - 90) < 4 && Math.abs(b.cy * H - 105) < 4, JSON.stringify(b));
  assert.equal(personBox(new Uint8Array(W * H), W, H), null);
  assert.equal(nearestAspect(1280, 720), '16:9');
  assert.equal(nearestAspect(1080, 1350), '4:5');
  assert.equal(nearestAspect(1000, 990), '1:1');
});
