# Package patches

Applied automatically by `patch-package` via the `postinstall` script - no manual step needed
after `npm install`.

## @niivue/niivue+0.68.1

Three performance fixes to the volume display pipeline (full background and benchmarks in
`notes/other/visualization-performance-investigation.md`):

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

Net effect: `nv.updateGLVolume()` ~920 ms → ~5 ms, and a continuous cal-slider drag stays at
~25 ms/frame indefinitely (was: degrading to 130–500 ms/frame after a few seconds of dragging).

**When upgrading @niivue/niivue:** check whether upstream has fixed this (0.69.0 had not); if not,
re-apply the same three edits to the new version's `build/niivue/index.js` and `dist/index.js`,
then run `npx patch-package @niivue/niivue` and delete the old patch file.
