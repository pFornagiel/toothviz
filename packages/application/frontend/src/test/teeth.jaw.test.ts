import { describe, expect, it } from "vitest";
import {
  isLowerLeftTooth,
  isLowerRightTooth,
  isUpperLeftTooth,
  isUpperRightTooth,
} from "@/app/teeth";

describe("FDI quadrant helpers", () => {
  it("classifies two-digit permanent FDI", () => {
    expect(isUpperRightTooth(11)).toBe(true);
    expect(isUpperLeftTooth("21")).toBe(true);
    expect(isLowerLeftTooth(31)).toBe(true);
    expect(isLowerRightTooth("48")).toBe(true);

    expect(isUpperRightTooth(21)).toBe(false);
    expect(isLowerLeftTooth(41)).toBe(false);
  });

  it("rejects non two-digit FDI values", () => {
    expect(isUpperRightTooth("1")).toBe(false);
    expect(isUpperRightTooth(1)).toBe(false);
    expect(isUpperLeftTooth("210")).toBe(false);
    expect(isLowerLeftTooth("abc")).toBe(false);
  });
});
