import { PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isLowerLeftTooth,
  isLowerRightTooth,
  isUpperLeftTooth,
  isUpperRightTooth,
} from "@/app/teeth";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  PICK_MODE_LABEL,
  PICK_MODE_LEGEND_CENTER,
  PICK_MODE_LEGEND_HINT,
  PICK_MODE_PENDING,
} from "../pickModeCopy";
import { useVisualization } from "../VisualizationProvider";
import { toothIdToFdi, toothLabelCss, byFdiNumber } from "../toothLabels";

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

function LegendToothList({
  entries,
  pickMode,
  disabled,
  onFocus,
}: {
  entries: LegendEntry[];
  pickMode: boolean;
  disabled: boolean;
  onFocus: (toothId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <li key={entry.toothId}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Span keeps hover tooltips working when the button is disabled. */}
              <span className={cn("block w-full", disabled ? "cursor-wait" : "cursor-pointer")}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onFocus(entry.toothId)}
                  aria-label={`Tooth ${entry.fdi}: center on this tooth`}
                  aria-pressed={pickMode ? entry.selected : undefined}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs tabular-nums text-foreground transition-colors",
                    "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    "disabled:pointer-events-none disabled:cursor-wait disabled:opacity-50",
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
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-60 text-balance">
              {PICK_MODE_LEGEND_CENTER}
            </TooltipContent>
          </Tooltip>
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
  onFocus,
}: {
  title: string;
  columns: LegendColumn[];
  pickMode: boolean;
  disabled: boolean;
  onFocus: (toothId: string) => void;
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
              onFocus={onFocus}
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
  // Mirrors the overlay: outside pick mode, only selected teeth stay in the list.
  const filtered = !teeth.pickFromPreview;
  const entries: LegendEntry[] = [];
  for (const toothId of teeth.presentToothIds) {
    const fdi = toothIdToFdi(toothId);
    const color = toothLabelCss(toothId);
    if (fdi === null || color === null || (filtered && !selectedSet.has(toothId))) {
      continue;
    }
    const pickSelection = teeth.pickFromPreview;
    entries.push({
      toothId,
      fdi,
      color,
      selected: pickSelection && selectedSet.has(toothId),
      faded: pickSelection && !selectedSet.has(toothId),
    });
  }

  entries.sort((a, b) => byFdiNumber(a.fdi, b.fdi));
  const upperRight = entries.filter((e) => isUpperRightTooth(e.fdi));
  const upperLeft = entries.filter((e) => isUpperLeftTooth(e.fdi));
  const lowerRight = entries.filter((e) => isLowerRightTooth(e.fdi));
  const lowerLeft = entries.filter((e) => isLowerLeftTooth(e.fdi));

  const handleFocus = (toothId: string) => {
    teeth.focusTooth(toothId);
  };

  const pickMode = teeth.pickFromPreview;
  const hint = teeth.pickModePending ? PICK_MODE_PENDING : PICK_MODE_LEGEND_HINT;

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
            {pickMode && (
              <>
                {" · "}
                <span className="font-medium text-foreground">{PICK_MODE_LABEL}</span>
              </>
            )}
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
          pickMode={pickMode}
          disabled={teeth.pickModePending}
          onFocus={handleFocus}
        />
        <LegendArch
          title="Lower"
          columns={[
            { title: "Right", entries: lowerRight },
            { title: "Left", entries: lowerLeft },
          ]}
          pickMode={pickMode}
          disabled={teeth.pickModePending}
          onFocus={handleFocus}
        />
      </div>
    </aside>
  );
}
