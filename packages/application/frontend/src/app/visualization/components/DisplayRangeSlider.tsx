import { CircleHelp } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../components/ui/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

const LABEL = "Display range";
const HELP =
  "Values below the left handle appear black in 2D and are hidden in 3D. " +
  "Values above the right handle appear fully white. " +
  "Move the left handle right to hide soft tissue, or the right handle left to brighten the image.";

const THUMB_CLASS =
  "block size-4 rounded-full bg-primary shadow-sm ring-ring/50 hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden";

/** One track with two handles for the lower and upper end of the displayed values. */
export default function DisplayRangeSlider({
  lower,
  upper,
  min,
  max,
  onLowerChange,
  onUpperChange,
  disabled,
}: {
  lower: number;
  upper: number;
  min: number;
  max: number;
  onLowerChange: (value: number) => void;
  onUpperChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50")}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-foreground">{LABEL}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`About ${LABEL}`}
              className="inline-flex cursor-help rounded-full text-muted-foreground hover:text-foreground"
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-60 text-balance">
            {HELP}
          </TooltipContent>
        </Tooltip>
        <span className="ml-auto text-sm text-foreground tabular-nums">
          {lower.toFixed(0)} – {upper.toFixed(0)}
        </span>
      </div>
      <SliderPrimitive.Root
        value={[lower, upper]}
        min={min}
        max={max}
        step={1}
        minStepsBetweenThumbs={1}
        disabled={disabled}
        onValueChange={([nextLower, nextUpper]) => {
          if (nextLower !== lower) {
            onLowerChange(nextLower);
          }
          if (nextUpper !== upper) {
            onUpperChange(nextUpper);
          }
        }}
        className="relative flex h-4 w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed"
      >
        <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb aria-label="Lower limit" className={THUMB_CLASS} />
        <SliderPrimitive.Thumb aria-label="Upper limit" className={THUMB_CLASS} />
      </SliderPrimitive.Root>
    </div>
  );
}
