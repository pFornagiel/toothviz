/**
 * ToothSeg / Dataset121 semantic class ↔ FDI mapping (33 classes: 0 bg + 1–32 teeth).
 *
 * Classes 1–8 → FDI 11–18, 9–16 → 21–28, 17–24 → 31–38, 25–32 → 41–48.
 */

export const MAX_TOOTH_CLASS = 32;

const UPPER_RIGHT = [11, 12, 13, 14, 15, 16, 17, 18] as const;
const UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28] as const;
const LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38] as const;
const LOWER_RIGHT = [41, 42, 43, 44, 45, 46, 47, 48] as const;

/** Index 0 unused; indices 1–32 are FDI numbers. */
export const CLASS_TO_FDI: readonly number[] = [
  0,
  ...UPPER_RIGHT,
  ...UPPER_LEFT,
  ...LOWER_LEFT,
  ...LOWER_RIGHT,
];

const FDI_TO_CLASS = new Map<number, number>();
for (let classId = 1; classId <= MAX_TOOTH_CLASS; classId++) {
  FDI_TO_CLASS.set(CLASS_TO_FDI[classId], classId);
}

export function classToFdi(classId: number): number | null {
  if (classId < 1 || classId > MAX_TOOTH_CLASS) {
    return null;
  }
  return CLASS_TO_FDI[classId];
}

export function fdiToClass(fdi: number | string): number | null {
  const n = typeof fdi === "string" ? parseInt(fdi, 10) : fdi;
  if (Number.isNaN(n)) {
    return null;
  }
  return FDI_TO_CLASS.get(n) ?? null;
}

export function fdiToToothId(fdi: number | string): string {
  return `teeth-${fdi}`;
}

export function toothIdToFdi(toothId: string): string | null {
  const match = /^teeth-(\d+)$/.exec(toothId);
  return match ? match[1] : null;
}

export function classToToothId(classId: number): string | null {
  const fdi = classToFdi(classId);
  return fdi === null ? null : fdiToToothId(fdi);
}

/** Read overlay class id from a NiiVue locationChange values array. */
export function toothClassFromLocationValues(
  values: ReadonlyArray<{ name?: string; value: number }>,
  overlayIndex: number,
  overlayName: string = "overlay",
): number | null {
  if (values.length === 0) {
    return null;
  }
  const byName = values.find(
    (v) => (v.name ?? "").toLowerCase() === overlayName.toLowerCase(),
  );
  if (byName) {
    const c = Math.round(byName.value);
    return c >= 1 && c <= MAX_TOOTH_CLASS ? c : null;
  }
  if (overlayIndex >= 0 && overlayIndex < values.length) {
    const c = Math.round(values[overlayIndex].value);
    return c >= 1 && c <= MAX_TOOTH_CLASS ? c : null;
  }
  return null;
}

export function toggleToothId(selected: string[], toothId: string): string[] {
  return selected.includes(toothId)
    ? selected.filter((id) => id !== toothId)
    : [...selected, toothId];
}

/** Unique tooth class IDs present in a segmentation mask (1–32 only). */
export function presentClassesFromImg(img: ArrayLike<number>): number[] {
  const seen = new Uint8Array(MAX_TOOTH_CLASS + 1);
  for (let i = 0; i < img.length; i++) {
    const v = img[i] | 0;
    if (v >= 1 && v <= MAX_TOOTH_CLASS) {
      seen[v] = 1;
    }
  }
  const out: number[] = [];
  for (let c = 1; c <= MAX_TOOTH_CLASS; c++) {
    if (seen[c]) {
      out.push(c);
    }
  }
  return out;
}

export function classesToToothIds(classIds: number[]): string[] {
  return classIds
    .map((c) => classToFdi(c))
    .filter((fdi): fdi is number => fdi !== null)
    .map(fdiToToothId);
}

export type ToothConditionGroup = {
  label: string;
  teeth: string[];
  outlineColor: string;
  fillColor: string;
};

export function buildDetectedConditions(presentToothIds: string[]): ToothConditionGroup[] {
  if (presentToothIds.length === 0) {
    return [];
  }
  return [
    {
      label: "detected",
      teeth: presentToothIds,
      fillColor: "#93c5fd",
      outlineColor: "#1d4ed8",
    },
  ];
}

/** Blue = detected but not selected; green = selected (chart + preview). */
export function buildSelectionConditions(
  presentToothIds: string[],
  selectedToothIds: string[],
): ToothConditionGroup[] {
  if (presentToothIds.length === 0) {
    return [];
  }
  if (selectedToothIds.length === 0) {
    return buildDetectedConditions(presentToothIds);
  }
  const selectedSet = new Set(selectedToothIds);
  const selected = presentToothIds.filter((id) => selectedSet.has(id));
  const rest = presentToothIds.filter((id) => !selectedSet.has(id));
  const groups: ToothConditionGroup[] = [];
  if (rest.length > 0) {
    groups.push({
      label: "detected",
      teeth: rest,
      fillColor: "#93c5fd",
      outlineColor: "#1d4ed8",
    });
  }
  if (selected.length > 0) {
    groups.push({
      label: "selected",
      teeth: selected,
      fillColor: "#86efac",
      outlineColor: "#15803d",
    });
  }
  return groups;
}

/** Stable RGB per tooth class for NiiVue label colormap (0 = background). */
export function toothClassRgb(classId: number): [number, number, number] {
  if (classId < 1 || classId > MAX_TOOTH_CLASS) {
    return [0, 0, 0];
  }
  const hue = ((classId - 1) * 137.508) % 360;
  return hslToRgb(hue, 0.65, 0.55);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export type LabelColorMap = {
  R: number[];
  G: number[];
  B: number[];
  A: number[];
  I: number[];
  labels: string[];
};

/**
 * Build a discrete label colormap. When `visibleClassIds` is null/undefined,
 * all present classes are opaque; otherwise only listed classes are shown.
 */
export function buildToothLabelColormap(
  presentClassIds: number[],
  visibleClassIds: number[] | null,
): LabelColorMap {
  const visible =
    visibleClassIds === null || visibleClassIds === undefined
      ? new Set(presentClassIds)
      : new Set(visibleClassIds);

  const R = [0];
  const G = [0];
  const B = [0];
  const A = [0];
  const I = [0];
  const labels = ["background"];

  for (const classId of presentClassIds) {
    const fdi = classToFdi(classId);
    if (fdi === null) {
      continue;
    }
    const [r, g, b] = toothClassRgb(classId);
    R.push(r);
    G.push(g);
    B.push(b);
    A.push(visible.has(classId) ? 255 : 0);
    I.push(classId);
    labels.push(String(fdi));
  }

  return { R, G, B, A, I, labels };
}

/** Cheap clone that only changes alpha from a cached full colormap. */
export function withColormapVisibility(
  base: LabelColorMap,
  visibleClassIds: number[] | null,
): LabelColorMap {
  if (visibleClassIds === null) {
    return {
      ...base,
      A: base.I.map((id) => (id === 0 ? 0 : 255)),
    };
  }
  const visible = new Set(visibleClassIds);
  return {
    ...base,
    A: base.I.map((id) => (id !== 0 && visible.has(id) ? 255 : 0)),
  };
}

/**
 * Build a NiiVue-compatible packed RGBA label LUT (same layout as their
 * internal `Be()` helper). A new typed-array identity is required so NiiVue's
 * colormap cache key changes when only alphas flip.
 */
export function buildLabelLut(cmap: LabelColorMap): {
  lut: Uint8ClampedArray;
  min: number;
  max: number;
} {
  const { R, G, B, A, I } = cmap;
  if (I.length === 0) {
    return { lut: new Uint8ClampedArray(0), min: 0, max: 0 };
  }
  let min = I[0];
  let max = I[0];
  for (let i = 1; i < I.length; i++) {
    const v = I[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const lut = new Uint8ClampedArray((max - min + 1) * 4);
  for (let h = 0; h < I.length; h++) {
    let m = (I[h] - min) * 4;
    lut[m++] = R[h] ?? 0;
    lut[m++] = G[h] ?? 0;
    lut[m++] = B[h] ?? 0;
    lut[m] = A[h] ?? 0;
  }
  return { lut, min, max };
}

/** Stable key for a visibility set (`*` = all present teeth opaque). */
export function visibilityKey(visibleClassIds: number[] | null): string {
  if (visibleClassIds === null) {
    return "*";
  }
  if (visibleClassIds.length === 0) {
    return "";
  }
  return [...visibleClassIds].sort((a, b) => a - b).join(",");
}

/** Resolve which class IDs should be opaque given selection tooth IDs. */
export function visibleClassesFromSelection(
  presentClassIds: number[],
  selectedToothIds: string[],
): number[] | null {
  if (selectedToothIds.length === 0) {
    return null;
  }
  const presentSet = new Set(presentClassIds);
  const visible: number[] = [];
  for (const toothId of selectedToothIds) {
    const fdi = toothIdToFdi(toothId);
    if (!fdi) {
      continue;
    }
    const classId = fdiToClass(fdi);
    if (classId !== null && presentSet.has(classId)) {
      visible.push(classId);
    }
  }
  return visible;
}

/** Parse `teeth-NN` from an odontogram SVG event target. */
export function toothIdFromOdontogramTarget(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.("g[class*='teeth-']");
  if (!el) {
    return null;
  }
  const match = el.getAttribute("class")?.match(/teeth-\d+/);
  return match?.[0] ?? null;
}
