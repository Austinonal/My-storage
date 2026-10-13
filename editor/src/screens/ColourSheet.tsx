import { useEffect, useRef, useState } from 'react';
import { FileUp, RotateCcw } from 'lucide-react';
import { BottomSheet, Button, CategoryTabs, PresetTile, Slider } from '../ui';
import { edit } from '../store';
import { FILTERS, CubeError } from '../luts';
import { NO_ADJUST, graded, importCube, myLuts } from '../colour';
import { setAdjust, setFilter } from '../timeline.ts';
import type { Adjust, MediaClip } from '../schema';
import type { Still } from './AnimationSheet';

export type ColourTab = 'filter' | 'adjust';

const SLIDERS: [keyof Adjust, string, number][] = [
  ['brightness', 'ความสว่าง', -100],
  ['contrast', 'คอนทราสต์', -100],
  ['saturation', 'ความอิ่มสี', -100],
  ['exposure', 'แสง', -100],
  ['highlights', 'ไฮไลต์', -100],
  ['shadows', 'เงา', -100],
  ['temperature', 'อุณหภูมิสี', -100],
  ['tint', 'โทนสี', -100],
  ['sharpen', 'ความคมชัด', 0],
];

// Each tile is the clip's own frame through that filter, drawn once when the sheet opens.
function FilterThumb({ still, presetId }: { still: Still; presetId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const img = graded(still.img, still.w, still.h, { filter: { presetId, intensity: 1 }, adjust: NO_ADJUST });
    const s = Math.max(cv.width / still.w, cv.height / still.h);
    ctx.drawImage(img, (cv.width - still.w * s) / 2, (cv.height - still.h * s) / 2, still.w * s, still.h * s);
  }, [still, presetId]);
  return <canvas ref={ref} width={128} height={128} aria-hidden className="size-full" />;
}

export function ColourSheet({
  open,
  tab,
  onTab,
  onClose,
  clip,
  still,
  onApplyAll,
}: {
  open: boolean;
  tab: ColourTab;
  onTab: (t: ColourTab) => void;
  onClose: () => void;
  clip: MediaClip;
  still: Still | null;
  onApplyAll: () => void;
}) {
  const [own, setOwn] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const filter = clip.filter;

  useEffect(() => {
    if (open) void myLuts().then(setOwn).catch(() => setOwn([]));
  }, [open]);

  async function addCube(file: File | undefined) {
    if (!file) return;
    setMessage('');
    try {
      const lut = await importCube(file);
      setOwn((list) => [...list, lut]);
      edit((d) => setFilter(d, clip.id, lut.id, 1), `filter-${clip.id}`);
    } catch (e) {
      setMessage(e instanceof CubeError ? 'ไฟล์นี้ไม่ใช่ LUT แบบ 3D (.cube) ที่อ่านได้' : 'นำเข้าไฟล์ไม่สำเร็จ');
    }
  }

  const looks = [...FILTERS.map((f) => ({ id: f.id, name: f.name })), ...own];
  return (
    <BottomSheet open={open} title={tab === 'filter' ? 'ฟิลเตอร์' : 'ปรับแต่งสี'} onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        <CategoryTabs items={['ฟิลเตอร์', 'ปรับแต่ง']} value={tab === 'filter' ? 'ฟิลเตอร์' : 'ปรับแต่ง'} onChange={(v) => onTab(v === 'ฟิลเตอร์' ? 'filter' : 'adjust')} />

        {tab === 'filter' && (
          <>
            {filter && (
              <Slider
                label="ความเข้ม"
                value={Math.round(filter.intensity * 100)}
                min={0}
                max={100}
                step={5}
                format={(v) => `${v}%`}
                onChange={(v) => edit((d) => setFilter(d, clip.id, filter.presetId, v / 100), `filter-intensity-${clip.id}`)}
              />
            )}
            <div className="grid grid-cols-4 gap-2">
              <PresetTile label="ไม่มี" none selected={!filter} onClick={() => edit((d) => setFilter(d, clip.id, null), `filter-${clip.id}`)} />
              {looks.map((f) => (
                <PresetTile
                  key={f.id}
                  label={f.name}
                  selected={filter?.presetId === f.id}
                  thumb={still && <FilterThumb still={still} presetId={f.id} />}
                  onClick={() => edit((d) => setFilter(d, clip.id, f.id, filter?.presetId === f.id ? filter.intensity : 1), `filter-${clip.id}`)}
                />
              ))}
              <button onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span className="grid size-16 place-items-center rounded-md border border-dashed border-muted text-muted">
                  <FileUp size={22} aria-hidden />
                </span>
                <span className="line-clamp-2 min-h-8 w-full text-center">นำเข้า LUT (.cube)</span>
              </button>
            </div>
            {message && (
              <p role="alert" className="text-xs text-warning">
                {message}
              </p>
            )}
            <input ref={input} type="file" accept=".cube" hidden aria-label="เลือกไฟล์ LUT (.cube)" onChange={(e) => {
              void addCube(e.target.files?.[0]);
              e.target.value = '';
            }} />
          </>
        )}

        {tab === 'adjust' &&
          SLIDERS.map(([key, label, min]) => (
            <Slider
              key={key}
              label={label}
              value={clip.adjust[key]}
              min={min}
              max={100}
              step={1}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              onChange={(v) => edit((d) => setAdjust(d, clip.id, { [key]: v }), `adjust-${key}-${clip.id}`)}
            />
          ))}

        <div className="flex gap-2">
          {tab === 'adjust' && (
            <Button variant="ghost" size="md" disabled={Object.values(clip.adjust).every((v) => v === 0)} onClick={() => edit((d) => setAdjust(d, clip.id, NO_ADJUST))}>
              <RotateCcw size={16} aria-hidden /> รีเซ็ต
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="secondary" size="md" onClick={onApplyAll}>
            ใช้กับทุกคลิป
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
