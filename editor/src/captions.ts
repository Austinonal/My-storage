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

// Speech recognition output -> captions short enough to read: long stretches are split between words (Thai has no spaces,
// so words come from the browser's word segmenter), each piece getting time in proportion to its length.
export function chunksToCaptions(chunks: { timestamp: [number, number | null]; text: string }[], total: number, maxChars = 30): Caption[] {
  const words = (s: string) => [...new Intl.Segmenter('th', { granularity: 'word' }).segment(s)].map((x) => x.segment);
  const out: Caption[] = [];
  for (const { timestamp, text } of chunks) {
    const clean = text.trim();
    const from = timestamp[0];
    const to = Math.min(total, timestamp[1] ?? total);
    if (!clean || !(to > from)) continue;
    const pieces: string[] = [''];
    for (const w of words(clean)) {
      if (pieces[pieces.length - 1].length + w.length > maxChars && pieces[pieces.length - 1].trim()) pieces.push('');
      pieces[pieces.length - 1] += w;
    }
    const lines = pieces.map((x) => x.trim()).filter(Boolean);
    const chars = lines.reduce((n, l) => n + l.length, 0);
    let at = from;
    for (const l of lines) {
      const d = ((to - from) * l.length) / chars;
      out.push({ start: Math.round(at * 1000) * MS, duration: Math.max(MS, Math.round(d * 1000) * MS), text: l });
      at += d;
    }
  }
  return out;
}
