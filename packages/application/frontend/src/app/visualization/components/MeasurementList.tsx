import { X } from "lucide-react";
import { SLICE_TYPE_LABELS } from "../constants";
import type { MeasurementControls } from "../hooks/useNiivueMeasurement";

/** One row per measurement: click to go to it, or remove it with the cross. */
export function MeasurementList({ measure }: { measure: MeasurementControls }) {
  return (
    <ul className="space-y-1">
      {measure.measurements.map(({ distance, plane }, index) => (
        <li key={index} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => measure.goTo(index)}
            title="Go to this measurement"
            className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left text-sm text-foreground hover:bg-accent"
          >
            <span className="tabular-nums">{distance.toFixed(1)} mm</span>
            {plane && (
              <span className="truncate text-xs text-muted-foreground">
                {SLICE_TYPE_LABELS[plane]}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => measure.remove(index)}
            aria-label={`Remove measurement ${index + 1}`}
            title="Remove"
            className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
