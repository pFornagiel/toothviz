/** Shared copy for pick mode UI (sidebar, legend, canvas notice). */

export const PICK_MODE_LABEL = "Pick mode";

export const PICK_MODE_SUMMARY = "Pick mode — all teeth stay visible while selecting";

export const PICK_MODE_HELP =
  "Click 2D slices or the chart to select teeth. All teeth stay visible until you apply or discard.";

export const PICK_MODE_HELP_SHORT =
  "Click slices or the chart to select or unselect.";

export const PICK_MODE_APPLY = "Apply selection";

export const PICK_MODE_DISCARD = "Leave without saving";

export const PICK_MODE_PENDING = "Updating overlay…";

export const PICK_MODE_LEGEND_CENTER = "Center on this tooth";

export const PICK_MODE_LEGEND_HINT = "Click to center on a tooth.";

export function slicePickMessage(fdi: string, selected: boolean): string {
  return selected ? `Selected ${fdi}` : `Unselected ${fdi}`;
}