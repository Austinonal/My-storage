import { useEffect, useRef, useState } from 'react';
import { BottomSheet, CategoryTabs, PresetTile, Slider } from '../ui';
import { PRESETS, TEXT_PRESETS, getPreset, poseOf, type Preset, type Slot } from '../anim.ts';
import { drawClip } from '../render';
import { textImage } from '../text';
import { edit } from '../store';
import { SEC, setAnim } from '../timeline.ts';
import type { MediaClip, TextClip } from '../schema';

export type Still = { img: CanvasImageSource; w: number; h: number };

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

// A tile: the text (first few letters) or the clip still, moved by the preset at progress p.
function drawTile(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, size: number, clip: MediaClip | TextClip, still: Still | null, preset: Preset, p: number) {
  if (clip.kind !== 'text') {
    if (still) drawClip(ctx, still.img, still.w, still.h, size, size, poseOf(preset, p));
    return;
  }
  const sample = [...graphemes.segment(clip.text.split('\n')[0] || 'ข้อความ')].slice(0, 6).map((s) => s.segment).join('') || 'ข้อความ';
  const img = textImage({ ...clip, text: sample }, 540, 540, preset.glyph ? { fn: preset.glyph, p } : undefined);
  const s = Math.min(1, (size * 0.85) / img.w, (size * 0.85) / img.h);
  drawClip(ctx, img.canvas, img.w, img.h, size, size, poseOf(preset, p), { cx: size / 2, cy: size / 2, w: img.w * s, h: img.h * s });
}

export function AnimationSheet({
  open,
  onClose,
  clip,
  still,
  onPlay,
}: {
  open: boolean;
  onClose: () => void;
  clip: MediaClip | TextClip;
  still: Still | null;
  onPlay: (slot: Slot) => void;
}) {
  const [slot, setSlot] = useState<Slot>('in');
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const text = clip.kind === 'text';
  const list = (text ? TEXT_PRESETS : PRESETS)[slot];
  const tabs: [Slot, string][] = [['in', 'เข้า'], ['out', 'ออก'], ['combo', text ? 'วนซ้ำ' : 'คอมโบ']];
  const current = slot === 'in' ? clip.animIn : slot === 'out' ? clip.animOut : clip.kind === 'text' ? clip.animLoop : clip.animCombo;

  // Every tile plays its own animation on a still of the clip, through the same compositor as the preview.
  useEffect(() => {
    if (!open || (!still && !text)) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-raised').trim();
    const start = performance.now();
    let last = 0;
    let raf = requestAnimationFrame(function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const t = (now - start) / 1000;
      for (const preset of list) {
        const cv = canvases.current.get(preset.id);
        if (!cv) continue;
        const ctx = cv.getContext('2d')!;
        const p = slot === 'combo' ? (t % preset.seconds) / preset.seconds : Math.min(1, (t % (preset.seconds + 0.6)) / preset.seconds);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cv.width, cv.height);
        drawTile(ctx, cv.width, clip, still, preset, p);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, slot, still, clip, list, text]);

  function pick(presetId: string | null) {
    const preset = presetId ? getPreset(presetId) : undefined;
    const duration = current?.duration ?? (slot === 'combo' && !text ? clip.duration : Math.round((preset?.seconds ?? 0.5) * SEC));
    edit((d) => setAnim(d, clip.id, slot, presetId, duration));
    if (presetId) onPlay(slot);
  }

  const other = slot === 'in' ? clip.animOut : slot === 'out' ? clip.animIn : null;
  const max = clip.duration - (other?.duration ?? 0);
  const min = Math.min(0.1 * SEC, max); // on the slider's 0.1 s grid, or every value snaps off by a fraction

  return (
    <BottomSheet open={open} title="แอนิเมชัน" onClose={onClose} modal={false}>
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-surface pb-3">
        <CategoryTabs items={tabs.map(([, label]) => label)} value={tabs.find(([s]) => s === slot)![1]} onChange={(label) => setSlot(tabs.find(([, l]) => l === label)![0])} />
        {slot === 'combo' && (
          <p className="text-xs text-muted">{text ? 'วนซ้ำตลอดเวลาที่ข้อความแสดง และจะแทนที่แบบเข้า/ออก' : 'คอมโบเล่นตลอดคลิป และจะแทนที่ภาพเคลื่อนไหวแบบเข้า/ออก'}</p>
        )}
        {current && (
          <Slider
            label="ระยะเวลา"
            value={current.duration / SEC}
            min={min / SEC}
            max={max / SEC}
            step={0.1}
            format={(v) => `${v.toFixed(1)} วิ`}
            onChange={(v) => edit((d) => setAnim(d, clip.id, slot, current.presetId, Math.round(v * SEC)), `anim-${slot}`)}
          />
        )}
      </div>
      <div className="grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-6">
        <PresetTile label="ไม่มี" none selected={!current} onClick={() => pick(null)} />
        {list.map((preset) => (
          <PresetTile
            key={preset.id}
            label={preset.name}
            selected={current?.presetId === preset.id}
            onClick={() => pick(preset.id)}
            thumb={
              <canvas
                ref={(el) => {
                  if (el) canvases.current.set(preset.id, el);
                  else canvases.current.delete(preset.id);
                }}
                width={128}
                height={128}
                aria-hidden
                className="size-full"
              />
            }
          />
        ))}
      </div>
    </BottomSheet>
  );
}
