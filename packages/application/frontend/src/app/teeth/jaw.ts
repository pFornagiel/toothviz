/**
 * FDI permanent teeth (ISO 3950): 1x/2x = upper, 3x/4x = lower.
 * Accepts numeric or string FDI (e.g. 21 or "21").
 */

export function isUpperTooth(fdi: string | number): boolean {
  const s = String(fdi);
  return s.startsWith("1") || s.startsWith("2");
}

export function isLowerTooth(fdi: string | number): boolean {
  const s = String(fdi);
  return s.startsWith("3") || s.startsWith("4");
}
