import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { MULTIPLANAR_LAYOUT } from "@/app/visualization/hooks/niivueLayout";
import useViewLayoutControls from "@/app/visualization/hooks/useViewLayoutControls";
import { SliceTypeKey } from "@/app/visualization/constants";

const SLICE_TYPE = vi.hoisted(() => ({
  AXIAL: 0,
  CORONAL: 1,
  SAGITTAL: 2,
  MULTIPLANAR: 3,
  RENDER: 4,
}));

vi.mock("@niivue/niivue", () => ({ SLICE_TYPE }));

const tileAt = (column: number, row: number) =>
  MULTIPLANAR_LAYOUT.find(({ position: [left, top] }) => {
    return (left > 0 ? 1 : 0) === column && (top > 0 ? 1 : 0) === row;
  })?.sliceType;

describe("MULTIPLANAR_LAYOUT", () => {
  it("matches CS 3D Imaging: axial, coronal, then sagittal and 3D", () => {
    expect(tileAt(0, 0)).toBe(SLICE_TYPE.AXIAL);
    expect(tileAt(1, 0)).toBe(SLICE_TYPE.CORONAL);
    expect(tileAt(0, 1)).toBe(SLICE_TYPE.SAGITTAL);
    expect(tileAt(1, 1)).toBe(SLICE_TYPE.RENDER);
  });

  it("leaves a gap between tiles and stays on the canvas", () => {
    for (const { position: [left, top, width, height] } of MULTIPLANAR_LAYOUT) {
      expect(left + width).toBeLessThanOrEqual(1);
      expect(top + height).toBeLessThanOrEqual(1);
      expect(width).toBeLessThan(0.5);
      expect(height).toBeLessThan(0.5);
    }
  });
});

describe("useViewLayoutControls", () => {
  function setup() {
    const nv = { customLayout: null, isEqualSize: false, sliceType: SLICE_TYPE.MULTIPLANAR };
    const nvRef = { current: nv as unknown as NiiVueGPU };
    const { result } = renderHook(() => useViewLayoutControls({ nvRef }));
    return { nv, result };
  }

  it.each([
    [SliceTypeKey.Axial, SLICE_TYPE.AXIAL],
    [SliceTypeKey.Coronal, SLICE_TYPE.CORONAL],
    [SliceTypeKey.Sagittal, SLICE_TYPE.SAGITTAL],
    [SliceTypeKey.Render, SLICE_TYPE.RENDER],
  ])("drops the custom layout for the single view %s", (key, sliceType) => {
    const { nv, result } = setup();
    act(() => result.current.handleSliceTypeChange(SliceTypeKey.Multiplanar));
    expect(nv.customLayout).toBe(MULTIPLANAR_LAYOUT);
    act(() => result.current.handleSliceTypeChange(key));
    expect(nv.customLayout).toBeNull();
    expect(nv.sliceType).toBe(sliceType);
  });

  it("restores the layout when going back to multiplanar", () => {
    const { nv, result } = setup();
    act(() => result.current.handleSliceTypeChange(SliceTypeKey.Axial));
    act(() => result.current.handleSliceTypeChange(SliceTypeKey.Multiplanar));
    expect(nv.customLayout).toBe(MULTIPLANAR_LAYOUT);
    expect(nv.isEqualSize).toBe(true);
    expect(nv.sliceType).toBe(SLICE_TYPE.MULTIPLANAR);
  });
});
