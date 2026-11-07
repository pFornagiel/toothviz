import { describe, expect, it } from "vitest";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { colorLoadedMask } from "@/app/visualization/hooks/useToothSelectionControls";

type FakeVolume = {
  name: string;
  img: Uint8Array;
  colormapLabel?: { lut: Uint8ClampedArray; min: number; max: number } | null;
};

const scan = (): FakeVolume => ({ name: "scan", img: new Uint8Array([1, 2, 3]) });
const overlay = (values: number[]): FakeVolume => ({ name: "mask", img: new Uint8Array(values) });
const nvWith = (...volumes: FakeVolume[]) => ({ volumes }) as unknown as NiiVueGPU;

describe("colorLoadedMask", () => {
  it("gives a mask its tooth colours", () => {
    const mask = overlay([0, 1, 2]);
    colorLoadedMask(nvWith(scan(), mask));
    const { lut, min, max } = mask.colormapLabel!;
    expect([min, max]).toEqual([0, 2]);
    expect(lut[1 * 4 + 3]).toBe(255);
    expect(lut[2 * 4 + 3]).toBe(255);
  });

  it("leaves a scan loaded on its own alone", () => {
    const only = scan();
    colorLoadedMask(nvWith(only));
    expect(only.colormapLabel).toBeUndefined();
  });

  it("keeps the load colormap for an overlay without tooth classes", () => {
    const other = overlay([0, 200, 250]);
    colorLoadedMask(nvWith(scan(), other));
    expect(other.colormapLabel).toBeUndefined();
  });
});
