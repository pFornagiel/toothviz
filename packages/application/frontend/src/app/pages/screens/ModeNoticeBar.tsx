"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";

const HOVER_CLOSE_DELAY_MS = 250;

export type ModeNoticeTone = "primary" | "success" | "destructive";

export interface ModeNoticeBarProps {
  summary: string;
  compactLabel: string;
  /** Expanded body (description, actions). */
  children: ReactNode;
  tone?: ModeNoticeTone;
  variant?: "pill" | "text";
  expandDirection?: "down" | "up";
  placement?: "inline" | "overlay";
  overlayIcon?: ReactNode;
  overlayAriaLabel?: string;
  onOverlayClick?: () => void;
  className?: string;
}

const TONE_BAR: Record<ModeNoticeTone, string> = {
  primary: "border-primary/30 text-foreground",
  success: "border-emerald-600/30 text-emerald-700 dark:text-emerald-400",
  destructive: "border-destructive/30 text-destructive",
};

const TONE_DOT: Record<ModeNoticeTone, string> = {
  primary: "bg-primary animate-pulse",
  success: "bg-emerald-600",
  destructive: "bg-destructive",
};

const BAR_SURFACE: Record<"inline" | "overlay", string> = {
  inline: "bg-secondary",
  overlay: "bg-background/90 shadow-sm backdrop-blur-md",
};

/**
 * Compact status trigger with a hover/focus expandable info card.
 * Used for pipeline preview notices and pick mode awareness.
 */
export function ModeNoticeBar({
  summary,
  compactLabel,
  children,
  tone = "primary",
  variant = "pill",
  expandDirection = "down",
  placement = "inline",
  overlayIcon,
  overlayAriaLabel,
  onOverlayClick,
  className = "",
}: ModeNoticeBarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandUp = expandDirection === "up";
  const surface = `${TONE_BAR[tone]} ${BAR_SURFACE[placement]}`;
  const popoverAlign = placement === "overlay" ? "left-0" : "right-0";
  const popoverOriginDown = placement === "overlay" ? "origin-top-left" : "origin-top-right";
  const popoverOriginUp = placement === "overlay" ? "origin-bottom-left" : "origin-bottom-right";
  const isOverlay = placement === "overlay";

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

  /** Keep open while focus moves between trigger and popover actions. */
  const handleFocusOut = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && rootRef.current?.contains(next)) {
        return;
      }
      handleClose();
    },
    [handleClose],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearCloseTimer();
        setOpen(false);
        const trigger = rootRef.current?.querySelector<HTMLElement>("button, [tabindex]");
        trigger?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  return (
    <div
      ref={rootRef}
      className={`relative max-w-full shrink-0 ${isOverlay ? "max-w-xl" : ""} ${className}`}
      onFocusCapture={handleOpen}
      onBlurCapture={handleFocusOut}
    >
      {isOverlay ? (
        <button
          type="button"
          className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-full border transition-colors hover:bg-muted/80 ${surface}`}
          title={summary}
          aria-label={overlayAriaLabel ?? summary}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={onOverlayClick}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
        >
          <span className="relative inline-flex size-4 items-center justify-center">
            {overlayIcon}
            <span
              className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ${TONE_DOT[tone]}`}
              aria-hidden
            />
          </span>
        </button>
      ) : variant === "pill" ? (
        <div
          className={`inline-flex max-w-full cursor-default items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${surface}`}
          title={summary}
          tabIndex={0}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
          <span>{compactLabel}</span>
        </div>
      ) : (
        <span
          className="cursor-default truncate text-xs font-medium text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
          title={summary}
          tabIndex={0}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
        >
          {compactLabel}
        </span>
      )}

      <div
        className={`absolute z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col ${
          expandUp
            ? `bottom-full ${popoverAlign} ${popoverOriginUp}`
            : `${popoverAlign} top-full ${popoverOriginDown}`
        } ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
        // Closed popover must not be keyboard-focusable (Apply/Discard, etc.).
        inert={!open}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        {!expandUp && <div className="h-2 w-full shrink-0" aria-hidden />}
        <div
          className={`space-y-2 rounded-lg border bg-card p-3 text-sm shadow-lg transition-all duration-150 ${surface} ${
            open ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
          role="region"
          aria-label={summary}
        >
          <p className="font-medium text-foreground">{summary}</p>
          {children}
        </div>
        {expandUp && <div className="h-2 w-full shrink-0" aria-hidden />}
      </div>
    </div>
  );
}
