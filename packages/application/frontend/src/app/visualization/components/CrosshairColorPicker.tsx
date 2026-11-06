import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { CROSSHAIR_COLOR_OPTIONS } from "../constants";

const LABEL = "Crosshair color";
const SWATCH_CLASS = "block size-4 rounded border border-foreground/25";

/** Compact swatch that opens a small palette of colours visible on a grayscale scan. */
export function CrosshairColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [tooltipOpen, setTooltipOpen] = React.useState(false);
  // After a mouse pick, returning focus to the swatch would pop its tooltip open.
  const skipFocusReturn = React.useRef(false);
  const activeOptionRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label={LABEL}
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className={SWATCH_CLASS} style={{ backgroundColor: value }} />
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{LABEL}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        className="w-auto p-1.5"
        onOpenAutoFocus={(e) => {
          // The roving-focus group has no tab stop yet when the popover mounts.
          e.preventDefault();
          activeOptionRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          if (skipFocusReturn.current) {
            e.preventDefault();
            skipFocusReturn.current = false;
          }
        }}
      >
        <ToggleGroupPrimitive.Root
          type="single"
          value={value}
          aria-label={LABEL}
          onValueChange={(next) => {
            // Radix reports "" when the active item is clicked again.
            if (next) {
              onChange(next);
            }
          }}
          className="flex gap-1"
        >
          {CROSSHAIR_COLOR_OPTIONS.map((option) => (
            <ToggleGroupPrimitive.Item
              key={option.value}
              ref={option.value === value ? activeOptionRef : undefined}
              value={option.value}
              aria-label={option.name}
              onClick={(e) => {
                // detail is 0 for keyboard-triggered clicks.
                skipFocusReturn.current = e.detail > 0;
                setOpen(false);
              }}
              className={cn(
                "inline-flex size-6 cursor-pointer items-center justify-center rounded hover:bg-accent",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "data-[state=on]:ring-2 data-[state=on]:ring-primary",
              )}
            >
              <span className={SWATCH_CLASS} style={{ backgroundColor: option.value }} />
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
      </PopoverContent>
    </Popover>
  );
}
