import { useRef, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  PICK_MODE_APPLY,
  PICK_MODE_DISCARD,
} from "../pickModeCopy";
import type {
  PickModeExitConfirmIntent,
  PickModeExitIntent,
} from "../hooks/useToothSelectionControls";
import { selectionSummary } from "../selectionSummary";

export interface PickModeExitDialogProps {
  intent: PickModeExitIntent | null;
  selectedToothIds: string[];
  baselineToothIds: string[];
  presentCount: number;
  onCancel: () => void;
  onConfirm: (intent: PickModeExitConfirmIntent) => void;
}

function ActionWithTooltip({
  summary,
  className,
  onClick,
  children,
}: {
  summary: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AlertDialogAction className={className} onClick={onClick}>
          {children}
        </AlertDialogAction>
      </TooltipTrigger>
      <TooltipContent side="top" className="z-[100] max-w-64 text-balance">
        {summary}
      </TooltipContent>
    </Tooltip>
  );
}

function SelectionCompare({
  current,
  previous,
}: {
  current: string;
  previous: string;
}) {
  return (
    <dl className="grid gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-left">
      <div className="grid gap-0.5">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Current
        </dt>
        <dd className="text-sm font-medium text-foreground tabular-nums text-balance">
          {current}
        </dd>
      </div>
      <div className="grid gap-0.5 border-t border-border/60 pt-2">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Previous
        </dt>
        <dd className="text-sm text-foreground tabular-nums text-balance">{previous}</dd>
      </div>
    </dl>
  );
}

export function PickModeExitDialog({
  intent,
  selectedToothIds,
  baselineToothIds,
  presentCount,
  onCancel,
  onConfirm,
}: PickModeExitDialogProps) {
  const open = intent !== null;
  const confirmedRef = useRef(false);

  const previousSelection = selectionSummary(baselineToothIds, presentCount);
  const currentSelection = selectionSummary(selectedToothIds, presentCount);
  const applySummary =
    selectedToothIds.length === 0
      ? "Hide all teeth."
      : selectedToothIds.length === presentCount
        ? `Show all ${presentCount} teeth.`
        : `Show only ${currentSelection}. Hide the rest.`;
  const discardSummary = `Restore previous selection: ${previousSelection}.`;

  const confirm = (next: PickModeExitConfirmIntent) => {
    confirmedRef.current = true;
    onConfirm(next);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (confirmedRef.current) {
            confirmedRef.current = false;
            return;
          }
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intent === "choose"
              ? "Leave pick mode?"
              : intent === "apply"
                ? "Apply selection?"
                : "Discard picks?"}
          </AlertDialogTitle>
          {intent === "choose" ? (
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Apply your picks, or restore the previous selection.</p>
                <SelectionCompare current={currentSelection} previous={previousSelection} />
              </div>
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription>
              {intent === "apply" ? applySummary : discardSummary}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {intent === "choose" ? (
            <>
              <ActionWithTooltip
                summary={discardSummary}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => confirm("discard")}
              >
                {PICK_MODE_DISCARD}
              </ActionWithTooltip>
              <ActionWithTooltip summary={applySummary} onClick={() => confirm("apply")}>
                {PICK_MODE_APPLY}
              </ActionWithTooltip>
            </>
          ) : (
            <AlertDialogAction
              className={
                intent === "discard"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                if (intent === "apply" || intent === "discard") {
                  confirm(intent);
                }
              }}
            >
              {intent === "apply" ? PICK_MODE_APPLY : PICK_MODE_DISCARD}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
