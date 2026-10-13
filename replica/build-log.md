# Build log

Parity after each milestone comes from `python3 .claude/skills/replica-diff/parity.py replica/features.csv`.

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
