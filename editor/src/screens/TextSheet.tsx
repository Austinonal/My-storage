import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Captions } from 'lucide-react';
import { BottomSheet, Button, CategoryTabs, PresetTile, Slider, Swatches } from '../ui';
import { edit } from '../store';
import { FONTS, family } from '../fonts';
import { SEC, updateText } from '../timeline.ts';
import type { TextClip, TextStyle } from '../schema';

const COLOURS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffd84d', '#34c759', '#00c7be', '#32ade6', '#007aff', '#af52de', '#ff4f8b', '#a2845e'];

// Looks only: font, size and placement stay as they are.
type Look = Pick<TextStyle, 'colour' | 'stroke' | 'shadow' | 'background'>;
const LOOKS: [string, Look][] = [
  ['ซับมาตรฐาน', { colour: '#ffffffff', stroke: { colour: '#000000ff', width: 6 }, shadow: null, background: null }],
  ['กล่องดำ', { colour: '#ffffffff', stroke: null, shadow: null, background: { colour: '#000000b3', radius: 12 } }],
  ['เหลืองขอบดำ', { colour: '#ffd84dff', stroke: { colour: '#000000ff', width: 6 }, shadow: null, background: null }],
  ['เงานุ่ม', { colour: '#ffffffff', stroke: null, shadow: { colour: '#000000cc', blur: 12, dx: 0, dy: 4 }, background: null }],
  ['นีออนฟ้า', { colour: '#ffffffff', stroke: null, shadow: { colour: '#00e5ffff', blur: 28, dx: 0, dy: 0 }, background: null }],
  ['นีออนชมพู', { colour: '#ffe0f0ff', stroke: null, shadow: { colour: '#ff2d95ff', blur: 28, dx: 0, dy: 0 }, background: null }],
  ['ป้ายชมพู', { colour: '#ffffffff', stroke: null, shadow: null, background: { colour: '#ff4f8bff', radius: 24 } }],
  ['ป้ายเหลือง', { colour: '#111111ff', stroke: null, shadow: null, background: { colour: '#ffd84dff', radius: 8 } }],
  ['ดำบนขาว', { colour: '#111111ff', stroke: null, shadow: null, background: { colour: '#ffffffe6', radius: 8 } }],
  ['ขอบแดงหนา', { colour: '#ffffffff', stroke: { colour: '#ff3b30ff', width: 12 }, shadow: null, background: null }],
  ['ขาวขอบดำหนา', { colour: '#ffffffff', stroke: { colour: '#000000ff', width: 14 }, shadow: { colour: '#00000099', blur: 0, dx: 6, dy: 6 }, background: null }],
  ['ตัวดำขอบขาว', { colour: '#111111ff', stroke: { colour: '#ffffffff', width: 8 }, shadow: null, background: null }],
];

const TABS = ['สไตล์', 'แบบอักษร', 'สี', 'ขอบ', 'เงา', 'พื้นหลัง', 'ตำแหน่ง'] as const;
type Tab = (typeof TABS)[number];

const rgb = (c: string) => c.slice(0, 7);
const alpha = (c: string) => (c.length >= 9 ? parseInt(c.slice(7, 9), 16) / 255 : 1);
const withAlpha = (c: string, a: number) => rgb(c) + Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0');

// A CSS stand-in for the canvas look, for the small style tiles.
function lookCss(l: Look): CSSProperties {
  return {
    color: l.colour,
    WebkitTextStroke: l.stroke ? `${l.stroke.width / 4}px ${l.stroke.colour}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: l.shadow ? `${l.shadow.dx / 4}px ${l.shadow.dy / 4}px ${l.shadow.blur / 4}px ${l.shadow.colour}` : undefined,
    background: l.background?.colour,
    borderRadius: l.background ? l.background.radius / 4 : undefined,
    padding: '0 4px',
  };
}

const POSITIONS: [string, number][] = [
  ['บน', 0.15],
  ['กลาง', 0.5],
  ['ล่าง', 0.82],
];

export function TextSheet({ open, onClose, clip, shown, setTransform, onNext }: { open: boolean; onClose: () => void; clip: TextClip; shown: TextClip['transform']; setTransform: (patch: Partial<TextClip['transform']>, key: string) => void; onNext: () => void }) {
  const [tab, setTab] = useState<Tab>('สไตล์');
  const area = useRef<HTMLTextAreaElement>(null);
  const s = clip.style;
  const style = (patch: Partial<TextStyle>, key: string) => edit((d) => updateText(d, clip.id, { style: patch }), `text-${key}-${clip.id}`);
  const transform = (patch: Partial<TextClip['transform']>, key: string) => setTransform(patch, `text-${key}-${clip.id}`); // keyframe-aware, from the editor

  // A new subtitle opens with its text selected, so typing replaces it.
  useEffect(() => {
    if (open) area.current?.select();
  }, [open, clip.id]);

  return (
    <BottomSheet open={open} title="ข้อความ" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        <textarea
          ref={area}
          aria-label="ข้อความ"
          placeholder="พิมพ์ข้อความ…"
          rows={2}
          value={clip.text}
          onChange={(e) => edit((d) => updateText(d, clip.id, { text: e.target.value }), `text-input-${clip.id}`)}
          className="w-full resize-none rounded-md border border-border-input bg-bg p-2 text-base focus-visible:outline-2 focus-visible:outline-accent"
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md" onClick={onNext}>
            <Captions size={16} aria-hidden /> ซับถัดไป
          </Button>
          <span className="text-xs text-muted">{(clip.duration / SEC).toFixed(1)} วิ · ต่อท้ายด้วยสไตล์เดียวกัน</span>
        </div>
        <CategoryTabs items={[...TABS]} value={tab} onChange={(v) => setTab(v as Tab)} />

        {tab === 'สไตล์' && (
          <div className="grid grid-cols-4 gap-2">
            {LOOKS.map(([name, look]) => (
              <PresetTile
                key={name}
                label={name}
                selected={JSON.stringify([s.colour, s.stroke, s.shadow, s.background]) === JSON.stringify([look.colour, look.stroke, look.shadow, look.background])}
                thumb={
                  <span className="text-lg" style={{ fontFamily: family(s.fontId), ...lookCss(look) }}>
                    Aa ก
                  </span>
                }
                onClick={() => style(look, 'look')}
              />
            ))}
          </div>
        )}

        {tab === 'แบบอักษร' && (
          <div role="group" aria-label="แบบอักษร" className="grid grid-cols-2 gap-2">
            {FONTS.map((f) => (
              <button
                key={f.id}
                aria-pressed={s.fontId === f.id}
                onClick={() => style({ fontId: f.id }, 'font')}
                className={`flex h-14 flex-col items-start justify-center rounded-md bg-raised px-3 text-left focus-visible:outline-2 focus-visible:outline-accent ${s.fontId === f.id ? 'ring-2 ring-accent' : ''}`}
              >
                <span className="text-lg leading-tight" style={{ fontFamily: family(f.id), fontWeight: f.weight }}>
                  สวัสดี Aa
                </span>
                <span className="text-xs text-muted">{f.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'สี' && (
          <>
            <Swatches label="สีตัวอักษร" colours={COLOURS} value={rgb(s.colour)} onChange={(c) => style({ colour: withAlpha(c, alpha(s.colour)) }, 'colour')} />
            <Slider label="ความทึบ" value={Math.round(shown.opacity * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => transform({ opacity: v / 100 }, 'opacity')} />
          </>
        )}

        {tab === 'ขอบ' && (
          <>
            <Swatches label="สีขอบ" colours={COLOURS} value={rgb(s.stroke?.colour ?? '#000000')} onChange={(c) => style({ stroke: { colour: withAlpha(c, 1), width: s.stroke?.width || 6 } }, 'stroke')} />
            <Slider
              label="ความหนาขอบ"
              value={s.stroke?.width ?? 0}
              min={0}
              max={24}
              step={1}
              onChange={(v) => style({ stroke: v > 0 ? { colour: s.stroke?.colour ?? '#000000ff', width: v } : null }, 'stroke-width')}
            />
          </>
        )}

        {tab === 'เงา' && (
          <>
            <Swatches label="สีเงา" colours={COLOURS} value={rgb(s.shadow?.colour ?? '#000000')} onChange={(c) => style({ shadow: { blur: 12, dx: 0, dy: 4, ...s.shadow, colour: withAlpha(c, alpha(s.shadow?.colour ?? '#000000cc')) } }, 'shadow')} />
            <Slider
              label="ความฟุ้ง"
              value={s.shadow?.blur ?? 0}
              min={0}
              max={40}
              step={1}
              onChange={(v) => style({ shadow: { colour: '#000000cc', dx: 0, dy: 4, ...s.shadow, blur: v } }, 'shadow-blur')}
            />
            <Slider
              label="ระยะเงา"
              value={s.shadow?.dy ?? 0}
              min={0}
              max={20}
              step={1}
              onChange={(v) => style({ shadow: { colour: '#000000cc', blur: 12, ...s.shadow, dx: v / 2, dy: v } }, 'shadow-offset')}
            />
            <Button variant="ghost" size="md" disabled={!s.shadow} onClick={() => style({ shadow: null }, 'shadow-off')}>
              ไม่มีเงา
            </Button>
          </>
        )}

        {tab === 'พื้นหลัง' && (
          <>
            <Swatches label="สีพื้นหลัง" colours={COLOURS} value={rgb(s.background?.colour ?? '#000000')} onChange={(c) => style({ background: { colour: withAlpha(c, alpha(s.background?.colour ?? '#000000b3')), radius: s.background?.radius ?? 12 } }, 'bg')} />
            <Slider
              label="ความทึบพื้นหลัง"
              value={Math.round(alpha(s.background?.colour ?? '#00000000') * 100)}
              min={0}
              max={100}
              step={5}
              format={(v) => `${v}%`}
              onChange={(v) => style({ background: v > 0 ? { colour: withAlpha(s.background?.colour ?? '#000000', v / 100), radius: s.background?.radius ?? 12 } : null }, 'bg-alpha')}
            />
            <Slider
              label="ความมนของมุม"
              value={s.background?.radius ?? 0}
              min={0}
              max={60}
              step={2}
              onChange={(v) => s.background && style({ background: { ...s.background, radius: v } }, 'bg-radius')}
            />
          </>
        )}

        {tab === 'ตำแหน่ง' && (
          <>
            <Slider label="ขนาด" value={s.size} min={16} max={240} step={2} onChange={(v) => style({ size: v }, 'size')} />
            <div role="group" aria-label="จัดแนว" className="flex gap-2">
              {(
                [
                  ['left', AlignLeft, 'ชิดซ้าย'],
                  ['center', AlignCenter, 'กึ่งกลาง'],
                  ['right', AlignRight, 'ชิดขวา'],
                ] as const
              ).map(([v, Icon, label]) => (
                <Button key={v} variant={s.align === v ? 'primary' : 'secondary'} size="md" aria-label={label} aria-pressed={s.align === v} onClick={() => style({ align: v }, 'align')}>
                  <Icon size={18} aria-hidden />
                </Button>
              ))}
              <span className="flex-1" />
              {POSITIONS.map(([label, y]) => (
                <Button key={label} variant="secondary" size="md" onClick={() => transform({ x: 0.5, y }, 'place')}>
                  {label}
                </Button>
              ))}
            </div>
            <Slider label="หมุน" value={Math.round(shown.rotation)} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => transform({ rotation: v }, 'rotate')} />
            <Slider label="ซูม" value={Math.round(shown.scale * 100)} min={20} max={400} step={5} format={(v) => `${v}%`} onChange={(v) => transform({ scale: v / 100 }, 'scale')} />
            <p className="text-xs text-muted">บนจอตัวอย่าง: ลากเพื่อย้าย ใช้สองนิ้วเพื่อย่อ/ขยายและหมุน</p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
