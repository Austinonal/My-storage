import type { AudioClip, MediaClip, Project, Us } from './schema';
import { openMedia } from './media';
import { overlayClips, renderFrame, visibleAt, type TextBox } from './render';
import { fileSecondsAt, rateAt } from './timing.ts';
import { voiceChain, type Chain } from './voice';
import type { Voice } from './schema';
import { loadFonts } from './fonts';
import { prepareLuts } from './colour';
import { FRAME_NUDGE, SEC, projectDuration } from './timeline.ts';

// Plays a project in a canvas: one clock, every media element follows it and is corrected when it drifts.
// Main-track videos share one element per file (a second one only while a transition shows two parts of the same file);
// overlay videos and audio clips get their own.
export class Player {
  time: Us = 0;
  playing = false;
  onTick?: (t: Us, playing: boolean) => void;
  onError?: (e: unknown) => void;
  textBoxes: TextBox[] = []; // where text and overlays were drawn last, in canvas pixels
  selectedBox: string | null = null; // framed in the preview only, never in the export
  mute = false; // silences everything, e.g. while recording a voiceover

  private p: Project | null = null;
  private photos = new Map<string, ImageBitmap>(); // by asset id
  private videos = new Map<string, HTMLVideoElement>(); // main: file path (+ '#2'); overlay: 'ov:' + clip id
  private audios = new Map<string, HTMLAudioElement>(); // audio-track clips, by clip id
  private assigned = new Map<string, HTMLVideoElement>(); // clip id -> the element showing it right now
  private urls = new Map<string, string>(); // by file path
  private loading = new Set<string>();
  private raf = 0;
  private clock = { at: 0, t: 0 };
  private stopAt: Us = 0;
  private ac: AudioContext | null = null; // made on first use of a voice effect
  private routes = new Map<HTMLMediaElement, { src: MediaElementAudioSourceNode; voice: Voice | null; chain: Chain | null }>();

  constructor(private canvas: HTMLCanvasElement) {
    void loadFonts().then(() => this.draw());
  }

  private pathOf(c: MediaClip | AudioClip) {
    const a = this.p!.assets[c.assetId];
    return c.kind === 'video' && c.reversed && a.reversedFile ? a.reversedFile : a.file;
  }

  setProject(p: Project) {
    this.p = p;
    const clips = p.tracks.flatMap((t) => t.clips);
    const ids = new Set(clips.map((c) => c.id));
    for (const [id, el] of this.audios) {
      if (ids.has(id)) continue;
      el.pause();
      this.audios.delete(id);
    }
    const keep = new Set(clips.flatMap((c) => (c.kind === 'video' ? [this.pathOf(c), `${this.pathOf(c)}#2`, `ov:${c.id}`] : [])));
    for (const [key, el] of this.videos) {
      if (keep.has(key)) continue;
      el.pause();
      el.removeAttribute('src');
      this.videos.delete(key);
    }
    this.time = Math.min(this.time, projectDuration(p));
    void prepareLuts(p).then(() => this.draw());
    void this.load(p);
    this.sync();
    this.draw();
  }

  private async url(path: string) {
    let u = this.urls.get(path);
    if (!u) {
      u = URL.createObjectURL(await openMedia(path));
      this.urls.set(path, u);
    }
    return u;
  }

  private makeVideo(key: string, url: string) {
    const el = document.createElement('video');
    el.preload = 'auto';
    el.playsInline = true;
    el.addEventListener('seeked', () => this.draw());
    el.addEventListener('loadeddata', () => this.draw());
    el.src = url;
    this.videos.set(key, el);
    return el;
  }

  private async load(p: Project) {
    const jobs: [string, () => Promise<void>][] = [];
    for (const v of [...(p.tracks[0].clips as MediaClip[]).map((c) => ({ c, main: true })), ...overlayClips(p).map((c) => ({ c, main: false }))]) {
      const { c } = v;
      if (c.kind === 'photo') {
        jobs.push([c.assetId, async () => {
          if (!this.photos.has(c.assetId)) this.photos.set(c.assetId, await createImageBitmap(await openMedia(p.assets[c.assetId].file)));
        }]);
        continue;
      }
      const path = this.pathOf(c);
      const key = v.main ? path : `ov:${c.id}`;
      jobs.push([key, async () => {
        if (!this.videos.has(key)) this.makeVideo(key, await this.url(path));
      }]);
    }
    for (const t of p.tracks.slice(1)) {
      for (const c of t.clips) {
        if (c.kind !== 'audio') continue;
        jobs.push([c.id, async () => {
          if (this.audios.has(c.id)) return;
          const el = new Audio(await this.url(this.pathOf(c)));
          el.preload = 'auto';
          this.audios.set(c.id, el);
        }]);
      }
    }
    for (const [key, job] of jobs) {
      if (this.loading.has(key)) continue;
      this.loading.add(key);
      try {
        await job();
      } catch (e) {
        this.onError?.(e);
      } finally {
        this.loading.delete(key);
      }
    }
    this.sync();
    this.draw();
  }

  private follow(el: HTMLMediaElement, c: MediaClip | AudioClip, local: Us, muted: boolean) {
    const asset = this.p!.assets[c.assetId];
    const want = fileSecondsAt(c, asset.duration, local) + FRAME_NUDGE;
    // shortcut: media elements play at most 16x; faster parts of a clip are kept in step by seeking
    el.playbackRate = Math.min(16, Math.max(0.0625, rateAt(c, Math.min(c.duration, Math.max(0, local)))));
    const at = Math.min(c.duration, Math.max(0, local));
    const fadeIn = c.fadeIn ?? 0;
    const fadeOut = c.fadeOut ?? 0;
    const fade = Math.min(1, fadeIn ? at / fadeIn : 1, fadeOut ? (c.duration - at) / fadeOut : 1);
    el.volume = Math.max(0, Math.min(1, c.volume * fade)); // shortcut: preview caps volume at 100 %; the export uses the real gain
    el.muted = muted || this.mute;
    this.route(el, c.voice ?? null);
    if (this.playing) {
      if (Math.abs(el.currentTime - want) > 0.2) el.currentTime = want;
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.001) el.currentTime = want;
    }
  }

  // A voice effect needs the element's sound to go through Web Audio; once routed, an element stays routed.
  private route(el: HTMLMediaElement, voice: Voice | null) {
    let r = this.routes.get(el);
    if (!r) {
      if (!voice) return;
      this.ac ??= new AudioContext();
      r = { src: this.ac.createMediaElementSource(el), voice: null, chain: null };
      r.src.connect(this.ac.destination);
      this.routes.set(el, r);
    }
    if (r.voice === voice) return;
    r.src.disconnect();
    r.chain?.output.disconnect();
    r.chain = voice ? voiceChain(this.ac!, voice) : null;
    if (r.chain) {
      r.src.connect(r.chain.input);
      r.chain.output.connect(this.ac!.destination);
    } else r.src.connect(this.ac!.destination);
    r.voice = voice;
  }

  private sync() {
    const p = this.p;
    if (!p) return;
    const t = this.time;
    this.assigned.clear();
    const used = new Set<HTMLVideoElement>();
    for (const v of visibleAt(p, t)) {
      const c = v.clip;
      if (c.kind !== 'video') continue;
      const path = this.pathOf(c);
      let el = this.videos.get(v.main ? path : `ov:${c.id}`);
      if (el && used.has(el)) {
        const u = this.urls.get(path);
        el = this.videos.get(`${path}#2`) ?? (u ? this.makeVideo(`${path}#2`, u) : undefined);
      }
      if (!el) continue;
      used.add(el);
      this.assigned.set(c.id, el);
      const track = p.tracks.find((x) => x.clips.includes(c))!;
      this.follow(el, c, v.local, track.muted || v.local < 0 || v.local > c.duration); // the bit a transition borrows is silent
    }
    for (const el of this.videos.values()) if (!used.has(el) && !el.paused) el.pause();
    for (const track of p.tracks.slice(1)) {
      for (const c of track.clips) {
        const el = c.kind === 'audio' ? this.audios.get(c.id) : undefined;
        if (!el || c.kind !== 'audio') continue;
        if (t >= c.start && t < c.start + c.duration) this.follow(el, c, t - c.start, track.muted);
        else if (!el.paused) el.pause();
      }
    }
  }

  // The picture a clip shows right now, for drawing, tile stills and freeze frames.
  sourceOf(c: MediaClip): CanvasImageSource | null {
    if (c.kind === 'photo') return this.photos.get(c.assetId) ?? null;
    const el = this.assigned.get(c.id) ?? this.videos.get(`ov:${c.id}`) ?? this.videos.get(this.pathOf(c));
    return el && el.readyState >= 2 ? el : null;
  }

  draw() {
    const p = this.p;
    if (!p) return;
    const frames = new Map<string, CanvasImageSource | null>();
    let missing = false;
    for (const v of visibleAt(p, this.time)) {
      const img = this.sourceOf(v.clip);
      frames.set(v.clip.id, img);
      if (v.main && !img) missing = true;
    }
    if (missing && this.playing) return; // keep the last frame while the next clip seeks
    const ctx = this.canvas.getContext('2d')!;
    this.textBoxes = renderFrame(ctx, this.canvas.width, this.canvas.height, p, this.time, frames);
    const b = this.textBoxes.find((x) => x.id === this.selectedBox);
    if (!b) return;
    const px = devicePixelRatio;
    ctx.save();
    ctx.translate(b.cx, b.cy);
    ctx.rotate((b.rot * Math.PI) / 180);
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 2 * px;
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
  }

  resize(w: number, h: number) {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
    this.draw();
  }

  play(to?: Us) {
    const p = this.p;
    if (!p || this.playing) return;
    const end = projectDuration(p);
    if (to === undefined && this.time >= end - SEC / 100) this.time = 0;
    this.stopAt = Math.min(to ?? end, end);
    this.playing = true;
    void this.ac?.resume();
    this.clock = { at: performance.now(), t: this.time };
    this.sync();
    const loop = () => {
      this.time = Math.min(this.stopAt, this.clock.t + (performance.now() - this.clock.at) * 1000);
      if (this.time >= this.stopAt) return this.pause();
      this.sync();
      this.draw();
      this.onTick?.(this.time, true);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onTick?.(this.time, true);
  }

  playRange(from: Us, to: Us) {
    this.pause();
    this.time = Math.max(0, from);
    this.play(to);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.playing = false;
    this.sync();
    this.draw();
    this.onTick?.(this.time, false);
  }

  // Scrubbing stops playback; otherwise a running range preview would pull the time back to its end point.
  seek(t: Us) {
    if (!this.p) return;
    cancelAnimationFrame(this.raf);
    this.playing = false;
    this.time = Math.min(Math.max(0, Math.round(t)), projectDuration(this.p));
    this.sync();
    this.draw();
    this.onTick?.(this.time, false);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const img of this.photos.values()) img.close();
    for (const el of [...this.audios.values(), ...this.videos.values()]) el.pause();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
  }
}
