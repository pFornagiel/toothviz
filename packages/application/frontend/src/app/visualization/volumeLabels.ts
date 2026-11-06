export const SCAN_LABEL = "CBCT scan";
export const SEGMENTATION_LABEL = "Tooth segmentation";

/**
 * Name shown to the user for a loaded volume. Display only: NiiVue's `volume.name`
 * must stay as it is, because the overlay lookup can match on it.
 */
export function volumeLabel(
  index: number,
  overlayIndex: number,
  fileName: string | undefined,
): string {
  if (index === overlayIndex) {
    return SEGMENTATION_LABEL;
  }
  if (index === 0) {
    return SCAN_LABEL;
  }
  return fileName || `Volume ${index}`;
}
