import { describe, it, expect, vi } from "vitest";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  classToFdi,
  classToToothId,
  fdiToClass,
  selectionCentreOfMass,
  maskVoxelCounts,
} from "@/app/visualization/toothLabels";
import { setRotationPivot } from "@/app/visualization/hooks/niivueRotationPivot";
import useToothSelectionControls from "@/app/visualization/hooks/useToothSelectionControls";

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

describe("maskVoxelCounts", () => {
  it("counts voxels per class and ignores unknown labels", () => {
    const counts = maskVoxelCounts([0, 1, 1, 2, 34, 40, 1]);
    expect(counts[1]).toBe(3);
    expect(counts[2]).toBe(1);
    expect(counts[0]).toBe(0);
    expect(counts[34]).toBe(1);
    expect(counts.length).toBe(36);
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

describe("useToothSelectionControls rotation pivot", () => {
  const FIRST_TOOTH = classToToothId(1)!;
  const FIRST_CENTRE = [1, 2, 3];
  const SCAN_CENTRE = [50, 0, 30];

  async function setup() {
    const nv = {
      drawScene: vi.fn(),
      updateGLVolume: vi.fn(async () => {}),
      setColormapLabel: vi.fn(async () => {}),
      model: {
        extentsMin: [0, -10, 20],
        extentsMax: [100, 10, 40],
        pivot3D: Float32Array.of(...SCAN_CENTRE),
      },
      volumes: [
        { name: "scan" },
        {
          name: "overlay",
          img: [0, 1, 1, 2, 2, 3],
          colormapLabel: {
            lut: new Uint8ClampedArray(4),
            min: 0,
            max: 3,
            centroids: {
              [classToFdi(1)!]: FIRST_CENTRE,
              [classToFdi(2)!]: [4, 5, 6],
              [classToFdi(3)!]: [7, 8, 9],
            },
          },
        },
      ],
    };
    const nvRef = { current: nv as unknown as NiiVueGPU };
    const hook = renderHook(
      ({ volumeVisibility }) =>
        useToothSelectionControls({
          nvRef,
          queueNvUpdate: (_key, apply) => apply(),
          volumeVisibility,
        }),
      { initialProps: { volumeVisibility: [true, true] } },
    );
    await act(async () => hook.result.current.syncFromVolumes(nv as unknown as NiiVueGPU));
    const pivot = () => [...nv.model.pivot3D];
    return { hook, pivot };
  }

  async function selectOnlyFirstTooth({ hook, pivot }: Awaited<ReturnType<typeof setup>>) {
    act(() => hook.result.current.clearSelection());
    act(() => {
      hook.result.current.toggleToothFromChart(FIRST_TOOTH);
    });
    await waitFor(() => expect(pivot()).toEqual(FIRST_CENTRE));
  }

  it("rotates around the scan centre while the segmentation is hidden", async () => {
    const ctx = await setup();
    await selectOnlyFirstTooth(ctx);

    ctx.hook.rerender({ volumeVisibility: [true, false] });
    expect(ctx.pivot()).toEqual(SCAN_CENTRE);

    ctx.hook.rerender({ volumeVisibility: [true, true] });
    expect(ctx.pivot()).toEqual(FIRST_CENTRE);
  });

  it("ignores selection changes until the segmentation is shown again", async () => {
    const ctx = await setup();
    ctx.hook.rerender({ volumeVisibility: [true, false] });
    act(() => ctx.hook.result.current.clearSelection());
    act(() => {
      ctx.hook.result.current.toggleToothFromChart(FIRST_TOOTH);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(ctx.pivot()).toEqual(SCAN_CENTRE);

    ctx.hook.rerender({ volumeVisibility: [true, true] });
    expect(ctx.pivot()).toEqual(FIRST_CENTRE);
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
