import { byFdiNumber, toothIdToFdi } from "./toothLabels";

/** Comma-separated FDI numbers for a tooth-id list. */
export function formatFdiList(toothIds: string[]): string {
  return toothIds
    .map((id) => toothIdToFdi(id))
    .filter((fdi): fdi is string => fdi !== null)
    .sort(byFdiNumber)
    .join(", ");
}

/** Short visibility summary for confirmations. */
export function selectionSummary(toothIds: string[], presentCount: number): string {
  if (toothIds.length === 0) {
    return "no teeth";
  }
  if (presentCount > 0 && toothIds.length === presentCount) {
    return `all ${presentCount} teeth`;
  }
  return formatFdiList(toothIds);
}
