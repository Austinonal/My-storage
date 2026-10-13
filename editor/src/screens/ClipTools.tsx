import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Circle, FlipHorizontal2, Mic, RotateCcw, RotateCw, Square } from 'lucide-react';
import { BottomSheet, Button, CategoryTabs, PresetTile, Slider } from '../ui';
import { edit } from '../store';
import { SPEED_PRESETS } from '../timing.ts';
import { TRANSITIONS } from '../transitions';
import { VOICES } from '../voice';
import { SEC, extractAudio, formatTime, setCrop, setCurve, setFades, setSpeed, setTransition, setVoice, setVolume } from '../timeline.ts';
import type { AudioClip, MediaClip, Project, Us } from '../schema';
import type { Still } from './AnimationSheet';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

// ---- speed: a constant 0.1x-100x, or a curve (video) ----

const toY = (v: number) => (Math.log10(v) + 1) / 2; // 0.1x at the bottom, 10x at the top
const fromY = (y: number) => 10 ** (Math.min(1, Math.max(0, y)) * 2 - 1);
const fmtSpeed = (s: number) => `${s < 1 ? s.toFixed(2) : s < 10 ? s.toFixed(1) : Math.round(s)}x`;

function CurveGraph({ curve, onChange }: { curve: [number, number][]; onChange?: (c: [number, number][], key: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; key: string } | null>(null);
  const W = 300;
  const H = 120;
  const path = curve.map(([x, v], i) => `${i ? 'L' : 'M'}${x * W} ${H - toY(v) * H}`).join('');
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !onChange) return;
    const r = svg.current!.getBoundingClientRect();
    const y = 1 - (e.clientY - r.top) / r.height;
    onChange(curve.map((p, j) => (j === d.i ? [p[0], fromY(y)] : p)), d.key);
  };
  return (
    <svg
      ref={svg}
      viewBox={`-8 -8 ${W + 16} ${H + 16}`}
      className={`w-full rounded-md bg-bg ${onChange ? 'touch-none' : ''}`}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      aria-hidden={!onChange}
      role={onChange ? 'group' : undefined}
      aria-label={onChange ? 'กราฟความเร็ว: ลากจุดขึ้นเพื่อเร็วขึ้น ลงเพื่อช้าลง' : undefined}
    >
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" className="text-border" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke="currentColor" className="text-accent" strokeWidth={3} />
      {onChange &&
        curve.map(([x, v], i) => (
          <circle
            key={i}
            cx={x * W}
            cy={H - toY(v) * H}
            r={9}
            className="fill-fg"
            tabIndex={0}
            role="slider"
            aria-label={`จุดที่ ${i + 1}`}
            aria-valuetext={fmtSpeed(v)}
            onPointerDown={(e) => {
              svg.current!.setPointerCapture(e.pointerId);
              drag.current = { i, key: `curve-${i}-${Date.now()}` };
            }}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0;
              if (!step) return;
              e.preventDefault();
              onChange(curve.map((p, j) => (j === i ? [p[0], fromY(toY(p[1]) + step)] : p)), `curve-key-${i}`);
            }}
          />
        ))}
    </svg>
  );
}

export function SpeedSheet({ open, onClose, clip }: { open: boolean; onClose: () => void; clip: MediaClip | AudioClip }) {
  const [tab, setTab] = useState('ปกติ');
  const curve = clip.kind === 'video' ? clip.curve : null;
  return (
    <BottomSheet open={open} title="ความเร็ว" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        {clip.kind === 'video' && <CategoryTabs items={['ปกติ', 'กราฟ']} value={tab} onChange={setTab} />}
        {(tab === 'ปกติ' || clip.kind !== 'video') && (
          <>
            <Slider
              label="ความเร็ว"
              value={Math.round(Math.log10(clip.speed) * 100) / 100}
              min={-1}
              max={2}
              step={0.01}
              format={(v) => fmtSpeed(10 ** v)}
              onChange={(v) => edit((d) => setSpeed(d, clip.id, Math.round(10 ** v * 100) / 100), `speed-${clip.id}`)}
            />
            <div className="flex flex-wrap gap-2">
              {[0.25, 0.5, 1, 2, 5, 10, 100].map((s) => (
                <Button key={s} variant={Math.abs(clip.speed - s) < 0.005 ? 'primary' : 'secondary'} size="md" onClick={() => edit((d) => setSpeed(d, clip.id, s))}>
                  {fmtSpeed(s)}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted">ความยาวคลิปตอนนี้ {formatTime(clip.duration, true)} · เร็วขึ้นแล้วคลิปสั้นลง</p>
          </>
        )}
        {tab === 'กราฟ' && clip.kind === 'video' && (
          <>
            <div className="grid grid-cols-4 gap-2">
              <PresetTile label="ไม่มี" none selected={!curve} onClick={() => edit((d) => setCurve(d, clip.id, null))} />
              {SPEED_PRESETS.map((s) => (
                <PresetTile
                  key={s.id}
                  label={s.name}
                  selected={JSON.stringify(curve) === JSON.stringify(s.curve)}
                  thumb={<CurveGraph curve={s.curve} />}
                  onClick={() => edit((d) => setCurve(d, clip.id, s.curve))}
                />
              ))}
            </div>
            <CurveGraph curve={curve ?? [[0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]]} onChange={(c, key) => edit((d) => setCurve(d, clip.id, c), key)} />
            <p className="text-xs text-muted">ลากจุดขึ้น = เร็วขึ้น ลง = ช้าลง (0.1x ถึง 10x) · ความยาวคลิปไม่เปลี่ยน</p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

// ---- crop, turn, mirror ----

const RATIOS: [string, number | null][] = [
  ['อิสระ', null],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['16:9', 16 / 9],
];

export function CropSheet({ open, onClose, clip, aspect, still }: { open: boolean; onClose: () => void; clip: MediaClip; aspect: number; still: Still | null }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'tl' | 'tr' | 'bl' | 'br'; x: number; y: number; start: MediaClip['crop']; key: string } | null>(null);
  const c = clip.crop;
  const put = (crop: MediaClip['crop'], key = '') => edit((d) => setCrop(d, clip.id, crop), key);
  // The largest centred rectangle with this shape (in picture pixels).
  const ratio = (r: number) => {
    const ar = r / aspect;
    const w = ar >= 1 ? 1 : ar;
    const h = ar >= 1 ? 1 / ar : 1;
    put({ ...c, x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };
  function down(e: PointerEvent<HTMLElement>, mode: 'move' | 'tl' | 'tr' | 'bl' | 'br') {
    e.stopPropagation();
    box.current!.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: { ...c }, key: `crop-${Date.now()}` };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const r = box.current!.getBoundingClientRect();
    const dx = (e.clientX - d.x) / r.width;
    const dy = (e.clientY - d.y) / r.height;
    const s = d.start;
    let { x, y, w, h } = s;
    if (d.mode === 'move') {
      x = Math.min(1 - w, Math.max(0, s.x + dx));
      y = Math.min(1 - h, Math.max(0, s.y + dy));
    } else {
      if (d.mode.includes('l')) [x, w] = [Math.min(s.x + s.w - 0.05, Math.max(0, s.x + dx)), 0];
      if (d.mode.includes('r')) w = Math.min(1 - s.x, Math.max(0.05, s.w + dx));
      if (d.mode.includes('l')) w = s.x + s.w - x;
      if (d.mode.includes('t')) [y, h] = [Math.min(s.y + s.h - 0.05, Math.max(0, s.y + dy)), 0];
      if (d.mode.includes('b')) h = Math.min(1 - s.y, Math.max(0.05, s.h + dy));
      if (d.mode.includes('t')) h = s.y + s.h - y;
    }
    put({ ...s, x, y, w, h }, d.key);
  }
  return (
    <BottomSheet open={open} title="ครอป หมุน กลับด้าน" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        {still && (
          <div className="flex justify-center">
            <div
              ref={box}
              className="relative touch-none select-none"
              style={{ width: `min(100%, ${(220 * still.w) / still.h}px)`, aspectRatio: `${still.w} / ${still.h}` }}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <canvas
                aria-hidden
                className="size-full"
                width={still.w}
                height={still.h}
                ref={(cv) => cv?.getContext('2d')?.drawImage(still.img, 0, 0, still.w, still.h)}
              />
              <div
                role="group"
                aria-label="กรอบครอป: ลากเพื่อย้าย ลากมุมเพื่อปรับขนาด"
                className="absolute border-2 border-white shadow-[0_0_0_999px_rgb(0_0_0/0.55)]"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                onPointerDown={(e) => down(e, 'move')}
              >
                {(['tl', 'tr', 'bl', 'br'] as const).map((m) => (
                  <span
                    key={m}
                    aria-hidden
                    onPointerDown={(e) => down(e, m)}
                    className={`absolute size-5 rounded-pill border-2 border-black bg-white ${m.includes('t') ? '-top-2.5' : '-bottom-2.5'} ${m.includes('l') ? '-left-2.5' : '-right-2.5'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div role="group" aria-label="สัดส่วนกรอบ" className="flex flex-wrap gap-2">
          {RATIOS.map(([label, r]) => (
            <Button key={label} variant="secondary" size="md" onClick={() => (r ? ratio(r) : put({ ...c, x: 0, y: 0, w: 1, h: 1 }))}>
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="md" onClick={() => put({ ...c, rotate: ((c.rotate + 270) % 360) as 0 | 90 | 180 | 270 })}>
            <RotateCcw size={16} aria-hidden /> หมุนซ้าย
          </Button>
          <Button variant="secondary" size="md" onClick={() => put({ ...c, rotate: ((c.rotate + 90) % 360) as 0 | 90 | 180 | 270 })}>
            <RotateCw size={16} aria-hidden /> หมุนขวา
          </Button>
          <Button variant={c.mirror ? 'primary' : 'secondary'} size="md" aria-pressed={c.mirror} onClick={() => put({ ...c, mirror: !c.mirror })}>
            <FlipHorizontal2 size={16} aria-hidden /> กลับด้าน
          </Button>
          <Button variant="ghost" size="md" onClick={() => put({ x: 0, y: 0, w: 1, h: 1, rotate: 0, mirror: false })}>
            รีเซ็ต
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ---- transitions ----

export function TransitionSheet({ open, onClose, project, fromClipId, onPreview }: { open: boolean; onClose: () => void; project: Project; fromClipId: string | null; onPreview: (from: Us, to: Us) => void }) {
  const current = project.transitions.find((t) => t.fromClipId === fromClipId);
  const main = project.tracks[0].clips;
  const i = main.findIndex((c) => c.id === fromClipId);
  const max = i >= 0 && main[i + 1] ? Math.min(main[i].duration, main[i + 1].duration) / 2 / SEC : 0;
  const [message, setMessage] = useState('');
  const cut = i >= 0 && main[i + 1] ? main[i + 1].start : 0;
  function choose(id: string | null, seconds: number, all = false) {
    setMessage('');
    try {
      edit((d) => {
        const clips = d.tracks[0].clips;
        for (let k = 0; k + 1 < clips.length; k++) {
          if (!all && clips[k].id !== fromClipId) continue;
          try {
            setTransition(d, clips[k].id, id, Math.round(seconds * SEC));
          } catch (e) {
            if (!all) throw e; // too-short pairs are skipped when applying to every cut
          }
        }
      }, all ? '' : `transition-${fromClipId}`);
      if (id) onPreview(cut - seconds * SEC * 0.75, cut + seconds * SEC * 0.75);
    } catch {
      setMessage('คลิปสั้นเกินไปสำหรับทรานซิชัน');
    }
  }
  const seconds = current ? current.duration / SEC : 0.6;
  return (
    <BottomSheet open={open} title="ทรานซิชัน" onClose={onClose} modal={false}>
      {fromClipId && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            <PresetTile label="ไม่มี" none selected={!current} onClick={() => choose(null, 0)} />
            {TRANSITIONS.map((t) => (
              <PresetTile key={t.id} label={t.name} selected={current?.presetId === t.id} onClick={() => choose(t.id, Math.min(max, current ? seconds : t.seconds))} />
            ))}
          </div>
          {current && (
            <Slider
              label="ความยาว"
              value={Math.round(seconds * 10) / 10}
              min={0.1}
              max={Math.max(0.1, Math.floor(max * 10) / 10)}
              step={0.1}
              format={(v) => `${v.toFixed(1)} วิ`}
              onChange={(v) => choose(current.presetId, v)}
            />
          )}
          <Button variant="secondary" disabled={!current} onClick={() => current && choose(current.presetId, seconds, true)}>
            ใช้กับทุกจุดตัด
          </Button>
          {message && (
            <p role="alert" className="text-xs text-warning">
              {message}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// ---- sound: volume, fades, voice effects, extract ----

export function SoundSheet({ open, onClose, clip, canExtract, onExtracted }: { open: boolean; onClose: () => void; clip: MediaClip | AudioClip; canExtract: boolean; onExtracted: (id: string) => void }) {
  const half = clip.duration / 2 / SEC;
  return (
    <BottomSheet open={open} title="เสียง" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-2">
        <Slider label="ระดับเสียง" value={Math.round(clip.volume * 100)} min={0} max={200} step={5} format={(v) => `${v}%`} onChange={(v) => edit((d) => setVolume(d, clip.id, v / 100), 'volume')} />
        <Slider
          label="ค่อยๆ ดัง"
          value={Math.round(((clip.fadeIn ?? 0) / SEC) * 10) / 10}
          min={0}
          max={Math.max(0.1, Math.floor(half * 10) / 10)}
          step={0.1}
          format={(v) => `${v.toFixed(1)} วิ`}
          onChange={(v) => edit((d) => setFades(d, clip.id, v * SEC, clip.fadeOut ?? 0), `fade-in-${clip.id}`)}
        />
        <Slider
          label="ค่อยๆ เบา"
          value={Math.round(((clip.fadeOut ?? 0) / SEC) * 10) / 10}
          min={0}
          max={Math.max(0.1, Math.floor(half * 10) / 10)}
          step={0.1}
          format={(v) => `${v.toFixed(1)} วิ`}
          onChange={(v) => edit((d) => setFades(d, clip.id, clip.fadeIn ?? 0, v * SEC), `fade-out-${clip.id}`)}
        />
        <p className="text-sm">เปลี่ยนเสียง</p>
        <div role="radiogroup" aria-label="เปลี่ยนเสียง" className="flex flex-wrap gap-2">
          {[{ id: null, name: 'ปกติ' }, ...VOICES].map((v) => (
            <button
              key={v.name}
              role="radio"
              aria-checked={(clip.voice ?? null) === v.id}
              onClick={() => edit((d) => setVoice(d, clip.id, v.id))}
              className={`h-10 rounded-pill px-4 text-sm ${(clip.voice ?? null) === v.id ? 'bg-accent text-on-accent' : 'bg-raised'} ${focus}`}
            >
              {v.name}
            </button>
          ))}
        </div>
        {canExtract && (
          <Button
            variant="secondary"
            onClick={() => {
              let id = '';
              edit((d) => {
                id = extractAudio(d, clip.id);
              });
              onExtracted(id);
            }}
          >
            แยกเสียงออกเป็นคลิปเสียง
          </Button>
        )}
        <p className="text-xs text-muted">ระดับเสียงเกิน 100% ได้ยินเต็มในไฟล์ที่ส่งออก (ตัวอย่างเล่นได้สูงสุด 100%)</p>
      </div>
    </BottomSheet>
  );
}

// ---- voiceover ----

export function VoiceoverSheet({ open, onClose, onRecord, time }: { open: boolean; onClose: () => void; onRecord: (state: 'start' | 'stop') => Promise<void>; time: Us }) {
  const [rec, setRec] = useState<{ since: number } | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [rec]);
  async function toggle() {
    setError('');
    try {
      if (rec) {
        setRec(null);
        await onRecord('stop');
      } else {
        await onRecord('start');
        setRec({ since: performance.now() });
        setNow(performance.now());
      }
    } catch (e) {
      setRec(null);
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน เปิดสิทธิ์ไมค์ให้แอปในการตั้งค่าเครื่องแล้วลองใหม่' : `อัดเสียงไม่ได้ (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return (
    <BottomSheet open={open} title="พากย์เสียง" onClose={() => !rec && onClose()} modal={false}>
      <div className="flex flex-col items-center gap-3 py-2">
        <p className="text-sm text-muted">{rec ? 'กำลังอัด… วิดีโอเล่นไปพร้อมกัน (เสียงวิดีโอปิดไว้)' : `เริ่มอัดที่ ${formatTime(time, true)} คลิปเสียงจะวางตรงนั้น`}</p>
        <button
          onClick={() => void toggle()}
          aria-label={rec ? 'หยุดอัด' : 'เริ่มอัดเสียง'}
          className={`grid size-20 place-items-center rounded-pill ${rec ? 'bg-danger' : 'bg-accent'} text-on-accent ${focus}`}
        >
          {rec ? <Square size={28} aria-hidden /> : <Mic size={32} aria-hidden />}
        </button>
        <p role="status" className="flex items-center gap-2 font-mono text-sm">
          {rec && <Circle size={10} aria-hidden className="fill-danger text-danger" />}
          {rec ? formatTime(Math.max(0, (now - rec.since) * 1000), true) : ''}
        </p>
        {error && (
          <p role="alert" className="text-center text-xs text-warning">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
