import { Ruler, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { MeasurementControls } from "../hooks/useNiivueMeasurement";

const OVERLAY_BUTTON =
  "shadow-sm dark:border dark:border-white/15 dark:bg-black/60 dark:text-white dark:hover:bg-black/80";

const HINT = {
  firstPoint: "Click the first point",
  secondPoint: "Click the second point",
} as const;

/** Viewer overlay for measuring a distance between two points on a 2D tile. */
export function MeasureControls({ measure }: { measure: MeasurementControls }) {
  const { phase, measurements, available, start, cancel, clear } = measure;

  if (!available) {
    return null;
  }

  return (
    <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
      {phase === "off" ? (
        <>
          <Button variant="secondary" size="sm" className={OVERLAY_BUTTON} onClick={start}>
            <Ruler className="size-4" />
            Measure
          </Button>
          {measurements.length > 0 && (
            <Button variant="secondary" size="sm" className={OVERLAY_BUTTON} onClick={clear}>
              <Trash2 className="size-4" />
              Clear measurements
            </Button>
          )}
        </>
      ) : (
        <>
          <Button variant="secondary" size="sm" className={OVERLAY_BUTTON} onClick={cancel}>
            <X className="size-4" />
            Cancel
          </Button>
          <span
            role="status"
            aria-live="polite"
            className="pointer-events-none rounded-full bg-black/70 px-2.5 py-1 text-xs text-white"
          >
            {HINT[phase]} · Esc to cancel
          </span>
        </>
      )}
    </div>
  );
}
