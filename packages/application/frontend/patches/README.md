# Package patches

Applied automatically by `patch-package` via the `postinstall` script - no manual step needed
after `npm install`.

## @niivue/niivue+1.0.0-rc.8

Performance patch for the WebGL2 backend (the app pins `backend: webgl2` by importing
`@niivue/niivue/webgl2`, so the WebGPU backend is intentionally left stock and out of the
bundle). Background and benchmarks for the equivalent 0.68.1 patch live in
`notes/other/visualization-performance-investigation.md`; the underlying problem is unchanged
in the 1.0 rewrite for the *background* volume, while upstream already fixed it for overlays.

Upstream rc.8 caches the overlay layer's orient pipeline (`overlayOrientCache`: raw 3D texture,
colormap textures, FBO, VAO) and re-runs only the cheap orient render pass when display
parameters change. But the background volume (layer 0) still re-uploads the full raw volume
(CPU dtype conversion + `texSubImage3D`, ~500 ms for a large float64 CBCT) **and** recomputes
the full gradient 3D texture (blur/Sobel passes over every slice, ~390 ms) on every
`updateGLVolume()` — i.e. on every calMin/calMax/opacity/colormap tick.

The patch (all in `dist/NVViewGL-*.js` unless noted):

1. **Background orient cache.** `updateVolume` now routes the background volume through the
   same `Fe`/`we` orient-cache machinery upstream built for overlays
   (`backgroundOrientCache`). Cache key (upstream's): datatype, shader type, frame4D,
   `img.buffer` identity, in/out dims. Cache hit = one orient render pass with fresh
   calMin/calMax uniforms (~tens of ms) instead of a full re-upload. RGB/RGBA volumes
   (datatype 128/2304) keep the stock uncached path, mirroring upstream's overlay logic.
2. **Colormap hot-swap on cache hit** (helps background *and* overlays). Upstream invalidates
   the whole cache when the colormap changes, re-uploading the raw volume. The patch instead
   re-uploads only the 256×1 colormap LUT textures in place and re-runs the orient pass.
   Label colormaps (atlas LUTs) still take the full rebuild path — they change texture
   dimensions and filtering.
3. **Gradient gating.** The gradient texture is computed on first load (the volume-render
   shader refuses to draw without it) but is *not* recomputed on subsequent updates unless
   `volumeIllumination !== 0`. With illumination at 0 the shader's
   `mix(vec3(1.0), matcapShade, gradientAmount)` makes the gradient's content a visual no-op,
   so a stale gradient is invisible. To keep illumination correct,
   `set volumeIllumination` (in `dist/NVControlBase-*.js`) now triggers `updateGLVolume()`
   instead of just `drawScene()`, which recomputes the gradient from the current cal window
   the moment illumination is enabled.
4. **Matcap reuse.** Stock re-decoded and re-uploaded the matcap 2D texture on every update;
   it is now cached by name and reloaded only when the name changes (`loadMatcap()` goes
   through `updateGLVolume`, so the documented path picks this up).
5. The renderer's `destroy()` releases the new background cache alongside the existing
   resources.

Net effect on the 410×410×268 float64 CBCT: a cal/opacity slider tick costs one orient pass
instead of raw re-upload + gradient recompute (~900 ms → ~tens of ms), and a colormap switch
costs the same instead of a full re-upload. Texture churn is also gone: the cache reuses the
same input/output textures across updates, so long slider drags no longer accumulate GPU
memory pressure (the rc.8 equivalent of the old round-2 `rgbaTex` pooling fix).

Notes on what did NOT need porting from the 0.68.1 patch: the drag/resize redraw fixes
(old patches 4-6) are obsolete — rc.8's `drawScene()` is rAF-coalesced (`framePending`) and
`updateGLVolume()` has single-flight coalescing (`_updating`/`_pendingUpdate`), so redundant
draw requests collapse to one render per frame by design.

## NiiVue Upgrade

**When upgrading @niivue/niivue:** check whether upstream now caches the *background* volume's
orient pipeline and gates the gradient recompute (rc.8 did not); if not, re-apply the edits to
the new `dist/NVViewGL-*.js` / `dist/NVControlBase-*.js` (chunk hashes in the filenames will
differ), then run `npx patch-package @niivue/niivue`, delete the old patch file, and clear
vite's prebundle cache (`rm -rf node_modules/.vite`).
