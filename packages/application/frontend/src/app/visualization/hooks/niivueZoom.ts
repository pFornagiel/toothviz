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
 * Zoom 2D tiles via pan2Dxyzmm[3], keeping the crosshair at the same place on screen.
 * NiiVue draws a tile by scaling around the scan centre and then applying the pan, so
 * a point's screen offset is (mm - centre + pan) * zoom; the new pan keeps that constant.
 * NiiVue's own wheel zoom uses a different formula, which lets the crosshair drift.
 */
export function zoomPan2D(nv: NiiVueGPU, nextZoom: number): number {
  const pan = nv.pan2Dxyzmm;
  const prev = pan[3] ?? 1;
  const clamped = clamp(
    Math.round(nextZoom * 10) / 10,
    PAN2D_ZOOM_RANGE.min,
    PAN2D_ZOOM_RANGE.max,
  );
  const { extentsMin, extentsMax } = nv.model;
  const mm = nv.model.scene2mm(nv.crosshairPos);
  const pivotedPan = (axis: number): number => {
    const offset = mm[axis] - (extentsMin[axis] + extentsMax[axis]) / 2;
    return ((offset + pan[axis]) * prev) / clamped - offset;
  };
  nv.pan2Dxyzmm = [pivotedPan(0), pivotedPan(1), pivotedPan(2), clamped];
  return clamped;
}

/** Set both 3D scaleMultiplier and 2D pan zoom (sidebar / reset). */
export function setUnifiedZoom(nv: NiiVueGPU, zoom: number): number {
  const clamped3d = clamp(zoom, RENDER_ZOOM_RANGE.min, RENDER_ZOOM_RANGE.max);
  nv.scaleMultiplier = clamped3d;
  zoomPan2D(nv, clamped3d);
  return clamped3d;
}
