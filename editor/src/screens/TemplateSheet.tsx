import { useRef, useState } from 'react';
import { BottomSheet, Button, ProgressPanel } from '../ui';
import { edit } from '../store';
import { importMedia } from '../media';
import { analyzeReference } from '../reference';
import { getPreset } from '../anim.ts';
import { addAudio, applyTemplate, outputSize } from '../timeline.ts';
import { importMessage } from './Home';
import type { Slot } from '../analyze.ts';
import type { Aspect, MediaAsset, MediaClip, Project } from '../schema';

type State =
  | { kind: 'idle' }
  | { kind: 'analyzing'; progress: number }
  | { kind: 'result'; slots: Slot[]; file: File }
  | { kind: 'error'; message: string };

// An empty slot to replace later: a grey picture with a plus, in the given shape.
export async function placeholderFile(aspect: Aspect): Promise<File> {
  const [w, h] = outputSize(aspect, 360);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--color-raised').trim();
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = css.getPropertyValue('--color-muted').trim();
  ctx.lineWidth = w / 30;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w / 2 - w / 8, h / 2);
  ctx.lineTo(w / 2 + w / 8, h / 2);
  ctx.moveTo(w / 2, h / 2 - w / 8);
  ctx.lineTo(w / 2, h / 2 + w / 8);
  ctx.stroke();
  return new File([await c.convertToBlob({ type: 'image/png' })], 'ช่องว่าง.png', { type: 'image/png' });
}

const effectName = (id: string | undefined) => (id ? getPreset(id)?.name : undefined);

export function TemplateSheet({ open, onClose, project, onApplied }: { open: boolean; onClose: () => void; project: Project; onApplied: (slots: number, empty: number) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [withAudio, setWithAudio] = useState(false);
  const [applying, setApplying] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const own = (project.tracks[0].clips as MediaClip[]).filter((c) => !project.assets[c.assetId].placeholder);

  async function analyze(file: File | undefined) {
    if (!file) return;
    const ac = new AbortController();
    abort.current = ac;
    setState({ kind: 'analyzing', progress: 0 });
    try {
      const slots = await analyzeReference(file, (progress) => setState({ kind: 'analyzing', progress }), ac.signal);
      if (slots.length === 0) throw new Error('ไม่พบภาพในคลิปนี้');
      setState({ kind: 'result', slots, file });
    } catch (e) {
      setState(ac.signal.aborted ? { kind: 'idle' } : { kind: 'error', message: importMessage(e) });
    }
  }

  async function apply(slots: Slot[], file: File) {
    setApplying(true);
    try {
      let hole: MediaAsset | undefined = Object.values(project.assets).find((a) => a.placeholder);
      if (!hole) hole = { ...(await importMedia(project.id, await placeholderFile(project.aspect))), placeholder: true };
      const sound = withAudio ? await importMedia(project.id, file, 'audio') : null;
      edit((d) => {
        applyTemplate(d, slots, hole);
        if (sound) addAudio(d, sound, 0);
      });
      onApplied(slots.length, Math.max(0, slots.length - own.length));
      setState({ kind: 'idle' });
      onClose();
    } catch (e) {
      setState({ kind: 'error', message: importMessage(e) });
    } finally {
      setApplying(false);
    }
  }

  return (
    <BottomSheet open={open} title="ตัดตามคลิปต้นแบบ" onClose={onClose}>
      <input ref={picker} type="file" accept="video/*" hidden aria-label="เลือกคลิปต้นแบบ" onChange={(e) => {
        void analyze(e.target.files?.[0]);
        e.target.value = '';
      }} />
      {state.kind === 'idle' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            เลือกคลิปที่ตัดต่อไว้แล้วของใครก็ได้ แอปจะหาจุดตัดและแอนิเมชันเข้า/ออก/คอมโบที่ใกล้ที่สุด แล้วจัดคลิปของคุณให้ตามจังหวะเดียวกัน ช่องที่เหลือจะเป็นช่องว่างให้ใส่รูปหรือคลิปทีหลัง
          </p>
          <p className="text-xs text-muted">ตอนนี้มีคลิปของคุณ {own.length} ชิ้น · วิเคราะห์ในเครื่อง ไม่ส่งคลิปไปไหน</p>
          <Button onClick={() => picker.current?.click()}>เลือกคลิปต้นแบบ</Button>
        </div>
      )}
      {state.kind === 'analyzing' && (
        <ProgressPanel
          title="กำลังวิเคราะห์คลิป…"
          value={state.progress}
          state="running"
          actions={<Button variant="secondary" onClick={() => abort.current?.abort()}>ยกเลิก</Button>}
        />
      )}
      {state.kind === 'error' && (
        <ProgressPanel title="วิเคราะห์ไม่สำเร็จ" value={0} state="failed" message={state.message} actions={<Button onClick={() => picker.current?.click()}>เลือกคลิปอื่น</Button>} />
      )}
      {state.kind === 'result' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            พบ {state.slots.length} ช่อง · ยาว {(state.slots.reduce((s, x) => s + x.seconds, 0)).toFixed(1)} วิ
          </p>
          <ol className="flex max-h-60 flex-col gap-1 overflow-y-auto text-xs">
            {state.slots.map((s, i) => {
              const fx = [s.dissolve && `ซ้อนจางจากช่องก่อน ${s.dissolve.toFixed(1)} วิ`, effectName(s.in?.presetId) && `เข้า: ${effectName(s.in?.presetId)}`, effectName(s.out?.presetId) && `ออก: ${effectName(s.out?.presetId)}`, effectName(s.combo?.presetId) && `คอมโบ: ${effectName(s.combo?.presetId)}`].filter(Boolean);
              const who = own[i] ? project.assets[own[i].assetId].name : 'ช่องว่าง';
              return (
                <li key={i} className="flex gap-2 rounded-md bg-raised px-2 py-1">
                  <span className="w-6 shrink-0 font-mono text-muted">{i + 1}</span>
                  <span className="w-12 shrink-0 font-mono">{s.seconds.toFixed(1)} วิ</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${own[i] ? '' : 'text-muted'}`}>{who}</span>
                    <span className="block text-muted">{fx.length ? fx.join(' · ') : 'ตัดตรง'}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <label className="flex min-h-(--size-touch) items-center gap-3 text-sm">
            <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} className="size-5 accent-accent" />
            ใส่เสียงจากคลิปต้นแบบด้วย (ใช้เมื่อคุณมีสิทธิ์ใช้เพลงนั้น)
          </label>
          <div className="flex gap-2">
            <Button loading={applying} onClick={() => void apply(state.slots, state.file)}>
              ใช้กับโปรเจกต์
            </Button>
            <Button variant="secondary" disabled={applying} onClick={() => picker.current?.click()}>
              เลือกคลิปใหม่
            </Button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
