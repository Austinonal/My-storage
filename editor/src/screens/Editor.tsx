import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Pause, Play, Redo2, Undo2, Upload } from 'lucide-react';
import { Button, Slider, TopBar } from '../ui';
import { edit, openProject, redo, undo, useEditor } from '../store';
import { openMedia } from '../media';
import { FRAME_NUDGE, SEC, formatTime, sourceOut, trimClip } from '../timeline.ts';
import type { MediaClip } from '../schema';

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
  const videoRef = useRef<HTMLVideoElement>(null);

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

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    let handle = 0;
    const tick = () => {
      if (v.currentTime >= outS) {
        v.pause();
        v.currentTime = outS;
        return;
      }
      setTime((v.currentTime - inS) * SEC);
      handle = v.requestVideoFrameCallback(tick);
    };
    handle = v.requestVideoFrameCallback(tick);
    return () => v.cancelVideoFrameCallback(handle);
  }, [playing, inS, outS]);

  function seek(s: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = s + FRAME_NUDGE;
    setTime((s - inS) * SEC);
  }

  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) return v.pause();
    if (v.currentTime < inS || v.currentTime >= outS - 0.05) v.currentTime = inS + FRAME_NUDGE;
    try {
      await v.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
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
        <div
          style={{
            width: `min(100cqw, 100cqh * ${a / b})`,
            aspectRatio: `${a} / ${b}`,
            background: p?.canvas.kind === 'colour' ? p.canvas.colour : undefined,
          }}
          className={p && src ? '' : 'animate-pulse rounded-md bg-raised'}
        >
          {src && (
            <video
              ref={videoRef}
              src={src}
              aria-label="ตัวอย่างวิดีโอ"
              className="size-full object-contain"
              playsInline
              preload="auto"
              onLoadedMetadata={() => seek(inS)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
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
          {formatTime(time)} / {formatTime(clip?.duration ?? 0)}
        </span>
        <Button variant="ghost" size="md" aria-label={playing ? 'หยุด' : 'เล่น'} disabled={!src} onClick={() => void togglePlay()}>
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
    </div>
  );
}
