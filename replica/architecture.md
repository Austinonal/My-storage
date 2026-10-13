# Architecture: a personal video editor (a rebuild of CapCut's core editing features)

Reads `replica/recon.md` and `replica/features.csv`. Scope is the v1 slice
from the recon (size L): timeline, trim/split/speed/reverse/crop, transitions,
text with In / Out / Loop animations, filters + adjust, music / extract /
voiceover / fades, keyframes, aspect ratio + canvas, export up to 1080p.

Platforms: Android (APK) and the web, from **one codebase**.

## The big decision: one web app, wrapped for Android

The editor is a web app built on WebCodecs + WebGL. Capacitor wraps the same
build into an Android APK. One codebase, two platforms, no server.

Why not native Kotlin plus a separate web app: that is two editors, two
render engines and two sets of bugs for one person to maintain. Android's
WebView is Chromium, so WebCodecs (hardware H.264 encode/decode) and WebGL2
are there on Android 10+.

The escape hatch, if export in the WebView is too slow on your phone: keep
everything else and replace only the export step on Android with a small
Capacitor plugin around Media3 Transformer (native). The project format
below is the contract between the two, so nothing else changes. Decide this
after the vertical slice, on your real phone, not before.

## Stack

| layer | choice | why |
| --- | --- | --- |
| app | Vite + React + TypeScript, single-page app | no server needed; Vite builds a static bundle Capacitor can wrap |
| styling | Tailwind, tokens from `/replica-design` | |
| Android | Capacitor (current major) | wraps the same build into an APK; plugins for files, share, keep-awake |
| compositor (preview + export) | PixiJS v8 on WebGL2 | sprites, transforms, blend modes, masks, filters and text out of the box; GLSL for our own effects |
| read media | Mediabunny | demuxes MP4/MOV/WebM/MP3/M4A, gives frames and samples through WebCodecs, reads rotation |
| write MP4 | Mediabunny | muxes WebCodecs output into MP4; one library for both directions |
| encode | WebCodecs `VideoEncoder` / `AudioEncoder` | hardware H.264 (HEVC where supported); AAC, Opus fallback |
| audio mix | Web Audio API (`OfflineAudioContext` for export) | volume, fades and speed as gain/rate automation, no library |
| voiceover | `getUserMedia` + `MediaRecorder` | built in |
| state | one store module + `useSyncExternalStore`, undo = document snapshots | the project is a small JSON document; snapshots make undo/redo free |
| storage: projects | IndexedDB, one record per project | the timeline is a document, not relational data |
| storage: media | Origin Private File System (OPFS), a copy per imported file | file handles from the picker do not survive a restart, so drafts need their own copy |
| text | Canvas 2D text drawn to a Pixi texture | the browser does Thai and emoji shaping |
| fonts | Google Fonts under OFL (e.g. Noto Sans Thai, Kanit, Prompt, Sarabun) bundled in the app | Thai glyphs, free to ship |
| transitions | our own GLSL, starting from the MIT-licensed gl-transitions collection | dozens of transitions; check each file's licence header |
| filters | our own 3D LUTs (PNG strips) + colour matrices | filters are data |
| hosting (web) | any static host on HTTPS (Cloudflare Pages, Netlify, Vercel, GitHub Pages) | WebCodecs needs a secure context |
| database / auth / payments / email / jobs | **none** | a personal offline editor has no users, no paywall, no server |

Browser target: Chromium (Chrome, Edge, Android WebView). Safari and Firefox
are not targets for v1; WebCodecs coverage there is incomplete.

Pin exact versions of every dependency when `/replica-build` installs them.

## Schema

There is no server database. The "schema" is the project document format,
in `editor/src/schema.ts` (TypeScript types, schema version 1). Entities from
the recon map:

| recon entity | where it lives |
| --- | --- |
| Project | IndexedDB `projects` store, key `id` |
| MediaAsset | inside the project (`assets`), file bytes in OPFS at `media/<projectId>/<assetId>` |
| Track, Clip, TextStyle, AudioProps, Keyframe, Transition | inside the project document |
| Preset | static catalogue in code (`src/presets/`), referenced by `presetId` |
| ExportJob | runtime only, never stored |

Access rules: none needed. Everything is local to the device or browser
profile. Nothing leaves it except the exported file the user saves or shares.

Times are integer **microseconds** (`Us`), the unit WebCodecs uses, so split
and trim never accumulate rounding errors.

### Invariants (the timeline's "database constraints")

Every edit command runs `normalize()` and then `assertValid()` before the
new snapshot is committed. A command that breaks one is a bug, not a state.

1. Main track: clips sorted, no gaps, no overlaps (`start[i+1] == start[i] + duration[i]`). Delete closes the gap.
2. Other tracks: sorted, no overlaps. A new item that would overlap goes on a new track.
3. Video/audio clips: `sourceIn >= 0` and `sourceIn + duration * speed <= asset.duration`.
4. `0.1 <= speed <= 100`. Reverse is a flag, not a negative speed.
5. Every clip is at least one frame long (`1e6 / fps`).
6. A transition joins two **adjacent** main-track clips and lasts at most half of the shorter one. Deleting either clip deletes the transition.
7. `animIn.duration + animOut.duration <= clip.duration`. Loop is exclusive with In/Out: picking one clears the other.
8. Keyframe `at` is within `[0, clip.duration]`. A trim drops keyframes that fall outside.
9. Audio `fadeIn + fadeOut <= duration`.
10. Every `assetId` exists in `project.assets`. Every `presetId` that is no longer in the catalogue renders as "none", never crashes.

## API

No HTTP API. Two surfaces instead: the app's routes, and the edit commands
(every user action is one command on the project document, which is what
makes undo/redo and autosave one mechanism).

### Routes (hash routing, works the same in the browser and in the APK)

| route | screen | does | flow |
| --- | --- | --- | --- |
| `#/` | S01 | drafts grid, "+ New project" | F01, F16 |
| (none) | S02 | the OS file picker, opened from S01; S01 copies the file to OPFS and creates the project | F01 |
| `#/edit/:projectId` | S03-S25 | the editor; every tool is a bottom sheet over it | F02-F13 |
| `#/export/:projectId` | S26-S27 | export settings, progress, save / share | F01 |

### Edit commands

| command | input | changes | screens | flow |
| --- | --- | --- | --- | --- |
| `importMedia` | files | adds assets, copies to OPFS, appends clips to main track | S02 | F01 |
| `trimClip` | clipId, edge, newTime | sourceIn / duration | S04 | F02 |
| `splitAt` | clipId, time | one clip -> two, keyframes divided | S04 | F02 |
| `deleteClip` | clipId | removes clip (+ its transitions) | S04 | F02 |
| `moveClip` | clipId, toIndex or toTime, toTrack | order / start | S03 | F02 |
| `setSpeed` | clipId, speed | speed, duration | S05 | F03 |
| `setReversed` | clipId, bool | reversed (builds a reversed proxy, see below) | S04 | F03 |
| `setCrop` | clipId, crop | crop | S23 | |
| `setVolume` | clipId, volume | volume | S04, S08 | F06 |
| `setTransition` | fromClipId, presetId or null, duration | transitions | S06 | F04 |
| `addText` | text, at | new text clip on a text track | S09 | F05 |
| `updateText` | clipId, partial text/style/transform | text clip | S09 | F05 |
| `setAnim` | clipId, slot (in/out/loop), presetId or null, duration | anim slots | S09, S24 | F05 |
| `setFilter` | clipId, presetId or null, intensity | filter | S17 | F09 |
| `setAdjust` | clipId, partial adjust | adjust | S18 | F09 |
| `addAudio` | file or assetId, at | new audio clip | S07 | F06 |
| `extractAudio` | video assetId, at | new audio clip from the video's sound | S07 | F07 |
| `addVoiceover` | recorded blob, at | new asset + audio clip | S07 | F08 |
| `setFades` | clipId, fadeIn, fadeOut | fades | S08 | F06 |
| `setKeyframe` | clipId, at, prop, value, easing | keyframes (add or update) | S25 | F12 |
| `removeKeyframe` | clipId, at, prop | keyframes | S25 | F12 |
| `setAspect` | aspect | aspect | S19 | F13 |
| `setCanvas` | canvas | canvas | S20 | F13 |
| `undo` / `redo` | | swaps snapshots | S03 | all |
| `export` (not a command) | settings | writes an MP4, nothing in the document changes | S26-S27 | F01 |

Webhooks in / out: none. Jobs: autosave (debounced 500 ms after every
command, writes the document to IndexedDB) and lazy thumbnail / waveform
generation for the timeline, cached in OPFS.

## The parts that bite

- **Preview vs export drift**: preview and export must use the same
  compositor code. Preview may drop frames; export never does (it decodes
  every frame with WebCodecs and composes at the project fps).
- **Frame memory**: every `VideoFrame` must be `close()`d, or the decoder
  stalls and the app runs out of memory. A 4K frame is ~33 MB.
- **Phone footage**: variable frame rate and rotation metadata (portrait
  video stored sideways). Map frames by timestamp, never by index; apply
  rotation from the container.
- **Codec support**: HEVC sources decode only where the device's hardware
  allows it in the WebView. Check `VideoDecoder.isConfigSupported` on
  import and say so clearly instead of failing at export. AAC encoding:
  check `AudioEncoder.isConfigSupported` in the vertical slice; fall back to
  Opus in MP4.
- **Reverse**: decoding backwards is slow (GOPs). Build a reversed proxy file
  once, in the background, when the user taps Reverse.
- **Android backgrounding**: the WebView pauses when the app goes to the
  background, so export stalls. v1: keep the screen awake during export and
  tell the user to stay in the app. Later: the native export plugin with a
  foreground service.
- **Storage**: copying a 1 GB video into OPFS doubles its size on the phone.
  Show storage used per draft; deleting a draft deletes its media. Ask for
  persistent storage (`navigator.storage.persist()`) so the browser does not
  evict drafts.
- **Audio speed**: changing `playbackRate` changes pitch. Pitch-preserved
  speed is a should-have, after v1.
- **Thai text**: shaping is fine through Canvas 2D; the bundled fonts must
  cover Thai, Latin and emoji fall back to the system emoji font.
- **Licences**: every preset (shader, LUT, font, sticker) we ship needs a
  licence we can name. Keep a `LICENCES.md` next to the presets.
- Not applicable: time zones, idempotency, payments, auth, email, multi-tenancy, GDPR (no data leaves the device).

## Build order

1. **Vertical slice (proves the stack on your phone):** S01 -> S02 -> S03 -> S26 -> S27.
   Import one video, trim it, export 720p MP4, save to gallery, **as an APK on your
   real Android phone and in Chrome**. Document: Project, MediaAsset, one main Track,
   MediaClip. Commands: `importMedia`, `trimClip`, `export`. Routes: all four.
   Checks: WebCodecs H.264 encode works in the WebView, AAC or Opus, export speed
   (target: a 30 s 1080p clip exports in under 60 s). Decide here on the native
   export escape hatch.
2. **Must-haves**, by area:
   1. Timeline: multi-clip, split, delete, reorder, undo/redo, play/pause, drafts + autosave (S01, S03, S04).
   2. Clip: speed 0.1x-100x, reverse, crop/rotate/mirror, volume/mute (S04, S05, S23).
   3. Text: add/edit, fonts (Thai), In / Out / Loop animations with duration (S09).
   4. Transitions with duration (S06), filters with intensity (S17), adjust basics (S18).
   5. Audio: own music, extract audio, voiceover, volume, fades, split/trim/delete (S07, S08).
   6. Keyframes for position / scale / rotation / opacity (S25).
   7. Aspect ratio + canvas colour / blur (S19, S20).
   8. Export: 720p / 1080p, 24-60 fps, progress, cancel, save to gallery (S26, S27).
3. **Should-haves:** speed curves, freeze frame, replace clip, clip In/Out/Combo
   animations (S24), transition categories, text stroke/shadow/background, text
   templates, custom font import, waveforms, voice effects, noise reduction,
   pitch-preserved audio speed, 2K/4K, bitrate, share sheet, snapping, draft
   rename/duplicate/delete, missing-media warning, apply colour to all, keyframe easing.
   Then **v2**: overlay + blend + mask + chroma key, video effects, stickers,
   auto captions (on-device speech model), text-to-speech (needs a small native
   Android plugin: browser speech cannot be recorded into a file).
4. **Fixes from replica-entrepreneur:** after it runs.
