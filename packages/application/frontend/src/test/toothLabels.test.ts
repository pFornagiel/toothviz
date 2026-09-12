import { describe, expect, it } from "vitest";
import {
  CLASS_TO_FDI,
  buildDetectedConditions,
  buildLabelLut,
  buildSelectionConditions,
  buildToothLabelColormap,
  classToFdi,
  classToToothId,
  classesToToothIds,
  fdiToClass,
  fdiToToothId,
  presentClassesFromImg,
  toothClassFromLocationValues,
  toothIdFromOdontogramTarget,
  toothIdToFdi,
  toggleToothId,
  visibilityKey,
  visibleClassesFromSelection,
  withColormapVisibility,
} from "../app/visualization/toothLabels";

describe("toothLabels mapping", () => {
  it("maps Dataset121 class indices to FDI", () => {
    expect(classToFdi(1)).toBe(11);
    expect(classToFdi(8)).toBe(18);
    expect(classToFdi(9)).toBe(21);
    expect(classToFdi(16)).toBe(28);
    expect(classToFdi(17)).toBe(31);
    expect(classToFdi(24)).toBe(38);
    expect(classToFdi(25)).toBe(41);
    expect(classToFdi(32)).toBe(48);
    expect(classToFdi(0)).toBeNull();
    expect(classToFdi(33)).toBeNull();
  });

  it("round-trips FDI ↔ class", () => {
    for (let c = 1; c <= 32; c++) {
      const fdi = CLASS_TO_FDI[c];
      expect(fdiToClass(fdi)).toBe(c);
      expect(fdiToClass(String(fdi))).toBe(c);
    }
  });

  it("builds odontogram tooth ids", () => {
    expect(fdiToToothId(21)).toBe("teeth-21");
    expect(toothIdToFdi("teeth-21")).toBe("21");
    expect(toothIdToFdi("bad")).toBeNull();
  });
});

describe("presentClassesFromImg", () => {
  it("returns sorted unique tooth classes ignoring background", () => {
    const img = new Uint8Array([0, 1, 1, 9, 0, 32, 9, 99]);
    expect(presentClassesFromImg(img)).toEqual([1, 9, 32]);
  });

  it("returns empty when only background", () => {
    expect(presentClassesFromImg(new Uint8Array([0, 0, 0]))).toEqual([]);
  });
});

describe("preview pick helpers", () => {
  it("maps location values to tooth class by overlay name", () => {
    const values = [
      { name: "volume", value: 120 },
      { name: "overlay", value: 9.2 },
    ];
    expect(toothClassFromLocationValues(values, 1)).toBe(9);
  });

  it("falls back to overlay index", () => {
    expect(
      toothClassFromLocationValues([{ name: "a", value: 0 }, { name: "b", value: 17 }], 1),
    ).toBe(17);
  });

  it("ignores background and out-of-range", () => {
    expect(toothClassFromLocationValues([{ name: "overlay", value: 0 }], 0)).toBeNull();
    expect(toothClassFromLocationValues([{ name: "overlay", value: 99 }], 0)).toBeNull();
  });

  it("toggles tooth ids", () => {
    expect(toggleToothId([], "teeth-11")).toEqual(["teeth-11"]);
    expect(toggleToothId(["teeth-11", "teeth-21"], "teeth-11")).toEqual(["teeth-21"]);
  });

  it("maps class to tooth id", () => {
    expect(classToToothId(9)).toBe("teeth-21");
    expect(classToToothId(0)).toBeNull();
  });
});

describe("selection visibility", () => {
  it("maps present classes to tooth ids", () => {
    expect(classesToToothIds([1, 9, 25])).toEqual(["teeth-11", "teeth-21", "teeth-41"]);
  });

  it("empty selection means show all (null visible filter)", () => {
    expect(visibleClassesFromSelection([1, 9], [])).toBeNull();
  });

  it("filters to selected subset that are present", () => {
    expect(visibleClassesFromSelection([1, 9, 17], ["teeth-21", "teeth-11", "teeth-99"])).toEqual([
      9, 1,
    ]);
  });

  it("builds selection conditions with green for selected teeth", () => {
    expect(buildSelectionConditions(["teeth-11", "teeth-21"], ["teeth-21"])).toEqual([
      {
        label: "detected",
        teeth: ["teeth-11"],
        fillColor: "#93c5fd",
        outlineColor: "#1d4ed8",
      },
      {
        label: "selected",
        teeth: ["teeth-21"],
        fillColor: "#86efac",
        outlineColor: "#15803d",
      },
    ]);
  });

  it("builds detected conditions for odontogram", () => {
    expect(buildDetectedConditions(["teeth-11", "teeth-21"])).toEqual([
      {
        label: "detected",
        teeth: ["teeth-11", "teeth-21"],
        fillColor: "#93c5fd",
        outlineColor: "#1d4ed8",
      },
    ]);
    expect(buildDetectedConditions([])).toEqual([]);
  });

  it("builds label colormap with alpha for hidden teeth", () => {
    const cmap = buildToothLabelColormap([1, 9], [1]);
    expect(cmap.I).toEqual([0, 1, 9]);
    expect(cmap.labels).toEqual(["background", "11", "21"]);
    expect(cmap.A[0]).toBe(0);
    expect(cmap.A[1]).toBe(255);
    expect(cmap.A[2]).toBe(0);
  });

  it("shows all present teeth when visible is null", () => {
    const cmap = buildToothLabelColormap([1, 9], null);
    expect(cmap.A.slice(1)).toEqual([255, 255]);
  });

  it("reuses a cached colormap when toggling visibility", () => {
    const base = buildToothLabelColormap([1, 9], null);
    const filtered = withColormapVisibility(base, [9]);
    expect(filtered.A).toEqual([0, 0, 255]);
    expect(withColormapVisibility(base, null).A).toEqual([0, 255, 255]);
  });

  it("builds a packed label LUT with per-class alpha", () => {
    const base = buildToothLabelColormap([1, 9], [9]);
    const { lut, min, max } = buildLabelLut(base);
    expect(min).toBe(0);
    expect(max).toBe(9);
    expect(lut[(1 - min) * 4 + 3]).toBe(0);
    expect(lut[(9 - min) * 4 + 3]).toBe(255);
    expect(lut[(0 - min) * 4 + 3]).toBe(0);
  });

  it("builds stable visibility keys", () => {
    expect(visibilityKey(null)).toBe("*");
    expect(visibilityKey([])).toBe("");
    expect(visibilityKey([9, 1])).toBe("1,9");
  });

  it("parses tooth ids from odontogram event targets", () => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "teeth-21");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    g.appendChild(path);
    expect(toothIdFromOdontogramTarget(path)).toBe("teeth-21");
    expect(toothIdFromOdontogramTarget(document.createElement("div"))).toBeNull();
  });
});
