import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBeats, speechRanges } from './sound.ts';

const RATE = 22050;
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// A drum loop: a low thump on every beat, a quieter hi-hat on every off-beat, a little hiss throughout.
function drums(bpm: number, seconds: number, offset: number) {
  const s = new Float32Array(RATE * seconds);
  for (let i = 0; i < s.length; i++) s[i] = rand() * 0.005;
  const beat = 60 / bpm;
  for (let k = 0; offset + (k * beat) / 2 < seconds; k++) {
    const on = k % 2 === 0;
    const at = Math.round((offset + (k * beat) / 2) * RATE);
    for (let j = 0; j < RATE * 0.12 && at + j < s.length; j++) {
      const env = Math.exp(-j / (RATE * (on ? 0.04 : 0.01)));
      s[at + j] += on ? 0.8 * env * Math.sin((2 * Math.PI * 60 * j) / RATE) : 0.15 * env * rand();
    }
  }
  return s;
}

test('beats: a 120 BPM loop with off-beat hats reads as 120, on the thumps', () => {
  const { beats, bpm } = findBeats(drums(120, 12, 0.23), RATE);
  assert.ok(Math.abs(bpm - 120) < 2, `bpm ${bpm}`);
  assert.ok(beats.length >= 22 && beats.length <= 24, `count ${beats.length}`);
  beats.forEach((b, i) => assert.ok(Math.abs(b - (0.23 + i * 0.5)) < 0.03, `beat ${i} at ${b}`));
});

test('beats: 95 BPM and silence give sensible answers', () => {
  const { bpm } = findBeats(drums(95, 15, 0), RATE);
  assert.ok(Math.abs(bpm - 95) < 2, `bpm ${bpm}`);
  assert.deepEqual(findBeats(new Float32Array(RATE * 10), RATE).beats, []);
});

// Talking: tone bursts (words) with pauses between them, over background hiss.
function talk(parts: [number, number][], seconds: number) {
  const s = new Float32Array(RATE * seconds);
  for (let i = 0; i < s.length; i++) s[i] = rand() * 0.002;
  for (const [a, b] of parts) for (let i = Math.round(a * RATE); i < b * RATE; i++) s[i] += 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) * (0.6 + 0.4 * Math.sin(i / 400));
  return s;
}

test('speech: long pauses go, short ones stay, a little padding is kept', () => {
  const r = speechRanges(talk([[0.5, 1.5], [2.5, 3.5], [3.7, 4.5]], 6), RATE);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0][0] - 0.4) < 0.03 && Math.abs(r[0][1] - 1.6) < 0.03, JSON.stringify(r));
  assert.ok(Math.abs(r[1][0] - 2.4) < 0.03 && Math.abs(r[1][1] - 4.6) < 0.03, JSON.stringify(r));
});

test('speech: steady sound or silence is left whole', () => {
  assert.deepEqual(speechRanges(talk([[0, 4]], 4), RATE), [[0, 4]]);
  assert.deepEqual(speechRanges(new Float32Array(RATE * 2), RATE), [[0, 2]]);
});
