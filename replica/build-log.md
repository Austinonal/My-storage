# Build log

Parity after each milestone comes from `python3 .claude/skills/replica-diff/parity.py replica/features.csv`.

## 2026-10-13 — thumbnails: layer order, stickers, PNG; reading the reference better (parity 84.4, must-haves 33 of 34)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| Layer order | done | dragging layers in the list | the renderer drew all text after all pictures; it now draws pictures and text in track order (video projects look the same, their overlays already sit below text) |
| Stickers | partial | drawn sticker packs, animated stickers | none: an emoji is a text layer |
| PNG | done | none | none |
| Reference reading | done | Thai display fonts are read with small mistakes; "5" in some fonts reads as "S" | a label's rim (JPEG-darkened blue next to yellow) was drawn as letters; a spot at the picture's edge counted the area past it as black; a level word touching a collar looked tilted |

- **Layers**: "เลื่อนขึ้น" / "เลื่อนลง" on a selected picture or text; text can now sit under a picture.
- **Stickers** ("สติกเกอร์", in thumbnails and in the clip editor): 24 emoji and symbols, added as layers.
- **Export**: JPEG or PNG.
- **Reading the reference**: up to 8 text spots; tilted text keeps its slant; labels (letters on a filled box) keep the box; text over the person is found; every spot is read on the device (Tesseract, Thai + English, about 10 MB bundled, offline; the data ships unzipped because the Android build unzips .gz assets and renames them) and a spot that reads as nothing is dropped (busy textures); the words go into the text layer, sized and placed by the read lines.
- Measured on a reference made in the app (5 texts) and a gravel background with no text:

  | | truth | found |
  | --- | --- | --- |
  | TOP 5 (yellow, black outline) | 0.25, 0.22 | 0.25, 0.20, read "TOPS" |
  | ห้ามพลาด! (white, red outline, -10°) | 0.27, 0.62, -10° | 0.27, 0.60, -9°, read "ทห้ามพลาด!" |
  | สุดยอด (over the person) | 0.74, 0.86 | 0.74, 0.87, read "สุดยอด" |
  | 2026 (dark on a yellow label) | 0.90, 0.10 | 0.90, 0.10, label kept, read "2026" |
  | รีวิว (yellow, black outline) | 0.30, 0.88 | 0.30, 0.86, read "รีวิว" |
  | gravel, no text | 0 | 0 (with or without the reader) |

  Before this round the same picture gave 4 unread spots (the one over the person missed, the label in the wrong colours, no slant). Analysis took about 2.3 s here.
- Checked: 74 unit tests; the thumbnail suites (made by hand, from a reference, stickers, layer order, PNG) and the clip suites, zero errors.

## 2026-10-13 — thumbnails, and thumbnails laid out like any picture (our own addition)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| S01 Home | done | none | none |
| S33 Thumbnail editor | done | layer order (overlays stay under text), stickers, PNG | a draw promised before the editor closed (fonts, colours, the cutout model) hit pictures already closed; the player now forgets its project when it is destroyed |
| Reference layout | done | text that sits on the person, rotated text, more than four text spots | picking the outline colour by "the smaller part" fails for thick outlines; the outline is now the colour that touches the surroundings |

- **Home**: two choices at the top, "ตัดต่อคลิป" (as before) and "ทำปก (Thumbnail)" with its own list, "ปกใหม่จากรูป" and "ทำตามรูปต้นแบบ".
- **Thumbnail editor**: the same editor without time: a layer list instead of the timeline (background, pictures, text, effects), tools "เพิ่มรูป", "ข้อความ", "ทำตามต้นแบบ", "อัตราส่วน", "เอฟเฟกต์"; on a layer: replace, place, crop, filter, adjust, cut out the background, quality, delete. The background always fills the frame (after a new photo or a new shape). Export saves a JPEG (720p = 1280 × 720) to the gallery album Pictures/Editor, or shares it.
- **ทำตามรูปต้นแบบ**: the picture's shape, its person (a slot that cuts out whoever is put in), its big text (position, size, letter and outline colours) and, once the background is a real photo, its colours. Checked by making a thumbnail by hand (person at 0.74, 0.55; yellow "TOP 5" outlined in black at 0.27, 0.30), saving it, and using it as the reference: the slot came out at 0.72, 0.56 and the text at 0.27, 0.28, yellow (#f7d24f) outlined in near-black (#181a25).
- Checked: 71 unit tests (text spots and colours on a synthetic thumbnail with a texture and a person that must not count, the person box, frame shapes, the layout put into a project); the thumbnail e2e (make, save, copy, fill, save) and the clip suites again, zero errors.

## 2026-10-13 — smart tools: beats, silences, auto captions, cutout, tracking, reframe, effect layers (parity 83.9, must-haves 33 of 34)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| Beat sync | done | manual beat marks | an analysis step of 10 ms is a whole number of samples (221 at 22.05 kHz), not 10 ms: times drifted 23 ms by 10 s until they used the real step |
| Remove silences | done | curves / reversed clips | none |
| Auto captions | done | Thai accuracy unmeasured (no Thai speech here); English and Thai only in the picker | the model hub and the CDN are blocked in this sandbox: the test answers the hub's URLs from a local copy of the same files; the ONNX runtime now ships with the app |
| Person cutout | done | exports that use it render on the main thread | the export worker cannot load MediaPipe's classic loader; projects that need it skip the worker |
| Text behind person | done | none | none |
| Tracking | done | size and turn are not followed | none |
| Auto reframe | done | quarter-turned clips stay centred | none |
| Effect layers | done | blur, shake and zoom effects | none |

- **ตัดตามบีท** (on a music clip): finds the beats on the device (24 beats at 120 BPM on the test loop), shows them as yellow dots on the clip, clips and edges snap to them; "วางคลิปให้เปลี่ยนตรงบีท" re-times the main track so every cut lands on every 1, 2 or 4 beats (checked: cuts at 0.73 s, 1.73 s, 2.73 s, 3.73 s).
- **ลบช่วงเงียบ** (on a main-track video): pauses over 0.35 s go, 0.1 s kept around the words (checked: three pauses cut, 2.6 s shorter, exactly where the test clip was quiet).
- **ซับอัตโนมัติ** (in คำบรรยาย): Whisper base in a worker; the model (about 80 MB) downloads once and stays cached; Thai or English; long stretches are split between words with the browser's Thai word breaker.
- **ตัดพื้นหลัง** (on a video, photo or overlay): remove, blur or swap the background for a photo; **ไว้หลังคน** (text position tab) puts text behind the person.
- **ติดตาม** (on a text or overlay): tap a spot on the preview; it follows from the playhead to the end of the clip and becomes position keyframes (checked: +0.49 of the frame in 2.4 s on a clip panning 0.195 frames per second).
- **จัดเฟรมอัตโนมัติตามตัวคน** (in อัตราส่วน): wide clips fill a narrower frame and slide to keep the person in the middle.
- **เอฟเฟกต์** (main toolbar): VHS, glitch, light leak, film dust and scan lines as clips on their own track, over everything below while they run.
- Checked: 68 unit tests; new e2e suites for effects, beats + silences, cutout + text behind, tracking + reframe, auto captions; the earlier suites (reverse, transitions, voiceover, overlays, text, captions, quality, colour, templates) still pass with zero errors. Screens: S28–S32 in `clone-screens/`.

## 2026-10-13 — the basics every editor has (parity 80.4, must-haves 33 of 34)

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| S01 Projects | done | none | duplicating has to copy every media file into the new project's folder |
| Keyframes | done | keyframes on volume, filters, adjust | edits had to land on "the keyframe at the playhead" from three places (drag/pinch, the placement sheet, the text sheet) |
| S06 Transitions | done | 3D and distortion styles | the export decoded one clip at a time; now every clip that shows in a frame is pulled in step (two during a transition) |
| Speed + curves | done | pitch-kept audio at other speeds | a curve is relative, so length and recording range never change; the sound follows the same curve |
| Reverse | done | none | decoders only run forwards: a reversed copy is made half a second at a time from the end |
| Freeze, crop | done | none | none |
| Aspect + background | done | image backgrounds | none |
| S07 Sound | done | noise reduction, pitch-kept speed | voice effects first came out ~7 dB quieter; made up |
| Voiceover | done | not tried on a phone (needs the microphone permission, added to the APK) | none |

- **Projects**: covers on the home list; "⋯" on a project: rename, duplicate (copies its media), delete (asks again).
- **Aspect & background** ("อัตราส่วน"): 9:16, 16:9, 1:1, 3:4, 4:3, 4:5, 2:1; background colour or the clip itself blurred behind (4 levels).
- **Clip tools**: speed 0.1x–100x (the clip gets shorter/longer), speed curves (8 presets + drag the points; length stays), reverse (a reversed copy is made once per video), freeze (3 s still at the playhead), crop (free or 9:16 / 1:1 / 4:5 / 16:9), quarter turns, mirror. Main clips can now be moved and zoomed too ("จัดวาง", or drag/pinch on the preview when selected).
- **Keyframes**: the ◆ button next to the time adds or removes a keyframe at the playhead for the selected clip or text; any move, pinch or slider change after that lands on the keyframe at the playhead (made if needed); four easings per keyframe; diamonds on the timeline.
- **Transitions**: the ⇄ button on every cut on the main track: 18 transitions (dissolve, through black/white, slides, zooms, blur, spin, glitch, flash, wipe, circle, heart, star, clock), length, "apply to every cut". The template's cross-dissolves now come out as real dissolves.
- **Sound** ("เสียง"): volume, fade in, fade out, voice (high, low, robot, echo, radio), "แยกเสียง" (video sound to its own audio clip). **Voiceover** ("พากย์เสียง"): records the microphone while the video plays silently from the playhead.
- Checked: 56 unit tests (timing, keyframes, transitions model, speed, crop, freeze, fades, extract); 15 e2e suites with zero errors; measured in exported files: reversed frames match the source backwards (0.3 s ↔ 3.6 s, 1 s ↔ 3 s, 2 s ↔ 2 s, 3 s ↔ 1 s), the slide transition is half-and-half at the cut, fades -38 → -21 → -38 dB, the high voice is 1.41× the pitch and the low one 0.72×, the voiceover lands at 4 s.

## 2026-10-13 — phone fixes, ปรับแก้, picture in picture, captions, video quality

| ID | status | missing | harder than expected |
| --- | --- | --- | --- |
| Safe areas | done | landscape not checked | Android 15 draws apps under the status and navigation bars; the export button sat under the clock. Capacitor 8 passes the bar sizes as CSS variables; the top bar, toolbars and sheets now pad by them |
| S18 ปรับแก้ | done | keyframes on adjust | none |
| Colour match | done | per-shot matching inside one clip | none |
| Overlay (PiP) | done | blend modes, masks, chroma key | the export decoded one clip at a time; overlays need their own decoders pulled in step with the main track |
| Captions | done | speech-to-text (needs an on-device model) | none |
| Video quality | done | AI upscaling ("Ultra HD" in the original needs a model and a server) | none |

- **Phone layout**: everything that can be tapped now clears the status bar and the navigation buttons (checked with simulated 36 px / 48 px bars: no button underneath); status bar icons are light on the dark app.
- **ปรับแก้**: 15 sliders (brightness, exposure, contrast, saturation, ambient light, sharpen = fine detail, clarity = overall local contrast, highlights, shadows, whites, blacks, temperature, tint, fade, vignette), HSL for 8 colours × hue/saturation/lightness, curves (white = all channels, red, green, blue; tap to add, drag off to remove, keyboard arrows), colour wheels for shadows / midtones / highlights with a brightness slider each, and colour match: pick any photo or clip and the clip takes on its colours (Lab statistics transfer baked into a LUT; a flat blue reference gives exactly its colour, 32,80,192).
- **Picture in picture**: "ภาพซ้อน" adds a photo or video at the playhead on an overlay track (under text). Drag and pinch on the preview, or size / turn / opacity in "จัดวาง"; every clip tool works on overlays (filters, ปรับแก้, animations, trim, split, volume, replace).
- **Captions**: "คำบรรยาย" lists every caption with its time (tap to jump, edit, delete); paste many lines to make back-to-back captions of a chosen length; import .srt or .vtt. New captions copy the look of the latest one.
- **Video quality** ("คุณภาพ"): enhance (auto levels from eight frames + a little sharpen, clarity, saturation), stabilize light / strong (records the picture's drift once per video, follows a smoothed path, zooms 6 % / 12 % to hide edges), deflicker (brightness gain to the local average), and 2K / 4K export.
- Checked: 49 unit tests; 13 e2e suites in Chromium with zero errors; measured on exported files: shake 10.2 → 3.5 px per frame, flicker 21 → 2 brightness steps per frame, 2K = 1440×2560, overlays and colour match match the preview.
- Not verified on a phone yet: everything above, plus 4K encoding (phone-dependent).

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
