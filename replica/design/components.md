# Components

Tokens: `replica/design/tokens.json` (classes like `bg-surface text-muted`,
never raw hex). Icons: Lucide (ISC licence), no CapCut icons. Every label is
our own copy. The UI font is the system stack (Roboto + Noto Sans Thai on
Android), so nothing is downloaded. Fonts for text *layers* in videos are a
separate, bundled OFL set (see architecture).

Not measured from screenshots: there were none. Sizes come from the touch
target rule (48 px) and the type scale. Compare against the real app on your
phone and adjust tokens, not components.

Built now as primitives (`editor/src/ui/`, shown on `#/design`): Button,
ToolButton, BottomToolbar, TopBar, BottomSheet, Slider, CategoryTabs,
PresetTile, Swatches, ProgressPanel, DraftCard.

Built with the timeline in `/replica-build` milestone 2.1, because they need
the engine: Timeline, TimelineClip, Playhead, JoinMarker, KeyframeDiamond,
PreviewPlayer, TransformHandles, CurveEditor, RecordButton.

## Layout (phone first, same layout on desktop web)

```
TopBar        48   close | project name | export
Preview       flex (letterboxed to the project aspect, bg colour = canvas)
Timeline      208  ruler + main track + extra tracks (48 each), scrolls
BottomToolbar 64   horizontal scroll of ToolButtons
BottomSheet   over toolbar + timeline, max 60vh, max width 520 centred
```

Desktop: the same column, sheets centred at 520 px. A side-panel layout is a
could-have, not v1.

## Primitives

```
Button
  variants  primary (bg accent, text on-accent), secondary (bg raised, text), ghost (text only), danger (text danger)
  sizes     md 40px, lg 48px (default on touch)
  states    default, active (90% brightness), focus-visible (2px ring accent, 2px offset), disabled (40% opacity, no pointer), loading (spinner, label kept, aria-busy)
  tokens    radius md, type sm/600
  a11y      real <button>; icon-only needs aria-label
  used on   S01, S26, S27, sheet footers

ToolButton
  variants  default, active (tool panel open), pro-badge: never (no paywall)
  size      64 x 64 hit area, icon 24, label xs below
  states    default, pressed, active (icon + label accent), focus-visible, disabled
  tokens    text-muted -> text when active; accent when active
  a11y      <button> with visible label; aria-pressed for toggles (Mute, Reverse)
  used on   S03, S04 bottom toolbar

BottomToolbar
  variants  global (nothing selected), clip (clip selected), audio, text
  layout    height 64, horizontal scroll, snap to buttons, bg surface, top border
  states    default, scrolled (fade edge)
  a11y      role="toolbar" with aria-label naming the context ("Clip tools")
  used on   S03, S04

TopBar
  layout    height 48, bg bg; left: close/back, centre: title (truncate), right: primary action
  a11y      <header>; back button labelled
  used on   S01, S03, S26

BottomSheet
  layout    native <dialog>, from bottom, bg surface, radius lg top corners, shadow sheet, max 60vh, max width 520
  parts     header (title, Done button), body (scroll), optional footer
  states    opening (slide up, motion base), open, closing; no "loading" state: content shows its own
  a11y      showModal() gives focus trap and Esc; title is aria-labelledby; focus returns to the opener
  used on   S05-S26 (every tool panel)

Slider
  variants  value (0..100), signed (-100..100, centre detent), range-log (speed 0.1x..100x), duration
  parts     label, track, thumb, value readout
  states    default, dragging (thumb grows), focus-visible, disabled
  tokens    track border, fill accent, thumb text
  a11y      native <input type="range">; aria-valuetext for readable units ("2.0x", "0.5 s")
  used on   S05, S06, S08, S17, S18, S24

CategoryTabs
  layout    horizontal scroll of text chips, height 40
  states    default, selected (text + underline accent), focus-visible
  a11y      buttons with aria-pressed; arrow keys not required in v1
  used on   S06, S16, S17, S24, S09 (font list)

PresetTile
  parts     thumbnail 64x64 radius md, label xs (1 line, truncate)
  states    default, selected (2px accent ring + check), loading thumbnail (raised placeholder), "none" tile (slash icon)
  a11y      <button aria-pressed>; label is the accessible name
  used on   S06, S09 animations, S17, S24 (grids of 4 per row on phone)

Swatches
  parts     row of 32px circles + custom colour (native <input type="color">)
  states    default, selected (ring), focus-visible
  a11y      each swatch a button with aria-label (colour name or hex)
  used on   S09, S20

ProgressPanel
  parts     title, determinate bar, percent, Cancel
  states    running, failed (message + Retry), done (Save / Share)
  a11y      <progress> element; live region announces done/failed
  used on   S27 (export), S11/S12 later

DraftCard
  parts     cover 16:9 or per aspect, name, duration (mono), updated date
  states    default, pressed, missing media (warning icon), long-press menu (rename, duplicate, delete) is a should-have
  a11y      the whole card is one <button>; menu has its own labelled button
  used on   S01
```

## Engine-bound (spec now, build with the timeline)

```
Timeline
  parts     ruler (timecode, mono xs), tracks stacked (main first), playhead fixed in the centre, content scrolls under it
  states    idle, scrubbing, playing (auto-scroll), clip selected, dragging, pinch-zoomed
  tokens    track height 48, clip radius sm, gaps 2px, bg bg
  a11y      Play/Pause and Split are reachable as buttons; timeline itself is pointer-first (documented limit)

TimelineClip
  variants  video/photo (thumbnail strip), audio (waveform on clip-audio), text (label on clip-text)
  states    default, selected (2px playhead-colour border + trim handles 16px wide), dragging (raised, 80% opacity), muted (icon)

Playhead       2px line, colour playhead, full timeline height
JoinMarker     16px square on the main track seam; empty = plus icon, filled = transition icon; tap opens S06
KeyframeDiamond 12px rotated square, colour keyframe; filled when the playhead is on it
PreviewPlayer  canvas sized to the aspect, play/pause button 48px, timecode "00:03 / 00:15" mono
TransformHandles corner handle 24px (hit area 48), rotate handle above, delete in the corner
CurveEditor    square, grid lines border, curve accent, points 16px (hit 48)
RecordButton   72px circle danger; recording = pulsing ring + timer
```
