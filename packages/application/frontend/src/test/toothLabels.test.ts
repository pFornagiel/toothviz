import { describe, expect, it } from "vitest";
import {
  CLASS_TO_FDI,
  buildDetectedConditions,
  buildToothLabelColormap,
  classToFdi,
  classesToToothIds,
  fdiToClass,
  fdiToToothId,
  presentClassesFromImg,
  toothIdToFdi,
  visibleClassesFromSelection,
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
});
