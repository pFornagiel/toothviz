// Slice-type identifiers used by the slice-type selector and niivue layout switching
export enum SliceTypeKey {
  Multiplanar = "multiplanar",
  Axial = "axial",
  Coronal = "coronal",
  Sagittal = "sagittal",
  Render = "render",
}

// Human-readable labels for the slice-type selector
export const SLICE_TYPE_LABELS: Record<SliceTypeKey, string> = {
  [SliceTypeKey.Multiplanar]: "Multiplanar",
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
export const DEFAULT_SHOW_3D_CROSSHAIR = true;
export const DEFAULT_CROSSHAIR_WIDTH = 0.2;
export const DEFAULT_CROSSHAIR_COLOR = "#ff0000";
// Saturated or white only: grays and dark tones would get lost on a grayscale scan.
export const CROSSHAIR_COLOR_OPTIONS = [
  { name: "Red", value: DEFAULT_CROSSHAIR_COLOR },
  { name: "Yellow", value: "#ffd600" },
  { name: "Green", value: "#00e676" },
  { name: "Cyan", value: "#00e5ff" },
  { name: "Magenta", value: "#ff40ff" },
  { name: "White", value: "#ffffff" },
];
// Black gap between the 2D/3D tiles, in canvas pixels (the background shows through).
export const DEFAULT_TILE_MARGIN = 4;
// White, so a measurement's mm value stands out from its red line.
export const MEASURE_TEXT_COLOR = [1, 1, 1, 1];

export const DEFAULT_RENDER_AZIMUTH = 120;
export const DEFAULT_RENDER_ELEVATION = 10;

// niivue normalises every volume into a unit cube and uses clip depth as the
// SIGNED distance of the plane from the centre (the raw 4th component of the
// plane equation). The furthest corner sits at √3, so the plane fully clears
// the volume at ±√3 and bisects it at 0. Sweeping -√3..+√3 moves the plane
// continuously from "everything hidden" to "fully visible".
export const CLIP_DEPTH_EDGE = Math.sqrt(3); // ≈1.732 - worst-case (cubic) furthest corner

export const RENDER_ZOOM_BUTTON_FACTOR = 1.2; // multiplicative step for the +/- buttons

// Slider bounds for UI controls
export const OPACITY_RANGE = { min: 0, max: 1, step: 0.01 };
export const CLIP_DEPTH_RANGE = { min: -CLIP_DEPTH_EDGE, max: CLIP_DEPTH_EDGE, step: 0.001 };
export const CLIP_AZIMUTH_RANGE = { min: -90, max: 90, step: 1 };
export const CLIP_ELEVATION_RANGE = { min: -90, max: 90, step: 1 };
export const RENDER_AZIMUTH_RANGE = { min: 0, max: 360, step: 1 };
export const RENDER_ELEVATION_RANGE = { min: -180, max: 180, step: 1 };
export const RENDER_ZOOM_RANGE = { min: 0.1, max: 5, step: 0.1 };
export const PAN2D_ZOOM_RANGE = { min: 0.1, max: 10, step: 0.1 };

export const RENDER_DRAG_DPR_SCALE = 0.8;
export const NATIVE_DPR_AUTO = 0;

/** Max pointer travel (CSS px) treated as click-slop vs an intentional drag. */
export const POINTER_CLICK_SLOP_PX = 6;

// useViewLayoutControls - initial slice type on load (4-pane: A/C/S + 3D)
export const DEFAULT_SLICE_TYPE = SliceTypeKey.Multiplanar;

// useClipPlaneControls - initial clip depth
export const DEFAULT_CLIP_PLANE_DEPTH = CLIP_DEPTH_EDGE;

// useNiivueCanvasWheel - wheel interaction step sizes
export const RENDER_ZOOM_SCROLL_FACTOR = 1.1; // multiplicative zoom step per wheel notch
export const CLIP_DEPTH_SCROLL_STEP = 0.05; // additive clip-depth step per wheel notch
export const DEFAULT_PAN2D_ZOOM = 1.0;
export const DEFAULT_PAN2D_XYZMM: [number, number, number, number] = [0, 0, 0, DEFAULT_PAN2D_ZOOM];
export const DEFAULT_CROSSHAIR_POS: [number, number, number] = [0.5, 0.5, 0.5];

// useNiivueSyncedRotation - drag rotation sensitivity (degrees per pixel)
export const DRAG_DEG_PER_PX = 0.5;

// useRenderControls - niivue scaleMultiplier default (1 = no zoom)
export const DEFAULT_RENDER_ZOOM = 1.0;

// useNiivueViewer - colormaps and names applied to newly loaded volumes/overlays
export const VOLUME_COLORMAP = "Gray";
export const OVERLAY_COLORMAP = "Red";
export const DEFAULT_OVERLAY_OPACITY = 0.5;
export const DEFAULT_VOLUME_NAME = "volume";
export const DEFAULT_OVERLAY_NAME = "overlay";
export const DEFAULT_BONE_OPACITY = 0.3;

// useVolumeDisplayControls - HU intensity fallback range and fully-hidden opacity
export const CAL_MIN_GLOBAL_VAL = -1000;
export const CAL_MAX_GLOBAL_VAL = 3000;
// Lower window bound applied when a scan loads. There is no standard dental CBCT
// preset; this rounds the lower edge of level 1131 / width 1858, a windowing
// protocol reported for tooth segmentation on CBCT (Adv Clin Exp Med 2018;27(7)).
export const DEFAULT_CAL_MIN = 200;
export const HIDDEN_OPACITY = 0;
