/**
 * FDI permanent teeth (ISO 3950):
 * 1x upper right · 2x upper left · 3x lower left · 4x lower right.
 */

function fdiQuadrantDigit(fdi: string | number): string | null {
  const s = String(fdi);
  // Permanent FDI is two digits; reject bare "1" / "10" etc.
  if (!/^[1-4]\d$/.test(s)) {
    return null;
  }
  return s[0];
}

export function isUpperRightTooth(fdi: string | number): boolean {
  return fdiQuadrantDigit(fdi) === "1";
}

export function isUpperLeftTooth(fdi: string | number): boolean {
  return fdiQuadrantDigit(fdi) === "2";
}

export function isLowerLeftTooth(fdi: string | number): boolean {
  return fdiQuadrantDigit(fdi) === "3";
}

export function isLowerRightTooth(fdi: string | number): boolean {
  return fdiQuadrantDigit(fdi) === "4";
}
