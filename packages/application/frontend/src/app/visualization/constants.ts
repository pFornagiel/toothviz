// Shared visualization constants used by both VisualizationPage (niivue logic)
// and VisualizationSidebar (presentational controls). Kept in a standalone module
// so the page and the sidebar can both import them without a circular dependency.

// Slice-type identifiers used by the slice-type selector and niivue layout switching
export enum SliceTypeKey {
  Multiplanar = "multiplanar",
  Multiplanar4View = "multiplanar_4view",
  Axial = "axial",
  Coronal = "coronal",
  Sagittal = "sagittal",
  Render = "render",
}

// Human-readable labels for the slice-type selector
export const SLICE_TYPE_LABELS: Record<SliceTypeKey, string> = {
  [SliceTypeKey.Multiplanar]: "Multiplanar",
  [SliceTypeKey.Multiplanar4View]: "Multiplanar (4 Views)",
  [SliceTypeKey.Axial]: "Axial",
  [SliceTypeKey.Coronal]: "Coronal",
  [SliceTypeKey.Sagittal]: "Sagittal",
  [SliceTypeKey.Render]: "3D Render",
};

// Defaults shared by the viewer lifecycle (useNiivueViewer) and the control
// state (useNiivueControls)
export const DEFAULT_COLORMAP = "Gray";
export const DEFAULT_VISIBLE_OPACITY = 1.0;

// Niivue init / display defaults
export const DEFAULT_BACK_COLOR_DARK: [number, number, number, number] = [0, 0, 0, 1];
export const DEFAULT_BACK_COLOR_LIGHT: [number, number, number, number] = [1, 1, 1, 1];
export const DEFAULT_SHOW_3D_CROSSHAIR = true;
export const DEFAULT_CROSSHAIR_WIDTH = 0.2;

export const DEFAULT_RENDER_AZIMUTH = 120;
export const DEFAULT_RENDER_ELEVATION = 10;

// niivue normalises every volume into a unit cube and uses clip depth as the
// SIGNED distance of the plane from the centre (the raw 4th component of the
// plane equation). The furthest corner sits at √3, so the plane fully clears
// the volume at ±√3 and bisects it at 0. Sweeping -√3..+√3 moves the plane
// continuously from "everything hidden" to "fully visible".
export const CLIP_DEPTH_EDGE = Math.sqrt(3); // ≈1.732 — worst-case (cubic) furthest corner

export const RENDER_ZOOM_BUTTON_FACTOR = 1.2; // multiplicative step for the +/- buttons

// Slider bounds for UI controls
export const CROSSHAIR_WIDTH_RANGE = { min: 0.1, max: 2, step: 0.1 };
export const OPACITY_RANGE = { min: 0, max: 1, step: 0.01 };
export const CLIP_DEPTH_RANGE = { min: -CLIP_DEPTH_EDGE, max: CLIP_DEPTH_EDGE, step: 0.01 };
export const CLIP_AZIMUTH_RANGE = { min: -90, max: 90, step: 1 };
export const CLIP_ELEVATION_RANGE = { min: -90, max: 90, step: 1 };
export const RENDER_AZIMUTH_RANGE = { min: 0, max: 360, step: 1 };
export const RENDER_ELEVATION_RANGE = { min: -180, max: 180, step: 1 };
export const RENDER_ZOOM_RANGE = { min: 0.1, max: 5, step: 0.1 };

export const RENDER_DRAG_DPR_SCALE = 0.8;
export const NATIVE_DPR_AUTO = 0;
