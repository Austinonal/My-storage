import { useRef, useState } from 'react';
import { AudioLines, FileUp, Plus, Trash2 } from 'lucide-react';
import { BottomSheet, Button, Slider } from '../ui';
import { edit } from '../store';
import { linesToCaptions, parseSubtitles } from '../captions';
import { transcribe } from '../speech';
import { importMessage } from './Home';
import { SEC, addCaptions, deleteClip, formatTime, updateText } from '../timeline.ts';
import type { Project, TextClip, Us } from '../schema';

// Every caption in one list: edit the words, jump to one, delete; or make many at once from pasted lines or a subtitle file.
export function CaptionSheet({
  open,
  onClose,
  project,
  time,
  onSeek,
  onAddHere,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  time: Us;
  onSeek: (t: Us) => void;
  onAddHere: () => void;
}) {
  const [lines, setLines] = useState('');
  const [seconds, setSeconds] = useState(2);
  const [message, setMessage] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState('thai');
  const [hearing, setHearing] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const captions = (project.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'text') as TextClip[]).sort((a, b) => a.start - b.start);
  const like = captions.at(-1);

  function make(caps: ReturnType<typeof parseSubtitles>, what: string) {
    if (!caps.length) return setMessage(`ไม่พบ${what}`);
    edit((d) => {
      addCaptions(d, caps, like);
    });
    setMessage(`เพิ่มคำบรรยาย ${caps.length} รายการ`);
  }

  async function fromSpeech() {
    setMessage('');
    setHearing('กำลังเตรียมเสียง…');
    stop.current = new AbortController();
    try {
      const caps = await transcribe(project, language, (s) => setHearing(s.listening ? 'กำลังถอดเสียงเป็นข้อความ… (ใช้เวลาพอๆ กับความยาวคลิปหรือนานกว่าในเครื่องรุ่นเก่า)' : `กำลังโหลดโมเดลถอดเสียง ${Math.round((s.download ?? 0) * 100)}%`), stop.current.signal);
      make(caps, 'เสียงพูดในคลิป');
    } catch (e) {
      if (!stop.current?.signal.aborted) setMessage(`ถอดเสียงไม่สำเร็จ: ${importMessage(e)}`);
    } finally {
      setHearing(null);
      stop.current = null;
    }
  }

  async function fromFile(f: File | undefined) {
    if (!f) return;
    try {
      make(parseSubtitles(await f.text()), 'คำบรรยายที่มีเวลาในไฟล์นี้ (รองรับ .srt และ .vtt)');
    } catch {
      setMessage('อ่านไฟล์ไม่ได้');
    }
  }

  return (
    <BottomSheet open={open} title="คำบรรยาย" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="md" onClick={onAddHere}>
            <Plus size={16} aria-hidden /> เพิ่มที่ {formatTime(time, true)}
          </Button>
          <Button variant="secondary" size="md" onClick={() => file.current?.click()}>
            <FileUp size={16} aria-hidden /> นำเข้า .srt / .vtt
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-md bg-raised p-3">
          <span className="text-sm">ซับอัตโนมัติจากเสียงพูด</span>
          <div role="radiogroup" aria-label="ภาษาที่พูดในคลิป" className="flex gap-1">
            {[['thai', 'ไทย'], ['english', 'อังกฤษ']].map(([id, label]) => (
              <button key={id} role="radio" aria-checked={language === id} disabled={!!hearing} onClick={() => setLanguage(id)} className={`h-9 flex-1 rounded-md text-sm ${language === id ? 'bg-accent text-on-accent' : 'bg-bg'} focus-visible:outline-2 focus-visible:outline-accent`}>
                {label}
              </button>
            ))}
          </div>
          {hearing ? (
            <Button variant="secondary" onClick={() => stop.current?.abort()}>
              หยุด
            </Button>
          ) : (
            <Button onClick={() => void fromSpeech()}>
              <AudioLines size={16} aria-hidden /> สร้างซับจากเสียงพูด
            </Button>
          )}
          <p role="status" className="text-xs text-muted">
            {hearing ?? 'ถอดเสียงบนเครื่องด้วย Whisper · ครั้งแรกต้องต่อเน็ตเพื่อโหลดโมเดลประมาณ 80 MB แล้วใช้ออฟไลน์ได้ · ฟังเสียงทั้งหมดในโปรเจกต์ เพลงดังๆ อาจทำให้ฟังผิด'}
          </p>
        </div>

        {captions.length === 0 ? (
          <p className="text-sm text-muted">ยังไม่มีคำบรรยาย เพิ่มทีละอัน วางข้อความหลายบรรทัด หรือนำเข้าไฟล์ซับ</p>
        ) : (
          <ol aria-label="คำบรรยายทั้งหมด" className="flex flex-col gap-2">
            {captions.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <button
                  onClick={() => onSeek(c.start)}
                  aria-label={`ไปที่ ${formatTime(c.start, true)}`}
                  className="mt-1 shrink-0 rounded-sm bg-raised px-2 py-1 font-mono text-xs text-muted focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {formatTime(c.start, true)}
                  <br />
                  {formatTime(c.start + c.duration, true)}
                </button>
                <textarea
                  aria-label={`คำบรรยายที่ ${formatTime(c.start, true)}`}
                  rows={Math.min(3, c.text.split('\n').length)}
                  value={c.text}
                  onChange={(e) => edit((d) => updateText(d, c.id, { text: e.target.value }), `caption-${c.id}`)}
                  className="min-w-0 flex-1 resize-none rounded-md border border-border-input bg-bg p-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
                />
                <Button variant="ghost" size="md" aria-label={`ลบคำบรรยายที่ ${formatTime(c.start, true)}`} onClick={() => edit((d) => deleteClip(d, c.id))}>
                  <Trash2 size={16} aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-col gap-2 rounded-md bg-raised p-3">
          <label htmlFor="caption-lines" className="text-sm">
            วางหลายบรรทัด (บรรทัดละหนึ่งคำบรรยาย)
          </label>
          <textarea
            id="caption-lines"
            rows={4}
            value={lines}
            placeholder={'สวัสดีครับ\nวันนี้จะพาไปเที่ยว…'}
            onChange={(e) => setLines(e.target.value)}
            className="w-full resize-y rounded-md border border-border-input bg-bg p-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
          <Slider label="ยาวบรรทัดละ" value={seconds} min={0.5} max={8} step={0.5} format={(v) => `${v.toFixed(1)} วิ`} onChange={setSeconds} />
          <Button
            disabled={!lines.trim()}
            onClick={() => {
              make(linesToCaptions(lines, time, seconds), 'ข้อความ');
              setLines('');
            }}
          >
            สร้างคำบรรยายต่อกันจาก {formatTime(time, true)}
          </Button>
        </div>
        {message && (
          <p role="status" className="text-xs text-muted">
            {message}
          </p>
        )}
        <p className="text-xs text-muted">คำบรรยายใหม่ใช้สไตล์เดียวกับอันล่าสุด แก้สไตล์ได้ที่ปุ่ม “แก้ไข” เมื่อเลือกข้อความ · ยาวรวม {(captions.reduce((s, c) => s + c.duration, 0) / SEC).toFixed(1)} วิ</p>
        <input ref={file} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden aria-label="เลือกไฟล์คำบรรยาย" onChange={(e) => {
          void fromFile(e.target.files?.[0]);
          e.target.value = '';
        }} />
      </div>
    </BottomSheet>
  );
}
