import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, DraftCard, TopBar } from '../ui';
import { createProject, listProjects } from '../store';
import { ImportError, deleteProjectMedia, importMedia } from '../media';
import { addMedia, formatTime, newProject, projectDuration } from '../timeline.ts';
import type { Project } from '../schema';

const importMessages: Record<ImportError['code'], string> = {
  'unsupported-format': 'เปิดไฟล์นี้ไม่ได้ ลองใช้ไฟล์ MP4, MOV, WebM, JPG, PNG หรือ MP3',
  'no-video': 'ไฟล์นี้ไม่มีภาพวิดีโอ',
  'no-audio': 'ไฟล์นี้ไม่มีเสียง',
  'unsupported-codec': 'เครื่องนี้เล่นไฟล์นี้ไม่ได้',
  'bad-image': 'เปิดรูปนี้ไม่ได้',
};

export function importMessage(e: unknown) {
  if (e instanceof ImportError) return importMessages[e.code];
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'พื้นที่ในเครื่องไม่พอสำหรับวิดีโอนี้';
  return `นำเข้าไม่สำเร็จ (${e instanceof Error ? e.message : String(e)})`;
}

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects().then(setProjects, (e) => setError(`โหลดโปรเจกต์ไม่สำเร็จ (${e})`));
  }, []);

  async function onPick(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError('');
    const id = crypto.randomUUID();
    try {
      void navigator.storage.persist();
      const assets = [];
      for (const file of files) assets.push(await importMedia(id, file));
      const p = newProject(id, files[0].name.replace(/\.[^.]+$/, ''), assets[0], new Date().toISOString());
      addMedia(p, assets.slice(1));
      await createProject(p);
      location.hash = `#/edit/${id}`;
    } catch (e) {
      await deleteProjectMedia(id);
      setError(importMessage(e));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-(--size-sheet-width) flex-col">
      <TopBar title="โปรเจกต์ของฉัน" />
      <main className="flex flex-1 flex-col gap-6 px-4 pb-[calc(2rem+var(--safe-bottom))]">
        <Button loading={busy} onClick={() => picker.current?.click()}>
          {!busy && <Plus size={20} aria-hidden />}
          {busy ? 'กำลังนำเข้า…' : 'โปรเจกต์ใหม่'}
        </Button>
        <input
          ref={picker}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          aria-label="เลือกวิดีโอหรือรูป"
          onChange={(e) => void onPick([...(e.target.files ?? [])])}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {projects === null ? (
          <div aria-busy className="grid grid-cols-2 gap-4">
            <div className="aspect-video animate-pulse rounded-md bg-raised" />
            <div className="aspect-video animate-pulse rounded-md bg-raised" />
          </div>
        ) : projects.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">ยังไม่มีโปรเจกต์ กด “โปรเจกต์ใหม่” แล้วเลือกวิดีโอหรือรูปในเครื่องได้เลย</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4">
            {projects.map((p) => (
              <li key={p.id} className="min-w-0">
                <DraftCard
                  name={p.name}
                  duration={formatTime(projectDuration(p))}
                  updated={new Date(p.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                  onOpen={() => (location.hash = `#/edit/${p.id}`)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
