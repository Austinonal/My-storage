import { useEffect, useRef, useState } from 'react';
import { FileUp, ImagePlus, RotateCcw, X } from 'lucide-react';
import { BottomSheet, Button, CategoryTabs, PresetTile, Slider } from '../ui';
import { edit } from '../store';
import { FILTERS, CubeError } from '../luts';
import { NO_ADJUST, graded, importCube, makeMatch, myLuts } from '../colour';
import { neutralGrade } from '../grade';
import { setAdjust, setFilter, setGrade, setMatch } from '../timeline.ts';
import { importMessage } from './Home';
import { CurvesPanel, HslPanel, WheelsPanel } from './GradeTools';
import type { Adjust, Grade, MediaAsset, MediaClip } from '../schema';
import type { Still } from './AnimationSheet';

export type ColourTab = 'filter' | 'adjust';

const SLIDERS: [keyof Adjust, string, number][] = [
  ['brightness', 'ความสว่าง', -100],
  ['exposure', 'การรับแสง', -100],
  ['contrast', 'คอนทราสต์', -100],
  ['saturation', 'ความอิ่มตัวสี', -100],
  ['ambient', 'แสงไฟรอบๆ', -100],
  ['sharpen', 'ทำให้คมชัด', 0],
  ['clarity', 'ทำให้ชัดขึ้น', -100],
  ['highlights', 'ไฮไลท์', -100],
  ['shadows', 'เงา', -100],
  ['whites', 'สีขาว', -100],
  ['blacks', 'สีดำ', -100],
  ['temperature', 'อุณหภูมิ', -100],
  ['tint', 'โทนสี', -100],
  ['fade', 'เลือน', 0],
  ['vignette', 'ขอบมืด', -100],
];
const PARTS = ['พื้นฐาน', 'HSL', 'กราฟ', 'วงล้อสี', 'จับคู่สี'] as const;
type Part = (typeof PARTS)[number];

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
  asset,
  still,
  onApplyAll,
}: {
  open: boolean;
  tab: ColourTab;
  onTab: (t: ColourTab) => void;
  onClose: () => void;
  clip: MediaClip;
  asset: MediaAsset;
  still: Still | null;
  onApplyAll: () => void;
}) {
  const [part, setPart] = useState<Part>('พื้นฐาน');
  const [matching, setMatching] = useState(false);
  const reference = useRef<HTMLInputElement>(null);
  const grade = clip.grade ?? neutralGrade();
  const regrade = (patch: Partial<Grade>, key: string) => edit((d) => setGrade(d, clip.id, patch), `${key}-${clip.id}`);

  async function matchTo(file: File | undefined) {
    if (!file) return;
    setMessage('');
    setMatching(true);
    try {
      const m = await makeMatch(file, clip, asset);
      edit((d) => setMatch(d, clip.id, { ...m, intensity: clip.match?.intensity ?? 1 }));
    } catch (e) {
      setMessage(`จับคู่สีไม่สำเร็จ: ${importMessage(e)}`);
    } finally {
      setMatching(false);
    }
  }
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
    <BottomSheet open={open} title={tab === 'filter' ? 'ฟิลเตอร์' : 'ปรับแก้'} onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        <CategoryTabs items={['ฟิลเตอร์', 'ปรับแก้']} value={tab === 'filter' ? 'ฟิลเตอร์' : 'ปรับแก้'} onChange={(v) => onTab(v === 'ฟิลเตอร์' ? 'filter' : 'adjust')} />

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

        {tab === 'adjust' && (
          <>
            <div role="group" aria-label="ส่วนของการปรับแก้" className="flex gap-1 overflow-x-auto">
              {PARTS.map((x) => (
                <button key={x} aria-pressed={x === part} onClick={() => setPart(x)} className={`h-9 shrink-0 rounded-pill px-3 text-sm ${x === part ? 'bg-fg text-bg' : 'bg-raised text-muted'} focus-visible:outline-2 focus-visible:outline-accent`}>
                  {x}
                </button>
              ))}
            </div>
            {part === 'พื้นฐาน' &&
              SLIDERS.map(([key, label, min]) => (
                <Slider
                  key={key}
                  label={label}
                  value={clip.adjust[key] ?? 0}
                  min={min}
                  max={100}
                  step={1}
                  format={(v) => (v > 0 ? `+${v}` : String(v))}
                  onChange={(v) => edit((d) => setAdjust(d, clip.id, { [key]: v }), `adjust-${key}-${clip.id}`)}
                />
              ))}
            {part === 'HSL' && <HslPanel hsl={grade.hsl} onChange={(hsl, key) => regrade({ hsl }, key)} />}
            {part === 'กราฟ' && <CurvesPanel curves={grade.curves} onChange={(curves, key) => regrade({ curves }, key)} />}
            {part === 'วงล้อสี' && <WheelsPanel wheels={grade.wheels} onChange={(wheels, key) => regrade({ wheels }, key)} />}
            {part === 'จับคู่สี' && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">เลือกรูปหรือคลิปที่ชอบโทนสี แล้วคลิปนี้จะปรับสีให้ออกมาคล้ายกัน</p>
                {clip.match && (
                  <div className="flex items-center gap-2 rounded-md bg-raised p-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">ตามโทนของ: {clip.match.name}</span>
                    <Button variant="ghost" size="md" aria-label="เลิกจับคู่สี" onClick={() => edit((d) => setMatch(d, clip.id, null))}>
                      <X size={16} aria-hidden />
                    </Button>
                  </div>
                )}
                {clip.match && (
                  <Slider
                    label="ความเข้ม"
                    value={Math.round(clip.match.intensity * 100)}
                    min={0}
                    max={100}
                    step={5}
                    format={(v) => `${v}%`}
                    onChange={(v) => edit((d) => setMatch(d, clip.id, { ...clip.match!, intensity: v / 100 }), `match-intensity-${clip.id}`)}
                  />
                )}
                <Button variant="secondary" loading={matching} onClick={() => reference.current?.click()}>
                  <ImagePlus size={16} aria-hidden /> {clip.match ? 'เปลี่ยนต้นแบบสี' : 'เลือกรูปหรือคลิปต้นแบบสี'}
                </Button>
                {message && (
                  <p role="alert" className="text-xs text-warning">
                    {message}
                  </p>
                )}
                <input ref={reference} type="file" accept="image/*,video/*" hidden aria-label="เลือกรูปหรือคลิปต้นแบบสี" onChange={(e) => {
                  void matchTo(e.target.files?.[0]);
                  e.target.value = '';
                }} />
              </div>
            )}
          </>
        )}

        <div className="flex gap-2">
          {tab === 'adjust' && part !== 'จับคู่สี' && (
            <Button
              variant="ghost"
              size="md"
              onClick={() =>
                part === 'พื้นฐาน'
                  ? edit((d) => setAdjust(d, clip.id, NO_ADJUST))
                  : regrade(part === 'HSL' ? { hsl: neutralGrade().hsl } : part === 'กราฟ' ? { curves: neutralGrade().curves } : { wheels: neutralGrade().wheels }, `reset-${part}`)
              }
            >
              <RotateCcw size={16} aria-hidden /> รีเซ็ต{part === 'พื้นฐาน' ? '' : part}
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
