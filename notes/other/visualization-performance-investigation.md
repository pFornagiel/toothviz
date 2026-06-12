# Visualization performance investigation (2026-06-09)

> **Updated later the same day — round 2.** The fixes below removed the per-call
> `updateGLVolume` cost, but two further problems remained; see
> "Round 2: GPU texture churn and the render tile" at the end of this file.
> For why the 3D render view's *per-frame* cost depends on cal_min and window
> size (inherent raycasting cost, not fixed by the patch), see
> `3d-render-performance-model.md`.

## Symptom

The visualization screen became very slow when editing calibration (cal_min/cal_max) or opacity,
and sometimes when simply interacting with the image (right-drag). Dragging a cal slider could
freeze the UI for tens of seconds.

## Method

Profiled the real renderer over the Chrome DevTools Protocol: a second Electron instance with
`--remote-debugging-port` loaded the same vite dev URL, the Niivue instance was located through the
React fiber tree, and `Profiler`/`Input`/`PerformanceObserver` domains were used to benchmark,
CPU-profile, and drive real slider/canvas mouse events. Test data: study
`visualization_2026-06-07_15:57:32` (ToothFairy3F_009_0000.nii.gz, 410×410×268 voxels, **float64**,
360 MB decoded).

## Root causes

Verdict: **a niivue architectural cost, amplified by our UI and our data format.**

1. **niivue (architecture):** `nv.updateGLVolume()` → `refreshLayers()` redoes the *entire* volume
   display pipeline on every call, even when only a display parameter changed:
   - converts the voxel array (float64 → float32 for WebGL) and re-uploads the full raw volume via
     `texSubImage3D` — ~500 ms — although the voxel data never changes when adjusting cal/opacity;
   - recomputes a gradient 3D texture (`gradientGL`: blur + Sobel render passes over all 268
     slices, with a driver sync per slice) — ~390 ms — even though the gradient is only sampled
     when 3D render illumination is enabled (`gradientAmount > 0`; default 0, never enabled by us);
   - the part that actually applies cal_min/cal_max (the orient render pass) costs only ~30 ms.

   Measured: **~920 ms per `updateGLVolume()` call**, entirely main-thread-blocking.
   niivue 0.69.0 and 1.0.0-rc still behave the same (checked the published bundles).

2. **Our UI:** the cal sliders called `updateGLVolume()` on every `onChange` tick (step=1 over a
   −1000..3000 range) and the opacity slider on every 0.01 step. Chromium coalesces input events,
   so each 920 ms task was followed by the next queued tick → a 25-tick drag froze the page for
   **23–30 s** (worst observed frame gap: 2.1 s). Zoom/pan itself was never slow
   (`drawScene` ≈ 1.6 ms) — it only *felt* slow while queued slider updates blocked the thread.
   niivue's default right-drag = contrast adjustment also runs `refreshLayers` on release (~1 s
   stall), which explains "sometimes just controlling the image is slow".

3. **Our data:** the uploaded NIfTI stores float64 (datatypeCode 64) — 8 bytes/voxel that WebGL
   cannot use directly, forcing a 45M-element CPU conversion per update and a 4× larger upload.
   (The backend does not upcast — `dicom_fn.py` passes the source dtype through; this file was
   uploaded as float64.)

## Fixes applied

| Change | Effect (measured) |
|---|---|
| niivue patch 1: skip `gradientGL` unless gradient illumination is in use | 920 ms → ~350 ms |
| niivue patch 2: cache the raw 3D texture per layer; re-upload only when `volume.img` identity / `frame4D` changes | 350 ms → **4–15 ms** |
| `VisualizationPage`: opacity/cal slider changes go through `queueNvUpdate` (rAF-coalesced, latest value wins) | ≤1 niivue update per frame, live preview |
| `VisualizationPage`: removed leftover debug `console.log`s | noise removal |

Files:
- `packages/application/frontend/patches/@niivue+niivue+0.68.1.patch` — applied automatically by
  `postinstall: patch-package` (see `patches/README.md`)
- `packages/application/frontend/src/app/pages/VisualizationPage.tsx`
- `packages/application/frontend/package.json` (+ `patch-package` devDependency)

## Verification (end-to-end, real input events on the patched build)

- `updateGLVolume()` with warm cache: **4–15 ms** (was ~920 ms).
- 25-tick cal-slider drag: live updates each frame, **zero long tasks** (was 23 s frozen).
- Wheel zoom ×20: worst frame gap 33 ms.
- Right-drag contrast windowing: zero long tasks.
- Multiplanar, 4-view, 3D render, colormap switching all visually correct (the default render
  shader never samples the gradient texture, so skipping it changes nothing while
  `gradientAmount == 0`).

## Caveats

- The texture cache keeps the raw volume resident on the GPU (~180 MB for this scan) — fine for a
  desktop app, and roughly offset by no longer allocating gradient textures.
- The cache is invalidated by `volume.img` *identity*; in-place mutation of the array would show
  stale data (nothing in niivue or our code does this today).
- If 3D render illumination is ever enabled (`setVolumeRenderIllumination(>0)`), niivue recomputes
  the gradient through `refreshLayers` as before — the gate only skips it while unused.

## Future work

1. **Upstream it.** File an issue/PR against niivue/niivue with these numbers; both changes are
   generally useful (any large volume suffers). Until then the patch must be re-generated when
   upgrading `@niivue/niivue` (re-apply the two edits to the new `build/niivue/index.js` +
   `dist/index.js`, then `npx patch-package @niivue/niivue`).
2. **Normalize dtype at ingest.** Converting float64 sources to float32 (lossless enough here) or
   int16 at upload/conversion time cuts file size, decode time, JS heap (360 MB → 90–180 MB) and
   the one cold upload proportionally. Needs a decision about migrating already-stored studies.
3. Optional UI polish: pre-existing lint warnings in `VisualizationPage.tsx` (`routeState` useMemo,
   clip-plane effect deps) are unrelated but easy wins.

## Why a patch file, and the alternatives considered

`refreshLayers` calls module-private bundle functions (`gradientGL`, `setupVolumeTextureData`,
`renderToOutputTexture`, …) that the package does not export. The public `nv.gradientGL()` method
exists but is *not* what `refreshLayers` invokes internally, so there is no seam to hook from
application code:

- **Runtime monkey-patching** — not viable. Overriding `Niivue.prototype.refreshLayers` would mean
  copying ~150 lines of niivue internals (plus their private helpers) into our codebase; that copy
  silently diverges on every niivue release. Intercepting at the raw WebGL level
  (`gl.texSubImage3D`) cannot detect "same data" cheaply and cannot skip the gradient passes.
- **Vite transform plugin** — possible (string-replace the same code during bundling), but it is
  the same fragile text edit as the patch, with extra complexity: niivue must be excluded from
  `optimizeDeps` so the plugin sees it in dev, and the edit is hidden inside build config instead
  of a reviewable diff. No real advantage over patch-package.
- **Forking/vendoring niivue** — maximum control, much higher maintenance for two small edits.
- **patch-package (chosen)** — the diff lives in the repo (`patches/`), is applied automatically on
  `npm install`, fails loudly (instead of silently) if a niivue upgrade changes the patched code,
  and is the standard tool for exactly this situation.

---

# Round 2: GPU texture churn and the render tile (2026-06-09, later)

## Symptom

With the round-1 fixes in place, dragging a cal slider *still* made the visualization
progressively slower, and a larger canvas (bigger window / hidden sidebar) made everything slower.

## Method

Same CDP rig (Electron `--remote-debugging-port`, vite dev URL, Niivue found via the React fiber
tree). Key change vs round 1: measurements were **rAF-paced** (one `updateGLVolume` per animation
frame, like the real `queueNvUpdate` path) and ran for 200–300 updates, where round-1 verification
only ran short bursts — which is why these problems were missed. GPU: Intel UHD 620 (Mesa/ANGLE,
hardware accelerated).

## Root causes

1. **GPU texture churn → memory-pressure stalls (the "becomes slower" bug).** Every
   `refreshLayers` call passes the old output texture to `rgbaTex`, which **deletes it and
   creates a new one** — a full-volume RGBA8 3D texture, ~180 MB for the 410×410×268 scan. The
   driver defers reclamation, so a cal drag allocates ~180 MB of GPU memory *per tick*. After
   ~40 ticks the driver hits memory pressure and every subsequent frame stalls. Measured
   (rAF-paced, 200 cal ticks, canvas 2240×1356): frame-gap median **146 ms**, p90 300 ms, max
   524 ms, **197/200 frames > 100 ms** (~7 fps). The JS call itself returns in ~3 ms — all the
   damage is in the GPU pipeline, which is why short benchmarks looked fine.
2. **True GPU memory leak in the overlay path.** For layer 1, `allocateVolumeTextures` calls
   `rgbaTex(null, TEXTURE2_OVERLAY_VOL, …)` — the old `overlayTexture` is *never deleted*. Every
   cal/opacity/colormap tick leaks a full-volume texture whenever a segmentation overlay is
   loaded (this app's normal case after a pipeline run).
3. **The 3D render tile in "Multiplanar" scales with canvas size.** `multiplanarShowRender`
   defaults to AUTO, so plain multiplanar view included a volume-render tile whenever there was
   room. That tile raycasts the whole volume per pixel per frame: at 2240×1356 it cost ~13 ms of
   the ~29 ms `drawScene` (measured 29.4 ms with tile vs 16.7 ms without). On an iGPU this is the
   "bigger canvas → slower" effect.

## Fixes applied

| Change | Effect (measured, rAF-paced 200-tick cal drag @ 2240×1356) |
|---|---|
| niivue patch 3: pool the volume/overlay output textures in the `rgbaTex` method (`__volTexPool`); reuse while dims unchanged, delete the old overlay texture the stock code leaked | frame gap 146 ms median / 197 long frames → **25 ms median / 0 frames > 100 ms**, no degradation over time |
| `VisualizationPage`: `multiplanarShowRender: SHOW_RENDER.NEVER` by default; `ALWAYS` only in "Multiplanar (4 Views)" | `drawScene` 29 ms → 17 ms at 1440p in default multiplanar; render tile still shown in 4-view mode |

Only the `TEXTURE0_BACK_VOL`/`TEXTURE2_OVERLAY_VOL` units are pooled: other `rgbaTex` callers
(e.g. the per-call blend texture) are deleted directly by niivue afterwards, so caching them
would reuse deleted handles.

## Verification

- 200 rAF-paced cal ticks @ 2240×1356: median frame gap 25.8 ms (~40 fps), max 36 ms, zero
  frames > 100 ms, `gl.getError() === 0`, and no degradation across 300+ updates (was: degraded
  permanently after ~40).
- Cal drag in 4-view mode (render tile active): 50 ms median, zero long frames.
- Cached render path is **pixel-identical** to a forced fresh-upload render (canvas hash compared).
- Multiplanar / 4-view / render / colormap / opacity switching all visually correct via
  screenshots; the 4-view mode still shows the 3D render tile.

## Caveats

- Steady-state GPU residency is unchanged vs round 1 (raw volume + one output texture per
  layer); the pool only removes per-tick churn.
- A cal drag is now bounded by real GPU work (~25 ms/frame at 1440p ≈ orient pass + slice
  draws on the UHD 620); discrete GPUs will be faster.
- The remaining "future work" items from round 1 (upstream the patch, normalize dtype at
  ingest) still stand; the upstream issue should now also mention the overlay-texture leak,
  which affects any niivue app with overlays, not just large volumes.

---

# Round 3: drag rotation 3× slower than slider rotation (2026-06-10)

## Symptom

In the 3D render view, rotating via the azimuth/elevation sliders is smooth, but rotating by
dragging the view with the mouse is sluggish — even though both end in the same camera update.

## Method

Vite dev URL driven via agent-browser; Niivue instance located through the React fiber tree,
`nv.drawScene` wrapped with a counter, and synthetic mousedown/mousemove sequences dispatched on
the canvas, compared against an equivalent `setRenderAzimuthElevation` loop.

## Root cause

A left-drag uses niivue's default `dragModePrimary: crosshair`. For every mousemove during the
drag, `mouseMoveListener` calls `drawScene()` **three times**:

1. an unconditional pre-draw at the top of the listener (before any state changed);
2. the rotation draw inside `mouseMove()` (the only one that matters — it updates
   azimuth/elevation);
3. a post-draw after two `mouseClick()` calls — both of which are no-ops in the render tile
   (`mouseClick` returns immediately when `inRenderTile` and `posChange === 0`).

Crucially, `drawScene()` ends with `gl.finish()`, a full synchronous CPU↔GPU sync, so each
raycast render blocks the main thread for its entire GPU duration. Per mouse event the drag path
therefore stalls for **3 full raycast frames** where the slider path
(`setRenderAzimuthElevation` → one `drawScene`) stalls for 1. With the per-frame raycast cost
model from `3d-render-performance-model.md` (large canvas × high cal_min ⇒ 13–30+ ms/frame on an
iGPU), drag = 40–90+ ms blocked per mousemove vs 13–30 ms for the slider — exactly the observed
"sliders smooth, drag sluggish".

Measured (Iguana.nii.gz, synthetic 20-move drag): stock = 3 draws per mousemove, slider path =
1 draw per change. React is not involved: `scene.onAzimuthElevationChange` is never wired to the
Niivue-level callback during drags, so no per-event re-render occurs.

## Fix applied (niivue patch 4)

In `mouseMoveListener`: when the pointer is mousedown in crosshair drag mode inside the render
tile, skip the unconditional pre-draw and return immediately after `mouseMove()`'s rotation draw
(also skipping the two no-op `mouseClick` calls and the third draw). One draw per mouse event,
same rotation math.

## Verification (patched build, real DOM events via agent-browser)

- Render view drag: 3 → **1 draw per mousemove**; identical rotation delta for the same drag
  (80° azimuth over 20 moves, before and after); render visually correct (screenshots).
- 4-view mode render tile drag: 1 draw per mousemove, rotation works.
- 2D crosshair drag in multiplanar: unchanged (2 draws per move, crosshair follows the mouse) —
  the gate only fires inside the render tile.
- Right-drag windowing on a 2D slice: works, no JS errors (path untouched).

## Notes

- Patch regenerated into `patches/@niivue+niivue+0.68.1.patch` (now 4 fixes); README updated.
- Remaining per-frame raycast cost is inherent (see the cost-model note); if rotation still feels
  heavy on an iGPU at large window sizes, the next lever is interaction-time resolution/step-size
  reduction, not event handling.

---

# Round 4: remaining redundant redraws + a lost-update bug (2026-06-10, later)

Follow-up sweep for the same class of problem as round 3 ("unneeded re-rendering, not inherent
raycast cost"). Three more found.

> **Adoption status (updated after testing):** after the initial three-part change the
> visualization "behaved weird", so the set was stashed and only item 1 (niivue patch 5,
> the redundant pre-draw removal) was re-applied and re-verified in isolation. Item 2
> (resize coalescing) is NOT currently applied — it lives in the git stash (`patch_for_patch`).
> Item 3 (keyed queueNvUpdate) was subsequently applied: `VisualizationPage.tsx` uses a
> `Map<NvUpdateKey, () => void>` queue keyed by `enum NvUpdateKey`, so the lost-update bug
> (resetSettings dropping zoom and cal_min) is fixed. A false alarm to be aware of when
> re-testing: right-drag contrast intentionally does nothing when the selection box covers a
> uniform (e.g. all-black) region — `calculateNewRange` skips selections with no intensity
> variation; that is stock niivue behavior, not a regression.

## 1. niivue patch 5: pre-draw on every drag mousemove (2× drag cost everywhere)

The unconditional `drawScene()` at the top of `mouseMoveListener` runs *before* any state is
mutated, and every mousedown branch below it already draws *after* mutating state (crosshair via
`mouseClick`'s internal draw, windowing, drag-selection via `setDragEnd`+draw). So all 2D drags
paid 2 draws per mousemove — and in 4-view mode each draw includes the render-tile raycast.
Removed the pre-draw entirely (patch 4's render-tile gate had already removed it for render
rotation; this generalizes it). Measured: 2D crosshair drag and right-drag windowing both went
2 → 1 draw per mousemove; crosshair still follows, windowing still applies on release.

## 2. niivue patch 6: doubled resize pipeline

`attachToCanvas` registers BOTH a window `resize` listener and a `ResizeObserver` on the canvas
parent; each independently rAF-schedules `resizeListener` (canvas reallocation + full redraw).
A window resize triggers both → the full pipeline ran twice per resize frame. A shared
`__resizePending` flag now coalesces them. Measured: 3 triggers in one frame → 1 run (was 2).

## 3. VisualizationPage: `queueNvUpdate` single-slot lost-update bug

The rAF coalescing queue held ONE pending closure for ALL update types — `queue.current = apply`
(latest wins *across different settings*). `resetSettings` queues the zoom reset, then the same
React commit fires the cal_min effect (overwrites the zoom closure) and the cal_max effect
(overwrites the cal_min closure): only cal_max ever reached niivue. Zoom and cal_min on the nv
side stayed stale while the UI showed reset values — a correctness bug, not just perf.
Fixed by keying the queue (`Map<NvUpdateKey, () => void>`, enum keys: cal_min/cal_max/opacity/
render_zoom/clip_plane): latest-wins per setting, all settings applied in one rAF flush.
`setClipPlane` (clip-plane effect, incl. shift+wheel depth) now also goes through the queue.
Verified end-to-end: dirty cal_min/cal_max/zoom via UI sliders → Reset → all three nv-side
values restored (stock dropped two of them); clip plane slider still applies (visually checked).

Also: `VisualizationPage.test.tsx`'s Niivue mock was missing `setClipPlane`/`setScale`/etc. —
completed it; 61/61 tests pass with no unhandled errors (at HEAD the suite already had 1 failure).

## Things checked and deliberately left alone

- `gl.finish()` at the end of `drawScene` — blocks the main thread per draw but provides natural
  backpressure (input events can't queue more GPU work than the GPU absorbs). Removing it would
  pipeline frames but risks unbounded queuing; not worth it while every interaction is 1 draw.
- `updateGLVolume()` refreshes ALL layers when one volume's display param changes (2× orient work
  with an overlay loaded). Per-call cost is ~5-15 ms post-patch; per-layer refresh would be an
  invasive niivue change for little gain.
- `mouseDownListener` double-draw on click (handleMouseAction draw + trailing draw) — one extra
  frame per click, not per move; negligible.
- App wheel-zoom calls `nv.setScale` per wheel event (uncoalesced): events arrive ≈1/frame for
  mice; measured fine earlier (33 ms worst gap at ×20 zoom). Coalescing would need a pending-
  target ref to keep multiplicative compounding; complexity not justified yet.

---

# Round 5: migration to niivue 1.0.0-rc.8 ("NiiVueGPU" rewrite) (2026-06-11)

The app moved from patched 0.68.1 to `@niivue/niivue@1.0.0-rc.8` from the niivue/mono
monorepo — a full WebGPU/WebGL2 rewrite with a new flat property API, CustomEvent-based
events, and `setVolume(idx, {calMin, ...})` batched display updates. The app pins the
WebGL2 backend (`@niivue/niivue/webgl2` entry).

Perf status of the rewrite, verified by reading the published rc.8 bundles:

- **Fixed upstream:** redundant draws (rounds 3–4) — `drawScene()` is rAF-coalesced
  (`framePending`) and `updateGLVolume()` single-flights; overlay layers got a proper
  orient cache (`overlayOrientCache`: raw texture + FBO reused, only the orient pass
  re-runs on display-param changes). Old patches 1–6 are all obsolete as written.
- **Still broken upstream for the background volume:** `updateVolume` deletes and
  re-uploads the raw 3D texture AND recomputes the gradient texture on every
  `updateGLVolume()` — same pathology as round 1, now scoped to layer 0.

New patch (`patches/@niivue+niivue+1.0.0-rc.8.patch`, see `patches/README.md`): routes the
background volume through upstream's own overlay orient-cache machinery, hot-swaps colormap
LUTs on cache hit, computes the gradient once and re-computes it only when
`volumeIllumination !== 0` (the render shader requires the texture to exist but ignores its
content at illumination 0), and caches the matcap by name.

Measured (Iguana.nii.gz, uint8 210×256×179, SwiftShader software GL via agent-browser):
`setVolume({calMin})` 1.2 ms median patched vs 13.6 ms stock-like (forced cache miss +
gradient recompute); 120 rAF-paced cal updates ran vsync-locked with zero frames > 100 ms
and `gl.getError() === 0`. The stock cost scales with volume bytes — the thesis float64
CBCT is ~38× the upload of Iguana, putting stock rc.8 back in the ~1 s/update class the
round-1 patch fixed.

Migration notes that affect future testing: `cal_min→calMin`/`global_min→globalMin`,
colormap names canonical-capitalized ("Gray"), `crosshairWidth` is world-space mm now
(app default 0.2), drag rotation does NOT emit `azimuthElevationChange` (React mirrors on
`pointerUp`), and React StrictMode/HMR can leave a destroyed instance in old fibers — pick
the one with `view.volumeRenderer.isReady` when probing.
