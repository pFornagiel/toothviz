import type NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE } from "@niivue/niivue";
import { MULTIPLANAR_TILE_GAP } from "../constants";

const TILE_SIZE = (1 - MULTIPLANAR_TILE_GAP) / 2;
const SECOND_CELL = (1 + MULTIPLANAR_TILE_GAP) / 2;

/** Same arrangement as the MPR tab of CS 3D Imaging. */
export const MULTIPLANAR_LAYOUT: NonNullable<NiiVueGPU["customLayout"]> = [
  { sliceType: SLICE_TYPE.AXIAL, position: [0, 0, TILE_SIZE, TILE_SIZE] },
  { sliceType: SLICE_TYPE.CORONAL, position: [SECOND_CELL, 0, TILE_SIZE, TILE_SIZE] },
  { sliceType: SLICE_TYPE.SAGITTAL, position: [0, SECOND_CELL, TILE_SIZE, TILE_SIZE] },
  { sliceType: SLICE_TYPE.RENDER, position: [SECOND_CELL, SECOND_CELL, TILE_SIZE, TILE_SIZE] },
];

/**
 * Show the 2x2 multiplanar view. A custom layout scales each tile on its own, so
 * `isEqualSize` gives the planes one field of view and therefore one scale in mm.
 */
export function showMultiplanarLayout(nv: NiiVueGPU): void {
  nv.isEqualSize = true;
  nv.customLayout = MULTIPLANAR_LAYOUT;
  nv.sliceType = SLICE_TYPE.MULTIPLANAR;
}

/** Show one plane or the 3D view. A custom layout would override `sliceType`. */
export function showSingleTile(nv: NiiVueGPU, sliceType: number): void {
  nv.isEqualSize = false;
  nv.customLayout = null;
  nv.sliceType = sliceType;
}
