import type NiiVueGPU from "@niivue/niivue/webgl2";

/**
 * Set the point the 3D view rotates around, in mm, or `null` for the scan centre.
 * NiiVue has no public setter for this. It also goes back to the scan centre by itself
 * whenever a volume is added or removed.
 */
export function setRotationPivot(
  nv: NiiVueGPU,
  point: readonly [number, number, number] | null,
): void {
  const { model } = nv;
  const next = Float32Array.from(
    point ?? [0, 1, 2].map((axis) => (model.extentsMin[axis] + model.extentsMax[axis]) / 2),
  );
  if (next.every((value, axis) => value === model.pivot3D[axis])) {
    return;
  }
  model.pivot3D = next;
  nv.drawScene();
}
