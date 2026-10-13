import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, CategoryTabs, ProgressPanel, TopBar } from '../ui';
import { openProject, useEditor } from '../store';
import { ExportError, exportProject } from '../export';
import { outputSize } from '../timeline.ts';
import { canShare, saveVideo, shareVideo } from '../save';
import type { ExportSettings, Fps } from '../schema';

type Job =
  | { state: 'idle' }
  | { state: 'running'; progress: number }
  | { state: 'failed'; message: string }
  | { state: 'done'; file: File };

function exportMessage(e: unknown) {
  if (e instanceof ExportError) return 'เครื่องนี้สร้างไฟล์วิดีโอไม่ได้ (ไม่มีตัวเข้ารหัสวิดีโอที่รองรับ)';
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'พื้นที่ในเครื่องไม่พอ';
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'ไฟล์วิดีโอต้นฉบับหายไปจากเครื่อง';
  return `ส่งออกไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`;
}

export function ExportScreen({ id }: { id: string }) {
  const { project } = useEditor();
  const [found, setFound] = useState<boolean | null>(null);
  const [height, setHeight] = useState<ExportSettings['height']>(1080);
  const [fps, setFps] = useState<Fps | null>(null);
  const [job, setJob] = useState<Job>({ state: 'idle' });
  const [saved, setSaved] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    openProject(id).then(setFound);
  }, [id]);
  useEffect(() => () => abort.current?.abort(), []);

  const p = project?.id === id ? project : null;
  const back = () => (location.hash = `#/edit/${id}`);

  async function start() {
    if (!p) return;
    const ac = new AbortController();
    abort.current = ac;
    setJob({ state: 'running', progress: 0 });
    setSaved('');
    let shown = 0;
    // Android pauses a backgrounded app, which stalls the export, so keep the screen on.
    const lock = await navigator.wakeLock?.request('screen').catch(() => undefined);
    try {
      const file = await exportProject(
        p,
        { height, fps: fps ?? p.fps, bitrate: 'high', codec: 'avc' },
        (f) => {
          const pct = Math.floor(f * 100);
          if (pct !== shown) setJob({ state: 'running', progress: (shown = pct) / 100 });
        },
        ac.signal,
      );
      setJob({ state: 'done', file });
    } catch (e) {
      setJob(ac.signal.aborted ? { state: 'idle' } : { state: 'failed', message: exportMessage(e) });
    } finally {
      void lock?.release();
    }
  }

  async function save(file: File) {
    setSaved('กำลังบันทึก…');
    try {
      const where = await saveVideo(file, p?.name ?? 'video');
      setSaved(where ? `บันทึกแล้วที่ ${where}` : '');
    } catch (e) {
      setSaved(`บันทึกไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  // One File per finished export, so the APK copies it to its cache once for both save and share.
  const file = useMemo(() => (job.state === 'done' ? new File([job.file], `${p?.name ?? 'video'}.mp4`, { type: 'video/mp4' }) : null), [job, p?.name]);

  if (found === false) {
    return <p className="p-8 text-center text-sm text-muted">ไม่พบโปรเจกต์นี้</p>;
  }

  const [w, h] = p ? outputSize(p.aspect, height) : [0, 0];
  const shareable = !!file && canShare(file);
  const busy = job.state === 'running';

  return (
    <div className="mx-auto flex min-h-dvh max-w-(--size-sheet-width) flex-col">
      <TopBar
        left={
          <Button variant="ghost" size="md" aria-label="กลับไปตัดต่อ" disabled={busy} onClick={back}>
            <ArrowLeft size={20} aria-hidden />
          </Button>
        }
        title="ส่งออกวิดีโอ"
      />
      <main className="flex flex-col gap-6 px-4 pb-8">
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="text-sm">ความละเอียด</legend>
          <CategoryTabs items={['720p', '1080p']} value={`${height}p`} onChange={(v) => setHeight(parseInt(v) as 720 | 1080)} />
          <p className="font-mono text-xs text-muted">
            {w} × {h}
          </p>
        </fieldset>
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="text-sm">เฟรมเรต (fps)</legend>
          <CategoryTabs
            items={['24', '25', '30', '50', '60']}
            value={String(fps ?? p?.fps ?? 30)}
            onChange={(v) => setFps(Number(v) as Fps)}
          />
        </fieldset>

        {p && (p.tracks[0].clips as { assetId: string }[]).some((c) => p.assets[c.assetId].placeholder) && (
          <p role="alert" className="text-sm text-warning">ยังมีช่องว่างในโปรเจกต์ ช่องนั้นจะออกมาเป็นภาพว่างในวิดีโอ</p>
        )}
        {job.state === 'idle' && (
          <Button disabled={!p} onClick={() => void start()}>
            ส่งออก
          </Button>
        )}
        {job.state === 'running' && (
          <ProgressPanel
            title="กำลังส่งออก… เปิดหน้าจอไว้ อย่าสลับแอป"
            value={job.progress}
            state="running"
            actions={
              <Button variant="secondary" onClick={() => abort.current?.abort()}>
                ยกเลิก
              </Button>
            }
          />
        )}
        {job.state === 'failed' && (
          <ProgressPanel title="ส่งออกไม่สำเร็จ" value={0} state="failed" message={job.message} actions={<Button onClick={() => void start()}>ลองอีกครั้ง</Button>} />
        )}
        {job.state === 'done' && file && (
          <ProgressPanel
            title="ส่งออกเสร็จแล้ว"
            value={1}
            state="done"
            message={saved || `${(file.size / 1e6).toFixed(1)} MB`}
            actions={
              <>
                <Button onClick={() => void save(file)}>บันทึกลงเครื่อง</Button>
                {shareable && (
                  <Button
                    variant="secondary"
                    onClick={() => void shareVideo(file, p?.name ?? 'video').catch((e) => setSaved(`แชร์ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`))}
                  >
                    แชร์
                  </Button>
                )}
              </>
            }
          />
        )}
      </main>
    </div>
  );
}
