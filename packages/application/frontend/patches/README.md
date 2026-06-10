# Package patches

Applied automatically by `patch-package` via the `postinstall` script - no manual step needed
after `npm install`.

## @niivue/niivue+0.68.1

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

**When upgrading @niivue/niivue:** check whether upstream has fixed this (0.69.0 had not); if not,
re-apply the same five edits to the new version's `build/niivue/index.js` and `dist/index.js`,
then run `npx patch-package @niivue/niivue` and delete the old patch file.
