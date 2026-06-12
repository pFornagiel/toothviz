# Package patches

Applied automatically by `patch-package` via the `postinstall` script - no manual step needed
after `npm install`.

## @niivue/niivue+1.0.0-rc.8 — what is done where

The patch file is one flat diff over two dist chunks (`NVControlBase-*.js`, `NVViewGL-*.js`);
it has no notion of "which edit session added which hunk", so this section is the map. Hunks
are identified by their `@@ -<line>` header (the *original*, unpatched line number) plus a
content anchor. If the patch is ever regenerated against a different base these numbers move —
trust the anchors.

The WebGPU chunk (`NVViewGPU-*.js`) is intentionally NOT patched: the app pins the WebGL2
entry (`@niivue/niivue/webgl2`), which statically imports only `NVViewGL`.

### A. Gradient gating — skip the gradient texture while illumination is off (perf)

Stock rc.8 rebuilds the 3D gradient texture (blur + Sobel passes over the full volume) on
every `updateVolume`, even though it is only sampled when matcap illumination is enabled.

- `NVControlBase @@ -17987` — `volumeIllumination` setter calls `updateGLVolume()` instead of
  `drawScene()`, so turning illumination on builds the (until then skipped) gradient texture.
- `NVViewGL @@ -2847` — `updateVolume(e, r, i = "", d = !0)`: new "compute gradient" flag.
- `NVViewGL @@ -2857` (SHARED hunk, also B) — the `if (d || !this.volumeGradientTexture)`
  guard around the gradient build.
- `NVViewGL @@ -3621` — caller passes `this.model.volume.illumination !== 0` as the flag.

### B. Background orient cache + colormap hot-swap + matcap reuse (perf)

Stock rc.8 deletes and rebuilds the background volume's oriented RGBA texture (and the matcap
texture) on every `updateVolume`; display-parameter tweaks paid a full re-orient + re-upload.

- `NVViewGL @@ -1719` — in `Fe(...)` (orient pipeline with cache parameter): when the cached
  resources match the volume data and only the colormap changed (non-label), re-upload just
  the two 256×1 colormap LUT textures and re-run the cached orient render ("colormap
  hot-swap") instead of rebuilding the whole pipeline.
- `NVViewGL @@ -2765` — adds the `backgroundOrientCache` and `_matcapName` fields.
- `NVViewGL @@ -2857` (SHARED hunk, also A) — background volume goes through the cached
  orient pipeline (`Fe(..., __bg)`) instead of delete+rebuild (`Te`); RGBA/no-img volumes keep
  the stock path. Matcap texture is only re-created when the matcap *name* changed.
- `NVViewGL @@ -3070` — `destroy()` releases the cache and `_matcapName`.

### C. Background layer opacity in the 3D render (`backOpacity`)

Stock rc.8 ignores the background volume's `opacity` in the 3D render pass (only 2D slices
honored it). The patch fades the composited background by
`volumes[0].opacity` before the overlay passes, so `nv.setVolume(0, { opacity })` works in 3D.

- `NVViewGL @@ -2344` — `uniform float backOpacity;` declaration in the render fragment.
- `NVViewGL @@ -2704` (SHARED hunk, also D) — the `colAcc *= backOpacity;` line.
- `NVViewGL @@ -2987` — `draw(..., __backOpacity = 1)` parameter.
- `NVViewGL @@ -3006` — uploads the clamped uniform.
- `NVViewGL @@ -3814` — draw-loop caller passes `x.opacity ?? 1` (the background NVImage).

### D. Clip planes affect ALL volumes, not just the background

Stock rc.8 clips only the background pass; overlay/PAQD/drawing passes deliberately marched
the original unclipped ray, so overlays floated over the cut surface. The patch threads the
background's clip range (`sampleRange`/`cutaway`/`hasClip`) into every pass, in both normal
and cutaway mode, and into the depth-pick shader so clicks land on visible surfaces only.
Granularity is per-pass (all overlays share one composited texture), not per overlay volume.

- `NVViewGL @@ -426` — `isSampleClipped()` helper in the shared fragment preamble (used by
  both the render and depth-pick shaders).
- `NVViewGL @@ -448`, `@@ -2549` — comment-only updates ("overlay ignores clip planes" no
  longer true).
- `NVViewGL @@ -527` (comment), `@@ -536`, `@@ -546` — depth-pick shader: overlay fast/fine
  loops skip clipped samples.
- `NVViewGL @@ -2379`, `@@ -2396`, `@@ -2408` — `rayMarchPass` (overlay + drawing): clip
  params added to the signature; fast/fine loops skip clipped samples.
- `NVViewGL @@ -2444`, `@@ -2461`, `@@ -2474` — `rayMarchPaqd`: same.
- `NVViewGL @@ -2704` (SHARED hunk, also C) — the three call sites pass
  `sampleRange, cutaway, hasClip`.

### Removing a single change

`patch-package` applies each hunk *independently* against the pristine file: the `@@ -<line>`
original position is matched with up to ±20 lines of drift, and insert offsets are bookkept
only at apply time. Consequence: **deleting all hunks of one change from the patch file does
not break the remaining hunks.** Mind the two SHARED hunks though — `@@ -2857` mixes A+B and
`@@ -2704` mixes C+D; splitting those means editing inside a hunk and fixing the
`@@ -a,b +c,d` line counts by hand, which is fragile.

The always-safe procedure (also the only sane one for the shared hunks):

```bash
cd packages/application/frontend
npm run niivue:unpatch              # 1. reverse with the CURRENT patch file (do this FIRST)
# 2. re-apply only the edits you want to keep in node_modules/@niivue/niivue/dist/...
npx patch-package @niivue/niivue    # 3. regenerate the patch from the diff
rm -rf node_modules/.vite           # 4. vite prebundles niivue - always clear after patching
```

(Steps 3+4 are `npm run niivue:repatch`.) Never edit the patch file before reversing - the
reverse needs node_modules to match the patch being reversed. Then update this map.

## @niivue/niivue+0.68.1 (HISTORICAL — patch file no longer exists)

The notes below describe the patch for the pre-rewrite 0.68.1 architecture. They are kept
because the analysis (what was slow and why) still informs the rc.8 patch above; the file
references (e.g. `build/niivue/index.js`, `mouseMoveListener`) no longer apply.

Five performance fixes (full background and benchmarks in
`notes/other/visualization-performance-investigation.md`). Fixes 1-3 target the volume display
pipeline; fixes 4-5 remove redundant redraws in the drag handling:

1. Skip the gradient-texture recomputation (`gradientGL`, ~390 ms of blur/Sobel passes per call)
   unless gradient-based render illumination is actually enabled
   (`gradientTextureAmount > 0`, `renderGradientValues`, or `opts.gradientOpacity > 0`).
2. Cache the raw 3D volume texture per layer (`__rawTexCache`) so cal_min/cal_max/opacity/colormap
   changes skip the CPU dtype conversion + full GPU re-upload (~500 ms per call for a large
   float64 CBCT). The cache is invalidated when `volume.img` identity or `frame4D` changes.
3. Pool the volume/overlay *output* textures in the `rgbaTex` method (`__volTexPool`): stock
   niivue deletes and recreates the full-volume RGBA8 output texture (~180 MB for a 410³-class
   scan) on every `refreshLayers`, and the overlay path never deletes the old texture at all
   (a true GPU memory leak). The churn saturates GPU memory after ~40 updates and every
   subsequent frame stalls 130–500 ms. The pool reuses the texture while dims are unchanged;
   only the `TEXTURE0_BACK_VOL`/`TEXTURE2_OVERLAY_VOL` units are pooled (other `rgbaTex` callers,
   e.g. the per-call blend texture, are deleted directly by niivue and must not be cached).
4. Draw once per mousemove when rotating the 3D render by dragging. Stock `mouseMoveListener`
   calls `drawScene()` three times per mousemove on this path (an unconditional pre-draw, the
   rotation draw inside `mouseMove`, and a post-`mouseClick` draw), and every `drawScene` ends in
   a blocking `gl.finish()` — so each mouse event stalled the main thread for three full
   raycast frames while the azimuth/elevation sliders (one draw per change) stayed smooth. The
   patch returns right after the rotation draw when the crosshair-mode drag is inside the
   render tile; 2D-slice crosshair drags are unaffected.
5. Remove the unconditional pre-draw at the top of `mouseMoveListener`. Every mousedown branch
   of the listener already redraws *after* mutating state (crosshair via `mouseClick`,
   windowing, drag-selection via `setDragEnd`), so the pre-draw — which runs *before* any state
   changes — only repainted the previous frame a second time. All 2D drags (crosshair follow,
   right-drag windowing/contrast box) drop from 2 drawScene calls per mousemove to 1; in
   4-view mode each of those draws includes the render-tile raycast, so drag cost halves.

Net effect: `nv.updateGLVolume()` ~920 ms → ~5 ms, and a continuous cal-slider drag stays at
~25 ms/frame indefinitely (was: degrading to 130–500 ms/frame after a few seconds of dragging).
Drag-rotating the 3D render costs one raycast frame per mouse event instead of three, all other
drags one instead of two.

### Usage perspective

**Patch 1** - gradient skip. Fires on every single one of those interactions, for the background layer. Stock niivue rebuilt a 3D gradient texture (~390 ms of blur+Sobel passes) on each refresh, even though that texture is only ever sampled by the 3D illumination/matcap shaders, which this app never enables. So from the user's perspective: every slider tick, colormap change, and contrast drag silently paid for a lighting feature they can't even turn on. The skip is unconditional in practice here; if the app ever called setVolumeRenderIllumination(>0) or setGradientOpacity(>0), the gate reopens and gradients are computed as before.

**Patch 2**- raw volume texture cache. Fires whenever refreshLayers runs but the voxel data itself hasn't changed - which is every display-parameter tweak: cal sliders, opacity, colormap, visibility toggles, right-drag windowing. Stock niivue re-converted the 360 MB float64 array and re-uploaded all 45M voxels to the GPU on each of these (~500 ms), despite the data being identical. The cache makes those interactions skip straight to the cheap ~30 ms orient pass. It deliberately does not fire - i.e., a full upload still happens - the first time a scan is displayed, when the segmentation overlay loads after a pipeline run, when a different scan replaces the current one, or on a 4D frame change (no 4D data in this app). Those cold paths behave exactly like stock.

**Patch 3** - output texture pool. Fires in the same display-parameter scenarios as patch 2, but its benefit is cumulative rather than per-call. Stock niivue destroyed and reallocated a ~180 MB output texture on every refresh (and outright leaked the overlay's output texture each time). A user dragging a cal slider for a few seconds allocated gigabytes of GPU memory; after ~40 ticks the driver hit memory pressure and the whole app dropped to ~7 fps permanently, worst when a segmentation overlay was loaded - which is the normal state after running the pipeline. With the pool, the same drag stays at ~40 fps no matter how long it lasts or how many overlays are loaded.

**Patch 4** - single draw per rotation-drag event. Fires only while left-dragging inside the 3D render tile (the default `dragModePrimary: crosshair`). The two `mouseClick` calls it skips are no-ops in the render tile anyway (they return immediately at `inRenderTile`), so behavior is identical - only the two redundant raycast+`gl.finish` stalls per event are gone. Slider-driven rotation already drew once and is unchanged.

**Patch 5** - no pre-draw on drag mousemove. Affects every drag on 2D slices: moving the crosshair, right-drag windowing, and the contrast selection box. Each used to repaint the stale previous frame before painting the updated one. Most noticeable in "Multiplanar (4 Views)", where every repaint also raycasts the render tile. The removed draw always rendered from not-yet-updated state (pixel-identical to the frame already on screen), and every branch of the listener that mutates state still draws after the mutation - so no interaction loses a visible frame.

### Reverting patch 5 only (keeping patches 1-4)

Patches 4 and 5 both live in `mouseMoveListener`, so patch 5 cannot be dropped by deleting a
hunk from the patch file - revert it at the source instead. In BOTH bundles
(`node_modules/@niivue/niivue/build/niivue/index.js` and
`node_modules/@niivue/niivue/dist/index.js`), find `mouseMoveListener(e) {`. It currently
starts like this:

```js
mouseMoveListener(e) {
  const pos = this.getNoPaddingNoBorderCanvasRelativeMousePosition(e, this.gl.canvas);
  const __isRenderRotateDrag = this.uiData.mousedown && !!pos && ...;
  if (!pos) {
```

Re-insert the pre-draw between the `__isRenderRotateDrag` line and `if (!pos) {` (the
`!__isRenderRotateDrag` gate keeps patch 4, the single-draw render rotation, intact):

```js
  if (this.uiData.mousedown && !__isRenderRotateDrag) {
    this.drawScene();
  }
```

Then regenerate the patch file and clear vite's prebundle cache (it caches niivue):

```bash
cd packages/application/frontend
npx patch-package @niivue/niivue
rm -rf node_modules/.vite
```

Finally update this README (patch count + remove the patch 5 entry). To instead revert ALL
niivue patches temporarily: `git apply -R -p1 patches/@niivue+niivue+0.68.1.patch` from the
frontend directory (re-apply later with the same command without `-R`).

## NiiVue Upgrade

**When upgrading @niivue/niivue:** the dist chunk filenames carry content hashes
(`NVViewGL-ChZkTHkv.js` etc.), so the old patch will not apply to a new version. Check which
of the changes in the map above upstream has fixed; re-apply the remaining edits to the new
version's dist chunks in `node_modules`, run `npx patch-package @niivue/niivue`, delete the
old patch file, clear `node_modules/.vite`, and update the map in this README.
