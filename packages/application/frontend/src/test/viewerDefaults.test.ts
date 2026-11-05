import { describe, it, expect } from "vitest";
import { hexToRgba } from "@/app/utils/hexToRgba";
import { resolveDefaultCalMin } from "@/app/visualization/hooks/useVolumeDisplayControls";
import { DEFAULT_CAL_MIN } from "@/app/visualization/constants";

describe("hexToRgba", () => {
  it("normalises channels and keeps the colour opaque", () => {
    expect(hexToRgba("#ff0000")).toEqual([1, 0, 0, 1]);
    expect(hexToRgba("#00ff33")).toEqual([0, 1, 0.2, 1]);
  });
});

describe("resolveDefaultCalMin", () => {
  it("uses the default when it fits below the upper bound", () => {
    expect(resolveDefaultCalMin(-1000, 2000)).toBe(DEFAULT_CAL_MIN);
  });

  it("keeps the volume's own value when the window would be empty", () => {
    expect(resolveDefaultCalMin(0, 1)).toBe(0);
    expect(resolveDefaultCalMin(0, DEFAULT_CAL_MIN)).toBe(0);
  });
});
