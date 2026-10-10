/** Shared copy for pick mode UI (sidebar, legend, canvas notice). */

export const PICK_MODE_LABEL = "Pick mode";

export const PICK_MODE_SUMMARY = "Pick mode — all teeth stay visible while selecting";

/** Tooltip on the switch when pick mode is off. */
export const PICK_MODE_HELP_OFF =
  "Show all teeth while you pick from 2D slices or the chart.";

/** Tooltip on the switch when pick mode is on and selection is unchanged. */
export const PICK_MODE_HELP_ON =
  "Turn off to leave pick mode and filter the overlay to the current selection.";

/** Tooltip on the switch when pick mode is on and selection changed. */
export const PICK_MODE_HELP_ON_DIRTY =
  "Apply keeps the new selection and hides the rest. Discard restores the previous one.";

export const PICK_MODE_HELP =
  "Click slices or the chart to select or unselect.";

export const PICK_MODE_APPLY = "Apply selection";

export const PICK_MODE_DISCARD = "Leave without saving";

export const PICK_MODE_PENDING = "Updating overlay…";

export const PICK_MODE_LEGEND_CENTER = "Center on this tooth";

export function slicePickMessage(fdi: string, selected: boolean): string {
  return selected ? `Selected ${fdi}` : `Unselected ${fdi}`;
}
