import { useEffect, useRef, useState } from 'react';
import { BottomSheet, Button } from '../ui';
import { edit } from '../store';
import { autoLevels, recordShake } from '../quality';
import { setQuality, setShake } from '../timeline.ts';
import { importMessage } from './Home';
import type { MediaAsset, MediaClip } from '../schema';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function Switch({ label, hint, on, disabled, onChange }: { label: string; hint: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className={`flex items-center gap-3 rounded-md bg-raised p-3 text-left disabled:opacity-40 ${focus}`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
      <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors ${on ? 'bg-accent' : 'bg-border'}`}>
        <span className={`absolute top-0.5 size-5 rounded-pill bg-white transition-all ${on ? 'left-5.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function QualitySheet({ open, onClose, clip, asset, onExport }: { open: boolean; onClose: () => void; clip: MediaClip; asset: MediaAsset; onExport: () => void }) {
  const [work, setWork] = useState<{ what: string; progress: number } | null>(null);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  const q = clip.quality ?? { enhance: null, stabilize: 0, deflicker: false };
  const video = clip.kind === 'video';

  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);
  useEffect(() => () => abort.current?.abort(), []);

  async function run<T>(what: string, job: (onProgress: (f: number) => void, signal: AbortSignal) => Promise<T>) {
    const ac = new AbortController();
    abort.current = ac;
    setMessage('');
    setWork({ what, progress: 0 });
    try {
      return await job((progress) => setWork({ what, progress }), ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setMessage(`${what}ไม่สำเร็จ: ${importMessage(e)}`);
      return null;
    } finally {
      setWork(null);
    }
  }

  // Steadying and deflicker share one recording of the video; it is made the first time either is turned on.
  async function withShake(patch: Parameters<typeof setQuality>[2]) {
    if (asset.shake) return edit((d) => setQuality(d, clip.id, patch));
    const shake = await run('วิเคราะห์การสั่นและความสว่าง', (onProgress, signal) => recordShake(asset, onProgress, signal));
    if (shake)
      edit((d) => {
        setShake(d, asset.id, shake);
        setQuality(d, clip.id, patch);
      });
  }

  return (
    <BottomSheet open={open} title="คุณภาพวิดีโอ" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        <Switch
          label="ปรับปรุงคุณภาพ"
          hint="ปรับดำ-ขาวให้เต็มช่วงอัตโนมัติ เพิ่มความคม ความชัด และสีเล็กน้อย"
          on={!!q.enhance}
          disabled={!!work}
          onChange={async (on) => {
            if (!on) return edit((d) => setQuality(d, clip.id, { enhance: null }));
            const levels = await run('ปรับปรุงคุณภาพ', () => autoLevels(clip, asset));
            if (levels) edit((d) => setQuality(d, clip.id, { enhance: levels }));
          }}
        />

        <div role="radiogroup" aria-label="ลดการสั่น" className={`flex flex-col gap-2 rounded-md bg-raised p-3 ${video ? '' : 'opacity-40'}`}>
          <span className="text-sm">ลดการสั่น</span>
          <span className="text-xs text-muted">{video ? 'ทำให้ภาพนิ่งขึ้น ภาพจะซูมเข้าเล็กน้อยเพื่อซ่อนขอบ' : 'ใช้ได้กับวิดีโอเท่านั้น'}</span>
          <div className="flex gap-2">
            {(['ปิด', 'น้อย', 'มาก'] as const).map((label, level) => (
              <button
                key={label}
                role="radio"
                aria-checked={q.stabilize === level}
                disabled={!video || !!work}
                onClick={() => (level ? void withShake({ stabilize: level as 1 | 2 }) : edit((d) => setQuality(d, clip.id, { stabilize: 0 })))}
                className={`h-10 flex-1 rounded-md text-sm ${q.stabilize === level ? 'bg-accent text-on-accent' : 'bg-surface text-fg'} disabled:opacity-60 ${focus}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Switch
          label="ลบการกะพริบ"
          hint={video ? 'เกลี่ยความสว่างที่วูบวาบจากไฟหรือจอให้คงที่' : 'ใช้ได้กับวิดีโอเท่านั้น'}
          on={q.deflicker}
          disabled={!video || !!work}
          onChange={(on) => (on ? void withShake({ deflicker: true }) : edit((d) => setQuality(d, clip.id, { deflicker: false })))}
        />

        <div className="flex items-center gap-3 rounded-md bg-raised p-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm">ความละเอียดสูงสุด</span>
            <span className="text-xs text-muted">
              ต้นฉบับ {asset.width} × {asset.height} · ส่งออกได้ถึง 4K (2160p)
            </span>
          </span>
          <Button variant="secondary" size="md" onClick={onExport}>
            ไปส่งออก
          </Button>
        </div>

        {work && (
          <div role="status" className="flex flex-col gap-1">
            <span className="text-xs text-muted">
              กำลัง{work.what}… {Math.round(work.progress * 100)}%
            </span>
            <span className="h-1 overflow-hidden rounded-pill bg-border">
              <span className="block h-full bg-accent" style={{ width: `${work.progress * 100}%` }} />
            </span>
          </div>
        )}
        {message && (
          <p role="alert" className="text-xs text-warning">
            {message}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
