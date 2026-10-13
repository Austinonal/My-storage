import type { AudioClip, MediaClip, Project, Us } from './schema';
import { openMedia } from './media';
import { renderFrame, type TextBox } from './render';
import { loadFonts } from './fonts';
import { FRAME_NUDGE, SEC, projectDuration } from './timeline.ts';

type Source = { kind: 'video'; el: HTMLVideoElement } | { kind: 'photo'; img: ImageBitmap };

// Plays a project in a canvas: one clock, every media element follows it and is corrected when it drifts.
export class Player {
  time: Us = 0;
  playing = false;
  onTick?: (t: Us, playing: boolean) => void;
  onError?: (e: unknown) => void;
  textBoxes: TextBox[] = []; // where text was drawn last, in canvas pixels
  selectedText: string | null = null; // framed in the preview only, never in the export

  private p: Project | null = null;
  private sources = new Map<string, Source>(); // main-track media, by asset id
  private audios = new Map<string, HTMLAudioElement>(); // audio-track clips, by clip id
  private urls = new Map<string, string>();
  private loading = new Set<string>();
  private raf = 0;
  private clock = { at: 0, t: 0 };
  private stopAt: Us = 0;

  constructor(private canvas: HTMLCanvasElement) {
    void loadFonts().then(() => this.draw());
  }

  setProject(p: Project) {
    this.p = p;
    const ids = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    for (const [id, el] of this.audios) {
      if (ids.has(id)) continue;
      el.pause();
      this.audios.delete(id);
    }
    this.time = Math.min(this.time, projectDuration(p));
    void this.load(p);
    this.sync();
    this.draw();
  }

  private async url(assetId: string) {
    let u = this.urls.get(assetId);
    if (!u) {
      u = URL.createObjectURL(await openMedia(this.p!.assets[assetId].file));
      this.urls.set(assetId, u);
    }
    return u;
  }

  private async load(p: Project) {
    const jobs: [string, () => Promise<void>][] = [];
    for (const c of p.tracks[0].clips as MediaClip[]) {
      const asset = p.assets[c.assetId];
      jobs.push([c.assetId, async () => {
        if (this.sources.has(asset.id)) return;
        if (asset.kind === 'photo') {
          this.sources.set(asset.id, { kind: 'photo', img: await createImageBitmap(await openMedia(asset.file)) });
          return;
        }
        const el = document.createElement('video');
        el.preload = 'auto';
        el.playsInline = true;
        el.addEventListener('seeked', () => this.draw());
        el.addEventListener('loadeddata', () => this.draw());
        el.src = await this.url(asset.id);
        this.sources.set(asset.id, { kind: 'video', el });
      }]);
    }
    for (const t of p.tracks.slice(1)) {
      for (const c of t.clips) {
        if (c.kind !== 'audio') continue;
        jobs.push([c.id, async () => {
          if (this.audios.has(c.id)) return;
          const el = new Audio(await this.url(c.assetId));
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

  private mainAt(t: Us): MediaClip | undefined {
    const clips = this.p!.tracks[0].clips as MediaClip[];
    return clips.find((c) => t >= c.start && t < c.start + c.duration) ?? clips.at(-1);
  }

  private follow(el: HTMLMediaElement, c: MediaClip | AudioClip | null, muted: boolean) {
    if (!c) {
      if (!el.paused) el.pause();
      return;
    }
    const want = (c.sourceIn + (this.time - c.start) * c.speed) / SEC + FRAME_NUDGE;
    el.playbackRate = Math.min(16, Math.max(0.0625, c.speed));
    el.volume = Math.min(1, c.volume); // shortcut: preview caps volume at 100 %; the export uses the real gain
    el.muted = muted;
    if (this.playing) {
      if (Math.abs(el.currentTime - want) > 0.2) el.currentTime = want;
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.001) el.currentTime = want;
    }
  }

  private sync() {
    const p = this.p;
    if (!p) return;
    const t = this.time;
    const main = this.mainAt(t);
    for (const [assetId, s] of this.sources) {
      if (s.kind === 'video') this.follow(s.el, main?.assetId === assetId && t < main.start + main.duration ? main : null, p.tracks[0].muted);
    }
    for (const track of p.tracks.slice(1)) {
      for (const c of track.clips) {
        const el = this.audios.get(c.id);
        if (el && c.kind === 'audio') this.follow(el, t >= c.start && t < c.start + c.duration ? c : null, track.muted);
      }
    }
  }

  // The frame source for a main-track clip, for thumbnails and stills.
  sourceOf(c: MediaClip): CanvasImageSource | null {
    const s = this.sources.get(c.assetId);
    if (!s) return null;
    return s.kind === 'photo' ? s.img : s.el.readyState >= 2 ? s.el : null;
  }

  draw() {
    const p = this.p;
    if (!p) return;
    const clip = this.mainAt(this.time);
    const img = clip ? this.sourceOf(clip) : null;
    if (!img && this.playing) return; // keep the last frame while the next clip seeks
    const ctx = this.canvas.getContext('2d')!;
    this.textBoxes = renderFrame(ctx, this.canvas.width, this.canvas.height, p, this.time, clip, img);
    const b = this.textBoxes.find((x) => x.id === this.selectedText);
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
    for (const s of this.sources.values()) {
      if (s.kind === 'video') s.el.pause();
      else s.img.close();
    }
    for (const el of this.audios.values()) el.pause();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
  }
}
