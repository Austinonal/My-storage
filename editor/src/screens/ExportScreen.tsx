import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, CategoryTabs, ProgressPanel, TopBar } from '../ui';
import { openProject, useEditor } from '../store';
import { ExportError, exportProject, exportStill } from '../export';
import { outputSize } from '../timeline.ts';
import { canShare, saveExport, shareExport } from '../save';
import type { ExportSettings, Fps } from '../schema';

const RES: Record<string, ExportSettings['height']> = { '720p': 720, '1080p': 1080, '2K': 1440, '4K': 2160 };

type Job =
  | { state: 'idle' }
  | { state: 'running'; progress: number }
  | { state: 'failed'; message: string }
  | { state: 'done'; file: File };

function exportMessage(e: unknown) {
  if (e instanceof ExportError) return 'เครื่องนี้เข้ารหัสวิดีโอขนาดนี้ไม่ได้ ลองความละเอียดหรือเฟรมเรตที่ต่ำลง';
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'พื้นที่ในเครื่องไม่พอ';
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'ไฟล์วิดีโอต้นฉบับหายไปจากเครื่อง';
  return `ส่งออกไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`;
}

export function ExportScreen({ id }: { id: string }) {
  const { project } = useEditor();
  const [found, setFound] = useState<boolean | null>(null);
  const [height, setHeight] = useState<ExportSettings['height']>(project?.id === id && project.still ? 720 : 1080); // thumbnails: 1280 x 720
  const [fps, setFps] = useState<Fps | null>(null);
  const [png, setPng] = useState(false);
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
      if (p.still) return setJob({ state: 'done', file: await exportStill(p, height, png ? 'image/png' : 'image/jpeg') });
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
      const where = await saveExport(file, p?.name ?? 'video');
      setSaved(where ? `บันทึกแล้วที่ ${where}` : '');
    } catch (e) {
      setSaved(`บันทึกไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  // One File per finished export, so the APK copies it to its cache once for both save and share.
  const file = useMemo(() => (job.state !== 'done' ? null : p?.still ? job.file : new File([job.file], `${p?.name ?? 'video'}.mp4`, { type: 'video/mp4' })), [job, p?.name, p?.still]);
  const picture = useMemo(() => (p?.still && file ? URL.createObjectURL(file) : null), [file, p?.still]);
  useEffect(() => () => void (picture && URL.revokeObjectURL(picture)), [picture]);

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
        title={p?.still ? 'ส่งออกรูปปก' : 'ส่งออกวิดีโอ'}
      />
      <main className="flex flex-col gap-6 px-4 pb-[calc(2rem+var(--safe-bottom))]">
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="text-sm">ความละเอียด</legend>
          <CategoryTabs items={Object.keys(RES)} value={Object.keys(RES).find((k) => RES[k] === height)!} onChange={(v) => setHeight(RES[v])} />
          <p className="font-mono text-xs text-muted">
            {w} × {h}
          </p>
        </fieldset>
        {p?.still && (
          <fieldset disabled={busy} className="flex flex-col gap-2">
            <legend className="text-sm">ไฟล์</legend>
            <CategoryTabs items={['JPEG', 'PNG']} value={png ? 'PNG' : 'JPEG'} onChange={(v) => setPng(v === 'PNG')} />
            <p className="text-xs text-muted">{png ? 'PNG: คมที่สุด ไฟล์ใหญ่กว่า' : 'JPEG: ไฟล์เล็ก เหมาะกับ YouTube (ไม่เกิน 2 MB)'}</p>
          </fieldset>
        )}
        {!p?.still && <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="text-sm">เฟรมเรต (fps)</legend>
          <CategoryTabs
            items={['24', '25', '30', '50', '60']}
            value={String(fps ?? p?.fps ?? 30)}
            onChange={(v) => setFps(Number(v) as Fps)}
          />
        </fieldset>}

        {p && p.tracks.some((t) => t.clips.some((c) => (c.kind === 'video' || c.kind === 'photo') && p.assets[c.assetId].placeholder)) && (
          <p role="alert" className="text-sm text-warning">ยังมีช่องว่างในโปรเจกต์ ช่องนั้นจะออกมาเป็นภาพว่าง{p.still ? 'ในรูป' : 'ในวิดีโอ'}</p>
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
        {picture && <img src={picture} alt="รูปปกที่ส่งออก" className="w-full rounded-md" />}
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
                    onClick={() => void shareExport(file, p?.name ?? 'video').catch((e) => setSaved(`แชร์ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`))}
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
