import { createStore, get, set, values } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import type { Project } from './schema';
import { assertValid } from './timeline.ts';

const db = createStore('editor', 'projects');

type State = { project: Project | null; past: Project[]; future: Project[] };
let state: State = { project: null, past: [], future: [] };
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function useEditor() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

let pending: Project | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  clearTimeout(timer);
  const p = pending;
  pending = null;
  return p ? set(p.id, p, db) : Promise.resolve();
}

function save(p: Project) {
  pending = p;
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}

// Closing or backgrounding the app must not lose the last 500 ms of edits.
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => document.hidden && flush());

export async function openProject(id: string) {
  if (state.project?.id === id) return true;
  await flush();
  const p = await get<Project>(id, db);
  emit({ project: p ?? null, past: [], future: [] });
  return !!p;
}

export async function createProject(p: Project) {
  assertValid(p);
  await set(p.id, p, db);
  emit({ project: p, past: [], future: [] });
}

let last = { key: '', at: 0 };

// Every user action goes through here. Edits with the same `key` within a second (a slider drag) share one undo step.
export function edit(fn: (draft: Project) => void, key = '') {
  const prev = state.project;
  if (!prev) return;
  const next = structuredClone(prev);
  fn(next);
  assertValid(next);
  next.updatedAt = new Date().toISOString();
  const now = Date.now();
  const merge = key !== '' && key === last.key && now - last.at < 1000;
  last = { key, at: now };
  emit({ project: next, past: merge ? state.past : [...state.past, prev].slice(-100), future: [] });
  save(next);
}

export function undo() {
  const prev = state.past.at(-1);
  if (!prev || !state.project) return;
  last = { key: '', at: 0 };
  emit({ project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] });
  save(prev);
}

export function redo() {
  const [next, ...rest] = state.future;
  if (!next || !state.project) return;
  last = { key: '', at: 0 };
  emit({ project: next, past: [...state.past, state.project], future: rest });
  save(next);
}

export async function listProjects() {
  await flush();
  return (await values<Project>(db)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
