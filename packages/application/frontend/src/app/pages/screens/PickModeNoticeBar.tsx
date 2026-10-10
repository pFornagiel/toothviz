"use client";

import { Crosshair } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  PICK_MODE_APPLY,
  PICK_MODE_DISCARD,
  PICK_MODE_HELP,
  PICK_MODE_LABEL,
  PICK_MODE_PENDING,
  PICK_MODE_SUMMARY,
} from "../../visualization/pickModeCopy";
import { ModeNoticeBar } from "./ModeNoticeBar";

export interface PickModeNoticeBarProps {
  pending: boolean;
  selectedCount: number;
  onApply: () => void;
  onDiscard: () => void;
  placement?: "inline" | "overlay";
  expandDirection?: "down" | "up";
}

export function PickModeNoticeBar({
  pending,
  selectedCount,
  onApply,
  onDiscard,
  placement = "overlay",
  expandDirection = "down",
}: PickModeNoticeBarProps) {
  const compactLabel = pending
    ? PICK_MODE_PENDING
    : selectedCount > 0
      ? `${PICK_MODE_LABEL} · ${selectedCount}`
      : PICK_MODE_LABEL;

  const summary = pending ? PICK_MODE_PENDING : PICK_MODE_SUMMARY;

  return (
    <ModeNoticeBar
      summary={summary}
      compactLabel={compactLabel}
      tone="primary"
      placement={placement}
      expandDirection={expandDirection}
      overlayIcon={<Crosshair className="size-3.5 opacity-90" aria-hidden />}
      overlayAriaLabel={`${summary}. ${PICK_MODE_HELP}`}
    >
      {pending ? (
        <p className="text-muted-foreground">{PICK_MODE_PENDING}</p>
      ) : (
        <>
          <p className="text-muted-foreground">{PICK_MODE_HELP}</p>
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start p-0 text-sm"
              onClick={onApply}
              disabled={pending}
            >
              {PICK_MODE_APPLY}
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start p-0 text-sm text-muted-foreground"
              onClick={onDiscard}
              disabled={pending}
            >
              {PICK_MODE_DISCARD}
            </Button>
          </div>
        </>
      )}
    </ModeNoticeBar>
  );
}
