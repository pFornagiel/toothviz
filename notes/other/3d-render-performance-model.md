# Why the 3D render speed depends on cal_min and window size (2026-06-09)

Companion to `visualization-performance-investigation.md`. That file covers the
*update* path (cal/opacity changes, texture churn — fixed via the niivue patch).
This note explains the remaining *per-frame* cost of the 3D render view, which is
inherent to how niivue draws it and is **not** addressed by the patch.

## The cost model

niivue's 3D render is a per-pixel **raycaster**: every screen pixel covered by the
render tile shoots a ray through the 3D volume texture and samples it step by step,
every frame. The total per-frame cost is roughly:

```
cost ≈ (physical pixels covered by the render) × (samples per ray)
```

The two symptoms we observed are the two factors of this product:

| Symptom | Factor it raises |
|---|---|
| Larger window / hidden sidebar → slower | pixels covered (scales with **area**: 2× width and height = 4× rays) |
| cal_min raised above ~300 (bone only) → slower rotation | samples per ray (see below) |

They multiply, so a high cal_min in a maximized window is the worst case.

## Why a *higher* cal_min is slower (counterintuitive)

The only optimization in the ray loop is **early ray termination**: the ray stops
once accumulated opacity passes 0.95
(volume-render fragment shader in `dist/NVViewGL-*.js` for rc.8; was
`build/niivue/index.js:26813-26823` in 0.68.1):

```glsl
samplePos += deltaDir;            // advance ray position
...
colAcc = (1.0 - colAcc.a) * colorSample + colAcc;
if ( colAcc.a > earlyTermination ) // = 0.95
    break;
```

- **Low cal_min (skin visible):** soft tissue maps to an opaque color. Rays hit the
  skin surface almost immediately, saturate, and terminate after ~5–20 samples.
  An opaque surface is the *cheap* case.
- **cal_min > ~300 (bone only):** skin/muscle/fat now map to alpha ≈ 0, so they
  accumulate nothing. Each ray marches sample-by-sample through all that
  transparent tissue until it reaches bone deep inside the head — or exits the far
  side without hitting anything (worst case: full traversal). Hundreds of samples
  per ray, i.e. ~10–50× more 3D-texture fetches per pixel.

niivue has no empty-space skipping (no min/max octree or distance map), so
transparent voxels are sampled one at a time at full rate. Showing *less* therefore
costs *more*.

## Other notes

- **Physical** pixels count: a 2× HiDPI display pays 4× the rays for the same
  apparent window size.
- The 2D slice views are nearly free by comparison (one texture lookup per pixel,
  no marching). This is why plain Multiplanar got fast once the hidden render tile
  was disabled (`multiplanarShowRender: SHOW_RENDER.NEVER`; the tile is only drawn
  in "Multiplanar (4 Views)"). Window-size sensitivity is essentially confined to
  the 3D render view and the 4-view tile.
- Work that does *not* scale with window size (orient pass on cal changes, texture
  uploads) is covered by the round-1/round-2 fixes in the investigation notes.

## Possible mitigations

1. **Implemented** — interaction-time DPR downscale: `RENDER_DRAG_DPR_SCALE = 0.8` in
   `VisualizationPage.tsx` lowers `nv.devicePixelRatio` on pointer-down and restores it on
   pointer-up. Cuts both factors' pixel count while dragging; full quality returns on release.
2. Increase the ray step size during interaction (fewer samples per ray, coarser image while
   moving) — design note in `3d-render-interaction-quality-patch.md`, not yet implemented.
3. Empty-space skipping (acceleration structure) — an upstream-niivue-sized change, not implemented.
