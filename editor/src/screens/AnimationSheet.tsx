import { useEffect, useRef, useState } from 'react';
import { BottomSheet, CategoryTabs, PresetTile, Slider } from '../ui';
import { PRESETS, getPreset, poseOf, type Slot } from '../anim.ts';
import { drawClip } from '../render';
import { edit } from '../store';
import { SEC, setAnim } from '../timeline.ts';
import type { MediaClip } from '../schema';

export type Still = { img: CanvasImageSource; w: number; h: number };

const TABS: [Slot, string][] = [
  ['in', 'เข้า'],
  ['out', 'ออก'],
  ['combo', 'คอมโบ'],
];
const KEY = { in: 'animIn', out: 'animOut', combo: 'animCombo' } as const;

export function AnimationSheet({
  open,
  onClose,
  clip,
  still,
  onPlay,
}: {
  open: boolean;
  onClose: () => void;
  clip: MediaClip;
  still: Still | null;
  onPlay: (slot: Slot) => void;
}) {
  const [slot, setSlot] = useState<Slot>('in');
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const current = clip[KEY[slot]];

  // Every tile plays its own animation on a still of the clip, through the same compositor as the preview.
  useEffect(() => {
    if (!open || !still) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-raised').trim();
    const start = performance.now();
    let last = 0;
    let raf = requestAnimationFrame(function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const t = (now - start) / 1000;
      for (const preset of PRESETS[slot]) {
        const cv = canvases.current.get(preset.id);
        if (!cv) continue;
        const ctx = cv.getContext('2d')!;
        const p = slot === 'combo' ? (t % preset.seconds) / preset.seconds : Math.min(1, (t % (preset.seconds + 0.6)) / preset.seconds);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cv.width, cv.height);
        drawClip(ctx, still.img, still.w, still.h, cv.width, cv.height, poseOf(preset, p));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, slot, still]);

  function pick(presetId: string | null) {
    const preset = presetId ? getPreset(presetId) : undefined;
    const duration = current?.duration ?? (slot === 'combo' ? clip.duration : Math.round((preset?.seconds ?? 0.5) * SEC));
    edit((d) => setAnim(d, clip.id, slot, presetId, duration));
    if (presetId) onPlay(slot);
  }

  const other = slot === 'in' ? clip.animOut : slot === 'out' ? clip.animIn : null;
  const max = clip.duration - (other?.duration ?? 0);
  const min = Math.min(0.1 * SEC, max); // on the slider's 0.1 s grid, or every value snaps off by a fraction

  return (
    <BottomSheet open={open} title="แอนิเมชัน" onClose={onClose} modal={false}>
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-surface pb-3">
        <CategoryTabs items={TABS.map(([, label]) => label)} value={TABS.find(([s]) => s === slot)![1]} onChange={(label) => setSlot(TABS.find(([, l]) => l === label)![0])} />
        {slot === 'combo' && <p className="text-xs text-muted">คอมโบเล่นตลอดคลิป และจะแทนที่ภาพเคลื่อนไหวแบบเข้า/ออก</p>}
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
        {PRESETS[slot].map((preset) => (
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
