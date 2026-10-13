// Subtitle files (.srt, .vtt) and pasted lines -> timed captions. Pure, so it is unit-tested.
import type { Us } from './schema';

export interface Caption {
  start: Us;
  duration: Us;
  text: string;
}

const MS = 1000; // microseconds per millisecond
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function toUs(s: string): Us | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const [, h = '0', min, sec, frac] = m;
  return ((Number(h) * 3600 + Number(min) * 60 + Number(sec)) * 1000 + Number(frac.padEnd(3, '0'))) * MS;
}

// SubRip and WebVTT: blocks of "start --> end" followed by text lines. Styling tags and cue settings are dropped.
export function parseSubtitles(file: string): Caption[] {
  const out: Caption[] = [];
  for (const block of file.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = toUs(a);
    const end = toUs(b);
    const text = lines
      .slice(i + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim())
      .filter(Boolean)
      .join('\n');
    if (start === null || end === null || end <= start || !text) continue;
    out.push({ start, duration: end - start, text });
  }
  return out.sort((x, y) => x.start - y.start);
}

// One caption per non-empty line, back to back from `at`.
export function linesToCaptions(text: string, at: Us, seconds: number): Caption[] {
  const d = Math.round(seconds * 1000) * MS;
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((t, i) => ({ start: at + i * d, duration: d, text: t }));
}
