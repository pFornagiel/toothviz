import { describe, expect, it } from "vitest";
import {
  BONE_CAL_MAX,
  BONE_CAL_MIN,
  DEFAULT_CAL_MAX,
  DEFAULT_CAL_MIN,
  DENTAL_SLIDER_MAX,
  DENTAL_SLIDER_MIN,
  SOFT_TISSUE_CAL_MAX,
  SOFT_TISSUE_CAL_MIN,
} from "@/app/visualization/constants";
import {
  matchDensityPreset,
  resolveDensityPreset,
  resolveDensitySliderBounds,
} from "@/app/visualization/densityPresets";

describe("resolveDensityPreset", () => {
  const globalMin = -1000;
  const globalMax = 3000;

  it("uses the dental CBCT default window", () => {
    expect(resolveDensityPreset("default", globalMin, globalMax)).toEqual({
      calMin: DEFAULT_CAL_MIN,
      calMax: DEFAULT_CAL_MAX,
    });
  });

  it("uses bone and soft-tissue windows tuned for CBCT viewing", () => {
    expect(resolveDensityPreset("bone", globalMin, globalMax)).toEqual({
      calMin: BONE_CAL_MIN,
      calMax: BONE_CAL_MAX,
    });
    expect(resolveDensityPreset("soft", globalMin, globalMax)).toEqual({
      calMin: SOFT_TISSUE_CAL_MIN,
      calMax: SOFT_TISSUE_CAL_MAX,
    });
  });

  it("spans the whole scan for Full range", () => {
    expect(resolveDensityPreset("full", globalMin, globalMax)).toEqual({
      calMin: globalMin,
      calMax: globalMax,
    });
  });

  it("clamps preset windows into a narrow scan range without an empty span", () => {
    // Bone's preferred floor (400) is above this tiny scan, so the window collapses
    // to the top of the available range with a 1 HU span.
    expect(resolveDensityPreset("bone", 0, 100)).toEqual({
      calMin: 99,
      calMax: 100,
    });
    expect(resolveDensityPreset("soft", 0, 100)).toEqual({
      calMin: 0,
      calMax: 100,
    });
  });
});

describe("resolveDensitySliderBounds", () => {
  it("keeps everyday drags on the dental band", () => {
    expect(resolveDensitySliderBounds(-1000, 4000, 200, 2100)).toEqual({
      min: DENTAL_SLIDER_MIN,
      max: DENTAL_SLIDER_MAX,
    });
  });

  it("expands to include a full-range window", () => {
    expect(resolveDensitySliderBounds(-1000, 4000, -1000, 4000)).toEqual({
      min: -1000,
      max: 4000,
    });
  });
});

describe("matchDensityPreset", () => {
  it("recognises the active preset and clears after a manual drag", () => {
    const bone = resolveDensityPreset("bone", -1000, 3000);
    expect(matchDensityPreset(bone.calMin, bone.calMax, -1000, 3000)).toBe("bone");
    expect(matchDensityPreset(bone.calMin + 1, bone.calMax, -1000, 3000)).toBeNull();
  });
});
