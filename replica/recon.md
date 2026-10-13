# Recon map: CapCut - Video Editor (Android, `com.lemon.lvoverseas`)

Scope: the core mobile video editor. Import clips, multi-track timeline (trim,
split, speed, reverse, freeze, crop), transitions, filters, adjust, video
effects, overlay with blend/mask/chroma key, keyframes, text with In / Out /
Loop (combo) animations, audio (music, extract, voiceover, volume, fades,
voice effects), aspect ratio and canvas, export. Templates, cloud, community
and the Pro store are out.
For: the user's own personal editor, free to use, no subscription.
Date: 2026-10-13

## How this was gathered

- Public sources only, through web search. This container's network policy
  blocked direct reads of `play.google.com`, `apps.apple.com` and
  `www.capcut.com`, so the store listing and help center were read through
  search results, not page by page. No screenshots were saved, so
  `replica/screens/` is empty.
- The decompiled APK the user uploaded earlier was not used (it was empty
  anyway). Clean-room rule: no decompiled code, no private APIs, no assets.
- No account was used.
- Confidence labels: **high** = the Play listing or a CapCut-hosted page says
  it. **medium** = several third-party tutorials agree. **guess** = prior
  knowledge of the app or a single weak source. Confirm guesses by opening
  the app on your own phone.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Google Play listing (via search) | https://play.google.com/store/apps/details?id=com.lemon.lvoverseas&hl=en | feature groups: basic, advanced, intelligent, text/effects/audio, export |
| 2 | App Store listing (via search) | https://apps.apple.com/us/app/-/id1500855883 | same feature text: speed 0.1x-100x, curves, chroma key, keyframes, stabilize |
| 3 | CapCut help: why some features are paid | https://www.capcut.com/help/features-needs-to-paid | free trials ending, features moving to paid |
| 4 | CapCut help: future paid features | https://www.capcut.com/help/payment-for-additional-features | |
| 5 | CapCut free transitions page | https://capcut.com/tools/free-video-transitions | transition categories |
| 6 | CapCut keyframes guide | https://www.capcut.com/resource/how-to-add-keyframes-in-capcut | position, scale, opacity keyframes |
| 7 | CapCut blend modes page | https://www.capcut.com/create/blend-modes-creative-video-photo-effects | blend families |
| 8 | CapCut colour grading guide | https://www.capcut.com/resource/capcut-color-grading | adjust sliders |
| 9 | CapCut help: overexposed video | https://www.capcut.com/help/correct-overexposed-video | highlights, shadows, contrast |
| 10 | CapCut change background page | https://www.capcut.com/tools/change-video-background | canvas: colour, pattern, image, blur |
| 11 | CapCut video resizer | https://www.capcut.com/tools/video-resizer | aspect ratio presets |
| 12 | CapCut voice changer resource | https://www.capcut.com/resource/how-to-change-your-voice | voice filter groups |
| 13 | CapCut help: alternative effects | https://www.capcut.com/help/recommended-alternative-effects | effects catalogue changes |
| 14 | TikTok Ads help: About CapCut | https://ads.tiktok.com/help/article/about-capcut | text templates, auto captions |
| 15 | Hollyland CapCut guide | https://www.hollyland.com/blog/topics/capcut-video-editing | context-sensitive bottom toolbar |
| 16 | Tutsplus CapCut tutorial | https://photography.tutsplus.com/tutorials/how-to-quickly-use-capcut-for-video-editing-tutorial-2024--cms-108707 | toolbar items, adjust |
| 17 | Tutsplus body effects guide | https://photography.tutsplus.com/tutorials/a-complete-guide-to-body-effects-in-capcut--cms-108858 | body effects |
| 18 | Metricool CapCut tutorial | https://metricool.com/capcut-video-editing/ | clip toolbar: split, reverse, crop, freeze, speed, volume, replace |
| 19 | Shotkit: add text in CapCut | https://shotkit.com/add-text-capcut/ | auto caption sources, templates |
| 20 | Miracamp: export high quality | https://www.miracamp.com/learn/capcut/how-to-export-high-quality-videos | export resolution, fps, bitrate |
| 21 | Miracamp: reverse a video | https://www.miracamp.com/learn/capcut/how-to-reverse-a-video | reverse |
| 22 | capcutguide.com effects | https://capcutguide.com/capcut-effects/ | video vs body effects, categories |
| 23 | capcutguide.com text animation | https://capcutguide.com/capcut-text-animation/ | In / Out / Loop |
| 24 | autoae.online text animation | https://autoae.online/blog/how-to-do-text-animation-in-capcut-pc | animation duration separate from layer length |
| 25 | Patreon: titles in CapCut | https://www.patreon.com/posts/creating-epic-in-92920336 | "Combo" as the third tab in older builds |
| 26 | vidpros: Pro vs free | https://vidpros.com/capcut-pro-vs-free/ | what is gated |
| 27 | eesel: CapCut pricing | https://eesel.ai/blog/capcut-pricing | Standard / Pro tiers |

## Core loop

Pick clips from the phone, cut them on a timeline, dress them up (text with
animations, transitions, filters, effects, music), export a vertical video.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen | conf. |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Home | app launch | start a project, reopen drafts | big "+ New project" button, drafts grid | empty (no drafts), filled | medium |
| S02 | Media picker | S01 "+" | pick videos, photos (and stock clips) | album tabs (video/photo), multi-select, "Add" | empty album, permission denied, filled | medium |
| S03 | Editor | after S02 | preview + timeline | video preview, play/pause, timecode, multi-track timeline, global bottom toolbar | empty track, filled, playing | high |
| S04 | Editor, clip selected | tap a clip on the timeline | edit one clip | context toolbar: Split, Speed, Volume, Animations, Delete, Crop, Reverse, Freeze, Mask, Chroma key, Stabilize, Replace, Filters, Adjust, Opacity/Blend; keyframe button over the timeline | default, nothing to undo | medium |
| S05 | Speed | S04 Speed | change clip speed | tabs Normal / Curve, 0.1x-100x slider, curve presets + custom curve editor, optical-flow toggle | default, custom curve | high |
| S06 | Transition picker | tap the marker between two clips | pick a transition | category tabs (Trending, Basic, Camera, Overlay, Light Effect, Split, Distortion, Glitch, Blur, Social Media, Slide, MG, Mask), thumbnail grid, duration slider | none selected, selected | high (categories) |
| S07 | Audio menu | S03 Audio | add sound | Sounds/music, Sound effects, Extract audio, Record (voiceover), Text-to-speech | empty library offline | medium |
| S08 | Audio clip panel | tap an audio clip | edit audio | volume, fade in/out sliders, voice effects, noise reduction, beats, split, speed, delete | default | medium |
| S09 | Text editor | S03 Text -> Add text | type and style text | keyboard, tabs: Fonts, Style (colour, stroke, shadow, background), Effects, Bubble, Animation (In / Out / Loop + duration) | empty text, filled | medium (style tabs guess) |
| S10 | Text templates | S03 Text -> Text template | pick a preset styled title | category tabs, grid | default | high |
| S11 | Auto captions | S03 Text -> Auto captions | captions from speech | source (audio / video / all), language, style template, bilingual, filler-word removal | processing, no speech found, done | medium |
| S12 | Text-to-speech | select a text -> Text-to-speech | turn text into a voice track | voice list by language, speed | processing, done | high |
| S13 | Stickers | S03 Stickers | add a sticker layer | search, category tabs, grid | default | medium |
| S14 | Overlay | S03 Overlay -> Add overlay | add a second video/photo layer | media picker reuse (S02), on-preview transform handles | default | medium |
| S15 | Blend / opacity | S04 on an overlay clip | blend layers | opacity slider, blend mode list | default | medium |
| S16 | Effects picker | S03 Effects | apply a video or body effect | tabs Video effects / Body effects, categories, grid, intensity | default | medium |
| S17 | Filters | S03 or S04 Filters | colour look | categories (e.g. Nature, Retro, Party), grid, intensity slider | none, applied | medium |
| S18 | Adjust | S03 or S04 Adjust | manual colour | brightness, contrast, saturation, exposure, sharpen, highlights, shadows, temperature, tint, HSL, curves | default, changed | medium |
| S19 | Aspect ratio | S03 Format / Aspect ratio | set canvas size | preset chips (9:16, 16:9, 1:1, 3:4, 4:3, 2:1; 4:5 unconfirmed) | default | high |
| S20 | Canvas | S03 Canvas | fill the empty area | Colour, Blur (levels), Image / pattern | default | high |
| S21 | Mask | S04 Mask | shape-cut a clip | shape list (rectangle, circle, star confirmed; linear, mirror, heart guess), feather, invert, on-preview handles | none, applied | medium |
| S22 | Chroma key | S04 Chroma key | remove a colour | colour picker on preview, intensity, shadow; plus auto background removal | default | high |
| S23 | Crop / rotate | S04 Crop | crop frame | crop box, ratio presets, rotate, mirror | default | medium |
| S24 | Clip animations | S04 Animations | animate a clip in / out | tabs In / Out / Combo, grid, duration slider | none, applied | medium |
| S25 | Keyframe mode | S04 keyframe button | animate any property over time | add/remove keyframe diamond on timeline, easing curve picker | no keyframes, keyframes | high |
| S26 | Export settings | S03 top-right Export / resolution chip | choose output | resolution (480p, 720p, 1080p, 2K, 4K), frame rate (24, 25, 30, 50, 60), bitrate (low/medium/high/custom), est. file size | default | medium |
| S27 | Export progress + done | after S26 | render and save | progress %, cancel, saved to gallery, share sheet | exporting, failed, done | medium |

Not mapped on purpose: Templates tab, Me / account, Inbox, Pro store, cloud
space. See out of scope.

## Flows

```
F01 Make a video from clips and export (core loop)
    S01 -> S02 -> S03 -> S26 -> S27
    happy path clicks: 6 (+, pick 2 clips, Add, Export, confirm, done)
    edge: no storage permission, huge 4K source on a slow phone, export
          interrupted (app backgrounded), out of disk, mixed fps / rotation sources

F02 Trim and split a clip, delete the bad part
    S03 -> S04 (drag edges to trim) -> Split -> select piece -> Delete
    happy path clicks: 4
    edge: split at the very first/last frame, undo after delete

F03 Speed up / slow down / speed ramp
    S04 -> S05 Normal (slider) or Curve (preset or custom)
    happy path clicks: 3
    edge: 100x on a 2 s clip (sub-frame result), 0.1x needs frame interpolation
          (optical flow), audio pitch at extreme speeds

F04 Add a transition between two clips
    S03 -> tap join marker -> S06 -> pick -> duration -> confirm
    happy path clicks: 4
    edge: transition longer than either clip, clips too short, apply to all (unconfirmed)

F05 Add text with In / Out / Loop animation
    S03 Text -> Add text -> S09 type -> Style -> Animation: In, Out (or Loop) -> duration
    happy path clicks: 7
    edge: In + Out longer than the text layer, Loop together with In/Out,
          emoji / Thai text shaping, very long text

F06 Add music and fade it out
    S03 Audio -> S07 Sounds (or import own file) -> S08 fade out
    happy path clicks: 5
    edge: music longer than video, beat markers, file with unsupported codec

F07 Extract audio from another video
    S07 Extract audio -> S02 pick video -> audio track appears
    happy path clicks: 3
    edge: video without an audio stream

F08 Record a voiceover
    S07 Record -> hold to record -> stop -> S08 voice effect
    happy path clicks: 4
    edge: mic permission denied, headphones vs speaker echo

F09 Colour: filter + manual adjust
    S04 Filters -> S17 pick + intensity -> Adjust -> S18 sliders
    happy path clicks: 5
    edge: apply to all clips vs one clip, global filter layer on the timeline

F10 Video / body effect
    S03 Effects -> S16 pick -> effect becomes its own timeline item -> stretch to length
    happy path clicks: 4
    edge: body effect with no person in frame

F11 Picture-in-picture with blend / mask / chroma key
    S03 Overlay -> S14 pick -> S15 blend or S21 mask or S22 chroma key
    happy path clicks: 6
    edge: overlay larger than canvas, green screen with uneven light

F12 Keyframe animation (move / zoom over time)
    S04 -> S25 add keyframe -> move playhead -> change position/scale -> keyframe auto-added
    happy path clicks: 5
    edge: keyframe outside the clip after a trim, easing between 3+ keyframes

F13 Change aspect ratio and fill with blurred canvas
    S03 -> S19 9:16 -> S20 Blur
    happy path clicks: 3

F14 Auto captions
    S03 Text -> S11 -> source -> language -> Generate -> edit lines
    happy path clicks: 4
    edge: music only (no speech), mixed languages, Thai

F15 Text to speech
    select text -> S12 -> voice -> Apply
    happy path clicks: 3
    edge: offline, language without a voice

F16 Reopen a draft
    S01 -> tap draft -> S03 (state restored)
    happy path clicks: 1
    edge: source media deleted from the gallery since last edit
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Bottom toolbar | global, clip-context, audio-context, text-context | default, scrolled, item disabled | S03, S04 |
| Tool icon button | icon + label | default, pressed, disabled, Pro badge (skip) | S03-S04 |
| Timeline | main video track, overlay tracks, audio tracks, text/sticker tracks, effect/filter tracks | idle, scrubbing, clip selected, clip dragging, pinch-zoomed | S03, S04 |
| Clip on timeline | video, photo, audio (waveform), text, sticker, effect | default, selected (trim handles), muted | S03 |
| Playhead | | idle, playing | S03 |
| Join marker | between clips | empty, has transition | S03, S06 |
| Keyframe diamond | | none, on keyframe, between keyframes | S04, S25 |
| Preview player | | playing, paused, loading frame | S03 |
| Transform handles | move, scale, rotate, delete | default, active | S03 (text, sticker, overlay) |
| Bottom sheet panel | short, tall | open, closed, applying | S05-S26 |
| Preset grid | thumbnail + label | default, selected, downloading, failed | S06, S10, S13, S16, S17, S24 |
| Category tab bar | horizontal scroll | selected | same as preset grid |
| Slider | value, range (0.1x-100x log), duration | default, dragging | S05, S06, S08, S17, S18, S24 |
| Curve editor | speed curve, colour curve, easing | default, point selected | S05, S18, S25 |
| Colour picker | swatches, eyedropper | default | S09, S20, S22 |
| Text input | multi-line | empty, typing | S09 |
| Media grid | video (duration badge), photo | default, selected (order number) | S02 |
| Progress dialog | determinate | running, failed, done | S11, S12, S27 |
| Record button | hold / tap | idle, recording | S07 |
| Draft card | thumbnail, name, duration, date | default, long-press menu (rename, duplicate, delete) | S01 |

## Inferred data model

```
Project     id, name, created_at, updated_at, aspect_ratio, canvas {type: colour|blur|image,
            colour, blur_level, image_uri}, cover_uri, duration_ms
            evidence: S01 drafts, S19, S20 (sources 10, 11)
            confidence: high (fields are a guess, the concept is not)

MediaAsset  id, uri, kind (video|photo|audio), duration_ms, width, height, fps,
            rotation, has_audio
            evidence: S02, F16 edge (missing source)
            confidence: high

Track       id, project_id, kind (main|overlay|audio|text|sticker|effect|filter|adjust),
            order, muted, hidden
            evidence: multi-track timeline (source 1), S14, S16 effects as timeline items
            confidence: high

Clip        id, track_id, asset_id (nullable for text/sticker/effect), source_in_ms,
            source_out_ms, timeline_start_ms, speed {mode: normal|curve, value, curve_points[]},
            reversed, volume, transform {x, y, scale, rotation, opacity}, crop {rect, mirror},
            blend_mode, mask {shape, x, y, w, h, rotation, feather, invert},
            chroma_key {colour, intensity, shadow}, filter {preset_id, intensity},
            adjust {brightness, contrast, saturation, exposure, sharpen, highlights,
            shadows, temperature, tint, hsl[], curve[]}, stabilize_level,
            anim_in {preset_id, duration_ms}, anim_out {...}, anim_loop {...}
            evidence: S04-S05, S15, S17-S18, S21-S24 (sources 1, 2, 18)
            confidence: high for the list of properties, guess for the exact shape

TextStyle   clip_id, text, font_id, size, colour, stroke {colour, width}, shadow {colour,
            blur, offset}, background {colour, radius}, alignment, letter_spacing,
            line_spacing, template_id
            evidence: S09, S10 (sources 14, 19)
            confidence: medium (stroke/shadow/background not confirmed)

AudioProps  clip_id, fade_in_ms, fade_out_ms, voice_effect_id, noise_reduction,
            beat_markers_ms[]
            evidence: S08 (source 12, audio search results)
            confidence: medium

Keyframe    id, clip_id, time_offset_ms, property (position|scale|rotation|opacity|
            volume|filter_intensity|adjust.*|mask.*), value, easing
            evidence: S25 (source 6)
            confidence: high for position/scale/opacity, guess for the rest

Transition  id, project_id, clip_a_id, clip_b_id, preset_id, duration_ms
            evidence: S06 (source 5)
            confidence: high

Preset      id, kind (transition|filter|effect|body_effect|text_anim_in|text_anim_out|
            text_anim_loop|clip_anim|font|sticker|text_template|voice_effect), name,
            category, thumbnail, params (shader + uniforms or keyframe JSON)
            evidence: every picker grid; catalogues change weekly (sources 1, 13)
            confidence: high for the concept. The contents are ours to make, never theirs.

ExportJob   id, project_id, resolution, fps, bitrate (low|medium|high|custom),
            codec (H.264|HEVC), status, progress, output_uri, error
            evidence: S26, S27 (sources 1, 20)
            confidence: medium
```

Relationships: Project 1-n Track, Track 1-n Clip, Clip n-1 MediaAsset,
Clip 1-n Keyframe, Clip 0-1 TextStyle, Clip 0-1 AudioProps, Project 1-n
Transition (each between two adjacent main-track clips), Clip n-1 Preset (per
slot), Project 1-n ExportJob.

## Feature matrix

See `features.csv`. Must: 34, should: 29, could: 10, skip: 9.

## Out of scope (cannot or should not be cloned)

- **The music and sound-effect library.** Licensed catalogue. Use your own
  files, or a royalty-free library you have the rights to.
- **CapCut's own presets as files:** their effect, filter, transition,
  sticker, font and text-template packs. Owned assets. We build our own
  presets that do the same kind of thing (fade, zoom, slide, glitch, blur...),
  with our own names and our own numbers.
- **Templates and the template community.** User content and the network.
- **ByteDance's AI models** (AI effects, AI voices, their auto-caption and
  background-removal models). Replace with on-device or open alternatives
  (e.g. Android TTS, an open speech-to-text model, an open segmentation model).
  Results will be similar, not identical.
- **Cloud space, account, TikTok direct-post integration.** Not needed for a
  personal offline editor.
- **The Pro paywall.** Nothing to clone: a personal app has no paywall. We do
  not touch, bypass or unlock the real CapCut's paid features.
- **The decompiled APK.** Not used, by rule.

## Size

Screens 27, flows 16, entities 10.

Hard parts:
1. **Real-time preview** of a multi-track composition with effects, filters,
   masks, blend modes and keyframes, at 30 fps on a mid-range phone. This
   means a GPU (OpenGL ES / Vulkan) render graph, not Android Views.
2. **Export**: hardware encoding (MediaCodec) of that same render graph,
   plus audio mixing, at up to 1080p/4K, without running out of memory, and
   surviving the app going to the background.
3. **Timeline UI**: smooth scroll/zoom, thumbnails, waveforms, drag-to-trim,
   snapping, undo/redo for every action.
4. Speed curves with audio pitch handling, and frame interpolation for slow
   motion.
5. A preset system (shaders + keyframe JSON) so that every filter, effect,
   transition and text animation is data, not new code.
6. On-device auto captions and background removal (needs ML models).

Size: **XL** for "everything CapCut has". Rescope.

Recommended slice for v1, size **L** (about a quarter of focused work): F01-F09,
F12, F13, F16. That is: timeline with trim/split/speed/reverse/freeze/crop,
transitions, text with In/Out/Loop animations, filters + adjust, music +
extract + voiceover + fades, keyframes, aspect ratio + canvas, export up to
1080p. Overlay/mask/chroma, effects, auto captions and TTS come in v2.
