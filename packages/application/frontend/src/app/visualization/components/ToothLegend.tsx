import { PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isLowerLeftTooth,
  isLowerRightTooth,
  isUpperLeftTooth,
  isUpperRightTooth,
} from "@/app/teeth";
import { Button } from "../../components/ui/button";
import { useVisualization } from "../VisualizationProvider";
import { toothIdToFdi, toothLabelCss } from "../toothLabels";

type LegendEntry = {
  toothId: string;
  fdi: string;
  color: string;
  selected: boolean;
  /** Unselected while a pick-mode selection exists (matches the faded chart). */
  faded: boolean;
};

type LegendColumn = {
  title: string;
  entries: LegendEntry[];
};

function byFdi(a: LegendEntry, b: LegendEntry): number {
  return parseInt(a.fdi, 10) - parseInt(b.fdi, 10);
}

function LegendToothList({
  entries,
  pickMode,
  disabled,
  onSelect,
}: {
  entries: LegendEntry[];
  pickMode: boolean;
  disabled: boolean;
  onSelect: (toothId: string) => void;
}) {
  const action = pickMode ? "select or unselect" : "center";
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <li key={entry.toothId}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(entry.toothId)}
            aria-label={`Tooth ${entry.fdi}: click to ${action}`}
            aria-pressed={pickMode ? entry.selected : undefined}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs tabular-nums text-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              "disabled:pointer-events-none disabled:opacity-50",
              entry.selected && "bg-accent font-semibold text-accent-foreground",
              entry.faded && "opacity-45",
            )}
          >
            <span
              className="size-3 shrink-0 rounded-[2px] ring-1 ring-black/15 ring-inset"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            {entry.fdi}
          </button>
        </li>
      ))}
    </ul>
  );
}

function LegendArch({
  title,
  columns,
  pickMode,
  disabled,
  onSelect,
}: {
  title: string;
  columns: LegendColumn[];
  pickMode: boolean;
  disabled: boolean;
  onSelect: (toothId: string) => void;
}) {
  if (columns.every((c) => c.entries.length === 0)) {
    return null;
  }

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wider text-foreground uppercase">{title}</h3>
      <div className="flex gap-1">
        {columns.map((column) => (
          <div key={column.title} className="min-w-0 flex-1">
            <span className="mb-1 block px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {column.title}
            </span>
            <LegendToothList
              entries={column.entries}
              pickMode={pickMode}
              disabled={disabled}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Full-height tooth color legend on the right of the viewer.
 * Mounted only when the page decides it should show
 * (`isLegendAvailable` + `legendVisible`).
 */
export function ToothLegend() {
  const { teeth, layout } = useVisualization();

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

  const upperRight = entries.filter((e) => isUpperRightTooth(e.fdi)).sort(byFdi);
  const upperLeft = entries.filter((e) => isUpperLeftTooth(e.fdi)).sort(byFdi);
  const lowerRight = entries.filter((e) => isLowerRightTooth(e.fdi)).sort(byFdi);
  const lowerLeft = entries.filter((e) => isLowerLeftTooth(e.fdi)).sort(byFdi);

  const handleSelect = (toothId: string) => {
    teeth.focusTooth(toothId);
    if (teeth.pickFromPreview) {
      teeth.toggleToothFromPreview(toothId);
    }
  };

  const hint = teeth.pickModePending
    ? "Updating overlay…"
    : teeth.pickFromPreview
      ? "Click a tooth to select or unselect."
      : "Click a tooth to center the crosshair.";

  return (
    <aside
      aria-label="Tooth legend"
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-secondary"
    >
      {/* Header (matches the controls sidebar header) */}
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Legend</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? "tooth" : "teeth"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => layout.setLegendVisible(false)}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          title="Hide legend"
        >
          <PanelRightClose className="size-5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <LegendArch
          title="Upper"
          columns={[
            { title: "Right", entries: upperRight },
            { title: "Left", entries: upperLeft },
          ]}
          pickMode={teeth.pickFromPreview}
          disabled={teeth.pickModePending}
          onSelect={handleSelect}
        />
        <LegendArch
          title="Lower"
          columns={[
            { title: "Right", entries: lowerRight },
            { title: "Left", entries: lowerLeft },
          ]}
          pickMode={teeth.pickFromPreview}
          disabled={teeth.pickModePending}
          onSelect={handleSelect}
        />
      </div>
    </aside>
  );
}
