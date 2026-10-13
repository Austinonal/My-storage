# Build log

Parity after each milestone comes from `python3 .claude/skills/replica-diff/parity.py replica/features.csv`.

## 2026-10-13 — text, colour, a friendlier timeline, sharper templates, gallery save, worker export (parity 50.9, must-haves 22 of 34)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| S09 Text | done | text templates, custom font import, auto captions | Thai has no spaces: lines wrap on the browser's Thai word dictionary and never inside a letter cluster |
| S17 Filters | done | a filter layer on the timeline | none |
| S18 Adjust | done | keyframes on adjust | none |
| S03 Timeline | done | overlay track, keyframes | audio snapped to the end of the video rather than the playhead when that edge was closer; that is the right call, the test was wrong |
| S24 Animations | done | art/particle presets | a shape reveal must cover the whole frame before it switches off; cover factors measured per shape and unit-tested |
| S27 Export | done | true background export with the app closed (Android pauses a WebView); unverified on a phone | fonts, LUTs and WebGL all had to work inside a worker |
| Template sheet | better | real overlapping cross-dissolves (read back as fade out + fade in) | rotation estimates had to reject slides and mixed frames |

- **Text**: the "ข้อความ" tool adds text at the playhead (copying the look of the previous one, so subtitles stay consistent); "ซับถัดไป" adds the next subtitle right after. 7 bundled Thai fonts (OFL), 12 looks, colour + opacity, stroke, shadow, background, size, alignment, top/middle/bottom, rotation, zoom. On the preview: tap to select, drag to move (snaps to the centre line), two fingers to scale and turn. Per-letter animations redraw the text every frame; static text is cached.
- **Colour**: one WebGL2 pass per frame (adjust, then the filter's 33³ LUT mixed by intensity), used by the preview and the export. 24 built-in looks are generated from small colour functions (no image assets); your own `.cube` files import into a library kept on the device.
- **Timeline**: filmstrips (one frame per second of source, cached per asset) and audio waveforms; edge handles on the selected clip trim videos and audio (source range), photos and text (length); audio and text trimmed at the left keep the rest in place; edges and dragged clips snap to the playhead, the video's ends and other clips' edges with a guide line; pinch or ctrl+wheel zooms.
- **Template**: turns are read from an angular profile around the centre (spin, pendulum, slow tilt and card spin); cross-dissolves are found as runs of frames that are a growing mix of two different pictures, and split in their middle.
- **Export**: the soundtrack is mixed on the main thread (workers have no OfflineAudioContext) and handed to a worker that renders, encodes and writes the MP4; if the worker cannot start, the export runs on the main thread. The screen stays on during export. 1080p 60 fps exported and probed. In the APK, "บันทึกลงเครื่อง" copies the video into the gallery album Movies/Editor (Documents if the gallery refuses), and "แชร์" opens the Android share sheet.
- Checked: 39 unit tests; eight e2e suites in Chromium (slice, animations, timeline, timeline 2, template with two ffmpeg references, text, colour, 1080p60 export) with zero errors; text, colour and audio verified in the exported files; the page kept 60 fps while the worker exported.
- Not verified: anything on a real phone (gallery save, share sheet, WebGL and fonts inside the worker on the Android WebView, export speed, H.264/AAC).

## 2026-10-13 — template from any edited clip (our own addition)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| Template sheet | done | dissolves between shots are not detected as cuts; rotation (spin) not measured; art/particle effects cannot be matched | the end of a slide looked like a cut, a fade looked like a cut, the test pattern's own motion looked like an effect, slow zooms were below per-frame precision; fixed with a structure-only cut score, a "cuts are sudden" rule, a per-shot motion baseline, and 0.2 s-spaced measurement for combos |
| S04 Replace | done | none | none |

- How it works (all on the device, `analyze.ts` + `reference.ts`): decode the reference at 64 px wide; per frame a colour histogram, a brightness-normalised thumbnail, row/column brightness profiles and sharpness. Cuts = sudden layout changes, ignoring flashes and fades, plus black gaps. Motion = scale and shift from the 1-D profiles (coarse ±16 px, then fine 0.25 px / 0.5 %). Each shot's start and end are matched to our presets: slide (4 directions), spring, shake, zoom in/out, fade, from/to black, flash, blur; whole-shot motion to slow zoom in/out, pan, jitter, earthquake, beat zoom.
- Apply: your clips fill the first slots in order, the rest become dashed "empty" slots; each slot takes the detected animation; optional: add the reference's sound (off by default, for music you may use). Replace swaps a slot's picture/video and keeps its length and animations. Export warns while empty slots remain.
- Checked: 26 unit tests (synthetic shots with known motion; the full catalogue); e2e on a 4-shot ffmpeg reference with known edits: all 4 cuts at exactly 1.5 s and every effect matched (from black, slow zoom in, slide from the right, to black), analysis 1.4 s for 6 s of video; the app's own exports read back correctly (zoom-in + fade-out; spring from the left + a plain cut); all four e2e suites green, zero console errors.

## 2026-10-13 — timeline: photos, audio, move, split, delete; more animations (parity 27.9, must-haves 12 of 34)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| S03 Editor + timeline | partial | pinch zoom, trim handles on the timeline, thumbnails/waveforms on clips, overlay track | scrubbing during a playing preview was yanked back by the playhead auto-follow; fixed by pausing on any touch/wheel on the timeline and on seek |
| S04 Clip tools | partial | speed, reverse, crop, freeze, replace | tool sheets were modal, so undo/play/timeline were dead while trimming; made them non-modal panels |
| S07/S08 Audio | partial | fades, voiceover recording, voice effects, beats | none |
| S24 Clip animations | done | art/particle presets | none |

- Main track holds videos and photos (photos default 3 s, 0.5-20 s); the audio track(s) hold music or the sound of any video (= extract audio). Overlapping audio opens a new track.
- Move: select a clip, then drag it (audio moves in time, main clips reorder), or use the arrow keys (audio ±0.1 s, Shift ±1 s; main clips one place). Split at the playhead, delete, volume 0-200 %.
- Player: one clock drives every clip's media element with drift correction; the canvas is drawn by the same compositor as the export.
- Export: photos rendered per frame; audio from main-track videos and audio tracks mixed at their start times; the video ends with the main track.
- Animations: 287 presets (100 In / 86 Out / 101 Combo), new effects (hue, saturation, sepia, contrast) and reveals (clock, checkerboard, circle from a corner).
- Checked: 20 unit tests; three e2e runs in Chromium (slice, animations, timeline) with zero console errors; the timeline export verified with ffprobe: 5.0 s, photo at 1.5 s, video at 4 s, silence before the music, music from its dragged start at 2.5 s, music + video sound mixed after 3 s.

## 2026-10-13 — CI: APK + web on GitHub

- `.github/workflows/editor.yml`, on every push to the default branch: tests + build (`web`), deploy `editor/dist` to GitHub Pages (`pages`), and a Capacitor debug APK (`android`) attached to the rolling `editor-latest` release.
- The Android project is generated in CI (`npx cap add android`) from the pinned `@capacitor/android`, not committed. Commit it once it needs native edits (permissions, icons).
- In the APK, "save" writes the export to the phone's public **Documents** folder in 3 MB chunks (the WebView cannot download blobs). No permission prompt on Android 11+; Android 10 and older are not supported for saving.
- Pages needs a one-time switch by the repo owner: Settings → Pages → Source: GitHub Actions. Until then the `pages` job fails with 404.
- Not verified yet: the APK on a real phone (file picker, OPFS, WebCodecs H.264 in the WebView, export speed, the saved file showing up in Files/Gallery).

## 2026-10-13 — clip animations In / Out / Combo (S24)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| S24 Clip animations | done | the original's art/particle presets (fire, hearts, magic, liquid glass, 3D phone): need WebGL and our own artwork | the duration slider's minimum (one frame) was off its 0.1 s step grid, so every value snapped by 0.033 s; fixed |

- Research in `replica/animations.md`: the original has 251 In, 219 Out, 108 Combo clip presets (most In/Out ones paid and asset-based).
- Ours: **181 presets (60 In, 51 Out, 70 Combo)**, every motion mechanism the original uses (slide, swing, turn, zoom, spin, shake, pendulum, flip, jelly, blur, black-and-white, flash, negative, mosaic, glitch strips, blinds, wiper, curtain, circle, diagonal, split screens, clones, trains, stacks, cube).
- Engine: `anim.ts` (poses, easings, presets) + `render.ts` (one Canvas 2D compositor). The editor preview is now a canvas drawn by the same compositor as the export, so what you see is what exports. PixiJS is no longer needed for this; revisit only for LUT filters and shader effects.
- Rules: In starts on the first frame, Out ends on the last, Combo replaces both; picking one clears the other; durations clamp to the clip and squeeze proportionally when the clip is trimmed.
- Checked: 14 unit tests (every preset finite everywhere, every In ends exactly at rest, every Out starts at rest); e2e in Chromium (preview dims during zoom-in and returns, combo clears In, duration slider exact, export contains the animation: brightness 22 → 125 over the 0.5 s zoom-in and 103 → 20 over the 1 s fade-out); zero console errors; the slice e2e still passes.
- Text In / Out / Loop (typewriter, per-letter) reuse this engine when text layers are built.

## 2026-10-13 — shell + vertical slice (parity 11.8, must-haves 4 of 34)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| S01 Home | partial | cover thumbnail, rename/duplicate/delete | none |
| S02 Media picker | system picker | multi-select, photos; it is the OS picker, not our screen (the `#/new` route was dropped) | none |
| S03 Editor | partial | the slice edits one clip with in/out sliders; timeline, tools, bottom toolbar come in milestone 2.1 | preview and export were one frame apart at the in point: containers round timestamps (WebM to 1 ms), fixed with a shared 1 ms nudge |
| S26 Export settings | partial | bitrate, codec choice, file-size estimate | none |
| S27 Export progress | partial | save to gallery (needs the APK); share is Web Share, unverified on a phone | none |

Verified in headless Chromium (Playwright), 390 px and 1440 px:
keyboard-only import, trim, undo/redo, slider arrows, playback stops at the
out point, autosave survives reload, export 720p at 30 fps, download,
not-found and unsupported-codec states, zero console errors. The exported file
was checked with ffprobe (720x1280, 30 fps, 2.03 s = the trim) and its first
frame matched the source frame at the in point.

Not verified, and why:
- **H.264 / AAC.** Open-source Chromium has no H.264 decoder or AAC encoder,
  so tests ran on VP9/Opus input and the export fell back to VP9/Opus in MP4.
  Phone videos are H.264/HEVC + AAC: this must be checked in real Chrome or
  on the phone.
- **The APK.** This container has no Android SDK and `dl.google.com` is
  blocked, so Capacitor cannot build here.
- **Export speed** on a real phone (target: 30 s of 1080p in under 60 s).

Shortcuts in the code (each has a `shortcut:` comment):
- media is copied into OPFS (doubles storage on the phone)
- the audio mix renders in memory (about 23 MB per stereo minute)
- export renders main-track video clips only, with a 2D canvas; PixiJS
  comes in with text and transitions
- the editor edits the first clip only
