import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { SLICE_TYPE_LABELS } from "../constants";
import type { MeasurementControls } from "../hooks/useNiivueMeasurement";

function defaultName(index: number): string {
  return `Measurement ${index + 1}`;
}

function nameDraft(name: string, index: number): string {
  return name.trim() || defaultName(index);
}

/** One row per measurement: click to go to it, rename, or remove. */
export function MeasurementList({ measure }: { measure: MeasurementControls }) {
  const {
    measurements,
    pendingRenameIndex,
    goTo,
    remove,
    rename,
    clearPendingRename,
  } = measure;
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** Escape unmounts the input and would otherwise commit via blur. */
  const skipCommitRef = useRef(false);

  const beginRename = (index: number) => {
    skipCommitRef.current = false;
    setEditingIndex(index);
    setDraft(nameDraft(measurements[index]?.name ?? "", index));
  };

  // Open rename as soon as a measurement is finished (including the first one).
  useEffect(() => {
    if (pendingRenameIndex === null) {
      return;
    }
    if (pendingRenameIndex >= measurements.length) {
      clearPendingRename();
      return;
    }
    beginRename(pendingRenameIndex);
    clearPendingRename();
    // beginRename closes over measurements; pending index is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenameIndex, measurements.length, clearPendingRename]);

  useEffect(() => {
    if (editingIndex !== null && editingIndex >= measurements.length) {
      setEditingIndex(null);
    }
  }, [measurements.length, editingIndex]);

  useEffect(() => {
    if (editingIndex === null) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editingIndex]);

  const commitRename = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    if (editingIndex === null) {
      return;
    }
    rename(editingIndex, draft.trim() || defaultName(editingIndex));
    setEditingIndex(null);
  };

  const cancelRename = () => {
    skipCommitRef.current = true;
    setEditingIndex(null);
  };

  return (
    <ul className="space-y-1">
      {measurements.map(({ distance, plane, name }, index) => {
        const label = nameDraft(name, index);
        const editing = editingIndex === index;

        const meta = (
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="tabular-nums text-muted-foreground">{distance.toFixed(1)} mm</span>
            {plane && (
              <span className="text-xs text-muted-foreground">{SLICE_TYPE_LABELS[plane]}</span>
            )}
          </span>
        );

        return (
          <li key={index} className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1">
              {editing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  size={Math.min(Math.max(draft.length, defaultName(index).length), 18)}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                  placeholder={defaultName(index)}
                  aria-label={`Name of measurement ${index + 1}`}
                  className="min-w-0 max-w-[55%] rounded-md border border-border bg-accent/40 px-1.5 py-0.5 text-sm font-medium text-foreground outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => goTo(index)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    beginRename(index);
                  }}
                  title="Go to this measurement · double-click to rename"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium text-foreground"
                >
                  {label}
                </button>
              )}
              {editing ? (
                meta
              ) : (
                <button
                  type="button"
                  onClick={() => goTo(index)}
                  title="Go to this measurement"
                  className="cursor-pointer text-left text-sm hover:opacity-80"
                >
                  {meta}
                </button>
              )}
            </div>
            {!editing && (
              <button
                type="button"
                onClick={() => beginRename(index)}
                aria-label={`Rename measurement ${index + 1}`}
                title="Rename"
                className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  cancelRename();
                }
                remove(index);
              }}
              aria-label={`Remove measurement ${index + 1}`}
              title="Remove"
              className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
