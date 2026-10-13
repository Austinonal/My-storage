import { useState, type ReactNode } from 'react';
import { ArrowLeft, AudioLines, Gauge, Palette, Scissors, Sparkles, Trash2, Type, Upload, VolumeX } from 'lucide-react';
import {
  BottomSheet,
  BottomToolbar,
  Button,
  CategoryTabs,
  DraftCard,
  PresetTile,
  ProgressPanel,
  Slider,
  Swatches,
  ToolButton,
  TopBar,
} from './ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function DesignPage() {
  const [sheet, setSheet] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState('Basic');
  const [preset, setPreset] = useState('fade');
  const [colour, setColour] = useState('#ffffff');

  return (
    <div className="mx-auto flex max-w-(--size-sheet-width) flex-col gap-8 pb-8">
      <TopBar
        left={
          <Button variant="ghost" size="md" aria-label="Back">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        }
        title="Design system"
        right={
          <Button size="md">
            <Upload size={16} aria-hidden /> Export
          </Button>
        }
      />
      <div className="flex flex-col gap-8 px-4">
        <Section title="Button">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Delete</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Saving</Button>
          </div>
        </Section>

        <Section title="BottomToolbar + ToolButton">
          <BottomToolbar label="Clip tools">
            <ToolButton icon={Scissors} label="Split" />
            <ToolButton icon={Gauge} label="Speed" active />
            <ToolButton icon={VolumeX} label="Mute" aria-pressed={muted} active={muted} onClick={() => setMuted(!muted)} />
            <ToolButton icon={Type} label="Text" />
            <ToolButton icon={AudioLines} label="Audio" />
            <ToolButton icon={Sparkles} label="Effects" disabled />
            <ToolButton icon={Palette} label="Filters" />
            <ToolButton icon={Trash2} label="Delete" />
          </BottomToolbar>
        </Section>

        <Section title="Slider">
          <Slider label="Speed" value={speed} min={0.1} max={10} step={0.1} format={(v) => `${v.toFixed(1)}x`} onChange={setSpeed} />
        </Section>

        <Section title="CategoryTabs + PresetTile">
          <CategoryTabs items={['Basic', 'Camera', 'Slide', 'Blur', 'Glitch', 'Light']} value={tab} onChange={setTab} />
          <div className="grid grid-cols-4 gap-3">
            <PresetTile label="None" none selected={preset === 'none'} onClick={() => setPreset('none')} />
            {['fade', 'zoom in', 'slide up', 'spin'].map((p) => (
              <PresetTile
                key={p}
                label={p}
                selected={preset === p}
                thumb={<span className="size-8 rounded-sm bg-border" />}
                onClick={() => setPreset(p)}
              />
            ))}
            <PresetTile label="loading" selected={false} onClick={() => {}} />
          </div>
        </Section>

        <Section title="Swatches">
          <div className="rounded-lg bg-surface p-4">
            <Swatches label="Text colour" colours={['#ffffff', '#000000', '#ff5a5a', '#ffd24d', '#3ddc8f', '#5b93ff']} value={colour} onChange={setColour} />
          </div>
        </Section>

        <Section title="ProgressPanel">
          <ProgressPanel title="Exporting" value={0.42} state="running" actions={<Button variant="secondary">Cancel</Button>} />
          <ProgressPanel title="Export failed" value={0.42} state="failed" message="Not enough space on the phone." actions={<Button>Try again</Button>} />
          <ProgressPanel
            title="Saved to gallery"
            value={1}
            state="done"
            actions={
              <>
                <Button>Share</Button>
                <Button variant="secondary">Done</Button>
              </>
            }
          />
        </Section>

        <Section title="DraftCard">
          <div className="grid grid-cols-2 gap-4">
            <DraftCard name="Trip to Chiang Mai" duration="00:42" updated="2 h ago" onOpen={() => {}} />
            <DraftCard name="Untitled" duration="00:08" updated="Yesterday" missingMedia onOpen={() => {}} />
          </div>
        </Section>

        <Section title="BottomSheet">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Open sheet
          </Button>
          <BottomSheet open={sheet} title="Speed" onClose={() => setSheet(false)}>
            <Slider label="Speed" value={speed} min={0.1} max={10} step={0.1} format={(v) => `${v.toFixed(1)}x`} onChange={setSpeed} />
          </BottomSheet>
        </Section>
      </div>
    </div>
  );
}
