import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Pause, Play, Redo2, Sparkles, Undo2, Upload } from 'lucide-react';
import { BottomToolbar, Button, Slider, ToolButton, TopBar } from '../ui';
import { edit, openProject, redo, undo, useEditor } from '../store';
import { openMedia } from '../media';
import { renderFrame } from '../render';
import { FRAME_NUDGE, SEC, formatTime, sourceOut, trimClip } from '../timeline.ts';
import type { Slot } from '../anim.ts';
import { AnimationSheet, type Still } from './AnimationSheet';
import type { MediaClip } from '../schema';

const SLOT_KEY = { in: 'animIn', out: 'animOut', combo: 'animCombo' } as const;

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

export function Editor({ id }: { id: string }) {
  const { project, past, future } = useEditor();
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'media-missing'>('loading');
  const [src, setSrc] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [still, setStill] = useState<Still | null>(null);
  const [pendingPlay, setPendingPlay] = useState<Slot | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopAt = useRef(0);

  useEffect(() => {
    setStatus('loading');
    openProject(id).then((ok) => setStatus(ok ? 'ready' : 'not-found'));
  }, [id]);

  const p = project?.id === id ? project : null;
  // shortcut: the slice edits the first clip only; the multi-clip timeline replaces this panel next.
  const clip = p?.tracks[0].clips[0] as MediaClip | undefined;
  const assetPath = clip && p?.assets[clip.assetId].file;

  useEffect(() => {
    if (!assetPath) return;
    let cancelled = false;
    let url = '';
    openMedia(assetPath).then(
      (f) => {
        if (cancelled) return;
        url = URL.createObjectURL(f);
        setSrc(url);
      },
      () => !cancelled && setStatus('media-missing'),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [assetPath]);

  const inS = clip ? clip.sourceIn / SEC : 0;
  const outS = clip ? sourceOut(clip) / SEC : 0;

  const draw = useCallback(() => {
    const v = videoRef.current;
    const cv = canvasRef.current;
    if (!v || !cv || !p || !clip) return;
    const t = Math.min(clip.duration, Math.max(0, Math.round(((v.currentTime - FRAME_NUDGE - inS) * SEC) / clip.speed)));
    renderFrame(cv.getContext('2d')!, cv.width, cv.height, p, clip, v.readyState >= 2 ? v : null, t);
  }, [p, clip, inS]);
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
    if (!playing) draw();
  });

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width * devicePixelRatio));
      cv.height = Math.max(1, Math.round(r.height * devicePixelRatio));
      drawRef.current();
    });
    ro.observe(cv);
    return () => ro.disconnect();
  }, [src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    let raf = requestAnimationFrame(function loop() {
      if (v.currentTime >= stopAt.current) {
        v.pause();
        v.currentTime = stopAt.current;
        return;
      }
      drawRef.current();
      setTime((v.currentTime - inS) * SEC);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, inS]);

  function seek(s: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = s + FRAME_NUDGE;
    setTime((s - inS) * SEC);
  }

  async function playRange(from: number, to: number) {
    const v = videoRef.current;
    if (!v) return;
    stopAt.current = to;
    v.currentTime = from + FRAME_NUDGE;
    try {
      await v.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) return v.pause();
    const from = v.currentTime < inS || v.currentTime >= outS - 0.05 ? inS : v.currentTime - FRAME_NUDGE;
    void playRange(from, outS);
  }

  // Tapping a preset plays just that animation once, after the edit has landed.
  useEffect(() => {
    if (!pendingPlay || !clip) return;
    setPendingPlay(null);
    const a = clip[SLOT_KEY[pendingPlay]];
    if (!a) return;
    const span = (a.duration * clip.speed) / SEC;
    const from = pendingPlay === 'out' ? outS - span : inS;
    void playRange(from, Math.min(outS, from + span));
  }, [pendingPlay, clip, inS, outS]);

  function openAnimations() {
    const v = videoRef.current;
    if (v && v.readyState >= 2 && clip && p) {
      const a = p.assets[clip.assetId];
      const w = 160;
      const h = Math.max(1, Math.round((w * a.height) / a.width));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(v, 0, 0, w, h);
      setStill({ img: c, w, h });
    }
    setSheet(true);
  }

  if (status === 'not-found') return <Message>ไม่พบโปรเจกต์นี้ อาจถูกลบไปแล้ว</Message>;
  if (status === 'media-missing') return <Message>ไฟล์วิดีโอของโปรเจกต์นี้หายไปจากเครื่อง</Message>;

  const [a, b] = (p?.aspect ?? '9:16').split(':').map(Number);
  const frame = p ? 1 / p.fps : 1 / 30;
  const assetS = clip && p ? p.assets[clip.assetId].duration / SEC : 0;

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
        <div style={{ width: `min(100cqw, 100cqh * ${a / b})`, aspectRatio: `${a} / ${b}` }} className={p && src ? '' : 'animate-pulse rounded-md bg-raised'}>
          {src && (
            <>
              <canvas ref={canvasRef} role="img" aria-label="ตัวอย่างวิดีโอ" className="size-full" />
              <video
                ref={videoRef}
                src={src}
                className="hidden"
                playsInline
                preload="auto"
                onLoadedMetadata={() => seek(inS)}
                onLoadedData={() => drawRef.current()}
                onSeeked={() => drawRef.current()}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            </>
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
          {formatTime(time)} / {formatTime(clip?.duration ?? 0)}
        </span>
        <Button variant="ghost" size="md" aria-label={playing ? 'หยุด' : 'เล่น'} disabled={!src} onClick={togglePlay}>
          {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
        </Button>
      </div>

      <section aria-label="ตัดคลิป" className="flex h-(--size-timeline) flex-col justify-center gap-2 border-t border-border bg-surface px-4">
        {clip && p && (
          <>
            <Slider
              label="จุดเริ่ม"
              value={inS}
              min={0}
              max={assetS}
              step={frame}
              format={(v) => formatTime(v * SEC, true)}
              onChange={(v) => {
                edit((d) => trimClip(d, clip.id, 'in', Math.round(v * SEC)), 'trim-in');
                seek(Math.min(v, outS - frame));
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
                seek(Math.max(v, inS + frame));
              }}
            />
          </>
        )}
      </section>

      <BottomToolbar label="เครื่องมือ">
        <ToolButton icon={Sparkles} label="แอนิเมชัน" active={sheet} disabled={!src} onClick={openAnimations} />
      </BottomToolbar>

      {p && clip && (
        <AnimationSheet open={sheet} onClose={() => setSheet(false)} clip={clip} still={still} onPlay={setPendingPlay} />
      )}
    </div>
  );
}
