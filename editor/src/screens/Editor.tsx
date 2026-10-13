import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ImagePlus, Music, Pause, Play, Redo2, Scissors, SlidersHorizontal, Sparkles, Trash2, Undo2, Upload, Volume2 } from 'lucide-react';
import { BottomSheet, BottomToolbar, Button, Slider, ToolButton, TopBar } from '../ui';
import { edit, openProject, redo, undo, useEditor } from '../store';
import { importMedia } from '../media';
import { Player } from '../player';
import {
  SEC,
  addAudio,
  addMedia,
  deleteClip,
  findClip,
  formatTime,
  moveClip,
  projectDuration,
  setPhotoDuration,
  setVolume,
  sourceOut,
  splitAt,
  trimClip,
} from '../timeline.ts';
import type { Slot } from '../anim.ts';
import { AnimationSheet, type Still } from './AnimationSheet';
import { Timeline } from './Timeline';
import { importMessage } from './Home';
import type { AudioClip, MediaAsset, MediaClip, Project } from '../schema';

const SLOT_KEY = { in: 'animIn', out: 'animOut', combo: 'animCombo' } as const;
type Sheet = 'anim' | 'trim' | 'volume' | null;

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
    const c = findClip(p, id);
    return c.kind === 'text' ? null : c;
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
  const [pendingPlay, setPendingPlay] = useState<Slot | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const visualInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStatus('loading');
    openProject(id).then((ok) => setStatus(ok ? 'ready' : 'not-found'));
  }, [id]);

  const p = project?.id === id ? project : null;
  const sel = selected(p, selectedId);
  const visual = sel && sel.kind !== 'audio' ? (sel as MediaClip) : null;
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

  // Tapping an animation preset plays just that part of the clip once, after the edit has landed.
  useEffect(() => {
    if (!pendingPlay || !visual) return;
    setPendingPlay(null);
    const a = visual[SLOT_KEY[pendingPlay]];
    if (!a) return;
    const from = pendingPlay === 'out' ? visual.start + visual.duration - a.duration : visual.start;
    playerRef.current?.playRange(from, from + a.duration);
  }, [pendingPlay, visual]);

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

  function openAnimations() {
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
    setSheet('anim');
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
          {p && <canvas ref={canvasRef} role="img" aria-label="ตัวอย่างวิดีโอ" className="size-full" />}
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
          </>
        )}
        {sel && (
          <>
            <ToolButton icon={Scissors} label="แยก" onClick={split} />
            <ToolButton icon={SlidersHorizontal} label={sel.kind === 'photo' ? 'ระยะเวลา' : 'ตัด'} active={sheet === 'trim'} onClick={() => setSheet('trim')} />
            {visual && <ToolButton icon={Sparkles} label="แอนิเมชัน" active={sheet === 'anim'} onClick={openAnimations} />}
            {sel.kind !== 'photo' && <ToolButton icon={Volume2} label="ระดับเสียง" active={sheet === 'volume'} onClick={() => setSheet('volume')} />}
            <ToolButton icon={Trash2} label="ลบ" disabled={onlyMain} onClick={() => remove(sel.id)} />
          </>
        )}
      </BottomToolbar>

      <input ref={visualInput} type="file" accept="video/*,image/*" multiple hidden aria-label="เลือกวิดีโอหรือรูป" onChange={(e) => {
        void addFiles([...(e.target.files ?? [])], 'visual');
        e.target.value = '';
      }} />
      <input ref={audioInput} type="file" accept="audio/*,video/*" hidden aria-label="เลือกไฟล์เสียง หรือวิดีโอเพื่อใช้แค่เสียง" onChange={(e) => {
        void addFiles([...(e.target.files ?? [])], 'audio');
        e.target.value = '';
      }} />

      {p && visual && (
        <AnimationSheet open={sheet === 'anim'} onClose={() => setSheet(null)} clip={visual} still={still} onPlay={setPendingPlay} />
      )}
      {p && sel && (
        <BottomSheet open={sheet === 'trim'} title={sel.kind === 'photo' ? 'ระยะเวลารูป' : 'ตัดคลิป'} onClose={() => setSheet(null)} modal={false}>
          {sel.kind === 'photo' ? (
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
      {p && sel && sel.kind !== 'photo' && (
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
