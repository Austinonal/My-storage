import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Slider } from '../ui';
import { CURVE_CHANNELS, HSL_COLOURS, WHEELS, curveFn } from '../grade';
import type { Grade } from '../schema';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function HslPanel({ hsl, onChange }: { hsl: Grade['hsl']; onChange: (hsl: Grade['hsl'], key: string) => void }) {
  const [at, setAt] = useState(0);
  const [h, s, l] = hsl[at];
  const set = (k: 0 | 1 | 2, v: number) => onChange(hsl.map((x, i) => (i === at ? (x.map((y, j) => (j === k ? v : y)) as [number, number, number]) : x)), `hsl-${at}-${k}`);
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="เลือกสี" className="flex flex-wrap gap-3">
        {HSL_COLOURS.map((c, i) => (
          <button
            key={c.id}
            aria-label={c.name}
            aria-pressed={i === at}
            onClick={() => setAt(i)}
            style={{ background: c.swatch }}
            className={`size-8 rounded-pill ${i === at ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : ''} ${hsl[i].some((v) => v) ? 'outline-2 outline-dashed outline-offset-2 outline-muted' : ''} ${focus}`}
          />
        ))}
      </div>
      <p className="text-sm">{HSL_COLOURS[at].name}</p>
      <Slider label="โทนสี" value={h} min={-100} max={100} format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={(v) => set(0, v)} />
      <Slider label="ความอิ่มสี" value={s} min={-100} max={100} format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={(v) => set(1, v)} />
      <Slider label="ความสว่าง" value={l} min={-100} max={100} format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={(v) => set(2, v)} />
    </div>
  );
}

const CHANNEL = { rgb: ['ขาว', '#e8e8e8'], r: ['แดง', '#ff453a'], g: ['เขียว', '#32d74b'], b: ['น้ำเงิน', '#0a84ff'] } as const;
type Pt = [number, number];

// Tap the graph to add a point, drag points, drag one off the graph (or double-tap it) to remove it.
export function CurvesPanel({ curves, onChange }: { curves: Grade['curves']; onChange: (c: Grade['curves'], key: string) => void }) {
  const [ch, setCh] = useState<(typeof CURVE_CHANNELS)[number]>('rgb');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; key: string; out: boolean } | null>(null);
  const pts = curves[ch];
  const put = (next: Pt[], key: string) => onChange({ ...curves, [ch]: next }, key);
  const at = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height] as Pt;
  };
  const moveTo = (i: number, [x, y]: Pt): Pt[] => {
    const lo = i === 0 ? 0 : pts[i - 1][0] + 0.01;
    const hi = i === pts.length - 1 ? 1 : pts[i + 1][0] - 0.01;
    const nx = i === 0 ? 0 : i === pts.length - 1 ? 1 : Math.min(hi, Math.max(lo, x));
    return pts.map((p, j) => (j === i ? [nx, Math.min(1, Math.max(0, y))] : p));
  };
  function down(e: PointerEvent<SVGSVGElement>) {
    const [x, y] = at(e);
    let i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.06);
    const key = `curve-${ch}-${Date.now()}`;
    if (i < 0) {
      if (pts.length >= 16) return;
      i = pts.findIndex(([px]) => px > x);
      put([...pts.slice(0, i), [x, y], ...pts.slice(i)], key);
    }
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = { i, key, out: false };
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    d.out = d.i > 0 && d.i < pts.length - 1 && (p[1] < -0.15 || p[1] > 1.15);
    put(moveTo(d.i, p), d.key);
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.out) put(pts.filter((_, j) => j !== d.i), d.key);
  }
  function key(e: KeyboardEvent, i: number) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const [x, y] = pts[i];
    const go: Record<string, Pt> = { ArrowUp: [x, y + step], ArrowDown: [x, y - step], ArrowLeft: [x - step, y], ArrowRight: [x + step, y] };
    if (go[e.key]) {
      e.preventDefault();
      put(moveTo(i, go[e.key]), `curve-${ch}-key-${i}`);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < pts.length - 1) {
      e.preventDefault();
      put(pts.filter((_, j) => j !== i), `curve-${ch}-del`);
    }
  }
  const f = curveFn(pts);
  const path = Array.from({ length: 65 }, (_, k) => `${k ? 'L' : 'M'}${(k / 64) * 256} ${256 - f(k / 64) * 256}`).join('');
  const colour = CHANNEL[ch][1];
  return (
    <div className="flex flex-col items-center gap-2">
      <div role="group" aria-label="ช่องสี" className="flex gap-2 self-stretch">
        {CURVE_CHANNELS.map((k) => (
          <button key={k} aria-pressed={k === ch} onClick={() => setCh(k)} className={`flex h-10 flex-1 items-center justify-center gap-1 rounded-md text-sm ${k === ch ? 'bg-raised text-fg' : 'text-muted'} ${focus}`}>
            <span aria-hidden className="size-3 rounded-pill" style={{ background: CHANNEL[k][1] }} />
            {CHANNEL[k][0]}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox="-8 -8 272 272"
        role="group"
        aria-label={`กราฟสี${CHANNEL[ch][0]}: แตะเพื่อเพิ่มจุด ลากจุดออกนอกกราฟเพื่อลบ`}
        className="aspect-square w-full max-w-72 touch-none rounded-md bg-bg"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {[64, 128, 192].map((v) => (
          <g key={v} stroke="currentColor" className="text-border" strokeWidth={1}>
            <line x1={v} y1={0} x2={v} y2={256} />
            <line x1={0} y1={v} x2={256} y2={v} />
          </g>
        ))}
        <rect x={0} y={0} width={256} height={256} fill="none" stroke="currentColor" className="text-border" />
        <line x1={0} y1={256} x2={256} y2={0} stroke="currentColor" className="text-muted" strokeDasharray="4 4" />
        <path d={path} fill="none" stroke={colour} strokeWidth={3} />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * 256}
            cy={256 - y * 256}
            r={9}
            fill={colour}
            stroke="#000"
            strokeWidth={2}
            tabIndex={0}
            role="slider"
            aria-label={`จุดที่ ${i + 1}`}
            aria-valuetext={`เข้า ${Math.round(x * 255)} ออก ${Math.round(y * 255)}`}
            onKeyDown={(e) => key(e, i)}
            onDoubleClick={() => i > 0 && i < pts.length - 1 && put(pts.filter((_, j) => j !== i), `curve-${ch}-del`)}
            className="focus-visible:outline-2 focus-visible:outline-accent"
          />
        ))}
      </svg>
    </div>
  );
}

const WHEEL_NAMES = { shadows: 'เงา', midtones: 'กลางโทน', highlights: 'ไฮไลท์' } as const;

// Drag the dot toward a colour to tint that tonal range; double-tap the wheel to clear it.
export function WheelsPanel({ wheels, onChange }: { wheels: Grade['wheels']; onChange: (w: Grade['wheels'], key: string) => void }) {
  const drag = useRef<string | null>(null);
  const set = (k: (typeof WHEELS)[number], v: [number, number, number], key: string) => onChange({ ...wheels, [k]: v }, key);
  const fromPointer = (e: PointerEvent<HTMLDivElement>, k: (typeof WHEELS)[number]) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const d = Math.hypot(x, y);
    if (d > 1) [x, y] = [x / d, y / d];
    set(k, [x, y, wheels[k][2]], drag.current!);
  };
  return (
    <div className="grid grid-cols-3 gap-3">
      {WHEELS.map((k) => {
        const [x, y, light] = wheels[k];
        return (
          <div key={k} className="flex flex-col items-center gap-1">
            <div
              role="slider"
              tabIndex={0}
              aria-label={`วงล้อสี${WHEEL_NAMES[k]}`}
              aria-valuetext={x || y ? `ทิศ ${Math.round((Math.atan2(-y, x) * 180) / Math.PI)} องศา แรง ${Math.round(Math.hypot(x, y) * 100)}%` : 'ไม่ปรับ'}
              className={`relative aspect-square w-full max-w-28 touch-none rounded-pill border border-border ${focus}`}
              style={{ background: 'radial-gradient(circle, #808080 0%, #80808000 72%), conic-gradient(from 90deg, #ff0000, #ff00ff, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = `wheel-${k}-${Date.now()}`;
                fromPointer(e, k);
              }}
              onPointerMove={(e) => drag.current && fromPointer(e, k)}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onDoubleClick={() => set(k, [0, 0, light], `wheel-${k}-reset`)}
              onKeyDown={(e) => {
                const step = 0.05;
                const go: Record<string, [number, number]> = { ArrowUp: [x, y - step], ArrowDown: [x, y + step], ArrowLeft: [x - step, y], ArrowRight: [x + step, y] };
                if (!go[e.key]) return;
                e.preventDefault();
                const [nx, ny] = go[e.key];
                const d = Math.max(1, Math.hypot(nx, ny));
                set(k, [nx / d, ny / d, light], `wheel-${k}-key`);
              }}
            >
              <span aria-hidden className="absolute size-4 -translate-1/2 rounded-pill border-2 border-white bg-black/40" style={{ left: `${50 + x * 50}%`, top: `${50 + y * 50}%` }} />
            </div>
            <span className="text-xs">{WHEEL_NAMES[k]}</span>
            <div className="w-full">
              <Slider label="ความสว่าง" value={light} min={-100} max={100} format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={(v) => set(k, [x, y, v], `wheel-${k}-light`)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
