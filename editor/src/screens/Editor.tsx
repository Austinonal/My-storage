import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ImagePlus, Music, Palette, Pause, Play, Redo2, Replace, Scissors, SlidersHorizontal, Sparkles, SunMedium, Trash2, Type, Undo2, Upload, Volume2, WandSparkles } from 'lucide-react';
import { BottomSheet, BottomToolbar, Button, Slider, ToolButton, TopBar } from '../ui';
import { edit, openProject, redo, undo, useEditor } from '../store';
import { importMedia } from '../media';
import { Player } from '../player';
import {
  SEC,
  addAudio,
  addMedia,
  addText,
  deleteClip,
  findClip,
  formatTime,
  moveClip,
  projectDuration,
  replaceClip,
  setAdjust,
  setFilter,
  setPhotoDuration,
  setTextTiming,
  setVolume,
  sourceOut,
  splitAt,
  trimClip,
  updateText,
} from '../timeline.ts';
import type { Slot } from '../anim.ts';
import { AnimationSheet, type Still } from './AnimationSheet';
import { Timeline } from './Timeline';
import { TemplateSheet } from './TemplateSheet';
import { TextSheet } from './TextSheet';
import { ColourSheet, type ColourTab } from './ColourSheet';
import { importMessage } from './Home';
import type { AudioClip, MediaAsset, MediaClip, Project, TextClip, Transform } from '../schema';

type Sheet = 'anim' | 'trim' | 'volume' | 'template' | 'text' | 'colour' | null;
type Point = { x: number; y: number };
const pinchOf = (a: Point, b: Point) => ({ d: Math.hypot(b.x - a.x, b.y - a.y), a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const wrapDeg = (v: number) => {
  const r = ((((v + 180) % 360) + 360) % 360) - 180;
  return Math.abs(r) < 3 ? 0 : r; // snap to level
};

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        left={
          <Button variant="ghost" size="md" aria-label="กลับ" onClick={() => (location.hash = '#/')}>
            <ArrowLeft size={20} aria-hidden />
          </Button>
        }
        title=""
      />
      <p role="alert" className="p-8 text-center text-sm text-muted">
        {children}
      </p>
    </div>
  );
}

function selected(p: Project | null, id: string | null) {
  if (!p || !id) return null;
  try {
    return findClip(p, id);
  } catch {
    return null; // deleted, or gone after an undo
  }
}

export function Editor({ id }: { id: string }) {
  const { project, past, future } = useEditor();
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found'>('loading');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [still, setStill] = useState<Still | null>(null);
  const [colourTab, setColourTab] = useState<ColourTab>('filter');
  const [pendingPlay, setPendingPlay] = useState<Slot | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const visualInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStatus('loading');
    openProject(id).then((ok) => setStatus(ok ? 'ready' : 'not-found'));
  }, [id]);

  const p = project?.id === id ? project : null;
  const sel = selected(p, selectedId);
  const visual = sel && (sel.kind === 'video' || sel.kind === 'photo') ? sel : null;
  const textSel = sel?.kind === 'text' ? sel : null;
  const animated = visual ?? textSel;
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ id: string; at: Point; tr: Transform; pinch: { d: number; a: number } | null; moved: boolean; key: string } | null>(null);
  const total = p ? projectDuration(p) : 0;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !p) return;
    const player = new Player(cv);
    player.onTick = (t, on) => {
      setTime(t);
      setPlaying(on);
    };
    player.onError = (e) => setNotice(importMessage(e));
    playerRef.current = player;
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect();
      player.resize(r.width * devicePixelRatio, r.height * devicePixelRatio);
    });
    ro.observe(cv);
    return () => {
      ro.disconnect();
      player.destroy();
      playerRef.current = null;
    };
  }, [!!p]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (p) playerRef.current?.setProject(p);
  }, [p]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.selectedText = textSel?.id ?? null;
    player.draw();
  }, [textSel?.id]);

  // Tapping an animation preset plays just that part of the clip once, after the edit has landed.
  useEffect(() => {
    if (!pendingPlay || !animated) return;
    setPendingPlay(null);
    const a = pendingPlay === 'in' ? animated.animIn : pendingPlay === 'out' ? animated.animOut : animated.kind === 'text' ? animated.animLoop : animated.animCombo;
    if (!a) return;
    const from = pendingPlay === 'out' ? animated.start + animated.duration - a.duration : animated.start;
    playerRef.current?.playRange(from, from + (pendingPlay === 'combo' && animated.kind === 'text' ? animated.duration : a.duration));
  }, [pendingPlay, animated]);

  async function addFiles(files: File[], as: 'visual' | 'audio') {
    if (!p || files.length === 0) return;
    setBusy(true);
    setNotice('');
    try {
      const assets: MediaAsset[] = [];
      for (const f of files) assets.push(await importMedia(p.id, f, as));
      if (as === 'audio') {
        let newId = '';
        edit((d) => {
          for (const a of assets) newId = addAudio(d, a, time);
        });
        setSelectedId(newId);
      } else {
        const main = p.tracks[0].clips;
        const at = visual ? main.indexOf(visual) + 1 : main.length;
        let ids: string[] = [];
        edit((d) => {
          ids = addMedia(d, assets, at);
        });
        setSelectedId(ids[0] ?? null);
      }
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function replaceWith(file: File | undefined) {
    if (!p || !visual || !file) return;
    setBusy(true);
    setNotice('');
    try {
      const asset = await importMedia(p.id, file);
      edit((d) => replaceClip(d, visual.id, asset));
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function split() {
    if (!sel) return;
    let right: string | null = null;
    edit((d) => {
      right = splitAt(d, sel.id, time);
    });
    if (!right) setNotice('เลื่อนเส้นเวลาไปไว้กลางคลิปที่เลือกก่อน แล้วค่อยแยก');
  }

  function remove(clipId: string) {
    edit((d) => deleteClip(d, clipId));
    setSelectedId(null);
    setSheet(null);
  }

  // New text sits at the playhead and copies the look of the text before it, so a run of subtitles stays consistent.
  function newText(at: number, from?: TextClip) {
    if (!p) return;
    const before = from ?? (p.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'text' && c.start <= at) as TextClip[]).sort((x, y) => x.start - y.start).at(-1);
    let newId = '';
    edit((d) => {
      newId = addText(d, at, 'ข้อความ', before?.style, before ? before.duration / SEC : 3);
      if (before) updateText(d, newId, { transform: before.transform });
    });
    setSelectedId(newId);
    setSheet('text');
    playerRef.current?.seek(at);
  }

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const cv = e.currentTarget;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cv.width) / r.width, y: ((e.clientY - r.top) * cv.height) / r.height };
  }

  function hitText({ x, y }: Point) {
    const boxes = playerRef.current?.textBoxes ?? [];
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const r = (-b.rot * Math.PI) / 180;
      const dx = x - b.cx;
      const dy = y - b.cy;
      if (Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) <= b.w / 2 && Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) <= b.h / 2) return b.id;
    }
    return null;
  }

  // Preview gestures on text: tap selects, one finger moves, two fingers scale and turn.
  function startGesture(id: string, at: Point, pinch: { d: number; a: number } | null) {
    const c = findClip(p!, id) as TextClip;
    drag.current = { id, at, tr: c.transform, pinch, moved: drag.current?.moved ?? false, key: drag.current?.key ?? `text-move-${Date.now()}` };
  }

  function onPreviewDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!p) return;
    const pt = canvasPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, pt);
    if (playerRef.current?.playing) playerRef.current.pause();
    if (pointers.current.size === 1) {
      drag.current = null;
      const id = hitText(pt);
      if (id) {
        setSelectedId(id);
        setNotice('');
        startGesture(id, pt, null);
      }
    } else if (pointers.current.size === 2) {
      const id = drag.current?.id ?? textSel?.id;
      const [a, b] = [...pointers.current.values()];
      if (id) startGesture(id, pt, pinchOf(a, b));
    }
  }

  function onPreviewMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = canvasPoint(e);
    pointers.current.set(e.pointerId, pt);
    const g = drag.current;
    if (!g) return;
    const cv = e.currentTarget;
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const now = pinchOf(a, b);
      g.moved = true;
      edit((d) => updateText(d, g.id, { transform: { scale: (g.tr.scale * now.d) / Math.max(1, g.pinch!.d), rotation: wrapDeg(g.tr.rotation + now.a - g.pinch!.a) } }), g.key);
    } else if (!g.pinch) {
      const dx = pt.x - g.at.x;
      const dy = pt.y - g.at.y;
      if (!g.moved && Math.hypot(dx, dy) < 6 * devicePixelRatio) return;
      g.moved = true;
      let x = g.tr.x + dx / cv.width;
      if (Math.abs(x - 0.5) < 0.015) x = 0.5; // snap to the centre line
      edit((d) => updateText(d, g.id, { transform: { x, y: clamp01(g.tr.y + dy / cv.height) } }), g.key);
    }
  }

  function onPreviewUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = drag.current;
    if (pointers.current.size === 0) {
      if (!g && textSel) setSelectedId(null); // a tap beside the text lets go of it
      drag.current = null;
    } else if (g) {
      startGesture(g.id, [...pointers.current.values()][0], null); // one finger left: keep moving from here
    }
  }

  // A small frame of the selected clip, for the preset tiles.
  function captureStill() {
    const player = playerRef.current;
    const img = visual && player?.sourceOf(visual);
    if (img && p && visual) {
      const a = p.assets[visual.assetId];
      const w = 160;
      const h = Math.max(1, Math.round((w * a.height) / a.width));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      setStill({ img: c, w, h });
    }
  }

  function openColour(tab: ColourTab) {
    captureStill();
    setColourTab(tab);
    setSheet('colour');
  }

  function colourToAll(from: MediaClip) {
    edit((d) => {
      for (const c of d.tracks[0].clips) {
        if (c.kind !== 'video' && c.kind !== 'photo') continue;
        setFilter(d, c.id, from.filter?.presetId ?? null, from.filter?.intensity ?? 1);
        setAdjust(d, c.id, from.adjust);
      }
    });
    setNotice('ใช้สีนี้กับทุกคลิปแล้ว');
  }

  if (status === 'not-found') return <Message>ไม่พบโปรเจกต์นี้ อาจถูกลบไปแล้ว</Message>;

  const [a, b] = (p?.aspect ?? '9:16').split(':').map(Number);
  const player = playerRef.current;
  const onlyMain = !!p && p.tracks[0].clips.length === 1 && p.tracks[0].clips[0].id === sel?.id;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        left={
          <Button variant="ghost" size="md" aria-label="กลับไปหน้าโปรเจกต์" onClick={() => (location.hash = '#/')}>
            <ArrowLeft size={20} aria-hidden />
          </Button>
        }
        title={p?.name ?? ''}
        right={
          <Button size="md" disabled={!p} onClick={() => (location.hash = `#/export/${id}`)}>
            <Upload size={16} aria-hidden /> ส่งออก
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 items-center justify-center p-2 [container-type:size]">
        <div style={{ width: `min(100cqw, 100cqh * ${a / b})`, aspectRatio: `${a} / ${b}` }} className={p ? '' : 'animate-pulse rounded-md bg-raised'}>
          {p && (
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="ตัวอย่างวิดีโอ"
              className="size-full touch-none"
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={onPreviewUp}
              onPointerCancel={onPreviewUp}
            />
          )}
        </div>
      </div>

      <div className="flex h-(--size-touch) items-center gap-2 px-2">
        <Button variant="ghost" size="md" aria-label="เลิกทำ" disabled={past.length === 0} onClick={undo}>
          <Undo2 size={20} aria-hidden />
        </Button>
        <Button variant="ghost" size="md" aria-label="ทำซ้ำ" disabled={future.length === 0} onClick={redo}>
          <Redo2 size={20} aria-hidden />
        </Button>
        <span className="flex-1 text-center font-mono text-xs text-muted">
          {formatTime(time, true)} / {formatTime(total, true)}
        </span>
        <Button variant="ghost" size="md" aria-label={playing ? 'หยุด' : 'เล่น'} disabled={!p} onClick={() => (playing ? player?.pause() : player?.play())}>
          {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
        </Button>
      </div>

      {(notice || busy) && (
        <p role={busy ? 'status' : 'alert'} className={`px-4 pb-1 text-xs ${busy ? 'text-muted' : 'text-warning'}`}>
          {busy ? 'กำลังนำเข้า…' : notice}
        </p>
      )}

      {p && (
        <Timeline
          project={p}
          time={time}
          selectedId={sel?.id ?? null}
          onSelect={(clipId) => {
            setSelectedId(clipId);
            setNotice('');
          }}
          onSeek={(t) => player?.seek(t)}
          onMove={(clipId, to) => edit((d) => moveClip(d, clipId, to))}
          onDelete={remove}
          onScrub={() => player?.playing && player.pause()}
        />
      )}

      <BottomToolbar label={sel ? 'เครื่องมือคลิป' : 'เครื่องมือ'}>
        {!sel && (
          <>
            <ToolButton icon={ImagePlus} label="เพิ่มคลิป" disabled={!p || busy} onClick={() => visualInput.current?.click()} />
            <ToolButton icon={Music} label="เพิ่มเสียง" disabled={!p || busy} onClick={() => audioInput.current?.click()} />
            <ToolButton icon={Type} label="ข้อความ" disabled={!p || busy} onClick={() => newText(Math.min(time, Math.max(0, total - SEC)))} />
            <ToolButton icon={WandSparkles} label="เทมเพลต" disabled={!p || busy} active={sheet === 'template'} onClick={() => setSheet('template')} />
          </>
        )}
        {sel && (
          <>
            {visual && <ToolButton icon={Replace} label="แทนที่" disabled={busy} active={!!p?.assets[visual.assetId].placeholder} onClick={() => replaceInput.current?.click()} />}
            {textSel && <ToolButton icon={Type} label="แก้ไข" active={sheet === 'text'} onClick={() => setSheet('text')} />}
            <ToolButton icon={Scissors} label="แยก" onClick={split} />
            <ToolButton icon={SlidersHorizontal} label={sel.kind === 'video' || sel.kind === 'audio' ? 'ตัด' : 'ระยะเวลา'} active={sheet === 'trim'} onClick={() => setSheet('trim')} />
            {animated && <ToolButton icon={Sparkles} label="แอนิเมชัน" active={sheet === 'anim'} onClick={() => {
              captureStill();
              setSheet('anim');
            }} />}
            {visual && <ToolButton icon={Palette} label="ฟิลเตอร์" active={sheet === 'colour' && colourTab === 'filter'} onClick={() => openColour('filter')} />}
            {visual && <ToolButton icon={SunMedium} label="ปรับสี" active={sheet === 'colour' && colourTab === 'adjust'} onClick={() => openColour('adjust')} />}
            {(sel.kind === 'video' || sel.kind === 'audio') && <ToolButton icon={Volume2} label="ระดับเสียง" active={sheet === 'volume'} onClick={() => setSheet('volume')} />}
            <ToolButton icon={Trash2} label="ลบ" disabled={onlyMain} onClick={() => remove(sel.id)} />
          </>
        )}
      </BottomToolbar>

      <input ref={visualInput} type="file" accept="video/*,image/*" multiple hidden aria-label="เลือกวิดีโอหรือรูป" onChange={(e) => {
        void addFiles([...(e.target.files ?? [])], 'visual');
        e.target.value = '';
      }} />
      <input ref={replaceInput} type="file" accept="video/*,image/*" hidden aria-label="เลือกรูปหรือวิดีโอมาแทนที่" onChange={(e) => {
        void replaceWith(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <input ref={audioInput} type="file" accept="audio/*,video/*" hidden aria-label="เลือกไฟล์เสียง หรือวิดีโอเพื่อใช้แค่เสียง" onChange={(e) => {
        void addFiles([...(e.target.files ?? [])], 'audio');
        e.target.value = '';
      }} />

      {p && (
        <TemplateSheet
          open={sheet === 'template'}
          onClose={() => setSheet(null)}
          project={p}
          onApplied={(slots, empty) => {
            setSelectedId(null);
            player?.seek(0);
            setNotice(empty ? `จัดตามคลิปต้นแบบแล้ว ${slots} ช่อง · ช่องว่าง ${empty} ช่อง: แตะช่องว่างแล้วกด “แทนที่”` : `จัดตามคลิปต้นแบบแล้ว ${slots} ช่อง`);
          }}
        />
      )}
      {p && animated && (
        <AnimationSheet open={sheet === 'anim'} onClose={() => setSheet(null)} clip={animated} still={visual ? still : null} onPlay={setPendingPlay} />
      )}
      {p && visual && (
        <ColourSheet open={sheet === 'colour'} tab={colourTab} onTab={setColourTab} onClose={() => setSheet(null)} clip={visual} still={still} onApplyAll={() => colourToAll(visual)} />
      )}
      {p && textSel && (
        <TextSheet open={sheet === 'text'} onClose={() => setSheet(null)} clip={textSel} onNext={() => newText(textSel.start + textSel.duration, textSel)} />
      )}
      {p && sel && (
        <BottomSheet open={sheet === 'trim'} title={sel.kind === 'photo' ? 'ระยะเวลารูป' : sel.kind === 'text' ? 'ระยะเวลาข้อความ' : 'ตัดคลิป'} onClose={() => setSheet(null)} modal={false}>
          {sel.kind === 'text' ? (
            <Slider
              label="ระยะเวลา"
              value={sel.duration / SEC}
              min={0.3}
              max={30}
              step={0.1}
              format={(v) => `${v.toFixed(1)} วิ`}
              onChange={(v) => edit((d) => setTextTiming(d, sel.id, sel.start, Math.round(v * SEC)), 'text-duration')}
            />
          ) : sel.kind === 'photo' ? (
            <Slider
              label="ระยะเวลา"
              value={sel.duration / SEC}
              min={0.5}
              max={20}
              step={0.1}
              format={(v) => `${v.toFixed(1)} วิ`}
              onChange={(v) => edit((d) => setPhotoDuration(d, sel.id, Math.round(v * SEC)), 'photo-duration')}
            />
          ) : (
            <TrimSliders project={p} clip={sel as MediaClip | AudioClip} onSeek={(t) => player?.seek(t)} />
          )}
        </BottomSheet>
      )}
      {p && sel && (sel.kind === 'video' || sel.kind === 'audio') && (
        <BottomSheet open={sheet === 'volume'} title="ระดับเสียง" onClose={() => setSheet(null)} modal={false}>
          <Slider
            label="ระดับเสียง"
            value={Math.round(sel.volume * 100)}
            min={0}
            max={200}
            step={5}
            format={(v) => `${v}%`}
            onChange={(v) => edit((d) => setVolume(d, sel.id, v / 100), 'volume')}
          />
        </BottomSheet>
      )}
    </div>
  );
}

function TrimSliders({ project, clip, onSeek }: { project: Project; clip: MediaClip | AudioClip; onSeek: (t: number) => void }) {
  const frame = 1 / project.fps;
  const assetS = project.assets[clip.assetId].duration / SEC;
  const inS = clip.sourceIn / SEC;
  const outS = sourceOut(clip) / SEC;
  return (
    <div className="flex flex-col gap-2">
      <Slider
        label="จุดเริ่ม"
        value={inS}
        min={0}
        max={assetS}
        step={frame}
        format={(v) => formatTime(v * SEC, true)}
        onChange={(v) => {
          edit((d) => trimClip(d, clip.id, 'in', Math.round(v * SEC)), 'trim-in');
          onSeek(clip.start);
        }}
      />
      <Slider
        label="จุดจบ"
        value={outS}
        min={0}
        max={assetS}
        step={frame}
        format={(v) => formatTime(v * SEC, true)}
        onChange={(v) => {
          edit((d) => trimClip(d, clip.id, 'out', Math.round(v * SEC)), 'trim-out');
          onSeek(clip.start + Math.round(((v - inS) * SEC) / clip.speed) - 1);
        }}
      />
    </div>
  );
}
