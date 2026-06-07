"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "../../components/ui/button";

export type ProcessingNotice =
  | "none"
  | "preview-waiting"
  | "loading-artifacts"
  | "artifacts-ready"
  | "processing-failed";

export interface ProcessingNoticeBarProps {
  notice: Exclude<ProcessingNotice, "none">;
  showReturnLink: boolean;
  onReturnToProgress: () => void;
  /** Shown on the trigger; defaults to the notice summary. */
  label?: string;
  /** Pill for ribbon; text matches the bottom status bar. */
  variant?: "pill" | "text";
  /** Popover opens above the trigger in the bottom bar. */
  expandDirection?: "down" | "up";
  /** Floating pill over the canvas (top-left). */
  placement?: "inline" | "overlay";
}

const HOVER_CLOSE_DELAY_MS = 250;

const SUMMARY: Record<Exclude<ProcessingNotice, "none">, string> = {
  "preview-waiting": "Scan preview — waiting for pipeline results",
  "loading-artifacts": "Processing complete — loading segmentation overlay…",
  "artifacts-ready": "All results loaded",
  "processing-failed": "Processing failed — scan preview only",
};

/** Compact pill text when floating over the viewer. */
const OVERLAY_LABEL: Record<Exclude<ProcessingNotice, "none">, string> = {
  "preview-waiting": "Scan preview",
  "loading-artifacts": "Loading results",
  "artifacts-ready": "All loaded",
  "processing-failed": "Preview only",
};

const BAR_STYLE: Record<Exclude<ProcessingNotice, "none">, string> = {
  "preview-waiting": "border-primary/30 text-foreground",
  "loading-artifacts": "border-primary/30 text-foreground",
  "artifacts-ready": "border-emerald-600/30 text-emerald-700 dark:text-emerald-400",
  "processing-failed": "border-destructive/30 text-destructive",
};

const BAR_SURFACE: Record<"inline" | "overlay", string> = {
  inline: "bg-secondary",
  overlay: "bg-background/90 shadow-sm backdrop-blur-md",
};

const DOT_STYLE: Record<Exclude<ProcessingNotice, "none">, string> = {
  "preview-waiting": "bg-primary animate-pulse",
  "loading-artifacts": "bg-primary animate-pulse",
  "artifacts-ready": "bg-emerald-600",
  "processing-failed": "bg-destructive",
};

function ExpandedContent({
  notice,
  showReturnLink,
  onReturnToProgress,
}: ProcessingNoticeBarProps) {
  switch (notice) {
    case "preview-waiting":
      return (
        <>
          <p className="text-muted-foreground">
            You are viewing the scan only. Segmentation results load automatically when processing
            finishes.
          </p>
          {showReturnLink && (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start p-0 text-sm"
              onClick={onReturnToProgress}
            >
              Return to progress screen
            </Button>
          )}
        </>
      );
    case "loading-artifacts":
      return (
        <>
          <p className="text-muted-foreground">
            Pipeline finished. Loading segmentation overlay and other artifacts now.
          </p>
          {showReturnLink && (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start p-0 text-sm"
              onClick={onReturnToProgress}
            >
              Return to progress screen
            </Button>
          )}
        </>
      );
    case "artifacts-ready":
      return (
        <p className="text-muted-foreground">
          Volume and segmentation overlay are ready. This message will dismiss shortly.
        </p>
      );
    case "processing-failed":
      return (
        <p className="text-muted-foreground">
          Scan preview remains available. Reopen from Browse Studies to retry or check details.
        </p>
      );
  }
}

export function ProcessingNoticeBar({
  notice,
  showReturnLink,
  onReturnToProgress,
  label,
  variant = "pill",
  expandDirection = "down",
  placement = "inline",
}: ProcessingNoticeBarProps) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerLabel =
    label ?? (placement === "overlay" ? OVERLAY_LABEL[notice] : SUMMARY[notice]);
  const expandUp = expandDirection === "up";
  const surface = `${BAR_STYLE[notice]} ${BAR_SURFACE[placement]}`;
  const popoverAlign = placement === "overlay" ? "left-0" : "right-0";
  const popoverOriginDown = placement === "overlay" ? "origin-top-left" : "origin-top-right";
  const popoverOriginUp = placement === "overlay" ? "origin-bottom-left" : "origin-bottom-right";

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleOpen = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  return (
    <div
      className={`relative max-w-full shrink-0 ${placement === "overlay" ? "max-w-xl" : ""}`}
    >
      {variant === "pill" ? (
        <div
          className={`inline-flex max-w-full cursor-default items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${surface}`}
          title={SUMMARY[notice]}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_STYLE[notice]}`} aria-hidden />
          <span>{triggerLabel}</span>
        </div>
      ) : (
        <span
          className="cursor-default truncate text-xs font-medium text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
          title={SUMMARY[notice]}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
        >
          {triggerLabel}
        </span>
      )}

      <div
        className={`absolute z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col ${
          expandUp
            ? `bottom-full ${popoverAlign} ${popoverOriginUp}`
            : `${popoverAlign} top-full ${popoverOriginDown}`
        } ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        {!expandUp && <div className="h-2 w-full shrink-0" aria-hidden />}
        <div
          className={`space-y-2 rounded-lg border bg-card p-3 text-sm shadow-lg transition-all duration-150 ${surface} ${
            open ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
          role="tooltip"
        >
          <p className="font-medium text-foreground">{SUMMARY[notice]}</p>
          <ExpandedContent
            notice={notice}
            showReturnLink={showReturnLink}
            onReturnToProgress={onReturnToProgress}
          />
        </div>
        {expandUp && <div className="h-2 w-full shrink-0" aria-hidden />}
      </div>
    </div>
  );
}
