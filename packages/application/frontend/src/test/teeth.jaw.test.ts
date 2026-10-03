import { describe, expect, it } from "vitest";
import { isLowerTooth, isUpperTooth } from "@/app/teeth";

describe("isUpperTooth / isLowerTooth", () => {
  it("classifies upper (1x, 2x) and lower (3x, 4x) FDI", () => {
    expect(isUpperTooth(11)).toBe(true);
    expect(isUpperTooth("21")).toBe(true);
    expect(isUpperTooth(31)).toBe(false);

    expect(isLowerTooth(31)).toBe(true);
    expect(isLowerTooth("48")).toBe(true);
    expect(isLowerTooth(11)).toBe(false);
  });
});
