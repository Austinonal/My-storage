import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Film, Image, Music, ZoomIn, ZoomOut } from 'lucide-react';
import { SEC, formatTime, projectDuration } from '../timeline.ts';
import type { Clip, Project, Us } from '../schema';

type Move = { index: number } | { start: Us };

const KIND = {
  video: { label: 'วิดีโอ', icon: Film, cls: 'bg-raised' },
  photo: { label: 'รูป', icon: Image, cls: 'bg-raised' },
  audio: { label: 'เสียง', icon: Music, cls: 'bg-clip-audio' },
  text: { label: 'ข้อความ', icon: Film, cls: 'bg-clip-text' },
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
  onScrub,
}: {
  project: Project;
  time: Us;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSeek: (t: Us) => void;
  onMove: (id: string, to: Move) => void;
  onDelete: (id: string) => void;
  onScrub: () => void; // a finger or wheel on the timeline: stop playback so it does not fight the scroll
}) {
  const [pps, setPps] = useState(48); // pixels per second
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const press = useRef<{ id: string; x: number; moved: boolean } | null>(null);
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
    press.current = { id: c.id, x: e.clientX, moved: false };
  }
  function move(e: PointerEvent) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (Math.abs(dx) > 4) p.moved = true;
    if (p.moved) setDrag({ id: p.id, dx });
  }
  function up(c: Clip) {
    const p = press.current;
    press.current = null;
    dragged.current = !!p?.moved;
    if (p?.moved && drag) onMove(c.id, target(c, drag.dx));
    setDrag(null);
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
          {project.tracks.map((track) => (
            <div key={track.id} className={`relative mt-1 ${track.kind === 'main' ? 'h-14' : 'h-10'}`} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
              {track.clips.map((c, i) => {
                const k = KIND[c.kind];
                const Icon = k.icon;
                const selected = c.id === selectedId;
                const dragging = drag?.id === c.id;
                const name = c.kind === 'text' ? c.text : project.assets[c.assetId]?.name ?? '';
                return (
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
                    } ${dragging ? 'z-20 opacity-80 shadow-pop' : ''} focus-visible:outline-2 focus-visible:outline-accent`}
                    style={{
                      left: (c.start / SEC) * pps + (dragging ? drag.dx : 0),
                      width: Math.max(4, (c.duration / SEC) * pps - 2),
                      touchAction: selected ? 'none' : 'pan-x pan-y',
                    }}
                  >
                    <Icon size={14} aria-hidden className="shrink-0" />
                    <span className="min-w-0 truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-playhead" />
      <div className="absolute right-1 bottom-1 flex gap-1">
        <button aria-label="ซูมออก" onClick={() => setPps((v) => Math.max(8, v / 1.5))} className="grid size-8 place-items-center rounded-md bg-surface text-muted focus-visible:outline-2 focus-visible:outline-accent">
          <ZoomOut size={16} aria-hidden />
        </button>
        <button aria-label="ซูมเข้า" onClick={() => setPps((v) => Math.min(240, v * 1.5))} className="grid size-8 place-items-center rounded-md bg-surface text-muted focus-visible:outline-2 focus-visible:outline-accent">
          <ZoomIn size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
