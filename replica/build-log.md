# Build log

Parity after each milestone comes from `python3 .claude/skills/replica-diff/parity.py replica/features.csv`.

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
