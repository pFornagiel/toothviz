"use client";

import { ChevronLeft } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModeNoticeBar, type ModeNoticeTone } from "./ModeNoticeBar";

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
  /** Floating control over the canvas (top-left). */
  placement?: "inline" | "overlay";
}

const SUMMARY: Record<Exclude<ProcessingNotice, "none">, string> = {
  "preview-waiting": "Scan preview — waiting for pipeline results",
  "loading-artifacts": "Processing complete — loading segmentation overlay…",
  "artifacts-ready": "All results loaded",
  "processing-failed": "Processing failed — scan preview only",
};

/** Compact status for inline / non-overlay triggers. */
const COMPACT_LABEL: Record<Exclude<ProcessingNotice, "none">, string> = {
  "preview-waiting": "Scan preview",
  "loading-artifacts": "Loading results",
  "artifacts-ready": "All loaded",
  "processing-failed": "Preview only",
};

const TONE: Record<Exclude<ProcessingNotice, "none">, ModeNoticeTone> = {
  "preview-waiting": "primary",
  "loading-artifacts": "primary",
  "artifacts-ready": "success",
  "processing-failed": "destructive",
};

function ExpandedContent({
  notice,
  showReturnLink,
  onReturnToProgress,
}: {
  notice: Exclude<ProcessingNotice, "none">;
  showReturnLink: boolean;
  onReturnToProgress: () => void;
}) {
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
          Processing finished and results are ready. This message will dismiss shortly.
        </p>
      );
    case "processing-failed":
      return (
        <p className="text-muted-foreground">
          Scan preview remains available. Use Retry on the progress error screen, or reopen from
          Browse Studies.
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
  return (
    <ModeNoticeBar
      summary={SUMMARY[notice]}
      compactLabel={label ?? COMPACT_LABEL[notice]}
      tone={TONE[notice]}
      variant={variant}
      expandDirection={expandDirection}
      placement={placement}
      overlayIcon={<ChevronLeft className="size-3.5 opacity-90" aria-hidden />}
      overlayAriaLabel={
        showReturnLink ? `Return to progress screen. ${SUMMARY[notice]}` : SUMMARY[notice]
      }
      onOverlayClick={showReturnLink ? onReturnToProgress : undefined}
    >
      <ExpandedContent
        notice={notice}
        showReturnLink={showReturnLink}
        onReturnToProgress={onReturnToProgress}
      />
    </ModeNoticeBar>
  );
}
