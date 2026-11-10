import { describe, it, expect } from "vitest";
import { hexToRgba } from "@/app/utils/hexToRgba";
import { DEFAULT_CAL_MAX, DEFAULT_CAL_MIN } from "@/app/visualization/constants";
import { resolveDensityPreset } from "@/app/visualization/densityPresets";

describe("hexToRgba", () => {
  it("normalises channels and keeps the colour opaque", () => {
    expect(hexToRgba("#ff0000")).toEqual([1, 0, 0, 1]);
    expect(hexToRgba("#00ff33")).toEqual([0, 1, 0.2, 1]);
  });
});

describe("default density window on load", () => {
  it("matches the Default preset for a typical CBCT range", () => {
    expect(resolveDensityPreset("default", -1000, 3000)).toEqual({
      calMin: DEFAULT_CAL_MIN,
      calMax: DEFAULT_CAL_MAX,
    });
  });

  it("clamps into a scan that cannot fit the preferred window", () => {
    expect(resolveDensityPreset("default", 0, 1)).toEqual({
      calMin: 0,
      calMax: 1,
    });
  });
});
