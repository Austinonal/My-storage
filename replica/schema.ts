// Project document format. One record per project in IndexedDB; media bytes in OPFS.
// Invariants are listed in replica/architecture.md ("Invariants").

export const SCHEMA_VERSION = 1;

export type Id = string; // crypto.randomUUID()
export type Us = number; // integer microseconds, the WebCodecs unit

export type Aspect = '9:16' | '16:9' | '1:1' | '3:4' | '4:3' | '2:1';
export type Fps = 24 | 25 | 30 | 50 | 60;

export interface Project {
  version: typeof SCHEMA_VERSION;
  id: Id;
  name: string;
  createdAt: string; // ISO 8601, UTC
  updatedAt: string;
  aspect: Aspect;
  fps: Fps;
  canvas: { kind: 'colour'; colour: string } | { kind: 'blur'; level: 1 | 2 | 3 | 4 };
  assets: Record<Id, MediaAsset>;
  tracks: Track[]; // tracks[0] is the main video track
  transitions: Transition[];
}

export interface MediaAsset {
  id: Id;
  kind: 'video' | 'photo' | 'audio';
  name: string;
  file: string; // OPFS path: media/<projectId>/<assetId>
  bytes: number;
  duration: Us; // 0 for photos
  width: number; // 0 for audio
  height: number;
  rotation: 0 | 90 | 180 | 270;
  hasAudio: boolean;
  reversedFile?: string; // proxy built on first Reverse
}

export interface Track {
  id: Id;
  kind: 'main' | 'audio' | 'text';
  muted: boolean;
  hidden: boolean;
  clips: Clip[]; // sorted by start, never overlapping
}

export type Clip = MediaClip | TextClip | AudioClip;

interface ClipBase {
  id: Id;
  start: Us; // on the timeline
  duration: Us; // on the timeline, after speed
  keyframes: Keyframe[];
}

export interface Transform {
  x: number; // centre, canvas-relative: 0 = left edge, 1 = right edge
  y: number;
  scale: number; // 1 = fit canvas
  rotation: number; // degrees
  opacity: number; // 0..1
}

export interface Anim {
  presetId: string;
  duration: Us;
}

export interface MediaClip extends ClipBase {
  kind: 'video' | 'photo';
  assetId: Id;
  sourceIn: Us; // 0 for photos
  speed: number; // 0.1..100; source span = duration * speed
  reversed: boolean;
  volume: number; // 0..2, 1 = 100 %
  transform: Transform;
  crop: { x: number; y: number; w: number; h: number; rotate: 0 | 90 | 180 | 270; mirror: boolean };
  filter: { presetId: string; intensity: number } | null; // intensity 0..1
  adjust: Adjust;
}

export interface Adjust {
  brightness: number; // each -100..100, 0 = unchanged
  contrast: number;
  saturation: number;
  exposure: number;
  sharpen: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
}

export interface TextClip extends ClipBase {
  kind: 'text';
  text: string;
  style: TextStyle;
  transform: Transform;
  animIn: Anim | null;
  animOut: Anim | null;
  animLoop: Anim | null; // exclusive with animIn / animOut
}

export interface TextStyle {
  fontId: string;
  size: number; // px at 1080p canvas height
  colour: string; // #rrggbbaa
  align: 'left' | 'center' | 'right';
  stroke: { colour: string; width: number } | null;
  shadow: { colour: string; blur: number; dx: number; dy: number } | null;
  background: { colour: string; radius: number } | null;
}

export interface AudioClip extends ClipBase {
  kind: 'audio';
  assetId: Id; // an audio asset, or a video asset for extracted sound
  sourceIn: Us;
  speed: number;
  volume: number;
  fadeIn: Us;
  fadeOut: Us;
}

export type KeyframeProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface Keyframe {
  at: Us; // offset from clip start
  prop: KeyframeProp;
  value: number;
  easing: Easing; // curve from this keyframe to the next
}

export interface Transition {
  id: Id;
  fromClipId: Id; // adjacent main-track clips
  toClipId: Id;
  presetId: string;
  duration: Us;
}

export interface ExportSettings {
  height: 720 | 1080 | 1440 | 2160; // width follows the aspect
  fps: Fps;
  bitrate: 'low' | 'medium' | 'high';
  codec: 'avc' | 'hevc';
}
