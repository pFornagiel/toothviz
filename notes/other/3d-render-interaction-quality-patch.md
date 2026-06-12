# Method B: adaptive ray step-size during interaction (design / how-to)

Status: **not implemented** — design note. Companion to
`3d-render-performance-model.md` (the cost model) and the niivue perf patch
documented in `packages/application/frontend/patches/README.md`.

## Why this exists

The shipped mitigation lowers `nv.devicePixelRatio` while dragging the 3D
render tile (see `RENDER_DRAG_DPR_SCALE` in `VisualizationPage.tsx`). That knob
resizes the **whole drawing buffer**, so in the Multiplanar / 4-view layouts it
also softens the 2D slice tiles that share the canvas — niivue composites every
tile into one buffer and exposes no per-tile resolution.

Method B attacks the *other* factor of the cost model instead:

```
cost ≈ (pixels covered) × (samples per ray)     // DPR cuts the first factor
                                                  // step-size cuts the second
```

By increasing the raycaster's **step size** during interaction we take fewer
samples per ray. This lives entirely in the volume-render fragment shader, so by
construction it speeds up **only** the 3D render:

- The 2D slice tiles are drawn by a different shader (`sliceRenderer`) with no
  ray-march — one texture lookup per pixel. They are untouched regardless of
  layout, so they stay pixel-sharp even in Multiplanar / 4-view.
- It accelerates the **overlay** pass too: the shared `rayMarchPass` (overlay,
  PAQD, drawing) derives its step from the same `deltaDir.w`, so a coarser step
  cuts the segmentation-mask traversal as well as the background.

It composes multiplicatively with the DPR downscale — you can ship both and get
the product of the two speedups, or replace the DPR approach with this one if
keeping the slices sharp matters more than the (smaller) per-tile pixel win.

Trade-off: a coarser step can introduce faint "wood-grain" banding / sparkle on
the volume *while dragging* (the ray jitter `ran` hides most of it). Full
quality returns the instant the drag ends. This is the standard
interaction-time LOD trade and is visually acceptable for navigation.

## Where the cost lives (current code)

In the patched build, `node_modules/@niivue/niivue/dist/NVViewGL-*.js`, the
volume-render fragment shader computes one sample per voxel:

```glsl
float stepSize = len / lenVox;            // 1 sample per voxel along the ray
vec4 deltaDir = vec4(dir * stepSize, stepSize);
...
float stepSizeFast = stepSize * 1.9;      // fast (empty-space) pass
vec4 deltaDirFast = vec4(dir * stepSizeFast, stepSizeFast);
```

Both the background fast/fine passes and the shared `rayMarchPass(overlay, …)`
march by `deltaDir.w == stepSize`. Scaling `stepSize` by a factor `q ≥ 1`
multiplies the spacing, so the number of fine-pass iterations drops ~`1/q`
(the loop terminates on `samplePos.a > len`, which is unaffected by the larger
increment; the fixed iteration caps 1024/2048 stay correct).

There are **two** `float stepSize = len / lenVox;` occurrences in the file. Edit
**only** the one in the main volume-render shader — the template that declares
`uniform float numPaqd;` and (after the background-opacity patch) the
`uniform float backOpacity;` line, and contains `colAcc *= backOpacity;`. The
other occurrence belongs to a different shader and must stay at full sampling.

## Implementation plan

This mirrors the existing `backOpacity` patch exactly (same files, same style),
so it slots into the same `patch-package` patch. Four edit points:

### 1. Declare the uniform (fragment shader)

In the main render shader's uniform block, next to the existing additions:

```glsl
uniform float numPaqd;
uniform float backOpacity;   // existing patch
uniform float qualityStep;   // NEW: ray step multiplier, 1.0 = full quality
```

### 2. Scale the step (fragment shader)

```glsl
// was: float stepSize = len / lenVox;
float stepSize = (len / lenVox) * max(qualityStep, 1.0);
```

`max(…, 1.0)` guards against accidental sub-1 values that would *increase* cost
or alias badly. `deltaDir`, `stepSizeFast`, and the overlay/PAQD/drawing passes
all inherit the new spacing automatically — no other shader edit needed.

### 3. Thread the value through `draw()` (renderer class `Mr`)

Follow the `__backOpacity` precedent. Add a trailing parameter and set the
uniform alongside the others:

```js
// signature — add the parameter after __backOpacity:
draw(e, r, i, o, a, s, n, d, f, c, u = !1, l = [0, 0, 0, 0], __backOpacity = 1, __qualityStep = 1) {

// in the long uniform-setting expression, after the backOpacity uniform:
h.uniforms.qualityStep && e.uniform1f(h.uniforms.qualityStep, Math.max(__qualityStep, 1)),
```

### 4. Pass it at the call site (engine class, `render()` / draw-scene path)

The single `this.volumeRenderer.draw(...)` call currently ends with
`r.volume.paqdUniforms, x.opacity ?? 1` (where `r = this.model`, `x` = the
background volume). Add the step argument, read from a model field so it can be
driven from outside:

```js
this.volumeRenderer.draw(
  e, A, E, D, x.volScale, U, r.volume.illumination, Math.min(T.length, 2),
  r.scene.clipPlaneColor, r.clipPlanes, r.scene.isClipPlaneCutaway,
  r.volume.paqdUniforms,
  x.opacity ?? 1,
  r.volume.interactiveStepScale ?? 1   // NEW
);
```

`r.volume` is the document's volume-render options object (it already holds
`illumination`, `paqdUniforms`, `matcap`), so stashing `interactiveStepScale`
there keeps it with related state and makes it visible at the draw call without
new plumbing.

### 5. Public setter (control class — the `NiiVue` instance)

So the React app can drive it like `devicePixelRatio`, add a getter/setter on
the control class that writes the model field and redraws:

```js
get renderInteractiveStepScale() { return this.model.volume.interactiveStepScale ?? 1; }
set renderInteractiveStepScale(t) {
  this.model.volume.interactiveStepScale = Math.max(t, 1);
  this.drawScene();
}
```

(If adding a named accessor to the minified class is awkward, the app can set
`nv.<model>.volume.interactiveStepScale` directly and call `nv.drawScene()` —
but the public setter is cleaner and matches the `devicePixelRatio` ergonomics.)

After editing the dist files, regenerate the patch:

```bash
cd packages/application/frontend
npx patch-package @niivue/niivue          # rewrites the .patch
rm -rf node_modules/.vite                 # drop vite's niivue prebundle
```

## App wiring (`VisualizationPage.tsx`)

Drive it from the exact same drag handlers that already toggle resolution. In
the render-tile pointer effect, alongside `beginInteractiveResolution` /
`endInteractiveResolution`:

```ts
const RENDER_DRAG_STEP_SCALE = 2.0; // 2x coarser ray sampling while dragging

const beginInteractiveQuality = () => {
  const nv = nvRef.current;
  if (!nv) return;
  nv.renderInteractiveStepScale = RENDER_DRAG_STEP_SCALE;
};
const endInteractiveQuality = () => {
  const nv = nvRef.current;
  if (!nv) return;
  nv.renderInteractiveStepScale = 1;
};
```

Call `beginInteractiveQuality()` in `handlePointerDown` (right after
`beginInteractiveResolution()`), `endInteractiveQuality()` in `endDrag`, and in
the effect cleanup if a drag is in flight — identical lifecycle to the DPR knob.

Because this targets only the render shader, it can run in **every** layout
(Render, Multiplanar, 4-view) without softening the slices — which is the
property the DPR approach can't provide in mixed layouts.

## Expected gain

`3d-render-performance-model.md` measured the overlay case on the 512³ float64
CBCT (Intel UHD 620) at ~9.7 fps (soft-tissue window) / ~16 fps (bone) full-res.
The fine-pass sample count scales ~`1/q`, so `q = 2` should roughly halve the
ray-march work where the render is sampling-bound. Real gain depends on how much
of the frame is ray-march vs the fixed texture-bandwidth floor (the same floor
that capped the DPR win at ~1.7× rather than 4×), so **measure** rather than
assume.

## Validating it

Reuse the FPS harness pattern from the investigation (an ESM bundle of
`niivuegpu.webgl2.js` driven in Playwright, `nv.azimuth` swept while timing
`nv.view.render()` + `gl.finish()` + a 1×1 `readPixels`). Add a `stepScale`
axis to the grid and confirm:

1. Render-mode frame time drops ~`1/q` for the sampling-bound configs.
2. A 2D-only layout (Axial) frame time is **unchanged** by `stepScale` —
   proves the slices are untouched.
3. Output at `q = 1` is byte-identical to the pre-patch render (regression gate,
   same `fnv1a` framebuffer checksum the niivue-bench harness uses).

## Interaction with existing patches & upgrades

- Independent of the background-orient cache / gradient-gating / backOpacity
  patches — it only adds a uniform and scales a local. No cache key changes.
- On a niivue upgrade the chunk hashes and minified identifiers
  (`Mr`, `r`, `x`, `h.uniforms`) will differ. Re-find the anchors by the stable
  GLSL strings (`float stepSize = len / lenVox;`, the `numPaqd`/`backOpacity`
  uniform block) and the `volumeRenderer.draw(` call site, then regenerate the
  patch as above. If upstream has added its own interaction-LOD knob by then,
  prefer it and drop this.
