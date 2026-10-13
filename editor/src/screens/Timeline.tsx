import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeftRight, Film, Image, Layers, Music, Plus, Type, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { SEC, formatTime, projectDuration, snap, snapPoints, sourceOut } from '../timeline.ts';
import { PEAK_RATE, THUMB_H, peaksOf, stripOf } from '../thumbs';
import { sourceAt } from '../timing.ts';
import { keyTimes } from '../keyframes';
import { effectName } from '../effects';
import type { AudioClip, Clip, MediaAsset, MediaClip, Project, Us } from '../schema';

type Move = { index: number } | { start: Us };
type Edge = 'in' | 'out';
const MIN_PPS = 8;
const MAX_PPS = 240;
const SNAP_PX = 10;
const clampPps = (v: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, v));

function useResolved<T>(promise: Promise<T> | null) {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    setValue(null);
    void promise?.then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, [promise]);
  return value;
}

// Frames from the clip's own source range, one tile per tile-width of timeline.
function Filmstrip({ asset, clip, pps, h }: { asset: MediaAsset; clip: MediaClip; pps: number; h: number }) {
  const strip = useResolved(stripOf(asset));
  if (!strip) return null;
  const tw = (strip.w * h) / THUMB_H;
  const n = Math.ceil(((clip.duration / SEC) * pps) / tw);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex overflow-hidden">
      {Array.from({ length: n }, (_, i) => {
        const at = clip.kind === 'photo' ? 0 : sourceAt(clip, (((i + 0.5) * tw) / pps) * SEC) / SEC;
        const idx = Math.min(strip.count - 1, Math.max(0, Math.floor(at / strip.step)));
        return (
          <span
            key={i}
            className="flex-none"
            style={{ width: tw, height: h, backgroundImage: `url(${strip.url})`, backgroundSize: `${strip.count * tw}px ${h}px`, backgroundPosition: `${-idx * tw}px 0` }}
          />
        );
      })}
    </span>
  );
}

function Waveform({ asset, clip, pps }: { asset: MediaAsset; clip: AudioClip; pps: number }) {
  const peaks = useResolved(peaksOf(asset));
  if (!peaks) return null;
  const n = Math.max(2, Math.min(600, Math.round(((clip.duration / SEC) * pps) / 3)));
  const a = (clip.sourceIn / SEC) * PEAK_RATE;
  const b = (sourceOut(clip) / SEC) * PEAK_RATE;
  let d = '';
  for (let i = 0; i < n; i++) {
    const k0 = Math.floor(a + ((b - a) * i) / n);
    const k1 = Math.max(k0 + 1, Math.floor(a + ((b - a) * (i + 1)) / n));
    let v = 0;
    for (let k = k0; k < k1; k++) v = Math.max(v, peaks[k] ?? 0);
    const y = Math.max(0.03, Math.min(1, v * clip.volume)) * 0.45;
    d += `M${i + 0.5} ${(0.5 - y).toFixed(3)}V${(0.5 + y).toFixed(3)}`;
  }
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full text-fg opacity-50" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none">
      <path d={d} stroke="currentColor" strokeWidth={0.6} />
    </svg>
  );
}

// The music's beats on its clip, where cuts land when the main track follows the beat.
function BeatMarks({ beats, clip, pps }: { beats: number[]; clip: AudioClip; pps: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {beats.map((b) => {
        const at = (b * SEC - clip.sourceIn) / clip.speed;
        return at >= 0 && at <= clip.duration ? <span key={b} className="absolute bottom-0.5 size-1.5 -translate-x-1/2 rounded-pill bg-warning" style={{ left: (at / SEC) * pps }} /> : null;
      })}
    </span>
  );
}

const KIND = {
  video: { label: 'วิดีโอ', icon: Film, cls: 'bg-raised' },
  photo: { label: 'รูป', icon: Image, cls: 'bg-raised' },
  audio: { label: 'เสียง', icon: Music, cls: 'bg-clip-audio' },
  text: { label: 'ข้อความ', icon: Type, cls: 'bg-clip-text' },
  overlay: { label: 'ภาพซ้อน', icon: Layers, cls: 'bg-raised' },
  effect: { label: 'เอฟเฟกต์', icon: Zap, cls: 'bg-clip-effect' },
  empty: { label: 'ช่องว่าง', icon: Plus, cls: 'border-dashed border-muted bg-surface text-muted' },
} as const;

// The playhead stays in the middle; scrolling the tracks under it scrubs. Tap a clip to select it, then drag it.
export function Timeline({
  project,
  time,
  selectedId,
  onSelect,
  onSeek,
  onMove,
  onDelete,
  onTrim,
  onScrub,
  onTransition,
}: {
  project: Project;
  time: Us;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSeek: (t: Us) => void;
  onMove: (id: string, to: Move) => void;
  onDelete: (id: string) => void;
  onTrim: (from: Clip, edge: Edge, dt: Us) => void; // dt is measured from where the drag began
  onScrub: () => void; // a finger or wheel on the timeline: stop playback so it does not fight the scroll
  onTransition: (fromClipId: string) => void;
}) {
  const [pps, setPps] = useState(48); // pixels per second
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const [guide, setGuide] = useState<Us | null>(null); // a snap line while an edge or clip sticks to something
  const press = useRef<{ c: Clip; x: number; moved: boolean; points: Us[] } | null>(null);
  const trim = useRef<{ c: Clip; edge: Edge; x: number; points: Us[] } | null>(null);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const dragged = useRef(false); // the click that ends a drag must not toggle selection
  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(-1);
  const total = projectDuration(project);
  const width = (total / SEC) * pps;
  const main = project.tracks[0].clips;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = (time / SEC) * pps;
    if (Math.abs(el.scrollLeft - x) > 1) {
      programmatic.current = x;
      el.scrollLeft = x;
    }
  }, [time, pps]);

  // Two fingers (or ctrl + wheel / a trackpad pinch) zoom the timeline.
  useEffect(() => {
    const el = scroller.current!;
    let d0 = 0;
    let p0 = 0;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      d0 = Math.max(1, dist(e));
      p0 = ppsRef.current;
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      setPps(clampPps((p0 * dist(e)) / d0));
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) d0 = 0;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPps((v) => clampPps(v * Math.exp(-e.deltaY / 200)));
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  function onScroll() {
    const el = scroller.current!;
    if (Math.abs(el.scrollLeft - programmatic.current) <= 1) return;
    programmatic.current = -1;
    onSeek(Math.round((el.scrollLeft / pps) * SEC));
  }

  function target(c: Clip, dx: number): Move {
    if (main.includes(c)) {
      const mid = c.start + c.duration / 2 + (dx / pps) * SEC;
      return { index: main.filter((o) => o !== c && o.start + o.duration / 2 < mid).length };
    }
    return { start: c.start + (dx / pps) * SEC };
  }

  function down(e: PointerEvent, c: Clip) {
    if (c.id !== selectedId) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { c, x: e.clientX, moved: false, points: snapPoints(project, time, c.id) };
  }
  // Clips off the main track stick to the playhead and to other clips' edges; the main track is always gapless.
  function move(e: PointerEvent) {
    const p = press.current;
    if (!p) return;
    let dx = e.clientX - p.x;
    if (Math.abs(dx) > 4) p.moved = true;
    if (!p.moved) return;
    let line: Us | null = null;
    if (!main.includes(p.c)) {
      const within = (SNAP_PX / pps) * SEC;
      const start = p.c.start + (dx / pps) * SEC;
      const a = snap(start, p.points, within);
      const b = snap(start + p.c.duration, p.points, within);
      const s = a !== null && (b === null || Math.abs(a - start) <= Math.abs(b - start - p.c.duration)) ? a : b !== null ? b - p.c.duration : null;
      if (s !== null && s >= 0) {
        dx = ((s - p.c.start) / SEC) * pps;
        line = s === a ? a : b;
      }
    }
    setGuide(line);
    setDrag({ id: p.c.id, dx });
  }
  function up(c: Clip) {
    const p = press.current;
    press.current = null;
    dragged.current = !!p?.moved;
    if (p?.moved && drag) onMove(c.id, target(c, drag.dx));
    setDrag(null);
    setGuide(null);
  }

  function trimDown(e: PointerEvent, c: Clip, edge: Edge) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    trim.current = { c: structuredClone(c), edge, x: e.clientX, points: snapPoints(project, time, c.id) };
  }
  function trimMove(e: PointerEvent) {
    const t = trim.current;
    if (!t) return;
    let dt = ((e.clientX - t.x) / pps) * SEC;
    const at = (t.edge === 'in' ? t.c.start : t.c.start + t.c.duration) + dt;
    const s = snap(at, t.points, (SNAP_PX / pps) * SEC);
    if (s !== null) dt += s - at;
    setGuide(s);
    onTrim(t.c, t.edge, Math.round(dt));
  }
  function trimUp() {
    trim.current = null;
    setGuide(null);
  }
  function click(c: Clip) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onSelect(c.id === selectedId ? null : c.id);
  }
  function key(e: KeyboardEvent, c: Clip) {
    if (c.id !== selectedId) return;
    const step = e.shiftKey ? SEC : SEC / 10;
    const i = main.indexOf(c);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      onMove(c.id, i >= 0 ? { index: i + d } : { start: c.start + d * step });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(c.id);
    }
  }

  const step = pps >= 60 ? 1 : pps >= 24 ? 2 : 5;
  const ticks = Array.from({ length: Math.floor(total / SEC / step) + 1 }, (_, i) => i * step);

  return (
    <div className="relative h-(--size-timeline) border-t border-border bg-bg">
      <div ref={scroller} onScroll={onScroll} onPointerDownCapture={onScrub} onWheel={onScrub} className="size-full overflow-auto" aria-label="ไทม์ไลน์" role="group">
        <div
          className="relative box-border min-h-full"
          style={{ width: `calc(${width}px + 100%)`, paddingInline: '50%' }}
          onClick={(e) => e.target === e.currentTarget && onSelect(null)}
        >
          <div className="relative h-5 font-mono text-xs text-muted" aria-hidden>
            {ticks.map((s) => (
              <span key={s} className="absolute top-0 -translate-x-1/2" style={{ left: s * pps }}>
                {formatTime(s * SEC)}
              </span>
            ))}
          </div>
          <div className="relative">
          {guide !== null && <div aria-hidden className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent" style={{ left: (guide / SEC) * pps }} />}
          {project.tracks.map((track) => (
            <div key={track.id} className={`relative mt-1 ${track.kind === 'main' ? 'h-14' : 'h-10'}`} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
              {track.clips.map((c, i) => {
                const empty = c.kind !== 'text' && c.kind !== 'effect' && !!project.assets[c.assetId]?.placeholder;
                const k = KIND[empty ? 'empty' : track.kind === 'overlay' ? 'overlay' : c.kind];
                const Icon = k.icon;
                const selected = c.id === selectedId;
                const dragging = drag?.id === c.id;
                const name = empty ? 'แตะแล้วกด “แทนที่”' : c.kind === 'text' ? c.text || 'ข้อความ' : c.kind === 'effect' ? effectName(c.effect) : project.assets[c.assetId]?.name ?? '';
                const left = (c.start / SEC) * pps + (dragging ? drag.dx : 0);
                const width = Math.max(4, (c.duration / SEC) * pps - 2);
                const asset = c.kind === 'text' || c.kind === 'effect' || empty ? null : project.assets[c.assetId];
                return [
                  <button
                    key={c.id}
                    aria-pressed={selected}
                    aria-label={`${k.label} ${track.kind === 'main' ? i + 1 : ''} ${name} ${formatTime(c.duration, true)}`}
                    onPointerDown={(e) => down(e, c)}
                    onPointerMove={move}
                    onPointerUp={() => up(c)}
                    onPointerCancel={() => up(c)}
                    onClick={() => click(c)}
                    onKeyDown={(e) => key(e, c)}
                    className={`absolute top-0 flex h-full items-center gap-1 overflow-hidden rounded-sm border-2 px-1 text-left text-xs ${k.cls} ${
                      selected ? 'z-10 border-playhead' : 'border-transparent'
                    } ${empty && !selected ? 'border-dashed border-muted' : ''} ${dragging ? 'z-20 opacity-80 shadow-pop' : ''} focus-visible:outline-2 focus-visible:outline-accent`}
                    style={{ left, width, touchAction: selected ? 'none' : 'pan-x pan-y' }}
                  >
                    {asset && c.kind !== 'audio' && <Filmstrip asset={asset} clip={c as MediaClip} pps={pps} h={track.kind === 'main' ? 52 : 36} />}
                    {asset && c.kind === 'audio' && <Waveform asset={asset} clip={c} pps={pps} />}
                    {asset?.beats && c.kind === 'audio' && <BeatMarks beats={asset.beats} clip={c} pps={pps} />}
                    <Icon size={14} aria-hidden className={`relative shrink-0 ${asset && c.kind !== 'audio' ? 'rounded-sm bg-bg/60' : ''}`} />
                    <span className={`relative min-w-0 truncate ${asset && c.kind !== 'audio' ? 'rounded-sm bg-bg/60 px-0.5' : ''}`}>{name}</span>
                  </button>,
                  selected &&
                    c.kind !== 'audio' &&
                    c.kind !== 'effect' &&
                    keyTimes(c).map((at) => (
                      <span
                        key={`${c.id}-key-${at}`}
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 z-20 size-2.5 -translate-1/2 rotate-45 border border-bg bg-accent"
                        style={{ left: left + (at / SEC) * pps }}
                      />
                    )),
                  track.kind === 'main' &&
                    i + 1 < track.clips.length &&
                    !drag && (
                      <button
                        key={`${c.id}-cut`}
                        aria-label={`ทรานซิชันระหว่างคลิปที่ ${i + 1} และ ${i + 2}${project.transitions.some((x) => x.fromClipId === c.id) ? ' (มีแล้ว)' : ''}`}
                        onClick={() => onTransition(c.id)}
                        className={`absolute bottom-0 z-30 grid size-6 -translate-x-1/2 translate-y-1/3 place-items-center rounded-sm border border-bg ${project.transitions.some((x) => x.fromClipId === c.id) ? 'bg-accent text-on-accent' : 'bg-fg text-bg'} focus-visible:outline-2 focus-visible:outline-accent`}
                        style={{ left: ((c.start + c.duration) / SEC) * pps }}
                      >
                        <ArrowLeftRight size={12} aria-hidden />
                      </button>
                    ),
                  selected &&
                    !dragging &&
                    (['in', 'out'] as const).map((edge) => (
                      <div
                        key={`${c.id}-${edge}`}
                        aria-hidden
                        data-edge={edge}
                        onPointerDown={(e) => trimDown(e, c, edge)}
                        onPointerMove={trimMove}
                        onPointerUp={trimUp}
                        onPointerCancel={trimUp}
                        className={`absolute top-0 z-20 grid h-full w-4 cursor-ew-resize touch-none place-items-center bg-playhead ${edge === 'in' ? 'rounded-l-sm' : 'rounded-r-sm'}`}
                        style={{ left: edge === 'in' ? left - 16 : left + width }}
                      >
                        <span className="h-1/2 w-0.5 rounded-pill bg-bg" />
                      </div>
                    )),
                ];
              })}
            </div>
          ))}
          </div>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-playhead" />
      <div className="absolute right-1 bottom-1 flex gap-1">
        <button aria-label="ซูมออก" onClick={() => setPps((v) => clampPps(v / 1.5))} className="grid size-8 place-items-center rounded-md bg-surface text-muted focus-visible:outline-2 focus-visible:outline-accent">
          <ZoomOut size={16} aria-hidden />
        </button>
        <button aria-label="ซูมเข้า" onClick={() => setPps((v) => clampPps(v * 1.5))} className="grid size-8 place-items-center rounded-md bg-surface text-muted focus-visible:outline-2 focus-visible:outline-accent">
          <ZoomIn size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
