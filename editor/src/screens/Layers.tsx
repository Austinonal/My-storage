import { Image, Layers as LayersIcon, Type, Zap } from 'lucide-react';
import { effectName } from '../effects';
import type { Clip, Project } from '../schema';

// A thumbnail has no time, so its layers take the timeline's place: bottom (the background) to top. Tap one to select it.
export function Layers({ project, selectedId, onSelect }: { project: Project; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const label = (c: Clip, main: boolean) => {
    if (c.kind === 'text') return { Icon: Type, name: c.text || 'ข้อความ' };
    if (c.kind === 'effect') return { Icon: Zap, name: effectName(c.effect) };
    if (c.kind === 'audio') return null;
    const empty = project.assets[c.assetId].placeholder;
    return { Icon: main ? Image : LayersIcon, name: empty ? `${main ? 'พื้นหลัง' : 'ช่องรูป'} (ว่าง)` : main ? 'พื้นหลัง' : c.cutout ? 'คน / รูปตัด' : 'รูปซ้อน' };
  };
  return (
    <div role="group" aria-label="เลเยอร์" className="flex shrink-0 gap-2 overflow-x-auto border-t border-border px-2 py-2">
      {project.tracks.flatMap((t, i) =>
        t.clips.map((c) => {
          const l = label(c, i === 0);
          if (!l) return null;
          const on = c.id === selectedId;
          return (
            <button
              key={c.id}
              aria-pressed={on}
              onClick={() => onSelect(on ? null : c.id)}
              className={`flex h-11 max-w-40 shrink-0 items-center gap-1.5 rounded-md border-2 px-3 text-sm ${on ? 'border-playhead bg-raised' : 'border-transparent bg-surface'} focus-visible:outline-2 focus-visible:outline-accent`}
            >
              <l.Icon size={16} aria-hidden className="shrink-0" />
              <span className="truncate">{l.name}</span>
            </button>
          );
        }),
      )}
    </div>
  );
}
