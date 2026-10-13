import { useEffect, useRef, useState } from 'react';
import { Copy, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { BottomSheet, Button, DraftCard, TopBar } from '../ui';
import { createProject, deleteProject, duplicateProject, listProjects, renameProject } from '../store';
import { coverOf } from '../thumbs';
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

function Cover({ p }: { p: Project }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const first = p.tracks[0].clips[0];
    const asset = first && (first.kind === 'video' || first.kind === 'photo') ? p.assets[first.assetId] : undefined;
    let live = true;
    if (asset) void coverOf(asset).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [p]);
  return url ? <img src={url} alt="" className="size-full object-cover" /> : null;
}

// Rename, copy or delete one project. Delete asks once more, because it also removes the copied media.
function Manage({ p, onClose, onChanged }: { p: Project | null; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setName(p?.name ?? '');
    setConfirm(false);
    setError('');
  }, [p]);
  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await job();
      onChanged();
      onClose();
    } catch (e) {
      setError(importMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={!!p} title="จัดการโปรเจกต์" onClose={onClose}>
      {p && (
        <div className="flex flex-col gap-3">
          <label htmlFor="project-name" className="text-sm">
            ชื่อโปรเจกต์
          </label>
          <div className="flex gap-2">
            <input
              id="project-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-md border border-border-input bg-bg px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            />
            <Button size="md" disabled={busy || !name.trim() || name.trim() === p.name} onClick={() => void run(() => renameProject(p.id, name.trim()))}>
              <Pencil size={16} aria-hidden /> เปลี่ยนชื่อ
            </Button>
          </div>
          <Button variant="secondary" loading={busy} onClick={() => void run(() => duplicateProject(p.id, `${p.name} (สำเนา)`))}>
            <Copy size={16} aria-hidden /> ทำสำเนา
          </Button>
          {confirm ? (
            <div role="alert" className="flex flex-col gap-2 rounded-md bg-raised p-3">
              <p className="text-sm">ลบ “{p.name}” และไฟล์ที่นำเข้ามาในโปรเจกต์นี้? กู้คืนไม่ได้</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="md" onClick={() => setConfirm(false)}>
                  ไม่ลบ
                </Button>
                <Button variant="danger" size="md" disabled={busy} onClick={() => void run(() => deleteProject(p.id))}>
                  <Trash2 size={16} aria-hidden /> ลบเลย
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              <Trash2 size={16} aria-hidden /> ลบโปรเจกต์
            </Button>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const [manage, setManage] = useState<Project | null>(null);

  const reload = () => listProjects().then(setProjects, (e) => setError(`โหลดโปรเจกต์ไม่สำเร็จ (${e})`));
  useEffect(() => {
    void reload();
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
              <li key={p.id} className="relative min-w-0">
                <DraftCard
                  name={p.name}
                  duration={formatTime(projectDuration(p))}
                  updated={new Date(p.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                  cover={<Cover p={p} />}
                  onOpen={() => (location.hash = `#/edit/${p.id}`)}
                />
                <button
                  aria-label={`จัดการ ${p.name}`}
                  onClick={() => setManage(p)}
                  className="absolute top-1 right-1 grid size-9 place-items-center rounded-pill bg-bg/70 text-fg focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Ellipsis size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Manage p={manage} onClose={() => setManage(null)} onChanged={() => void reload()} />
    </div>
  );
}
