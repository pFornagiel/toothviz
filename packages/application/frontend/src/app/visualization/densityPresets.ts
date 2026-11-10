import {
  BONE_CAL_MAX,
  BONE_CAL_MIN,
  DEFAULT_CAL_MAX,
  DEFAULT_CAL_MIN,
  DENTAL_SLIDER_MAX,
  DENTAL_SLIDER_MIN,
  SOFT_TISSUE_CAL_MAX,
  SOFT_TISSUE_CAL_MIN,
} from "./constants";

export type DensityPresetId = "default" | "bone" | "soft" | "full";

export type DensityPreset = {
  id: DensityPresetId;
  label: string;
};

/** Chips under the displayed-densities slider. */
export const DENSITY_PRESETS: readonly DensityPreset[] = [
  { id: "default", label: "Default" },
  { id: "bone", label: "Bone" },
  { id: "soft", label: "Soft tissue" },
  { id: "full", label: "Full range" },
] as const;

type CalWindow = { calMin: number; calMax: number };

const PRESET_WINDOWS: Record<Exclude<DensityPresetId, "full">, CalWindow> = {
  default: { calMin: DEFAULT_CAL_MIN, calMax: DEFAULT_CAL_MAX },
  bone: { calMin: BONE_CAL_MIN, calMax: BONE_CAL_MAX },
  soft: { calMin: SOFT_TISSUE_CAL_MIN, calMax: SOFT_TISSUE_CAL_MAX },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Fit a preferred window into the scan's global HU range without an empty span. */
export function clampCalWindow(
  preferredMin: number,
  preferredMax: number,
  globalMin: number,
  globalMax: number,
): CalWindow {
  if (!(globalMax > globalMin)) {
    return { calMin: globalMin, calMax: globalMax };
  }

  let calMin = clamp(preferredMin, globalMin, globalMax);
  let calMax = clamp(preferredMax, globalMin, globalMax);
  if (calMin > calMax) {
    [calMin, calMax] = [calMax, calMin];
  }
  if (calMin === calMax) {
    if (calMax < globalMax) {
      calMax += 1;
    } else if (calMin > globalMin) {
      calMin -= 1;
    }
  }
  return { calMin, calMax };
}

/**
 * Resolve a named dental window into the scan's global HU range. Prefer
 * content-based names over "2D"/"3D": one window still drives both views.
 */
export function resolveDensityPreset(
  id: DensityPresetId,
  globalMin: number,
  globalMax: number,
): CalWindow {
  if (id === "full") {
    return { calMin: globalMin, calMax: globalMax };
  }
  const preferred = PRESET_WINDOWS[id];
  return clampCalWindow(preferred.calMin, preferred.calMax, globalMin, globalMax);
}

/**
 * Slider track for everyday dental adjusting. Expands to include the current
 * window (and thus the full scan when Full range is active).
 */
export function resolveDensitySliderBounds(
  globalMin: number,
  globalMax: number,
  lower: number,
  upper: number,
): { min: number; max: number } {
  if (!(globalMax > globalMin)) {
    return { min: globalMin, max: globalMax };
  }

  const dentalMin = clamp(DENTAL_SLIDER_MIN, globalMin, globalMax);
  const dentalMax = clamp(DENTAL_SLIDER_MAX, globalMin, globalMax);
  const min = Math.min(dentalMin, lower, upper);
  const max = Math.max(dentalMax, lower, upper);
  return {
    min: clamp(min, globalMin, globalMax),
    max: clamp(max, globalMin, globalMax),
  };
}

/** Which preset chip matches the current window, if any. */
export function matchDensityPreset(
  calMin: number,
  calMax: number,
  globalMin: number,
  globalMax: number,
): DensityPresetId | null {
  for (const { id } of DENSITY_PRESETS) {
    const preset = resolveDensityPreset(id, globalMin, globalMax);
    if (preset.calMin === calMin && preset.calMax === calMax) {
      return id;
    }
  }
  return null;
}
