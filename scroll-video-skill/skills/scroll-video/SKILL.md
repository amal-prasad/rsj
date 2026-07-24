---
name: scroll-video
description: >
  Build an immersive scroll-scrubbed landing page from the user's OWN video footage.
  A fork of scroll-world (github.com/oso95/scroll-world) with the Higgsfield generation
  steps (interview → AI scene stills → AI dive/connector clips) removed and replaced
  with "cut and encode the footage the user already has." Everything downstream —
  encoding for blob-seek scrubbing, the portable scrub-engine.js, mobile hardening,
  and QA — is the original scroll-world code and steps, unmodified. Use when the user
  has their own video (one continuous shot, or several separate clips) and wants a
  scroll-driven "camera flight" page without any AI video generation step.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# scroll-video

Same output as scroll-world: scroll drives video time, one continuous-feeling flight
through a sequence of scenes, copy pinned per section. The only thing removed is the
Higgsfield pipeline — this skill assumes the footage already exists.

**Mapping to the original (github.com/oso95/scroll-world, MIT):**

| scroll-world | scroll-video |
|---|---|
| Step 1 — Interview (subject, brand kit, art direction, journey, mobile y/n, budget) | Step 1 — Interview, minus art direction / brand-kit-import / video-model / budget (nothing to generate, so nothing to price or style) |
| Step 2 — Generate scene stills (Higgsfield) | Step 2 — Cut the user's video into per-section segments + extract poster frames (only if working from one continuous video) |
| Step 3 — Float the scenes (optional knockout) | *dropped — no AI stills to knock out* |
| Step 4 — Camera architecture + generate dive clips (Higgsfield) | *dropped — the user's footage IS the "dive clip"* |
| Step 5 — Connectors (frame-matched AI transition clips) | *dropped — see Step 3 below for why real footage doesn't need this* |
| Step 6 — Encode for scrubbing | **unchanged** — same ffmpeg settings, same reasoning |
| Step 7 — Assemble the page | **unchanged** — same `scrub-engine.js`, same config shape |
| Step 8 — QA the seams | **unchanged**, minus the AI-frame-matching check (nothing to verify against) |

Do not reintroduce Higgsfield, AI stills, or AI-generated transition clips into this
skill — if the user wants those, point them at the original scroll-world skill instead.

---

## Step 1 — Get the footage and the per-section copy

Ask the user for:

1. **The video(s).** Either:
   - **One continuous video** covering the whole flight — cut into per-section
     segments at the points where the copy should change (Step 2).
   - **Separate clips**, one per section, already cut — used as-is, straight to Step 3.
2. **Section breakdown** — for each section: an id/label, eyebrow, title, body, tags,
   and (last section only) a CTA. These are the exact fields `scrub-engine.js` expects
   — the same information scroll-world's interview would have collected regardless of
   where the video came from.
3. **Accent colour(s)** per section and the page theme (`--sw-bg`, `--sw-ink`,
   `--sw-accent`) — ask for hex values, or pull them from brand assets the user
   already has.
4. **Mobile version?** Same question as scroll-world: a lighter/differently-shot set
   of files for phones, or rely on the engine's always-on phone hardening (seek-
   coalescing, iOS priming, safe-area CSS — unaffected by this fork). If the user has
   separately-shot 9:16 footage, run it through Steps 2-3 the same way and wire it as
   `clipMobile` / `connectorsMobile` / `stillMobile`.

Skip: art direction, brand-kit import, video-model choice, budget/credits — none of
that applies when there's nothing to generate.

---

## Step 2 — Cut and prep (only if working from one continuous video)

If the user already has separate clips per section, skip to Step 3.

Cut per-section segments at the copy's natural beats:

```bash
ffmpeg -v error -y -i source.mp4 -ss <start> -to <end> -c copy "seg_$n.mp4"
```

`-c copy` gives a clean cut when the boundary lands on a keyframe; otherwise re-encode
that one cut (`-c:v libx264 -crf 18`) instead of copying, so the cut point isn't a stale
frame.

Because every segment comes from the *same* source shot, adjacent segments are
trivially seam-safe: segment A's last frame and segment B's first frame are already the
true neighbouring frames of the original footage. This is exactly what scroll-world's
Step 5 frame-matching exists to fake for independently-rendered AI clips — real,
continuously-shot footage gets it for free, so there's no connector-generation step here.

**Poster stills** — extract each segment's first frame (these double as the video
poster and the lazy-load / reduced-motion fallback, same role as in scroll-world):

```bash
ffmpeg -v error -y -i "seg_$n.mp4" -frames:v 1 -q:v 2 "poster_$n.png"
```

Convert to webp for a smaller poster if you like: `cwebp -q 85 poster_$n.png -o poster_$n.webp`.

---

## Step 3 — Encode for smooth scrubbing (scroll-world Step 6, unchanged)

Scrubbing sets `video.currentTime` from scroll position. Seekability (the engine loads
each clip as a Blob, so it doesn't depend on HTTP byte-range support) and a small,
uniform GOP matter far more than resolution — same settings as scroll-world:

```bash
enc() { ffmpeg -v error -y -i "$1" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$2"; }

for n in $NAMES; do enc "seg_$n.mp4" "assets/vid/$n.mp4"; done
```

**Mobile (only if opted in at Step 1):** same tighter-GOP treatment as scroll-world —
a phone decoder's seek cost scales with frames-from-nearest-keyframe, so this is what
keeps scrubbing smooth on a phone, not just a smaller file:

```bash
encm() { ffmpeg -v error -y -i "$1" -an -vf "scale=-2:720,unsharp=5:5:0.6:5:5:0.0" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$2"; }
```

If the user's mobile footage is separately-shot 9:16 (not a crop of the desktop film),
encode that instead of centre-cropping — same rule as scroll-world: a native portrait
chain beats a crop.

**No connector clips to generate.** If the segments are cuts from one continuous shot,
they're already frame-continuous (Step 2) — leave `connectors: []`. If they're separate,
unrelated clips with no natural transition between them, also leave `connectors: []` /
use `null` entries and let the engine's crossfade handle the cut (the same fallback
scroll-world uses whenever a connector slot is intentionally skipped).

---

## Step 4 — Assemble the page (scroll-world Step 7, unchanged)

Copy `references/scrub-engine.js` and `references/index-template.html` into the user's
project, or adapt into their framework — it's self-contained vanilla JS (builds its own
DOM, injects its own namespaced CSS) so it drops into plain HTML, Next.js (call from a
ref/`useEffect`), Vue (`onMounted`), or a server-rendered page unchanged:

```js
mountScrollWorld(document.getElementById('world'), {
  brand: { name: '...' },
  diveScroll: 1.3, connScroll: 0.9,
  sections: [
    { id:'...', label:'...', still:'assets/poster_1.webp', clip:'assets/vid/1.mp4',
      clipMobile:'assets/vid/1-m.mp4', stillMobile:'assets/poster_1-m.webp',
      accent:'#...', eyebrow:'...', title:'...', body:'...', tags:[...] },
    // one per section
  ],
  connectors: [],           // or your own transition footage's clip URLs, if you have any
  connectorsMobile: [],
});
```

Theme via the `--sw-bg` / `--sw-ink` / `--sw-accent` CSS variables, exactly as in
scroll-world. Per-section `scroll` (dwell length) and `linger` (mid-scene settle) pacing
knobs work identically.

---

## Step 5 — QA (scroll-world Step 8, minus the seam-frame check)

Same checklist as scroll-world, minus the AI-frame-matching item (there's no
independently-rendered connector to verify against a still):

- Scrub across every cut point — no visible pop or freeze.
- Console clean; `video.seekable.end(0) > 0` (blob loaded); `currentTime` tracks scroll
  in both directions.
- Mobile: emulate a phone viewport with CPU throttled 4-6x and scroll fast — no
  freezing. Test iOS Safari specifically (blank-until-played video is the regression to
  watch for). Confirm `clipMobile` actually serves on mobile (Network panel) and the
  desktop master serves on desktop. Slowly scroll so the URL bar collapses — the page
  must not jump.
- `prefers-reduced-motion` falls back to stills only, no video, no particles.

---

## Gotchas

All of scroll-world's non-generation gotchas still apply unchanged: dark/custom theme
(`@layer sw`, set `--sw-bg`/`--sw-ink` at page level), phone scrub stutter (ship the
`-m.mp4` mobile encodes), blank/black scene on iOS (don't strip `playsinline`/`muted` if
you adapt the engine), page jumps on mobile scroll (engine ignores height-only resizes),
copy hidden behind the notch/URL bar (`viewport-fit=cover`, the template has it).

One new item specific to this fork:

- **Cut point looks like a pop even though it's the same shot** → you cut across a
  scene change / camera cut that was already in the source footage, not a clean
  mid-shot point. Pick cut points where the source footage itself is continuous, the
  same way scroll-world's Step 4 warns against reversing camera velocity across a seam.

---

## References

- `references/scrub-engine.js` — byte-identical copy of scroll-world's engine;
  video-source-agnostic, so nothing needed changing.
- `references/index-template.html` — scroll-world's template, comments updated to
  reflect user-supplied footage instead of Higgsfield output; structure unchanged.
- `references/LICENSE-original-scroll-world` — the original MIT license
  (scroll-world, © cyw/oso95) this fork's reused files are covered by.
