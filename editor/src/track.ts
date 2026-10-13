// Following a spot from one frame to the next: the square around it in the last frame is looked for nearby in the next
// one (least difference, each square's own average brightness taken out so a lighting change does not throw it).
// Pure, so it is unit-tested; follow.ts renders the frames.

export function grayOf(rgba: Uint8ClampedArray, w: number, h: number) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return g;
}

function meanOf(img: Float32Array, w: number, cx: number, cy: number, half: number) {
  let s = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) s += img[y * w + x];
  return s / (2 * half + 1) ** 2;
}

// Where the square of `half` around (x, y) in `prev` went in `next`, searching `radius` pixels each way.
export function matchPatch(prev: Float32Array, next: Float32Array, w: number, h: number, x: number, y: number, half: number, radius: number) {
  const inside = (v: number, size: number) => Math.min(size - 1 - half, Math.max(half, Math.round(v)));
  const px = inside(x, w);
  const py = inside(y, h);
  const pm = meanOf(prev, w, px, py, half);
  let best = { x: px, y: py, cost: Infinity };
  for (let dy = -radius; dy <= radius; dy++) {
    const cy = py + dy;
    if (cy < half || cy > h - 1 - half) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = px + dx;
      if (cx < half || cx > w - 1 - half) continue;
      const nm = meanOf(next, w, cx, cy, half);
      let cost = 0;
      for (let v = -half; v <= half && cost < best.cost; v++) {
        const a = (py + v) * w + px;
        const b = (cy + v) * w + cx;
        for (let u = -half; u <= half; u++) cost += Math.abs(prev[a + u] - pm - (next[b + u] - nm));
      }
      // Ties go to the smaller move, so a flat area does not wander.
      if (cost < best.cost || (cost === best.cost && Math.abs(dx) + Math.abs(dy) < Math.abs(best.x - px) + Math.abs(best.y - py))) best = { x: cx, y: cy, cost };
    }
  }
  return { x: best.x + (x - px), y: best.y + (y - py) };
}
