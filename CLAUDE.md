# RS ज्वेलर्स — scroll-scrubbed landing page

Vanilla, zero deps. Two files carry everything:

- `index.html` — theme tokens, loader gate, section copy config, `mountScrollWorld()` call
- `scrub-engine.js` — the whole engine; CSS is injected into an `@layer sw` block at `injectCSS()`

There is **no** GSAP, no ScrollTrigger, no build step, no CSS file. Do not add one.

## Architecture facts worth knowing before editing

- Pinning is `position:fixed` + a tall invisible `.sw-track` spacer. There is no `position:sticky`
  anywhere and no ancestor breaks fixed containment. Keep it that way.
- `read()` writes `.sw-copy` `transform` **every scroll frame**. Any CSS `transform` you add to the copy
  is clobbered on the next tick. Animate via `opacity` / `clip-path`, an inner wrapper, or the `--p`
  custom property that `read()` sets.
- Video encoding is already correct: mobile clips are 720p / GOP≈4 / 2.5Mbps. Do not re-encode.
  The untracked `assets/vid/*_g5.mp4` are 1080p, larger, and wired to nothing — ignore them.
- `.sw-copy:nth-of-type(4n+2)` in `index.html` counts the 4 sections. It silently re-cycles if a 5th
  section is added.

---

# Active task — mobile anchor, scrub smoothness, typography

## Locked decisions

| Knob | From | To | Why |
|---|---|---|---|
| `MOBILE.dist` | 0.60 | **1.25** | 11.7px of scroll per video frame — more forgiving than desktop's 10.8 |
| `MOBILE.eps` | 0.020 | **0.033** | 1 frame @30fps; 0.020 was sub-frame, i.e. never gated anything |
| `MOBILE.lerp` | 0.10 | **0.16** | 0.10 was compensating for the frozen-`cur` bug; stale once that is fixed |
| mobile `linger` | ×1 | **×0.5** | halves the 2× seek-rate spike at every seam |
| Body/UI face | Hind | **Anek Devanagari** | variable (wght 100–800 + wdth 75–125), real weights, covers both scripts |
| Display face | Tiro Devanagari Hindi | **keep** | genuine Tiro Typeworks Devanagari serif, native 400 |

## Worker contracts

Three parallel workers share two files. Each owns **only** the functions and CSS selectors listed.
Ranges are disjoint by construction. Every worker gets this rule:

> You own ONLY the functions/selectors listed. Do not reformat, refactor, or touch anything else in
> either file — another worker is editing adjacent lines concurrently. Report a unified diff.

### Worker A — Anchor the stage (`scrub-engine.js`)

Owns `layout()` (193–208), `onResize()` + listener block (341–353), and CSS selectors `html,body` (392),
`.sw-sky` (393), `.sw-stage` (412), `.sw-copylayer` (416), `.sw-track` (441).

- [x] svh probe near line 181 so CSS and JS agree on one viewport height: hidden `div` with
      `height:100svh` appended to `container`; `vh = probe.offsetHeight || window.innerHeight`.
      `100svh` does not change when the URL bar slides — that is the whole point.
- [x] `.sw-stage`, `.sw-sky`, `.sw-copylayer`: `inset:0` → `top:0;left:0;right:0;height:100vh;` then a
      second `height:100svh;` declaration (progressive — no-svh browsers keep the `vh` line).
- [x] Gate the `scrollTo` at line 206 on an **actual breakpoint cross**, not track-length delta.
      Capture `const wasMobile = isMobile();` before `vh` is reassigned; `scrollTo` only when
      `isMobile() !== wasMobile`. This is what the line-204 comment already claims.
- [x] `window.addEventListener('load', layout)` → `onResize`, so the load path inherits the `coarse`
      width guard instead of bypassing it.
- [x] Re-evaluate `coarse` inside `onResize()` instead of the once-captured mount value — DevTools
      emulation, paired mice, DeX and foldables all report it false and currently get a full relayout
      on every URL-bar transition.
- [x] Drop `overflow-x:hidden` from `body` at line 392, keep it on `html`. `overflow` on `html`
      propagates to the viewport; the `body` copy only makes `body` a redundant scroll container and is
      a known source of `position:fixed` repaint glitches on iOS.

### Worker B — Scrub smoothness (`scrub-engine.js`)

Owns the `MOBILE`/`DESKTOP`/`state` const block (184–191), `raf()` (290–306), and the single `s.target`
line inside `read()` (249). **Nothing else in `read()`** — Worker C owns line 271.

- [x] `MOBILE = { dist: 1.25, eps: 0.033, lerp: 0.16 }`. `DESKTOP` untouched. Rewrite the block comment —
      the current one says "phones cover the film in less page height", which *is* the bug.
      `// ponytail: tuned for a mid-range Android decoder; raise dist if a slower device stutters`
- [x] In `raf()`, move `if (s.video.seeking) continue;` to **below** `s.cur += (s.target - s.cur) * ...`
      so `cur` keeps converging while the decoder works — the behaviour line 297 already describes.
- [x] `fastSeek` when present and coarse:
      `if (isMobile() && s.video.fastSeek) s.video.fastSeek(t); else s.video.currentTime = t;`
      inside the existing `try`.
      `// ponytail: GOP≈4 caps fastSeek error at ~4 frames; drop this branch if it reads visibly`
- [x] Scale `linger` down on mobile at line 249: `s.linger * (isMobile() ? 0.5 : 1)` into `lingerEase`.
- [x] Leave one runnable check asserting `lingerEase(0,L)===0`, `lingerEase(1,L)===1`, and monotonicity
      across `L ∈ {0, 0.25, 0.5}` — monotonicity is what stops the video running backwards mid-scene.

### Worker C — Typography + the authored moment (`index.html` + copy CSS)

Owns all of `index.html`, plus CSS selectors `.sw-brand__name` (407), `.sw-copy__num` (419),
`.sw-copy__eyebrow` (420), `.sw-copy__title` (421), `.sw-copy__body` (422), `.sw-copy__tags` (423–424),
`.sw-btn` (426–428), `.sw-hint` (437), the typography lines in `@media (max-width:860px)` (449–450),
the copy `innerHTML` template (156), and **exactly one line** in `read()`: line 271.

- [x] Google Fonts link →
      `family=Tiro+Devanagari+Hindi&family=Anek+Devanagari:wdth,wght@75..125,100..800&display=swap`.
      `--sw-font-body: 'Anek Devanagari', system-ui, sans-serif`. One variable file replaces four static
      Hind weights — net lighter than today.
- [x] **Remove `text-transform:uppercase` AND `letter-spacing` from every Devanagari selector** —
      `.sw-copy__eyebrow` (`.16em`), `.sw-hint` (`.14em`), `.sw-copy__title` (`-.01em`). Devanagari is
      unicameral so the transform is a no-op, but the tracking that ships with it breaks the shirorekha
      and splits conjuncts. Give the eyebrow presence with weight (Anek 600) and a short gold hairline.
- [x] `.sw-copy__title` `line-height: 1.03 → 1.2` — 1.03 is clipping upper matras (ि ी े ै ो ौ ं) on
      every headline right now. Add `text-wrap: balance`.
- [x] Delete `.sw-copy__num` and stop emitting it. Monospace as a costume, and the route rail already
      shows position.
- [x] Light-on-dark body compensation: line-height 1.7, Anek 400, measure 45–75ch on desktop.
      Body text ≥4.5:1 against `#0A0A0A`.
- [x] `.sw-copy__tags li` currently mixes toward `#fff` — near-white pills on a black page. Move to a
      gold hairline outline on transparent.
- [x] **The authored moment — shirorekha wipe.** In `read()` line 271 keep the existing writes and add
      `c.style.setProperty('--p', pr)`. Everything else is CSS off `var(--p)`:
      - `.sw-copy__title { clip-path: inset(0 calc((1 - var(--p, 1)) * 100%) 0 0); }` — the headline bar
        draws left→right and the letters hang from it. Script-native to Devanagari, scrubbed off scroll,
        `clip-path` + `opacity` only.
      - Eyebrow rule: `transform: scaleX(var(--p))` on a `::before`.
      - Finale draws slower than the middles — the four sections must **not** be one identical entrance.
      - Body and tags fade only, no drift.
      - `@media (prefers-reduced-motion: reduce)` → `clip-path: none`.
      - `// ponytail: clip-path repaints per frame on a small text block; if mobile fps drops, gate the
        wipe to (hover:hover) and leave mobile on opacity`
- [x] No gradient / `background-clip:text` gold sheen. Emphasis comes from weight and size.

## Merge + verify (main thread, after all three report)

- [x] Read both files end to end. Confirm no worker strayed and that `read()` lines 249 and 271 both
      survived.
- [x] `python -m http.server 8000`, drive with the Playwright MCP tools.
- [x] **Anchor test (primary bug):** emulate iPhone 390×844 with touch, scroll mid-page, fire a `resize`
      with `innerHeight` −70px to simulate the URL bar collapsing. Assert `window.scrollY` unchanged and
      `.sw-stage` rect unchanged. **This fails today.**
- [x] Reload, scroll during the loader veil, confirm no jump when `load` fires.
- [x] **Smoothness:** at 390×844 assert `.sw-track` height ≈ `6.2 × 1.25 × vh + vh`; sample
      `video.currentTime` across a scripted flick and confirm no plateau (the plateau is the frozen-`cur`
      signature).
- [x] **Type:** screenshot all four scenes at 390×844 and 1440×900. Upper matras not clipped, no
      letter-spacing on Devanagari, `01 / 04` gone, tags read as gold outlines.
- [x] `prefers-reduced-motion: reduce` once — stills only, no clip-path, no drift.
- [x] `document.fonts.check("1rem 'Anek Devanagari'")` is true and Hind is no longer requested.

Do not commit or push unless asked.
