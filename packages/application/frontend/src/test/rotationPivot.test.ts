import { describe, it, expect, vi } from "vitest";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { fdiToClass, selectionCentreOfMass, toothVoxelCounts } from "@/app/visualization/toothLabels";
import { setRotationPivot } from "@/app/visualization/hooks/niivueRotationPivot";

const TOOTH_11 = fdiToClass(11)!;
const TOOTH_21 = fdiToClass(21)!;
const TOOTH_36 = fdiToClass(36)!;
const PRESENT = [TOOTH_11, TOOTH_21, TOOTH_36];

const COUNTS = new Uint32Array(33);
COUNTS[TOOTH_11] = 100;
COUNTS[TOOTH_21] = 300;
COUNTS[TOOTH_36] = 600;

const CENTROIDS = {
  11: [10, 0, 0],
  21: [20, 40, 0],
  36: [100, 100, 100],
};

describe("toothVoxelCounts", () => {
  it("counts voxels per tooth and ignores other labels", () => {
    const counts = toothVoxelCounts([0, 1, 1, 2, 33, 40, 1]);
    expect(counts[1]).toBe(3);
    expect(counts[2]).toBe(1);
    expect(counts[0]).toBe(0);
    expect(counts.length).toBe(33);
  });
});

describe("selectionCentreOfMass", () => {
  it("uses the tooth's own centre for one tooth", () => {
    expect(selectionCentreOfMass(["teeth-11"], PRESENT, COUNTS, CENTROIDS)).toEqual([10, 0, 0]);
  });

  it("weights several teeth by their voxel counts", () => {
    expect(selectionCentreOfMass(["teeth-11", "teeth-21"], PRESENT, COUNTS, CENTROIDS)).toEqual([
      17.5, 30, 0,
    ]);
  });

  it("keeps the scan centre with nothing or everything selected", () => {
    expect(selectionCentreOfMass([], PRESENT, COUNTS, CENTROIDS)).toBeNull();
    expect(
      selectionCentreOfMass(["teeth-11", "teeth-21", "teeth-36"], PRESENT, COUNTS, CENTROIDS),
    ).toBeNull();
  });

  it("ignores teeth without a centre, and gives up when none has one", () => {
    expect(selectionCentreOfMass(["teeth-11", "teeth-21"], PRESENT, COUNTS, { 21: [20, 40, 0] })).toEqual([
      20, 40, 0,
    ]);
    expect(selectionCentreOfMass(["teeth-11"], PRESENT, COUNTS, undefined)).toBeNull();
  });
});

describe("setRotationPivot", () => {
  function setup() {
    const nv = {
      drawScene: vi.fn(),
      model: {
        extentsMin: [0, -10, 20],
        extentsMax: [100, 10, 40],
        pivot3D: Float32Array.of(50, 0, 30),
      },
    };
    return { nv, typed: nv as unknown as NiiVueGPU };
  }

  it("moves the pivot and redraws", () => {
    const { nv, typed } = setup();
    setRotationPivot(typed, [1, 2, 3]);
    expect([...nv.model.pivot3D]).toEqual([1, 2, 3]);
    expect(nv.drawScene).toHaveBeenCalledOnce();
  });

  it("goes back to the scan centre", () => {
    const { nv, typed } = setup();
    setRotationPivot(typed, [1, 2, 3]);
    setRotationPivot(typed, null);
    expect([...nv.model.pivot3D]).toEqual([50, 0, 30]);
  });

  it("does not redraw when nothing changes", () => {
    const { nv, typed } = setup();
    setRotationPivot(typed, null);
    expect(nv.drawScene).not.toHaveBeenCalled();
  });
});
