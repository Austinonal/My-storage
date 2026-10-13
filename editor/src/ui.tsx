import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Ban, Check, TriangleAlert, type LucideIcon } from 'lucide-react';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const buttonVariants = {
  primary: 'bg-accent text-on-accent',
  secondary: 'bg-raised text-fg',
  ghost: 'text-fg',
  danger: 'text-danger',
};

export function Button({
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold active:brightness-90 disabled:opacity-40 ${size === 'lg' ? 'h-12' : 'h-10'} ${buttonVariants[variant]} ${focus} ${className}`}
    >
      {loading && <span aria-hidden className="size-4 animate-spin rounded-pill border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function ToolButton({
  icon: Icon,
  label,
  active = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      className={`flex size-16 shrink-0 snap-start flex-col items-center justify-center gap-1 text-xs disabled:opacity-40 ${active ? 'text-accent' : 'text-muted'} ${focus}`}
    >
      <Icon size={24} aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

export function BottomToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="toolbar" aria-label={label} className="flex h-16 snap-x overflow-x-auto border-t border-border bg-surface px-2">
      {children}
    </div>
  );
}

export function TopBar({ left, title, right }: { left?: ReactNode; title: string; right?: ReactNode }) {
  return (
    <header className="flex h-12 items-center gap-2 bg-bg px-2">
      <div className="flex flex-1">{left}</div>
      <h1 className="truncate text-base font-semibold">{title}</h1>
      <div className="flex flex-1 justify-end">{right}</div>
    </header>
  );
}

export function BottomSheet({
  open,
  title,
  onClose,
  modal = true,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  modal?: boolean; // false: a tool panel; the preview, timeline and undo behind it stay usable
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) {
      if (modal) d.showModal();
      else d.show();
    }
    if (!open && d.open) d.close();
  }, [open, modal]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={(e) => !modal && e.key === 'Escape' && onClose()}
      onClick={(e) => e.target === e.currentTarget && onClose()} // tap on the backdrop closes
      className={`mx-auto mt-auto mb-0 max-h-(--size-sheet-max) w-full max-w-(--size-sheet-width) flex-col rounded-t-lg bg-surface p-0 text-fg shadow-sheet open:flex ${
        modal ? 'backdrop:bg-scrim/50' : 'fixed inset-x-0 top-auto bottom-0 z-30'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between pl-4">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="md" onClick={onClose}>
          เสร็จ
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
    </dialog>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col">
      <div className="flex justify-between text-sm">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="font-mono text-muted">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-12 w-full accent-accent ${focus}`}
      />
    </div>
  );
}

export function CategoryTabs({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex h-10 gap-4 overflow-x-auto">
      {items.map((item) => (
        <button
          key={item}
          aria-pressed={item === value}
          onClick={() => onChange(item)}
          className={`shrink-0 border-b-2 text-sm ${item === value ? 'border-accent text-fg' : 'border-transparent text-muted'} ${focus}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function PresetTile({
  label,
  selected,
  none = false,
  thumb,
  onClick,
}: {
  label: string;
  selected: boolean;
  none?: boolean;
  thumb?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button aria-pressed={selected} onClick={onClick} className={`flex w-full flex-col items-center gap-1 text-xs ${focus}`}>
      <span className={`relative grid size-16 place-items-center overflow-hidden rounded-md bg-raised ${selected ? 'ring-2 ring-accent' : ''}`}>
        {none ? <Ban size={24} aria-hidden className="text-muted" /> : thumb}
        {selected && <Check size={16} aria-hidden className="absolute top-1 right-1 rounded-pill bg-accent text-on-accent" />}
      </span>
      <span className="line-clamp-2 min-h-8 w-full text-center">{label}</span>
    </button>
  );
}

export function Swatches({
  label,
  colours,
  value,
  onChange,
}: {
  label: string;
  colours: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-3">
      {colours.map((c) => (
        <button
          key={c}
          aria-label={c}
          aria-pressed={c === value}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={`size-8 rounded-pill border border-border ${c === value ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''} ${focus}`}
        />
      ))}
      <input type="color" aria-label={`${label}: สีอื่น`} value={value} onChange={(e) => onChange(e.target.value)} className="size-8 bg-transparent" />
    </div>
  );
}

export function ProgressPanel({
  title,
  value,
  state,
  message,
  actions,
}: {
  title: string;
  value: number;
  state: 'running' | 'failed' | 'done';
  message?: string;
  actions: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg bg-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <progress
        max={1}
        value={value}
        className="h-2 w-full appearance-none overflow-hidden rounded-pill [&::-webkit-progress-bar]:bg-raised [&::-webkit-progress-value]:bg-accent"
      />
      <p aria-live={state === 'running' ? 'off' : 'polite'} className={`text-sm ${state === 'failed' ? 'text-danger' : 'text-muted'}`}>
        {message ?? `${Math.round(value * 100)}%`}
      </p>
      <div className="flex gap-2">{actions}</div>
    </section>
  );
}

export function DraftCard({
  name,
  duration,
  updated,
  cover,
  missingMedia = false,
  onOpen,
}: {
  name: string;
  duration: string;
  updated: string;
  cover?: string;
  missingMedia?: boolean;
  onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className={`flex w-full flex-col gap-2 text-left ${focus}`}>
      <span className="relative aspect-video w-full overflow-hidden rounded-md bg-raised">
        {cover && <img src={cover} alt="" className="size-full object-cover" />}
        {missingMedia && (
          <span role="img" aria-label="Some media is missing" className="absolute top-2 left-2 text-warning">
            <TriangleAlert size={20} aria-hidden />
          </span>
        )}
      </span>
      <span className="truncate text-sm font-semibold">{name}</span>
      <span className="flex justify-between text-xs text-muted">
        <span className="font-mono">{duration}</span>
        <span>{updated}</span>
      </span>
    </button>
  );
}
