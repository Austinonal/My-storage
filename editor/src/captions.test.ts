import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunksToCaptions, linesToCaptions, parseSubtitles } from './captions.ts';

const SEC = 1_000_000;

test('srt and vtt read into timed captions; broken blocks are skipped', () => {
  const srt = `﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>สวัสดีครับ</i>\r\nบรรทัดสอง\r\n\r\n2\r\n00:00:04,200 --> 00:00:05,000\r\nต่อไป\r\n\r\n3\r\nnot a time\r\nข้าม\r\n\r\n4\r\n00:00:09,000 --> 00:00:08,000\r\nย้อนเวลา\r\n`;
  assert.deepEqual(parseSubtitles(srt), [
    { start: 1 * SEC, duration: 2.5 * SEC, text: 'สวัสดีครับ\nบรรทัดสอง' },
    { start: 4.2 * SEC, duration: 0.8 * SEC, text: 'ต่อไป' },
  ]);
  const vtt = 'WEBVTT\n\n00:01.500 --> 00:02.000 align:center\nสั้น\n\n01:00:00.000 --> 01:00:01.000\nหนึ่งชั่วโมง\n';
  assert.deepEqual(parseSubtitles(vtt), [
    { start: 1.5 * SEC, duration: 0.5 * SEC, text: 'สั้น' },
    { start: 3600 * SEC, duration: 1 * SEC, text: 'หนึ่งชั่วโมง' },
  ]);
});

test('pasted lines become back-to-back captions', () => {
  assert.deepEqual(linesToCaptions('หนึ่ง\n\n  สอง  \nสาม', 2 * SEC, 1.5), [
    { start: 2 * SEC, duration: 1.5 * SEC, text: 'หนึ่ง' },
    { start: 3.5 * SEC, duration: 1.5 * SEC, text: 'สอง' },
    { start: 5 * SEC, duration: 1.5 * SEC, text: 'สาม' },
  ]);
});

test('speech chunks: long Thai stretches split between words, short ones stay, timing follows length', () => {
  const caps = chunksToCaptions(
    [
      { timestamp: [0, 2], text: ' สวัสดีครับ' },
      { timestamp: [2.5, 8.5], text: 'วันนี้เราจะไปเที่ยวทะเลกันที่จังหวัดชลบุรีกับเพื่อนๆ ทุกคนนะครับ' },
      { timestamp: [9, null], text: '  ' },
      { timestamp: [9, null], text: 'bye' },
    ],
    10,
  );
  assert.equal(caps[0].text, 'สวัสดีครับ');
  assert.deepEqual([caps[0].start, caps[0].duration], [0, 2 * SEC]);
  const middle = caps.slice(1, -1);
  assert.ok(middle.length >= 2);
  assert.ok(middle.every((c) => c.text.length <= 30));
  assert.equal(middle.map((c) => c.text).join('').replace(/\s/g, ''), 'วันนี้เราจะไปเที่ยวทะเลกันที่จังหวัดชลบุรีกับเพื่อนๆทุกคนนะครับ');
  assert.equal(middle[0].start, 2.5 * SEC);
  assert.ok(Math.abs(middle.at(-1)!.start + middle.at(-1)!.duration - 8.5 * SEC) < 2000);
  assert.deepEqual(caps.at(-1), { start: 9 * SEC, duration: SEC, text: 'bye' });
});
