import { cn } from "@/lib/utils";
import { isLowerTooth, isUpperTooth } from "@/app/teeth";
import { useVisualization } from "../VisualizationProvider";
import { ViewPhase } from "../types";
import { toothIdToFdi, toothLabelCss } from "../toothLabels";

type LegendEntry = {
  toothId: string;
  fdi: string;
  color: string;
  selected: boolean;
  /** Unselected while a pick-mode selection exists (matches the faded chart). */
  faded: boolean;
};

function LegendColumn({
  title,
  entries,
  pickMode,
  disabled,
  onSelect,
}: {
  title: string;
  entries: LegendEntry[];
  pickMode: boolean;
  disabled: boolean;
  onSelect: (toothId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="px-2 pb-1.5 text-xs font-semibold tracking-wider text-foreground uppercase">
        {title}
      </span>
      {entries.map((entry) => (
        <button
          key={entry.toothId}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(entry.toothId)}
          title={
            pickMode
              ? `Tooth ${entry.fdi}: click to select or unselect`
              : `Tooth ${entry.fdi}: click to center`
          }
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm tabular-nums text-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
            entry.selected && "font-semibold",
            entry.faded && "opacity-45",
          )}
        >
          <span
            className="size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/15 ring-inset"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          {entry.fdi}
        </button>
      ))}
    </div>
  );
}

/**
 * Full-height tooth color legend panel on the right of the viewer, mirroring the
 * controls sidebar on the left. Replaces NiiVue's canvas-drawn legend so it
 * follows the app theme. Clicking an entry centers the crosshair on that tooth;
 * in pick mode it also toggles the tooth's selection.
 */
export function ToothLegend() {
  const { viewer, display, teeth } = useVisualization();

  const maskVisible =
    teeth.overlayIndex >= 0 && (display.volumeVisibility[teeth.overlayIndex] ?? true);
  if (viewer.viewPhase !== ViewPhase.Ready || !teeth.hasToothLabels || !maskVisible) {
    return null;
  }

  const selectedSet = new Set(teeth.selectedToothIds);
  // Mirrors the overlay: outside pick mode a selection hides the other teeth.
  const filtered = !teeth.pickFromPreview && selectedSet.size > 0;
  const entries: LegendEntry[] = [];
  for (const toothId of teeth.presentToothIds) {
    const fdi = toothIdToFdi(toothId);
    const color = toothLabelCss(toothId);
    if (fdi === null || color === null || (filtered && !selectedSet.has(toothId))) {
      continue;
    }
    const pickSelection = teeth.pickFromPreview && selectedSet.size > 0;
    entries.push({
      toothId,
      fdi,
      color,
      selected: pickSelection && selectedSet.has(toothId),
      faded: pickSelection && !selectedSet.has(toothId),
    });
  }

  const upper = entries.filter((e) => isUpperTooth(e.fdi));
  const lower = entries.filter((e) => isLowerTooth(e.fdi));

  const handleSelect = (toothId: string) => {
    teeth.focusTooth(toothId);
    if (teeth.pickFromPreview) {
      teeth.toggleToothFromPreview(toothId);
    }
  };

  return (
    <aside
      aria-label="Tooth legend"
      className="flex h-full w-48 shrink-0 flex-col border-l border-border bg-secondary"
    >
      {/* Header (matches the controls sidebar header) */}
      <div className="border-b border-border px-4 py-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Legend</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {teeth.pickFromPreview ? "Click to select" : "Click to center"} · {entries.length}{" "}
          {entries.length === 1 ? "tooth" : "teeth"}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-1 overflow-y-auto px-2 py-3">
        {upper.length > 0 && (
          <LegendColumn
            title="Upper"
            entries={upper}
            pickMode={teeth.pickFromPreview}
            disabled={teeth.pickModePending}
            onSelect={handleSelect}
          />
        )}
        {lower.length > 0 && (
          <LegendColumn
            title="Lower"
            entries={lower}
            pickMode={teeth.pickFromPreview}
            disabled={teeth.pickModePending}
            onSelect={handleSelect}
          />
        )}
      </div>
    </aside>
  );
}
