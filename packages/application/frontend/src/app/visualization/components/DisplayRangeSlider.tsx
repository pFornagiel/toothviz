import { useRef, type KeyboardEvent } from "react";
import { CircleHelp } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../components/ui/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import {
  DENSITY_PRESETS,
  matchDensityPreset,
  resolveDensityPreset,
  resolveDensitySliderBounds,
  type DensityPresetId,
} from "../densityPresets";

const LABEL = "Displayed densities range";
const HELP =
  "Densities below the range appear black in 2D and are hidden in 3D. Densities above it appear white. Presets use dental CBCT windows; Full range shows the whole scan. Hover a preset to preview.";

const THUMB_CLASS =
  "block size-3.5 rounded-full border border-border bg-background shadow-sm ring-ring/40 hover:ring-2 focus-visible:ring-2 focus-visible:outline-hidden";

const DENSITY_GRADIENT =
  "linear-gradient(to right, #0a0a0a 0%, #6b6b6b 45%, #f5f5f5 100%)";

/** Density scale painted into the slider track; dimmed outside the window. */
function DensitySliderTrack({
  trackMin,
  trackMax,
  lower,
  upper,
}: {
  trackMin: number;
  trackMax: number;
  lower: number;
  upper: number;
}) {
  const span = Math.max(1, trackMax - trackMin);
  const left = ((Math.max(lower, trackMin) - trackMin) / span) * 100;
  const right = ((trackMax - Math.min(upper, trackMax)) / span) * 100;
  return (
    <SliderPrimitive.Track className="relative h-2 grow overflow-hidden rounded-sm">
      <div className="absolute inset-0 opacity-80" style={{ background: DENSITY_GRADIENT }} />
      <div
        className="absolute inset-y-0 bg-background/70"
        style={{ left: 0, width: `${Math.max(0, left)}%` }}
      />
      <div
        className="absolute inset-y-0 bg-background/70"
        style={{ right: 0, width: `${Math.max(0, right)}%` }}
      />
      <SliderPrimitive.Range className="absolute h-full ring-1 ring-inset ring-foreground/40" />
    </SliderPrimitive.Track>
  );
}

/** One track with two handles for the lower and upper end of the displayed densities. */
export default function DisplayRangeSlider({
  lower,
  upper,
  min,
  max,
  onLowerChange,
  onUpperChange,
  onApplyRange,
  disabled,
}: {
  lower: number;
  upper: number;
  min: number;
  max: number;
  onLowerChange: (value: number) => void;
  onUpperChange: (value: number) => void;
  /** When set, preset chips apply both ends in one step. */
  onApplyRange?: (calMin: number, calMax: number) => void;
  disabled?: boolean;
}) {
  const activePreset = matchDensityPreset(lower, upper, min, max);
  const previewBaselineRef = useRef<{ calMin: number; calMax: number } | null>(null);
  const track = resolveDensitySliderBounds(min, max, lower, upper);
  // Reserve width for the widest possible readout so Full-range preview
  // does not shove the numbers onto a second row.
  const rangeReadout = `${lower.toFixed(0)} to ${upper.toFixed(0)}`;
  const rangeWidthReserve = `${min.toFixed(0)} to ${max.toFixed(0)}`;

  const applyPreset = (id: DensityPresetId) => {
    if (!onApplyRange || disabled) {
      return;
    }
    previewBaselineRef.current = null;
    const { calMin, calMax } = resolveDensityPreset(id, min, max);
    onApplyRange(calMin, calMax);
  };

  const previewPreset = (id: DensityPresetId) => {
    if (!onApplyRange || disabled) {
      return;
    }
    if (previewBaselineRef.current === null) {
      previewBaselineRef.current = { calMin: lower, calMax: upper };
    }
    const { calMin, calMax } = resolveDensityPreset(id, min, max);
    onApplyRange(calMin, calMax);
  };

  const endPreview = () => {
    if (!onApplyRange || previewBaselineRef.current === null) {
      return;
    }
    const baseline = previewBaselineRef.current;
    previewBaselineRef.current = null;
    onApplyRange(baseline.calMin, baseline.calMax);
  };

  const onPresetKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + delta + DENSITY_PRESETS.length) % DENSITY_PRESETS.length;
    applyPreset(DENSITY_PRESETS[next].id);
    const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
    const target = buttons?.[next] as HTMLButtonElement | undefined;
    target?.focus();
  };

  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50")}>
      <div className="flex flex-nowrap items-center gap-1.5">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{LABEL}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`About ${LABEL}`}
              className="inline-flex shrink-0 cursor-help rounded-full text-muted-foreground hover:text-foreground"
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-60 text-balance">
            {HELP}
          </TooltipContent>
        </Tooltip>
        <span className="relative ml-auto shrink-0 text-right text-xs tabular-nums whitespace-nowrap text-muted-foreground">
          <span className="invisible block" aria-hidden="true">
            {rangeWidthReserve}
          </span>
          <span className="absolute inset-y-0 right-0">{rangeReadout}</span>
        </span>
      </div>
      <SliderPrimitive.Root
        value={[lower, upper]}
        min={track.min}
        max={track.max}
        step={1}
        minStepsBetweenThumbs={1}
        disabled={disabled}
        onValueChange={([nextLower, nextUpper]) => {
          previewBaselineRef.current = null;
          if (nextLower !== lower) {
            onLowerChange(nextLower);
          }
          if (nextUpper !== upper) {
            onUpperChange(nextUpper);
          }
        }}
        className="relative flex h-4 w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed"
      >
        <DensitySliderTrack
          trackMin={track.min}
          trackMax={track.max}
          lower={lower}
          upper={upper}
        />
        <SliderPrimitive.Thumb aria-label="Lower limit" className={THUMB_CLASS} />
        <SliderPrimitive.Thumb aria-label="Upper limit" className={THUMB_CLASS} />
      </SliderPrimitive.Root>
      {onApplyRange && (
        <div
          className="flex flex-nowrap gap-1"
          role="group"
          aria-label="Density range presets"
          onMouseLeave={endPreview}
        >
          {DENSITY_PRESETS.map((preset, index) => {
            const selected = activePreset === preset.id;
            const { calMin, calMax } = resolveDensityPreset(preset.id, min, max);
            const rangeLabel = `${calMin.toFixed(0)} to ${calMax.toFixed(0)}`;
            return (
              <Tooltip key={preset.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    aria-label={`${preset.label}, ${rangeLabel}`}
                    onClick={() => applyPreset(preset.id)}
                    onMouseEnter={() => previewPreset(preset.id)}
                    onFocus={() => previewPreset(preset.id)}
                    onBlur={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (event.currentTarget.parentElement?.contains(next)) {
                        return;
                      }
                      endPreview();
                    }}
                    onKeyDown={(event) => onPresetKeyDown(event, index)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-md border px-1 py-0.5 text-center text-[11px] leading-tight transition-colors",
                      "disabled:cursor-not-allowed",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                      selected
                        ? "border-foreground/40 bg-accent text-accent-foreground"
                        : "border-foreground/35 bg-transparent text-foreground hover:border-foreground/50 hover:bg-accent/60",
                    )}
                  >
                    {preset.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="tabular-nums text-primary-foreground">
                  {rangeLabel}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
