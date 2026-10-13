import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, AudioLines, Captions, Crop, Diamond, Drum, Gauge, Gem, Mic, Ratio, Rewind, Snowflake, ImagePlus, Layers, Move, Music, Palette, Pause, Play, Redo2, Replace, Scissors, SlidersHorizontal, Sparkles, SunMedium, Trash2, Type, Undo2, Upload, UserRound, Volume2, WandSparkles, Zap, Crosshair, ScanFace, ScanSearch, Smile, ArrowUp, ArrowDown } from 'lucide-react';
import { BottomSheet, BottomToolbar, Button, Slider, Swatches, ToolButton, TopBar } from '../ui';
import { edit, openProject, redo, undo, useEditor } from '../store';
import { importMedia, openMedia, storeMedia } from '../media';
import { buildReversed } from '../reverse';
import { keyNear, transformAt } from '../keyframes';
import { Player } from '../player';
import {
  SEC,
  ASPECTS,
  addAudio,
  addMedia,
  addOverlay,
  addText,
  deleteClip,
  findClip,
  formatTime,
  moveClip,
  projectDuration,
  replaceClip,
  insertFreeze,
  keepParts,
  setAdjust,
  setKeyEasing,
  setReversed,
  setReversedFile,
  setTransformAt,
  toggleKeyframe,
  setAspect,
  setCanvas,
  setCutout,
  moveLayer,
  coverMain,
  applyLayout,
  setFollow,
  setReframe,
  outputSize,
  setFilter,
  setGrade,
  setMatch,
  setPhotoDuration,
  setTextTiming,
  sourceOut,
  splitAt,
  trimClip,
  trimEdge,
  updateText,
} from '../timeline.ts';
import type { Slot } from '../anim.ts';
import { AnimationSheet, type Still } from './AnimationSheet';
import { Timeline } from './Timeline';
import { TemplateSheet } from './TemplateSheet';
import { TextSheet } from './TextSheet';
import { CaptionSheet } from './CaptionSheet';
import { QualitySheet } from './QualitySheet';
import { BeatSheet, CropSheet, CutoutSheet, EffectSheet, StickerSheet, SoundSheet, SpeedSheet, TransitionSheet, VoiceoverSheet } from './ClipTools';
import { monoOf } from '../thumbs';
import { speechRanges } from '../sound.ts';
import { personPath, trackSpot } from '../follow';
import { analyzeThumbnail, layoutAssets } from '../thumbnail';
import { makeMatch } from '../colour';
import { Layers as LayerList } from './Layers';
import { ColourSheet, type ColourTab } from './ColourSheet';
import { importMessage } from './Home';
import type { AudioClip, Easing, MediaAsset, MediaClip, Project, TextClip, Transform } from '../schema';

type Sheet = 'anim' | 'trim' | 'sound' | 'template' | 'text' | 'colour' | 'place' | 'captions' | 'quality' | 'canvas' | 'speed' | 'crop' | 'transition' | 'voiceover' | 'effect' | 'beat' | 'cutout' | 'track' | 'sticker' | null;
type Point = { x: number; y: number };
const pinchOf = (a: Point, b: Point) => ({ d: Math.hypot(b.x - a.x, b.y - a.y), a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const wrapDeg = (v: number) => {
  const r = ((((v + 180) % 360) + 360) % 360) - 180;
  return Math.abs(r) < 3 ? 0 : r; // snap to level
};

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        left={
          <Button variant="ghost" size="md" aria-label="กลับ" onClick={() => (location.hash = '#/')}>
            <ArrowLeft size={20} aria-hidden />
          </Button>
        }
        title=""
      />
      <p role="alert" className="p-8 text-center text-sm text-muted">
        {children}
      </p>
    </div>
  );
}

function selected(p: Project | null, id: string | null) {
  if (!p || !id) return null;
  try {
    return findClip(p, id);
  } catch {
    return null; // deleted, or gone after an undo
  }
}

export function Editor({ id }: { id: string }) {
  const { project, past, future } = useEditor();
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found'>('loading');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [still, setStill] = useState<Still | null>(null);
  const [colourTab, setColourTab] = useState<ColourTab>('filter');
  const [pendingPlay, setPendingPlay] = useState<Slot | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [transitionFrom, setTransitionFrom] = useState<string | null>(null);
  const recorder = useRef<{ rec: MediaRecorder; chunks: Blob[]; at: number; stream: MediaStream } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const visualInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const overlayInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStatus('loading');
    openProject(id).then((ok) => setStatus(ok ? 'ready' : 'not-found'));
  }, [id]);

  const p = project?.id === id ? project : null;
  const thumb = !!p?.still; // a thumbnail: one picture, no time
  const sel = selected(p, selectedId);
  const visual = sel && (sel.kind === 'video' || sel.kind === 'photo') ? sel : null;
  const textSel = sel?.kind === 'text' ? sel : null;
  const overlaySel = visual && p && !p.tracks[0].clips.some((c) => c.id === visual.id) ? visual : null;
  const mainSel = visual && !overlaySel ? visual : null;
  const placed = visual ?? textSel; // clips with a position, size, turn and opacity (and keyframes)
  const local = placed ? Math.min(placed.duration, Math.max(0, time - placed.start)) : 0;
  const onKey = !!placed && p !== null && keyNear(placed, local, Math.round(SEC / p.fps / 2)) !== undefined;
  const animated = visual ?? textSel;
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ id: string; at: Point; tr: Transform; pinch: { d: number; a: number } | null; moved: boolean; key: string } | null>(null);
  const total = p ? projectDuration(p) : 0;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !p) return;
    const player = new Player(cv);
    player.onTick = (t, on) => {
      setTime(t);
      setPlaying(on);
    };
    player.onError = (e) => setNotice(importMessage(e));
    playerRef.current = player;
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect();
      player.resize(r.width * devicePixelRatio, r.height * devicePixelRatio);
    });
    ro.observe(cv);
    return () => {
      ro.disconnect();
      player.destroy();
      playerRef.current = null;
    };
  }, [!!p]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (p) playerRef.current?.setProject(p);
  }, [p]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.selectedBox = (textSel ?? overlaySel)?.id ?? null;
    player.draw();
  }, [textSel?.id, overlaySel?.id]);

  // Tapping an animation preset plays just that part of the clip once, after the edit has landed.
  useEffect(() => {
    if (!pendingPlay || !animated) return;
    setPendingPlay(null);
    const a = pendingPlay === 'in' ? animated.animIn : pendingPlay === 'out' ? animated.animOut : animated.kind === 'text' ? animated.animLoop : animated.animCombo;
    if (!a) return;
    const from = pendingPlay === 'out' ? animated.start + animated.duration - a.duration : animated.start;
    playerRef.current?.playRange(from, from + (pendingPlay === 'combo' && animated.kind === 'text' ? animated.duration : a.duration));
  }, [pendingPlay, animated]);

  async function addFiles(files: File[], as: 'visual' | 'audio') {
    if (!p || files.length === 0) return;
    setBusy(true);
    setNotice('');
    try {
      const assets: MediaAsset[] = [];
      for (const f of files) assets.push(await importMedia(p.id, f, as));
      if (as === 'audio') {
        let newId = '';
        edit((d) => {
          for (const a of assets) newId = addAudio(d, a, time);
        });
        setSelectedId(newId);
      } else {
        const main = p.tracks[0].clips;
        const at = visual && main.includes(visual) ? main.indexOf(visual) + 1 : main.length;
        let ids: string[] = [];
        edit((d) => {
          ids = addMedia(d, assets, at);
        });
        setSelectedId(ids[0] ?? null);
      }
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function addOverlayFile(file: File | undefined) {
    if (!p || !file) return;
    setBusy(true);
    setNotice('');
    try {
      const asset = await importMedia(p.id, file);
      let id = '';
      edit((d) => {
        id = addOverlay(d, asset, Math.min(time, Math.max(0, total - SEC)));
      });
      setSelectedId(id);
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function replaceWith(file: File | undefined) {
    if (!p || !visual || !file) return;
    setBusy(true);
    setNotice('');
    try {
      const asset = await importMedia(p.id, file);
      // A thumbnail's new background fills the frame and takes the colours of the picture it copies.
      const background = thumb && mainSel?.id === visual.id;
      const ref = background && p.still?.reference ? p.assets[p.still.reference] : undefined;
      const look = ref && asset.kind === 'photo' ? await makeMatch(new File([await openMedia(ref.file)], ref.name, { type: 'image/jpeg' }), { ...visual, assetId: asset.id, sourceIn: 0 }, asset) : null;
      edit((d) => {
        replaceClip(d, visual.id, asset);
        if (background) coverMain(d);
        if (look) setMatch(d, visual.id, { ...look, intensity: 0.7 });
      });
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // A new background behind the cut-out person: a photo, stored with the project.
  async function setBackground(file: File | undefined) {
    if (!p || !visual || !file) return;
    setBusy(true);
    setNotice('');
    try {
      const asset = await importMedia(p.id, file);
      if (asset.kind !== 'photo') return setNotice('พื้นหลังใหม่ต้องเป็นรูปนิ่ง');
      edit((d) => setCutout(d, visual.id, { bg: 'image' }, asset));
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function split() {
    if (!sel) return;
    let right: string | null = null;
    edit((d) => {
      right = splitAt(d, sel.id, time);
    });
    if (!right) setNotice('เลื่อนเส้นเวลาไปไว้กลางคลิปที่เลือกก่อน แล้วค่อยแยก');
  }

  function remove(clipId: string) {
    edit((d) => deleteClip(d, clipId));
    setSelectedId(null);
    setSheet(null);
  }

  // New text sits at the playhead and copies the look of the text before it, so a run of subtitles stays consistent.
  // On a thumbnail it starts plain in the middle instead (the text before it may be a sticker or a heading elsewhere).
  function newText(at: number, from?: TextClip) {
    if (!p) return;
    const before = thumb ? undefined : from ?? (p.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'text' && c.start <= at) as TextClip[]).sort((x, y) => x.start - y.start).at(-1);
    let newId = '';
    edit((d) => {
      newId = addText(d, at, 'ข้อความ', before?.style, before ? before.duration / SEC : 3);
      if (before || thumb) updateText(d, newId, { transform: before?.transform ?? { x: 0.5, y: 0.5 } });
    });
    setSelectedId(newId);
    setSheet('text');
    playerRef.current?.seek(at);
  }

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const cv = e.currentTarget;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cv.width) / r.width, y: ((e.clientY - r.top) * cv.height) / r.height };
  }

  // Text and overlays move the same way on the preview; only the command that stores the move differs.
  const moveBox = (d: Project, id: string, patch: Partial<Transform>) => {
    const c = findClip(d, id);
    setTransformAt(d, id, time - c.start, patch);
  };

  function hitText({ x, y }: Point) {
    const boxes = playerRef.current?.textBoxes ?? [];
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const r = (-b.rot * Math.PI) / 180;
      const dx = x - b.cx;
      const dy = y - b.cy;
      if (Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) <= b.w / 2 && Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) <= b.h / 2) return b.id;
    }
    return null;
  }

  // Preview gestures on text: tap selects, one finger moves, two fingers scale and turn.
  function startGesture(id: string, at: Point, pinch: { d: number; a: number } | null) {
    const c = findClip(p!, id) as TextClip | MediaClip;
    drag.current = { id, at, tr: transformAt(c, Math.min(c.duration, Math.max(0, time - c.start))), pinch, moved: drag.current?.moved ?? false, key: drag.current?.key ?? `text-move-${Date.now()}` };
  }

  function onPreviewDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!p) return;
    const pt = canvasPoint(e);
    if (sheet === 'track' && (textSel || overlaySel)) return void track(pt, e.currentTarget);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, pt);
    if (playerRef.current?.playing) playerRef.current.pause();
    if (pointers.current.size === 1) {
      drag.current = null;
      const id = hitText(pt) ?? (mainSel && !textSel ? mainSel.id : null); // a selected main clip moves from anywhere on the preview
      if (id) {
        setSelectedId(id);
        setNotice('');
        startGesture(id, pt, null);
      }
    } else if (pointers.current.size === 2) {
      const id = drag.current?.id ?? textSel?.id ?? visual?.id;
      const [a, b] = [...pointers.current.values()];
      if (id) startGesture(id, pt, pinchOf(a, b));
    }
  }

  function onPreviewMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = canvasPoint(e);
    pointers.current.set(e.pointerId, pt);
    const g = drag.current;
    if (!g) return;
    const cv = e.currentTarget;
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const now = pinchOf(a, b);
      g.moved = true;
      edit((d) => moveBox(d, g.id, { scale: (g.tr.scale * now.d) / Math.max(1, g.pinch!.d), rotation: wrapDeg(g.tr.rotation + now.a - g.pinch!.a) }), g.key);
    } else if (!g.pinch) {
      const dx = pt.x - g.at.x;
      const dy = pt.y - g.at.y;
      if (!g.moved && Math.hypot(dx, dy) < 6 * devicePixelRatio) return;
      g.moved = true;
      let x = g.tr.x + dx / cv.width;
      if (Math.abs(x - 0.5) < 0.015) x = 0.5; // snap to the centre line
      edit((d) => moveBox(d, g.id, { x, y: clamp01(g.tr.y + dy / cv.height) }), g.key);
    }
  }

  function onPreviewUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = drag.current;
    if (pointers.current.size === 0) {
      if (!g && (textSel || overlaySel)) setSelectedId(null); // a tap beside the text or overlay lets go of it
      drag.current = null;
    } else if (g) {
      startGesture(g.id, [...pointers.current.values()][0], null); // one finger left: keep moving from here
    }
  }

  // Reverse needs a reversed copy of the video; it is made once (with progress) and kept for every clip of that video.
  async function toggleReverse() {
    if (!p || !visual || visual.kind !== 'video') return;
    if (visual.reversed) return edit((d) => setReversed(d, visual.id, false));
    const asset = p.assets[visual.assetId];
    if (!asset.reversedFile) {
      setBusy(true);
      setBusyText('กำลังเตรียมคลิปถอยหลัง… 0%');
      try {
        const path = await buildReversed(p.id, asset, (f) => setBusyText(`กำลังเตรียมคลิปถอยหลัง… ${Math.round(f * 100)}%`), new AbortController().signal);
        edit((d) => {
          setReversedFile(d, asset.id, path);
          setReversed(d, visual.id, true);
        });
      } catch (e) {
        setNotice(`ทำคลิปถอยหลังไม่สำเร็จ: ${importMessage(e)}`);
      } finally {
        setBusy(false);
        setBusyText('');
      }
    } else edit((d) => setReversed(d, visual.id, true));
  }

  // Freeze: the frame at the playhead becomes a 3-second still, inserted there.
  async function freeze() {
    if (!p || !mainSel || mainSel.kind !== 'video') return;
    const el = playerRef.current?.sourceOf(mainSel) as HTMLVideoElement | null;
    if (!el?.videoWidth) return setNotice('รอให้ภาพขึ้นก่อน แล้วค่อยกดหยุดภาพ');
    const cv = document.createElement('canvas');
    cv.width = el.videoWidth;
    cv.height = el.videoHeight;
    cv.getContext('2d')!.drawImage(el, 0, 0);
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.95));
    if (!blob) return setNotice('จับภาพไม่สำเร็จ');
    const assetId = crypto.randomUUID();
    const file = await storeMedia(p.id, assetId, blob);
    const still: MediaAsset = { id: assetId, kind: 'photo', name: `${p.assets[mainSel.assetId].name} (หยุดภาพ)`, file, bytes: blob.size, duration: 0, width: cv.width, height: cv.height, rotation: 0, hasAudio: false };
    let fid = '';
    edit((d) => {
      fid = insertFreeze(d, mainSel.id, time, still);
    });
    setSelectedId(fid);
  }

  // Voiceover: record the microphone while the video plays silently from the playhead; the recording lands there.
  async function voiceover(state: 'start' | 'stop') {
    const player = playerRef.current;
    if (!p || !player) return;
    if (state === 'start') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(250);
      recorder.current = { rec, chunks, at: time, stream };
      player.mute = true;
      player.play();
      return;
    }
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    await new Promise((done) => {
      r.rec.onstop = done;
      r.rec.stop();
    });
    r.stream.getTracks().forEach((x) => x.stop());
    player.pause();
    player.mute = false;
    const blob = new Blob(r.chunks, { type: r.rec.mimeType || 'audio/webm' });
    const file = new File([blob], `พากย์เสียง ${formatTime(r.at)}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: blob.type });
    setBusy(true);
    try {
      const asset = await importMedia(p.id, file, 'audio');
      let aid = '';
      edit((d) => {
        aid = addAudio(d, asset, r.at);
      });
      setSelectedId(aid);
      setSheet(null);
    } catch (e) {
      setNotice(importMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Talking clips: the quiet stretches between sentences are cut out in one go (undo brings them back).
  async function removeSilence() {
    if (!p || !mainSel || mainSel.kind !== 'video') return;
    if (mainSel.curve || mainSel.reversed) return setNotice('ลบช่วงเงียบใช้กับคลิปที่ไม่ได้ใส่กราฟความเร็วหรือเล่นถอยหลัง');
    const c = mainSel;
    setBusy(true);
    setBusyText('กำลังฟังหาช่วงเงียบ…');
    try {
      const sound = p.assets[c.assetId].hasAudio ? await monoOf(p.assets[c.assetId], c.sourceIn / SEC, sourceOut(c) / SEC) : null;
      if (!sound) return setNotice('คลิปนี้ไม่มีเสียงให้ฟัง');
      const parts = speechRanges(sound.samples, sound.rate).map(([a, b]) => [Math.round((a * SEC) / c.speed), Math.round((b * SEC) / c.speed)] as [number, number]);
      const cut = (c.duration - parts.reduce((n, [a, b]) => n + Math.min(b, c.duration) - a, 0)) / SEC;
      let removed = 0;
      edit((d) => {
        removed = keepParts(d, c.id, parts);
      });
      setNotice(removed ? `ตัดช่วงเงียบออก ${removed} ช่วง (สั้นลง ${cut.toFixed(1)} วิ)` : 'ไม่พบช่วงเงียบที่ยาวพอจะตัด');
    } catch (e) {
      setNotice(`ฟังเสียงไม่สำเร็จ: ${importMessage(e)}`);
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  // A reference picture: its person and text spots become a slot and styled text; its colours go onto the background.
  async function applyReference(file: File | undefined) {
    if (!p || !file) return;
    setBusy(true);
    setBusyText('กำลังวิเคราะห์รูปต้นแบบ…');
    setNotice('');
    try {
      const layout = await analyzeThumbnail(file, setBusyText);
      const { reference, slot } = await layoutAssets(p.id, file, layout);
      const main = p.tracks[0].clips[0] as MediaClip;
      const look = p.assets[main.assetId].placeholder ? null : await makeMatch(file, main, p.assets[main.assetId]);
      edit((d) => {
        applyLayout(d, layout, reference, slot);
        if (look) setMatch(d, main.id, { ...look, intensity: 0.7 });
      });
      setSelectedId(null);
      setNotice(`วางตามต้นแบบแล้ว: ${layout.person ? 'ช่องคน 1 ช่อง, ' : ''}ข้อความ ${layout.texts.length} จุด${layout.texts.some((t) => t.text) ? ' (อ่านคำมาให้แล้ว แก้ได้)' : ''}${look ? ', โทนสีตามต้นแบบ' : ''}${layout.person ? ' · แตะ “ช่องรูป (ว่าง)” แล้วกด “แทนที่” ใส่รูปคนของคุณ' : ''}`);
    } catch (e) {
      setNotice(`อ่านรูปต้นแบบไม่สำเร็จ: ${importMessage(e)}`);
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  // Auto reframe: every main clip wider than the frame zooms to fill it and slides to keep the person in the middle.
  async function reframeAll() {
    if (!p) return;
    const [W, H] = outputSize(p.aspect, 1080);
    const wide = (p.tracks[0].clips as MediaClip[]).filter((c) => {
      const a = p.assets[c.assetId];
      return !a.placeholder && (a.width * c.crop.w) / (a.height * c.crop.h) > (W / H) * 1.02;
    });
    if (!wide.length) return setNotice('ไม่มีคลิปที่กว้างกว่าเฟรม เลือกอัตราส่วนที่แคบกว่าคลิปก่อน เช่น 9:16');
    setSheet(null);
    setBusy(true);
    const key = `reframe-${Date.now()}`; // one undo step for the whole run
    try {
      for (const [i, c] of wide.entries()) {
        const path = await personPath(p, c, (f) => setBusyText(`กำลังหาตัวคน… คลิป ${i + 1}/${wide.length} · ${Math.round(f * 100)}%`), new AbortController().signal);
        edit((d) => setReframe(d, c.id, path), key);
      }
      setNotice(`จัดเฟรมตามตัวคนแล้ว ${wide.length} คลิป · กดเล่นเพื่อดู`);
    } catch (e) {
      setNotice(`จัดเฟรมไม่สำเร็จ: ${importMessage(e)}`);
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  // Tracking: the selected text or overlay follows the spot tapped on the preview, from the playhead to its end.
  async function track(pt: Point, cv: HTMLCanvasElement) {
    const c = textSel ?? overlaySel;
    if (!p || !c) return;
    const from = Math.max(time, c.start);
    const to = Math.min(c.start + c.duration, total);
    if (to - from < SEC / 2) return setNotice('เลื่อนเส้นเวลาไปช่วงต้นของคลิปที่จะให้วิ่งตามก่อน แล้วค่อยแตะจุด');
    setSheet(null);
    setBusy(true);
    try {
      const path = await trackSpot(p, from, to, { x: pt.x / cv.width, y: pt.y / cv.height }, (f) => setBusyText(`กำลังติดตาม… ${Math.round(f * 100)}%`), new AbortController().signal);
      edit((d) => setFollow(d, c.id, path.map((q) => ({ ...q, at: q.at - c.start }))));
      setNotice(`ติดตามแล้ว ${((to - from) / SEC).toFixed(1)} วิ · กดเล่นเพื่อดู`);
    } catch (e) {
      setNotice(`ติดตามไม่สำเร็จ: ${importMessage(e)}`);
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  // A small frame of the selected clip, for the preset tiles.
  function captureStill(w = 160) {
    const player = playerRef.current;
    const img = visual && player?.sourceOf(visual);
    if (img && p && visual) {
      const a = p.assets[visual.assetId];
      const h = Math.max(1, Math.round((w * a.height) / a.width));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      setStill({ img: c, w, h });
    }
  }

  function openColour(tab: ColourTab) {
    captureStill();
    setColourTab(tab);
    setSheet('colour');
  }

  function colourToAll(from: MediaClip) {
    edit((d) => {
      for (const c of d.tracks[0].clips) {
        if (c.kind !== 'video' && c.kind !== 'photo') continue;
        setFilter(d, c.id, from.filter?.presetId ?? null, from.filter?.intensity ?? 1);
        setAdjust(d, c.id, from.adjust);
        if (from.grade) setGrade(d, c.id, from.grade);
        setMatch(d, c.id, from.match ?? null);
      }
    });
    setNotice('ใช้สีนี้กับทุกคลิปแล้ว');
  }

  if (status === 'not-found') return <Message>ไม่พบโปรเจกต์นี้ อาจถูกลบไปแล้ว</Message>;

  const [a, b] = (p?.aspect ?? '9:16').split(':').map(Number);
  const player = playerRef.current;
  const onlyMain = !!p && p.tracks[0].clips.length === 1 && p.tracks[0].clips[0].id === sel?.id;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        left={
          <Button variant="ghost" size="md" aria-label="กลับไปหน้าโปรเจกต์" onClick={() => (location.hash = thumb ? '#/thumbs' : '#/')}>
            <ArrowLeft size={20} aria-hidden />
          </Button>
        }
        title={p?.name ?? ''}
        right={
          <Button size="md" disabled={!p} onClick={() => (location.hash = `#/export/${id}`)}>
            <Upload size={16} aria-hidden /> ส่งออก
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 items-center justify-center p-2 [container-type:size]">
        <div style={{ width: `min(100cqw, 100cqh * ${a / b})`, aspectRatio: `${a} / ${b}` }} className={p ? '' : 'animate-pulse rounded-md bg-raised'}>
          {p && (
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="ตัวอย่างวิดีโอ"
              className="size-full touch-none"
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={onPreviewUp}
              onPointerCancel={onPreviewUp}
            />
          )}
        </div>
      </div>

      <div className="flex h-(--size-touch) items-center gap-2 px-2">
        <Button variant="ghost" size="md" aria-label="เลิกทำ" disabled={past.length === 0} onClick={undo}>
          <Undo2 size={20} aria-hidden />
        </Button>
        <Button variant="ghost" size="md" aria-label="ทำซ้ำ" disabled={future.length === 0} onClick={redo}>
          <Redo2 size={20} aria-hidden />
        </Button>
        <span className="flex-1 text-center font-mono text-xs text-muted">
          {!thumb && `${formatTime(time, true)} / ${formatTime(total, true)}`}
        </span>
        {!thumb && placed && time >= placed.start && time <= placed.start + placed.duration && (
          <Button
            variant="ghost"
            size="md"
            aria-label={onKey ? 'ลบคีย์เฟรม' : 'เพิ่มคีย์เฟรม'}
            aria-pressed={onKey}
            onClick={() => edit((d) => void toggleKeyframe(d, placed.id, local))}
          >
            <Diamond size={20} aria-hidden className={onKey ? 'fill-accent text-accent' : ''} />
          </Button>
        )}
        {!thumb && (
          <Button variant="ghost" size="md" aria-label={playing ? 'หยุด' : 'เล่น'} disabled={!p} onClick={() => (playing ? player?.pause() : player?.play())}>
            {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
          </Button>
        )}
      </div>

      {(notice || busy) && (
        <p role={busy ? 'status' : 'alert'} className={`px-4 pb-1 text-xs ${busy ? 'text-muted' : 'text-warning'}`}>
          {busy ? busyText || 'กำลังนำเข้า…' : notice}
        </p>
      )}

      {p && thumb && (
        <LayerList
          project={p}
          selectedId={sel?.id ?? null}
          onSelect={(clipId) => {
            setSelectedId(clipId);
            setNotice('');
          }}
        />
      )}
      {p && !thumb && (
        <Timeline
          project={p}
          time={time}
          selectedId={sel?.id ?? null}
          onSelect={(clipId) => {
            setSelectedId(clipId);
            setNotice('');
          }}
          onSeek={(t) => player?.seek(t)}
          onMove={(clipId, to) => edit((d) => moveClip(d, clipId, to))}
          onDelete={remove}
          onTrim={(from, edge, dt) => edit((d) => trimEdge(d, from, edge, dt), `edge-${from.id}`)}
          onScrub={() => player?.playing && player.pause()}
          onTransition={(fromClipId) => {
            setTransitionFrom(fromClipId);
            setSheet('transition');
          }}
        />
      )}

      <BottomToolbar label={sel ? 'เครื่องมือคลิป' : 'เครื่องมือ'}>
        {!sel && thumb && (
          <>
            <ToolButton icon={ImagePlus} label="เพิ่มรูป" disabled={!p || busy} onClick={() => overlayInput.current?.click()} />
            <ToolButton icon={Type} label="ข้อความ" disabled={!p || busy} onClick={() => newText(0)} />
            <ToolButton icon={Smile} label="สติกเกอร์" disabled={!p || busy} active={sheet === 'sticker'} onClick={() => setSheet('sticker')} />
            <ToolButton icon={ScanSearch} label="ทำตามต้นแบบ" disabled={!p || busy} onClick={() => referenceInput.current?.click()} />
            <ToolButton icon={Ratio} label="อัตราส่วน" disabled={!p || busy} active={sheet === 'canvas'} onClick={() => setSheet('canvas')} />
            <ToolButton icon={Zap} label="เอฟเฟกต์" disabled={!p || busy} active={sheet === 'effect'} onClick={() => setSheet('effect')} />
          </>
        )}
        {!sel && !thumb && (
          <>
            <ToolButton icon={ImagePlus} label="เพิ่มคลิป" disabled={!p || busy} onClick={() => visualInput.current?.click()} />
            <ToolButton icon={Music} label="เพิ่มเสียง" disabled={!p || busy} onClick={() => audioInput.current?.click()} />
            <ToolButton icon={Mic} label="พากย์เสียง" disabled={!p || busy} active={sheet === 'voiceover'} onClick={() => setSheet('voiceover')} />
            <ToolButton icon={Type} label="ข้อความ" disabled={!p || busy} onClick={() => newText(Math.min(time, Math.max(0, total - SEC)))} />
            <ToolButton icon={Ratio} label="อัตราส่วน" disabled={!p || busy} active={sheet === 'canvas'} onClick={() => setSheet('canvas')} />
            <ToolButton icon={Captions} label="คำบรรยาย" disabled={!p || busy} active={sheet === 'captions'} onClick={() => setSheet('captions')} />
            <ToolButton icon={Layers} label="ภาพซ้อน" disabled={!p || busy} onClick={() => overlayInput.current?.click()} />
            <ToolButton icon={Smile} label="สติกเกอร์" disabled={!p || busy} active={sheet === 'sticker'} onClick={() => setSheet('sticker')} />
            <ToolButton icon={Zap} label="เอฟเฟกต์" disabled={!p || busy} active={sheet === 'effect'} onClick={() => setSheet('effect')} />
            <ToolButton icon={WandSparkles} label="เทมเพลต" disabled={!p || busy} active={sheet === 'template'} onClick={() => setSheet('template')} />
          </>
        )}
        {sel && (
          <>
            {visual && <ToolButton icon={Replace} label="แทนที่" disabled={busy} active={!!p?.assets[visual.assetId].placeholder} onClick={() => replaceInput.current?.click()} />}
            {textSel && <ToolButton icon={Type} label="แก้ไข" active={sheet === 'text'} onClick={() => setSheet('text')} />}
            {!thumb && (textSel || overlaySel) && <ToolButton icon={Crosshair} label="ติดตาม" disabled={busy} active={sheet === 'track'} onClick={() => setSheet('track')} />}
            {thumb && !mainSel && sel.kind !== 'effect' && <ToolButton icon={ArrowUp} label="เลื่อนขึ้น" onClick={() => edit((d) => void moveLayer(d, sel.id, 1))} />}
            {thumb && !mainSel && sel.kind !== 'effect' && <ToolButton icon={ArrowDown} label="เลื่อนลง" onClick={() => edit((d) => void moveLayer(d, sel.id, -1))} />}
            {sel.kind === 'effect' && <ToolButton icon={Zap} label="เปลี่ยนเอฟเฟกต์" active={sheet === 'effect'} onClick={() => setSheet('effect')} />}
            {visual && <ToolButton icon={Move} label="จัดวาง" active={sheet === 'place'} onClick={() => setSheet('place')} />}
            {!thumb && (sel.kind === 'video' || sel.kind === 'audio') && <ToolButton icon={Gauge} label="ความเร็ว" active={sheet === 'speed'} onClick={() => setSheet('speed')} />}
            {!thumb && visual?.kind === 'video' && <ToolButton icon={Rewind} label="ถอยหลัง" disabled={busy} active={visual.reversed} aria-pressed={visual.reversed} onClick={() => void toggleReverse()} />}
            {mainSel?.kind === 'video' && <ToolButton icon={Snowflake} label="หยุดภาพ" disabled={busy} onClick={() => void freeze()} />}
            {mainSel?.kind === 'video' && <ToolButton icon={AudioLines} label="ลบช่วงเงียบ" disabled={busy} onClick={() => void removeSilence()} />}
            {sel.kind === 'audio' && <ToolButton icon={Drum} label="ตัดตามบีท" active={sheet === 'beat'} onClick={() => setSheet('beat')} />}
            {visual && <ToolButton icon={Crop} label="ครอป" active={sheet === 'crop'} onClick={() => {
              captureStill(320);
              setSheet('crop');
            }} />}
            {!thumb && <ToolButton icon={Scissors} label="แยก" onClick={split} />}
            {!thumb && <ToolButton icon={SlidersHorizontal} label={sel.kind === 'video' || sel.kind === 'audio' ? 'ตัด' : 'ระยะเวลา'} active={sheet === 'trim'} onClick={() => setSheet('trim')} />}
            {!thumb && animated && <ToolButton icon={Sparkles} label="แอนิเมชัน" active={sheet === 'anim'} onClick={() => {
              captureStill();
              setSheet('anim');
            }} />}
            {visual && <ToolButton icon={Palette} label="ฟิลเตอร์" active={sheet === 'colour' && colourTab === 'filter'} onClick={() => openColour('filter')} />}
            {visual && <ToolButton icon={UserRound} label="ตัดพื้นหลัง" active={sheet === 'cutout'} onClick={() => setSheet('cutout')} />}
            {visual && <ToolButton icon={Gem} label="คุณภาพ" active={sheet === 'quality'} onClick={() => setSheet('quality')} />}
            {visual && <ToolButton icon={SunMedium} label="ปรับแก้" active={sheet === 'colour' && colourTab === 'adjust'} onClick={() => openColour('adjust')} />}
            {!thumb && (sel.kind === 'video' || sel.kind === 'audio') && <ToolButton icon={Volume2} label="เสียง" active={sheet === 'sound'} onClick={() => setSheet('sound')} />}
            <ToolButton icon={Trash2} label="ลบ" disabled={onlyMain} onClick={() => remove(sel.id)} />
          </>
        )}
      </BottomToolbar>

      <input ref={visualInput} type="file" accept="video/*,image/*" multiple hidden aria-label="เลือกวิดีโอหรือรูป" onChange={(e) => {
        void addFiles([...(e.target.files ?? [])], 'visual');
        e.target.value = '';
      }} />
      <input ref={replaceInput} type="file" accept="video/*,image/*" hidden aria-label="เลือกรูปหรือวิดีโอมาแทนที่" onChange={(e) => {
        void replaceWith(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <input ref={backgroundInput} type="file" accept="image/*" hidden aria-label="เลือกรูปพื้นหลังใหม่" onChange={(e) => {
        void setBackground(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <input ref={referenceInput} type="file" accept="image/*" hidden aria-label="เลือกรูปต้นแบบ" onChange={(e) => {
        void applyReference(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <input ref={overlayInput} type="file" accept={thumb ? 'image/*' : 'video/*,image/*'} hidden aria-label="เลือกรูปหรือวิดีโอสำหรับภาพซ้อน" onChange={(e) => {
        void addOverlayFile(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <input ref={audioInput} type="file" accept="audio/*,video/*" hidden aria-label="เลือกไฟล์เสียง หรือวิดีโอเพื่อใช้แค่เสียง" onChange={(e) => {
        void addFiles([...(e.target.files ?? [])], 'audio');
        e.target.value = '';
      }} />

      {p && (
        <TemplateSheet
          open={sheet === 'template'}
          onClose={() => setSheet(null)}
          project={p}
          onApplied={(slots, empty) => {
            setSelectedId(null);
            player?.seek(0);
            setNotice(empty ? `จัดตามคลิปต้นแบบแล้ว ${slots} ช่อง · ช่องว่าง ${empty} ช่อง: แตะช่องว่างแล้วกด “แทนที่”` : `จัดตามคลิปต้นแบบแล้ว ${slots} ช่อง`);
          }}
        />
      )}
      {p && animated && (
        <AnimationSheet open={sheet === 'anim'} onClose={() => setSheet(null)} clip={animated} still={visual ? still : null} onPlay={setPendingPlay} />
      )}
      {p && visual && (
        <ColourSheet open={sheet === 'colour'} tab={colourTab} onTab={setColourTab} onClose={() => setSheet(null)} clip={visual} asset={p.assets[visual.assetId]} still={still} onApplyAll={() => colourToAll(visual)} />
      )}
      {p && (
        <BottomSheet open={sheet === 'canvas'} title="อัตราส่วนและพื้นหลัง" onClose={() => setSheet(null)} modal={false}>
          <div className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="อัตราส่วนภาพ" className="grid grid-cols-4 gap-2">
              {ASPECTS.map((r) => {
                const [x, y] = r.split(':').map(Number);
                return (
                  <button
                    key={r}
                    role="radio"
                    aria-checked={p.aspect === r}
                    onClick={() =>
                      edit((d) => {
                        setAspect(d, r);
                        if (d.still) coverMain(d); // a thumbnail's background keeps filling the frame
                      })
                    }
                    className={`flex h-16 flex-col items-center justify-center gap-1 rounded-md text-xs ${p.aspect === r ? 'bg-accent text-on-accent' : 'bg-raised'} focus-visible:outline-2 focus-visible:outline-accent`}
                  >
                    <span aria-hidden className="rounded-sm border-2 border-current" style={{ width: (20 * x) / Math.max(x, y), height: (20 * y) / Math.max(x, y) }} />
                    {r}
                  </button>
                );
              })}
            </div>
            <div role="radiogroup" aria-label="พื้นหลัง" className="flex gap-2">
              {(['สีพื้น', 'เบลอ'] as const).map((label) => {
                const on = (label === 'เบลอ') === (p.canvas.kind === 'blur');
                return (
                  <button
                    key={label}
                    role="radio"
                    aria-checked={on}
                    onClick={() => edit((d) => setCanvas(d, label === 'เบลอ' ? { kind: 'blur', level: 2 } : { kind: 'colour', colour: '#000000' }))}
                    className={`h-10 flex-1 rounded-md text-sm ${on ? 'bg-fg text-bg' : 'bg-raised'} focus-visible:outline-2 focus-visible:outline-accent`}
                  >
                    พื้นหลัง{label}
                  </button>
                );
              })}
            </div>
            {!thumb && (
              <Button variant="secondary" disabled={busy} onClick={() => void reframeAll()}>
                <ScanFace size={16} aria-hidden /> จัดเฟรมอัตโนมัติตามตัวคน
              </Button>
            )}
            {p.canvas.kind === 'colour' ? (
              <Swatches label="สีพื้นหลัง" colours={['#000000', '#ffffff', '#1c1c1e', '#ff3b30', '#ffd84d', '#34c759', '#007aff', '#ff4f8b']} value={p.canvas.colour} onChange={(c) => edit((d) => setCanvas(d, { kind: 'colour', colour: c }), 'canvas-colour')} />
            ) : (
              <Slider label="ความเบลอ" value={p.canvas.level} min={1} max={4} step={1} onChange={(v) => edit((d) => setCanvas(d, { kind: 'blur', level: v as 1 | 2 | 3 | 4 }), 'canvas-blur')} />
            )}
          </div>
        </BottomSheet>
      )}
      {p && visual && (
        <QualitySheet open={sheet === 'quality'} onClose={() => setSheet(null)} clip={visual} asset={p.assets[visual.assetId]} onExport={() => (location.hash = `#/export/${id}`)} />
      )}
      {p && (
        <CaptionSheet
          open={sheet === 'captions'}
          onClose={() => setSheet(null)}
          project={p}
          time={time}
          onSeek={(t) => player?.seek(t)}
          onAddHere={() => newText(Math.min(time, Math.max(0, total - SEC)))}
        />
      )}
      {p && visual && (
        <PlaceSheet
          open={sheet === 'place'}
          onClose={() => setSheet(null)}
          clip={visual}
          at={local}
          onKey={onKey}
          set={(patch, key) => edit((d) => setTransformAt(d, visual.id, local, patch), key)}
          setEasing={(e) => edit((d) => setKeyEasing(d, visual.id, local, e))}
        />
      )}
      {p && (sel?.kind === 'video' || sel?.kind === 'audio') && <SpeedSheet open={sheet === 'speed'} onClose={() => setSheet(null)} clip={sel} />}
      {p && visual && <CropSheet open={sheet === 'crop'} onClose={() => setSheet(null)} clip={visual} aspect={p.assets[visual.assetId].width / Math.max(1, p.assets[visual.assetId].height)} still={still} />}
      {p && (
        <TransitionSheet
          open={sheet === 'transition'}
          onClose={() => setSheet(null)}
          project={p}
          fromClipId={transitionFrom}
          onPreview={(from, to) => player?.playRange(Math.max(0, from), to)}
        />
      )}
      {p && (sel?.kind === 'video' || sel?.kind === 'audio') && (
        <SoundSheet
          open={sheet === 'sound'}
          onClose={() => setSheet(null)}
          clip={sel}
          canExtract={sel.kind === 'video' && p.assets[sel.assetId].hasAudio && sel.volume > 0}
          onExtracted={(aid) => {
            setSelectedId(aid);
            setNotice('แยกเสียงแล้ว: คลิปเสียงอยู่ในแทร็กเสียง ส่วนวิดีโอปิดเสียงไว้');
          }}
        />
      )}
      {p && <VoiceoverSheet open={sheet === 'voiceover'} onClose={() => setSheet(null)} onRecord={voiceover} time={time} />}
      {p && sel?.kind === 'audio' && (
        <BeatSheet
          open={sheet === 'beat'}
          onClose={() => setSheet(null)}
          project={p}
          clip={sel}
          onSynced={() => {
            player?.seek(0);
            setNotice('วางคลิปตามบีทแล้ว กดเล่นเพื่อดู');
          }}
        />
      )}
      {p && visual && <CutoutSheet open={sheet === 'cutout'} onClose={() => setSheet(null)} clip={visual} onPickImage={() => backgroundInput.current?.click()} />}
      {p && (textSel || overlaySel) && (
        <BottomSheet open={sheet === 'track'} title="ติดตาม" onClose={() => setSheet(null)} modal={false}>
          <p className="text-sm">แตะสิ่งที่ต้องการให้{textSel ? 'ข้อความ' : 'ภาพซ้อน'}วิ่งตามบนจอตัวอย่าง</p>
          <p className="mt-1 text-xs text-muted">เริ่มจากตำแหน่งเส้นเวลาตอนนี้ไปจนจบคลิป · ได้ผลดีกับสิ่งที่มีลวดลายชัดๆ ตำแหน่งที่ได้เป็นคีย์เฟรม แก้ต่อได้</p>
        </BottomSheet>
      )}
      {p && <StickerSheet open={sheet === 'sticker'} onClose={() => setSheet(null)} at={thumb ? 0 : Math.min(time, Math.max(0, total - SEC))} onAdded={setSelectedId} />}
      {p && <EffectSheet open={sheet === 'effect'} onClose={() => setSheet(null)} project={p} clip={sel?.kind === 'effect' ? sel : null} time={time} onAdded={setSelectedId} />}
      {p && textSel && (
        <TextSheet
          open={sheet === 'text'}
          onClose={() => setSheet(null)}
          clip={textSel}
          shown={transformAt(textSel, local)}
          setTransform={(patch, key) => edit((d) => setTransformAt(d, textSel.id, local, patch), key)}
          onNext={thumb ? undefined : () => newText(textSel.start + textSel.duration, textSel)}
        />
      )}
      {p && sel && (
        <BottomSheet open={sheet === 'trim'} title={sel.kind === 'photo' ? 'ระยะเวลารูป' : sel.kind === 'text' ? 'ระยะเวลาข้อความ' : sel.kind === 'effect' ? 'ระยะเวลาเอฟเฟกต์' : 'ตัดคลิป'} onClose={() => setSheet(null)} modal={false}>
          {sel.kind === 'text' || sel.kind === 'effect' ? (
            <Slider
              label="ระยะเวลา"
              value={sel.duration / SEC}
              min={0.3}
              max={30}
              step={0.1}
              format={(v) => `${v.toFixed(1)} วิ`}
              onChange={(v) => edit((d) => setTextTiming(d, sel.id, sel.start, Math.round(v * SEC)), 'text-duration')}
            />
          ) : sel.kind === 'photo' ? (
            <Slider
              label="ระยะเวลา"
              value={sel.duration / SEC}
              min={0.5}
              max={20}
              step={0.1}
              format={(v) => `${v.toFixed(1)} วิ`}
              onChange={(v) => edit((d) => setPhotoDuration(d, sel.id, Math.round(v * SEC)), 'photo-duration')}
            />
          ) : (
            <TrimSliders project={p} clip={sel as MediaClip | AudioClip} onSeek={(t) => player?.seek(t)} />
          )}
        </BottomSheet>
      )}
    </div>
  );
}

const EASINGS: [Easing, string][] = [
  ['linear', 'คงที่'],
  ['easeIn', 'ช้า→เร็ว'],
  ['easeOut', 'เร็ว→ช้า'],
  ['easeInOut', 'นุ่มสองข้าง'],
];

// Size, turn and opacity of a picture; with keyframes these edit the keyframe at the playhead (one is made if needed).
function PlaceSheet({ open, onClose, clip, at, onKey, set, setEasing }: { open: boolean; onClose: () => void; clip: MediaClip; at: number; onKey: boolean; set: (patch: Partial<Transform>, key?: string) => void; setEasing: (e: Easing) => void }) {
  const tr = transformAt(clip, at);
  const easing = clip.keyframes.find((k) => Math.abs(k.at - at) < SEC / 60)?.easing;
  return (
    <BottomSheet open={open} title="จัดวาง" onClose={onClose} modal={false}>
      <div className="flex flex-col gap-2">
        <Slider label="ขนาด" value={Math.round(tr.scale * 100)} min={5} max={400} step={1} format={(v) => `${v}%`} onChange={(v) => set({ scale: v / 100 }, 'place-scale')} />
        <Slider label="หมุน" value={Math.round(tr.rotation)} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => set({ rotation: v }, 'place-rotate')} />
        <Slider label="ความทึบ" value={Math.round(tr.opacity * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => set({ opacity: v / 100 }, 'place-opacity')} />
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={() => set({ x: 0.5, y: 0.5 })}>
            กลางจอ
          </Button>
          <Button variant="secondary" size="md" onClick={() => set({ x: 0.5, y: 0.5, scale: 1, rotation: 0 })}>
            เต็มจอ
          </Button>
        </div>
        {onKey && easing && (
          <div role="radiogroup" aria-label="ความนุ่มจากคีย์เฟรมนี้ไปคีย์เฟรมถัดไป" className="flex flex-col gap-1">
            <span className="text-sm">จากคีย์เฟรมนี้ไปถัดไป</span>
            <div className="flex gap-1">
              {EASINGS.map(([e, label]) => (
                <button
                  key={e}
                  role="radio"
                  aria-checked={easing === e}
                  onClick={() => setEasing(e)}
                  className={`h-9 flex-1 rounded-md text-xs ${easing === e ? 'bg-accent text-on-accent' : 'bg-raised'} focus-visible:outline-2 focus-visible:outline-accent`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted">บนจอตัวอย่าง: ลากเพื่อย้าย ใช้สองนิ้วเพื่อย่อ/ขยายและหมุน · กด ◆ เพื่อใส่คีย์เฟรม แล้วเลื่อนเวลาไปปรับค่าใหม่ ภาพจะค่อยๆ เปลี่ยนระหว่างคีย์เฟรม</p>
      </div>
    </BottomSheet>
  );
}

function TrimSliders({ project, clip, onSeek }: { project: Project; clip: MediaClip | AudioClip; onSeek: (t: number) => void }) {
  const frame = 1 / project.fps;
  const assetS = project.assets[clip.assetId].duration / SEC;
  const inS = clip.sourceIn / SEC;
  const outS = sourceOut(clip) / SEC;
  return (
    <div className="flex flex-col gap-2">
      <Slider
        label="จุดเริ่ม"
        value={inS}
        min={0}
        max={assetS}
        step={frame}
        format={(v) => formatTime(v * SEC, true)}
        onChange={(v) => {
          edit((d) => trimClip(d, clip.id, 'in', Math.round(v * SEC)), 'trim-in');
          onSeek(clip.start);
        }}
      />
      <Slider
        label="จุดจบ"
        value={outS}
        min={0}
        max={assetS}
        step={frame}
        format={(v) => formatTime(v * SEC, true)}
        onChange={(v) => {
          edit((d) => trimClip(d, clip.id, 'out', Math.round(v * SEC)), 'trim-out');
          onSeek(clip.start + Math.round(((v - inS) * SEC) / clip.speed) - 1);
        }}
      />
    </div>
  );
}
