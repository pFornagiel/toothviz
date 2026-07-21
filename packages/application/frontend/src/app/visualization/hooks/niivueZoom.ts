import type NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE } from "@niivue/niivue";
import { PAN2D_ZOOM_RANGE, RENDER_ZOOM_RANGE } from "../constants";
import { clamp } from "../../utils/clamp";

/** NiiVue axis index for moveCrosshairInVox (matches library `se`). */
export function sliceAxisIndex(sliceType: number): number {
  if (sliceType === SLICE_TYPE.CORONAL) {
    return 1;
  }
  if (sliceType === SLICE_TYPE.SAGITTAL) {
    return 0;
  }
  return 2; // axial / default
}

/**
 * Zoom 2D tiles via pan2Dxyzmm[3], pivoting on the crosshair (same formula as NiiVue).
 */
export function zoomPan2D(nv: NiiVueGPU, nextZoom: number): number {
  const pan = nv.pan2Dxyzmm;
  const prev = pan[3] ?? 1;
  const clamped = clamp(
    Math.round(nextZoom * 10) / 10,
    PAN2D_ZOOM_RANGE.min,
    PAN2D_ZOOM_RANGE.max,
  );
  const delta = prev - clamped;
  const mm = nv.model.scene2mm(nv.crosshairPos);
  nv.pan2Dxyzmm = [
    pan[0] + delta * mm[0],
    pan[1] + delta * mm[1],
    pan[2] + delta * mm[2],
    clamped,
  ];
  return clamped;
}

/** Set both 3D scaleMultiplier and 2D pan zoom (sidebar / reset). */
export function setUnifiedZoom(nv: NiiVueGPU, zoom: number): number {
  const clamped3d = clamp(zoom, RENDER_ZOOM_RANGE.min, RENDER_ZOOM_RANGE.max);
  nv.scaleMultiplier = clamped3d;
  zoomPan2D(nv, clamped3d);
  return clamped3d;
}
