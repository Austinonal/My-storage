# Research: CapCut's In / Out / Combo animations

Date: 2026-10-13. Public sources only. Used to decide **which kinds of motion**
the clone needs, not to copy anything: our presets are our own maths, our own
names (Thai), and none of CapCut's resource IDs, art or files.

## Sources

| # | source | what it gave |
| --- | --- | --- |
| 1 | [pyCapCut metadata](https://github.com/GuanYixuan/pyCapCut) (open-source draft writer, `pycapcut/metadata/*.py`) | the full name lists per tab, free vs paid, default durations. Read as an index only; IDs not used |
| 2 | [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) README | how the three types behave on a clip (In at the start, Out at the end, Group/Combo across the clip) |
| 3 | [HardReset: change video animation](https://www.hardreset.info/devices/apps/apps-capcut/change-video-animation/) | Combo is the alternative to setting In and Out separately |
| 4 | [MiniTool: add animation in CapCut](https://moviemaker.minitool.com/news/add-animation-to-a-video-in-capcut.html) | pick an effect, then adjust its duration |
| 5 | [Patreon: titles in CapCut desktop](https://www.patreon.com/SilentEye/posts/creating-epic-in-92920336) | text: In / Out / Loop; the duration slider defaults to half a second |
| 6 | [capcutguide.com text animation](https://capcutguide.com/capcut-text-animation/) | Loop repeats while the text is on screen |
| 7 | [CapCut: typewriter effects](https://www.capcut.com/resource/typewriter-effects) | typewriter reveals one character at a time |

## How they work

- **In** starts at the clip's first frame. **Out** ends on its last frame.
  **Combo** runs across the clip and replaces In and Out (pick one or the other).
- Each preset has a default duration, adjustable with a slider. Most In/Out
  defaults are **0.5 s**; heavier ones are 1-3 s.
- Tapping a preset plays it once on the preview.
- Text layers have their own tabs: **In / Out / Loop**. Loop repeats for the
  whole time the text is visible.

## The catalogue, in numbers

| tab | total | free | paid |
| --- | --- | --- | --- |
| Clip In | 251 | 43 | 208 |
| Clip Out | 219 | 22 | 197 |
| Clip Combo | 108 | 71 | 37 |
| Text In | 182 | 62 | 120 |
| Text Out | 100 | 35 | 65 |
| Text Loop | 81 | 23 | 58 |

## What the presets are made of (by mechanism)

| mechanism | examples in the original catalogue (described) | clone engine |
| --- | --- | --- |
| move / slide | slide up, down, left, right; slide with blur | yes: `x`, `y` |
| swing in from a direction | swing in from 6 directions with overshoot | yes: offset + rotation + back easing |
| turn in around a corner | turn in up / down / left / right | yes: rotation around a pivot |
| zoom | zoom in, zoom out, punchy zoom, slight zoom, fly closer | yes: `scale` |
| spin | rotate, whirlpool, spin open, flip back upright | yes: `rot`, `scale` |
| shake | vertical, horizontal, slight shake I-III, shake-and-drop, X-shake | yes: deterministic noise |
| swing on a pivot | pendulum, pirate ship, swing, wine glass sway | yes: rotation around an outside pivot |
| flip | mirror flip, card flip, cube | yes: `sx` / `sy` through zero (fake 3D) |
| stretch / jelly | jelly, funhouse mirror, twist and stretch, deform shrink | yes: `sx`, `sy`, `skew` |
| fade / colour | fade, blur fade, grey veil, negative, flash white | yes: `alpha`, canvas filters, flash overlay |
| reveal shapes | blinds, wiper, curtain, circle open, diagonal wipe, scan | yes: clip paths |
| strips | fragment slide, glitch tear | yes: horizontal strips with offsets |
| copies | split screen (3-way, centre, top/bottom), clones, stacking, train, light streak | yes: extra draws of the same frame |
| pixel | mosaic | yes: downscale + nearest-neighbour |
| particles, fire, hearts, magic, liquid glass, 3D phone, newspaper, film burn, light leaks | mostly paid | **not now**: needs WebGL shaders and our own artwork |
| typewriter, per-letter, karaoke, wave per character | text only | **with the text feature** (same engine, per-glyph poses) |

## Our catalogue

Built in `editor/src/anim.ts`: **100 In, 86 Out, 101 Combo** presets for clips,
covering every mechanism above except the "not now" row. Out presets are In
presets played backwards (with the direction flipped), plus a few that only
make sense on the way out. Text In/Out/Loop reuse the engine when text
layers are built.
