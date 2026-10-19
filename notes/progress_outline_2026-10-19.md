# Progress outline: 5 Oct – 19 Oct 2026

Raw material for a progress presentation. Covers everything merged, opened or left uncommitted since 5 Oct 2026.
PR links: https://github.com/pFornagiel/toothviz/pull/<n>

## TL;DR (opening slide)

- **ML:** the old 3D model (sliding_window_3d, 256³ patches) was replaced by a light **2.5D MobileNetV3UNet3Ch** that runs slice by slice. A smaller 5-channel variant, LiteMobileUNet5Ch, has been started.
- **Viewer UX:** teeth are picked in 3D or from an odontogram, with apply/discard flows and simpler controls.
- **Scan management:** pipelines can be cancelled, deletes ask for confirmation, scan names must be unique, and the browse list paginates, sorts and filters.
- **Stability:** fixed a Linux-only bug that hung the app after processing (fork vs spawn).
- **Thesis:** draw.io diagrams are now generated from scripts, and an interactive explainer of the pipeline exists.

| PR | Title | Author | State |
|----|-------|--------|-------|
| #61 | Teeth selector | Katarzyna Bęben | merged 09.10 |
| #62 | Cancel pipeline option | Katarzyna Bęben | merged 09.10 |
| #63 | Delete AlertDialog | Katarzyna Bęben | merged 09.10 |
| #71 | Enforce unique scan names | Emil Żychowicz | merged 09.10 |
| #72 | UI/UX improvements (pick mode, controls) | Katarzyna Bęben | merged 18.10 |
| #73 | Pagination, sorting, filtering | Katarzyna Bęben | merged 18.10 |
| #74 | Diagram generation scripts for thesis | Paweł Fornagiel | open |
| #75 | Linux worker spawn fix | Paweł Fornagiel | open |
| #76 | New model architecture (MobileUNet 2.5D) | Paweł Fornagiel | open |
| (local) | `lite_mobile_unet_5ch` + 5-channel slice context | Paweł Fornagiel | uncommitted on `@pFornagiel/alt-arch` |

#61–#63 were opened on 12 Sep but merged in this period.

---

## 1. ML: new segmentation model (#76)

**Slide: Why change the model**
- Old setup: a 3D network (`tooth_seg_semantic.onnx`, ~123 MB) used 256³ patches with `sliding_window_3d`, and its preprocessing was crop, CT-normalise, resample and pad.
- The new model is 2.5D and much smaller (`mobilenetv3_unet_3ch.onnx` + data, ~27 MB). It is also cheaper to run on a desktop CPU.
- The old models moved to `packages/models/legacy/`.

**Slide: How 2.5D works (diagram)**
- Each slice is fed to the network together with its neighbours as a 3-channel image (`SliceContext25D`, offset 3).
- Preprocessing: `ResampleToVoxelSize 0.3 mm` → `Reorient RPI` → `SliceContext25D` → `ZScorePerChannel` → `PadToSize 384²`.
- Prediction: `sliding_window_2d` with 384×384 tiles, step 0.5 and batches of 8.
- Postprocessing: `ReversePad` → `DropLabelsAbove 32` → `RemoveSmallLabels (<40 mm³)` → `ResampleToInputGrid`. The 2D slice predictions are stitched back into a 3D mask on the original scan grid.
- Everything is driven by config (`mobilenetv3_unet_3ch.json`) through the existing transform/predictor registry from #60.

**Slide: Architecture**
- A MobileNetV3-style encoder (timm inverted residuals, hard-swish, squeeze-excite) with a U-Net decoder.
- Also in the PR: ONNX export script (`packages/models/export_to_onnx.py`), updated config/README/setup paths, Electron backend-manager path updates, and unit tests (`test_ml_pipeline_25d.py`).

**Slide: Finding: squeeze-excite attention is collapsed**
- All SE gates in the shipped checkpoint (epoch 212) sit between 0.47 and 0.51 (std ≤ 0.008), so every channel is just multiplied by about 0.5.
- The attention adds parameters but has learned nothing. The likely cause is training the encoder from scratch, with BatchNorm absorbing the constant scale.
- This leads into the next model iteration (section 2).

## 2. ML: work in progress, LiteMobileUNet5Ch (uncommitted)

**Slide: Next model iteration**
- `packages/models/lite_mobile_unet_5ch/model.py`: `LiteMobileUNet5Ch`. It is a simpler encoder/decoder: **SE removed**, plain inverted residuals, 7 encoder stages down to /64, and depthwise-separable decoder blocks. It has 5 input channels and 36 classes.
- New transform `SliceContext25D5Channel`: the network sees slices z±9 and z±27, not z±3, so it gets much more vertical context per slice.
- Config: `lite_mobile_unet_5ch/exports/lite_mobile_unet_5ch.json` (same pipeline, new context step).
- Status: the ONNX export is not generated yet, and there are no results yet. Present this as "next steps".
- ⚠ Before committing: in `transforms.py` the new class is also named `SliceContext25D`, which shadows the 3-channel class at module level. The registry keys are still distinct.

## 3. Viewer: teeth selection and pick mode (#61, #72)

**Slide: Teeth selector (#61)**
- An odontogram (jaw chart) is coloured with each tooth's segmentation label colour.
- Teeth can be selected in the chart, in the legend, or by clicking directly in the 3D preview.
- A full-height `ToothLegend` panel replaced NiiVue's canvas legend. Clicking a tooth centres the crosshair on it.
- When a selection exists, unselected teeth fade out in both the chart and the legend.
- Performance: render resolution drops only once a 3D drag actually moves, and loading time was optimised.
- CI: tests now run on every PR. New tests cover the jaw, tooth labels and pipeline progress.

**Slide: Pick-mode UX polish (#72)**
- Pick mode now has an apply/discard flow, with confirmation dialogs (exit, clear selection, select all, reset view) and a popup message on the canvas.
- The legend only centres the view (no picking from the legend). An empty selection hides the teeth. Status text under the chart is clearer.
- Controls: the unused multiplanar modes were removed (one 4-pane mode remains), slice types have their own buttons, the active volume follows visibility, the mask gets no intensity window, and tooltips depend on state.
- Cleanup: unused colormap and light-mode settings were removed.
- 📸 Visual: before/after screenshots of the viewer, and a short GIF of picking a tooth.

## 4. Scan management and pipeline control (#62, #63, #71, #73)

**Slide: Cancelling a running pipeline (#62)**
- New endpoint `POST /studies/{id}/pipeline:cancel`. It stops a job that is running or not started yet, and keeps the study so it can be retried.
- `WorkerPool.force_stop()` kills the worker processes and recreates the executor. A "stop generation" counter makes a killed job show up as *cancelled*, not as *failed*. The cost is that the next run has to reload the model.
- Frontend: `CancelPipelineDialog`, new reducer/engine states and error hints. There are tests on the backend (`test_pipeline_cancel`, worker pool) and the frontend.

**Slide: Safer editing (#63, #71)**
- Delete asks for confirmation in an AlertDialog.
- Scan names must be unique (case-insensitive, trimmed) on both create and rename. A clash returns 409, and the dialog shows the conflict inline instead of closing.

**Slide: Browse page that scales (#73)**
- `GET /studies` now returns `{items, total, page, page_size}`.
- Supported query options: name search, created-date range, sorting by created/name/status in either direction, and page size up to 100.
- The UI got a search bar, pagination, sorting and a date filter. Repo, service and integration tests were updated.

## 5. Stability: Linux "stuck after processing" bug (#75)

**Slide: The bug**
- Symptom (Linux only): after segmentation the app stayed on "Processing complete" and never opened the viewer, and opening the scan from Browse also hung. Only a restart fixed it.

**Slide: Root cause (diagram of sockets)**
- Python on Linux creates worker processes by **forking** the server, so each child inherits copies of the server's open HTTP connections.
- When the server closes a connection, the long-lived segmentation worker still holds a copy of it, so the socket never really closes.
- The browser reuses that "alive" connection for `GET study`. Nobody reads it, so the request hangs forever.
- The progress-queue helper process has the same problem for the length of a run.

**Slide: Fix**
- Both pools now create processes with **spawn** (`worker_pool.py`, `progress_queue.py`). Only Linux behaviour changes, because Windows and macOS already use spawn.
- Good material for a "debugging story" slide: an 11-line fix after a long search.

## 6. Thesis materials (#74 + explainer)

**Slide: Diagrams as code (#74)**
- Python scripts (`uflib.py` + `uf1/3/6/7_A.py`) generate draw.io use-case/flow diagrams, and `export.sh` (Docker) renders them to PNG.
- The `.drawio` sources stay editable by hand. Location: `notes/thesis_resources/drawio_diagrams/`.
- 📸 Visual: `UF-1_upload_scan` diagram (in the PR description).

**Slide: Interactive pipeline explainer (separate repo, `~/dev/tooth_pipeline_visualization`)**
- A step-by-step explainer page built with Vite, d3 and three.js. It covers load → 5 preprocessing steps → 2D sliding window + network → 4 postprocessing steps → result.
- Every visual comes from a **real run** of the app's own `ml_pipeline` code on ToothFairy3F_022, a scan from the held-out test split. None of it is a mock-up.
- 📸 Ready-made screenshots: `~/dev/tooth_pipeline_visualization/shots/` (e.g. `intro-1.png`, `resample-1.png`, `reorient-1.png`, `context-3.png`, `tiles-3.png`, `blocks-*.png`, `result-2.png`).
- Can also be shown live during the presentation.

## 7. Next steps (closing slide)

- Merge #74, #75 and #76.
- Train and evaluate `LiteMobileUNet5Ch` with 5-channel context, and compare it with MobileNetV3UNet3Ch on Dice and on inference time.
- Experiments on the SE finding: remove SE, use a pretrained encoder, or track gates during training.
- Regenerate the explainer data after the model changes.
- Thesis: build more diagrams with the generator, and write the model architecture chapter.

## Suggested deck order

1. Title + TL;DR
2. New model: why → 2.5D idea → pipeline → architecture → SE finding
3. Next model iteration (WIP)
4. Viewer: teeth selection → pick mode
5. Scan management: cancel → safer editing → browse page
6. Linux bug story
7. Thesis tooling: diagrams + explainer
8. Next steps
