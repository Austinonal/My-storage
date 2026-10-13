// Keyframes: a clip's position, size, turn and opacity changing over time, with an easing per segment.
// Pure, so it is unit-tested; the renderer asks `transformAt`, edits go through `setKeys`.
import type { Easing, Keyframe, KeyframeProp, Transform, Us } from './schema';

export const KEY_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const satisfies KeyframeProp[];
type Prop = (typeof KEY_PROPS)[number];
type Keyed = { keyframes: Keyframe[]; transform: Transform };

export const EASE: Record<Easing, (u: number) => number> = {
  linear: (u) => u,
  easeIn: (u) => u * u * u,
  easeOut: (u) => 1 - (1 - u) ** 3,
  easeInOut: (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2),
};

const ofProp = (c: Keyed, prop: Prop) => c.keyframes.filter((k) => k.prop === prop).sort((a, b) => a.at - b.at);
export const hasKeys = (c: Keyed) => c.keyframes.some((k) => (KEY_PROPS as readonly string[]).includes(k.prop));

export function valueAt(c: Keyed, prop: Prop, t: Us) {
  const ks = ofProp(c, prop);
  if (!ks.length) return c.transform[prop];
  if (t <= ks[0].at) return ks[0].value;
  const last = ks[ks.length - 1];
  if (t >= last.at) return last.value;
  const i = ks.findIndex((k) => k.at > t) - 1;
  const a = ks[i];
  const b = ks[i + 1];
  return a.value + (b.value - a.value) * EASE[a.easing]((t - a.at) / Math.max(1, b.at - a.at));
}

export function transformAt(c: Keyed, t: Us): Transform {
  if (!hasKeys(c)) return c.transform;
  return Object.fromEntries(KEY_PROPS.map((p) => [p, valueAt(c, p, t)])) as unknown as Transform;
}

// Keyframe times of a clip, one entry per moment (all properties are keyed together).
export const keyTimes = (c: Keyed) => [...new Set(c.keyframes.filter((k) => (KEY_PROPS as readonly string[]).includes(k.prop)).map((k) => k.at))].sort((a, b) => a - b);
export const keyNear = (c: Keyed, t: Us, tol: Us) => keyTimes(c).find((at) => Math.abs(at - t) <= tol);

// Adds a keyframe of every property at `t` (with the values the clip shows there), or removes the one already there.
export function toggleKey(c: Keyed, t: Us, tol: Us) {
  const near = keyNear(c, t, tol);
  if (near !== undefined) {
    c.keyframes = c.keyframes.filter((k) => !(k.at === near && (KEY_PROPS as readonly string[]).includes(k.prop)));
    return false;
  }
  const values = transformAt(c, t);
  if (!hasKeys(c)) c.transform = values; // the static values become the fallback once the last keyframe goes
  for (const prop of KEY_PROPS) c.keyframes.push({ at: Math.round(t), prop, value: values[prop], easing: 'easeInOut' });
  return true;
}

// Moving or resizing: with keyframes, the change lands on a keyframe at `t` (made if needed); without, on the clip itself.
export function setKeys(c: Keyed, t: Us, patch: Partial<Transform>, tol: Us) {
  if (!hasKeys(c)) {
    c.transform = { ...c.transform, ...patch };
    return;
  }
  const at = keyNear(c, t, tol) ?? Math.round(t);
  if (keyNear(c, t, tol) === undefined) toggleKey(c, at, 0);
  for (const prop of KEY_PROPS) {
    if (patch[prop] === undefined) continue;
    const k = c.keyframes.find((x) => x.prop === prop && x.at === at);
    if (k) k.value = patch[prop]!;
  }
}

export function setEasing(c: Keyed, t: Us, easing: Easing, tol: Us) {
  const at = keyNear(c, t, tol);
  for (const k of c.keyframes) if (k.at === at) k.easing = easing;
}
