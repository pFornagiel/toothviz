import * as React from "react";
import type { KeyboardEvent } from "react";
import {
  Layers,
  Crosshair,
  Scissors,
  Box,
  PanelsTopLeft,
  PanelLeftClose,
  RotateCcw,
  Minus,
  Plus,
  Ruler,
  Eye,
  EyeOff,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";
import { Odontogram } from "react-odontogram";
import DisplayRangeSlider from "./DisplayRangeSlider";
import { MeasurementList } from "./MeasurementList";
import "react-odontogram/style.css";
import "../odontogram.css";
import { cn } from "@/lib/utils";
import { volumeLabel } from "../volumeLabels";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Checkbox } from "../../components/ui/checkbox";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../components/ui/accordion";
import { Tooth } from "../../components/icons/tooth";
import {
  BONE_CLASSES,
  MANDIBLE_CLASS,
  MAXILLA_CLASS,
  toothIdFromOdontogramTarget,
  toothIdToFdi,
  type BoneClass,
} from "../toothLabels";
import { formatFdiList, sameToothSelection } from "../selectionSummary";
import {
  SliceTypeKey,
  SLICE_TYPE_LABELS,
  OPACITY_RANGE,
  CLIP_DEPTH_RANGE,
  CLIP_AZIMUTH_RANGE,
  CLIP_ELEVATION_RANGE,
  RENDER_AZIMUTH_RANGE,
  RENDER_ELEVATION_RANGE,
  RENDER_ZOOM_RANGE,
  RENDER_ZOOM_BUTTON_FACTOR,
} from "../constants";
import {
  PICK_MODE_HELP_OFF,
  PICK_MODE_HELP_ON,
  PICK_MODE_HELP_ON_DIRTY,
  PICK_MODE_HELP,
  PICK_MODE_LABEL,
  PICK_MODE_PENDING,
  slicePickMessage,
} from "../pickModeCopy";
import { ClearSelectionDialog } from "./ClearSelectionDialog";
import { CrosshairColorPicker } from "./CrosshairColorPicker";
import { ResetViewDialog } from "./ResetViewDialog";
import { SelectAllDialog } from "./SelectAllDialog";
import { useVisualization } from "../VisualizationProvider";
import { isLowerJawTooth, isUpperJawTooth } from "../../teeth";
import { resolveScanVolumeIndex } from "../hooks/useVolumeDisplayControls";
import { ViewPhase } from "../types";

const BONE_NAMES: Record<BoneClass, string> = {
  [MAXILLA_CLASS]: "Upper jaw",
  [MANDIBLE_CLASS]: "Lower jaw",
};

/** Longer phrasing for tooltips (chips stay short). */
const MASK_PART_TOOLTIP_NAME: Record<string, string> = {
  teeth: "all detected teeth",
  [String(MAXILLA_CLASS)]: "upper jaw bone",
  [String(MANDIBLE_CLASS)]: "lower jaw bone",
};

/** Matches the widest part chip ("Upper jaw" + eye) so Opacity sits over the tracks. */
const MASK_PART_LABEL_COL = "w-[5.75rem] shrink-0";

type MaskPartItem = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  onVisibleChange: (visible: boolean) => void;
  onOpacityChange: (opacity: number) => void;
};

function MaskPartsOpacityHeader() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <div className={MASK_PART_LABEL_COL} />
      <span className="min-w-0 flex-1 text-center text-xs font-medium tracking-wider text-foreground uppercase">
        Opacity
      </span>
      <span className="w-9 shrink-0" />
    </div>
  );
}

/** Compact part row: clickable name chip toggles visibility; slider sets opacity. */
function MaskPartRow({
  name,
  tooltipName,
  visible,
  opacity,
  onVisibleChange,
  onOpacityChange,
}: {
  name: string;
  tooltipName: string;
  visible: boolean;
  opacity: number;
  onVisibleChange: (visible: boolean) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  const VisibilityIcon = visible ? Eye : EyeOff;
  const actionLabel = visible ? `Hide ${tooltipName}` : `Show ${tooltipName}`;
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-pressed={visible}
            aria-label={actionLabel}
            onClick={() => onVisibleChange(!visible)}
            className={cn(
              MASK_PART_LABEL_COL,
              // Same pressed/idle language as density preset chips (AA contrast on both).
              "inline-flex cursor-pointer items-center gap-1 rounded-md border px-1 py-0.5 text-left text-[11px] leading-tight transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
              visible
                ? "border-foreground/40 bg-accent text-accent-foreground hover:border-foreground/55 hover:bg-accent/80"
                : "border-foreground/35 bg-transparent text-foreground hover:border-foreground/50 hover:bg-accent/60",
            )}
          >
            <VisibilityIcon className="size-3 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{name}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-primary-foreground">
          {visible
            ? `Click to hide ${tooltipName}`
            : `Click to show ${tooltipName}`}
        </TooltipContent>
      </Tooltip>
      <input
        type="range"
        aria-label={`${name} opacity`}
        value={opacity}
        min={OPACITY_RANGE.min}
        max={OPACITY_RANGE.max}
        step={OPACITY_RANGE.step}
        disabled={!visible}
        onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
        className={cn(
          "h-1 min-w-0 flex-1 cursor-pointer accent-foreground disabled:cursor-not-allowed",
          !visible && "pointer-events-none opacity-50",
        )}
      />
      <span
        className={cn(
          "w-9 shrink-0 text-right text-xs tabular-nums text-foreground",
          !visible && "opacity-50",
        )}
      >
        {opacity.toFixed(2)}
      </span>
    </div>
  );
}

/** Teeth / jaw visibility chips — commit on click only (no hover preview). */
function MaskPartsControls({ parts }: { parts: MaskPartItem[] }) {
  return (
    <div className="space-y-1.5">
      <MaskPartsOpacityHeader />
      <div className="space-y-1">
        {parts.map((part) => (
          <MaskPartRow
            key={part.id}
            name={part.name}
            tooltipName={MASK_PART_TOOLTIP_NAME[part.id] ?? part.name.toLowerCase()}
            visible={part.visible}
            opacity={part.opacity}
            onVisibleChange={part.onVisibleChange}
            onOpacityChange={part.onOpacityChange}
          />
        ))}
      </div>
    </div>
  );
}

function MultiplanarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.25" y="1.25" width="6" height="6" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.75" y="1.25" width="6" height="6" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.25" y="8.75" width="6" height="6" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.75" y="8.75" width="6" height="6" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type SliceTypeOption = {
  key: SliceTypeKey;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  glyph?: string;
};

const SLICE_LAYOUT_OPTIONS: SliceTypeOption[] = [
  { key: SliceTypeKey.Multiplanar, icon: MultiplanarIcon },
  { key: SliceTypeKey.Render, icon: Box },
];

const SLICE_PLANE_OPTIONS: SliceTypeOption[] = [
  { key: SliceTypeKey.Axial, glyph: "A" },
  { key: SliceTypeKey.Coronal, glyph: "C" },
  { key: SliceTypeKey.Sagittal, glyph: "S" },
];

function SliceTypeButton({
  option,
  selected,
  onSelect,
  onHover,
}: {
  option: SliceTypeOption;
  selected: boolean;
  onSelect: (key: SliceTypeKey) => void;
  onHover: (key: SliceTypeKey | null) => void;
}) {
  const { key, icon: Icon, glyph } = option;
  const label = SLICE_TYPE_LABELS[key];

  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      size="icon"
      className={cn("h-9 w-full", !selected && "bg-card")}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(key)}
    >
      {Icon ? (
        <Icon className="size-4" />
      ) : (
        <span className="text-xs font-semibold tracking-wide">{glyph}</span>
      )}
    </Button>
  );
}

/** Collapsible, icon-headed control group matching the clinical sidebar design. */
function ControlSection({
  value,
  icon: Icon,
  title,
  children,
}: {
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-border/70">
      <AccordionTrigger className="py-3 hover:no-underline">
        <span className="flex items-center gap-2.5 text-xs font-semibold tracking-wider text-foreground uppercase">
          <Icon className="size-4 text-primary" />
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 pb-5">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** Loading stand-in for a Layers row: eye + name, then a slider track. */
function LayerRowSkeleton({ nameWidth }: { nameWidth: string }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className={cn("h-3.5", nameWidth)} />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
    </div>
  );
}

/** Loading stand-in for the Layers section (scan + mask). */
function LayersSkeleton() {
  return (
    <div className="space-y-3.5" aria-hidden>
      <LayerRowSkeleton nameWidth="w-24" />
      <LayerRowSkeleton nameWidth="w-32" />
    </div>
  );
}

/** Loading stand-in for the Teeth section: pick-mode switch + odontogram. */
function TeethSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      <Skeleton className="mx-auto aspect-[4/5] w-full max-w-56 rounded-xl" />
    </div>
  );
}

/** Label on the left, monospace value readout on the right, slider underneath. */
/** Quiet opacity control: label, thin track, and value on one line. */
function SubtleOpacitySlider({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", disabled && "opacity-50")}>
      <span className="shrink-0 text-xs text-muted-foreground">Opacity</span>
      <input
        type="range"
        aria-label={`${name} opacity`}
        value={value}
        min={OPACITY_RANGE.min}
        max={OPACITY_RANGE.max}
        step={OPACITY_RANGE.step}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-muted-foreground disabled:cursor-not-allowed"
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function SliderRow({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50")}>
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
        />
        <span className="w-12 shrink-0 text-right text-sm text-foreground">
          {valueLabel}
        </span>
      </div>
    </div>
  );
}

/** Visibility on the name row; subtle opacity and optional nested controls underneath. */
function LayerRow({
  name,
  visible,
  opacity,
  onVisibleChange,
  onOpacityChange,
  trailing,
  showOpacity = true,
  children,
}: {
  name: string;
  visible: boolean;
  opacity: number;
  onVisibleChange: () => void;
  onOpacityChange: (value: number) => void;
  /** Optional control on the name row (e.g. scan 2D/3D mode). */
  trailing?: React.ReactNode;
  /**
   * When false, skip the layer opacity slider (e.g. Tooth segmentation with
   * Parts — per-part opacity is the clearer control).
   */
  showOpacity?: boolean;
  children?: React.ReactNode;
}) {
  const hasBody = showOpacity || Boolean(children);
  return (
    <div className="space-y-2 rounded-md">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <Checkbox checked={visible} onCheckedChange={onVisibleChange} />
          <span className="truncate" title={name}>
            {name}
          </span>
        </label>
        {trailing}
      </div>
      {hasBody && (
        <div
          className={cn(
            "ml-6.5 space-y-2",
            !visible && "pointer-events-none opacity-50",
          )}
        >
          {showOpacity && (
            <SubtleOpacitySlider
              name={name}
              value={opacity}
              onChange={onOpacityChange}
              disabled={!visible}
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Where the CBCT scan is drawn when a mask is also loaded.
 * Compact icon+label switch; tooltips carry the full dentist-facing wording.
 * Hover/focus previews the mode; click or arrows commit it.
 */
function ScanViewMode({
  includeIn3d,
  onChange,
  disabled,
}: {
  includeIn3d: boolean;
  onChange: (includeIn3d: boolean) => void;
  disabled?: boolean;
}) {
  const previewBaselineRef = React.useRef<boolean | null>(null);

  const options = [
    {
      includeIn3d: false,
      label: "2D",
      fullLabel: "2D slices only",
      icon: PanelsTopLeft,
      help: "Show the scan in the 2D slice views only. The 3D view stays focused on teeth and bone.",
    },
    {
      includeIn3d: true,
      label: "2D+3D",
      fullLabel: "2D + 3D",
      icon: Box,
      help: "Also draw the scan volume in the 3D view. The Bone density window often makes hard tissue clearer.",
    },
  ] as const;

  const commit = (value: boolean) => {
    previewBaselineRef.current = null;
    onChange(value);
  };

  const preview = (value: boolean) => {
    if (disabled) {
      return;
    }
    if (previewBaselineRef.current === null) {
      previewBaselineRef.current = includeIn3d;
    }
    onChange(value);
  };

  const endPreview = () => {
    if (previewBaselineRef.current === null) {
      return;
    }
    const baseline = previewBaselineRef.current;
    previewBaselineRef.current = null;
    onChange(baseline);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    commit(options[next].includeIn3d);
    const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
    (buttons?.[next] as HTMLButtonElement | undefined)?.focus();
  };

  return (
    <div
      className={cn(
        "grid w-full shrink-0 grid-cols-2 gap-0.5 rounded-md bg-muted/60 p-0.5 sm:w-auto",
        disabled && "pointer-events-none opacity-50",
      )}
      role="radiogroup"
      aria-label="Show scan in"
      onMouseLeave={endPreview}
    >
      {options.map((option, index) => {
        const selected = includeIn3d === option.includeIn3d;
        const Icon = option.icon;
        return (
          <Tooltip key={option.label}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.fullLabel}
                disabled={disabled}
                onClick={() => commit(option.includeIn3d)}
                onMouseEnter={() => preview(option.includeIn3d)}
                onFocus={() => preview(option.includeIn3d)}
                onBlur={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (event.currentTarget.parentElement?.contains(next)) {
                    return;
                  }
                  endPreview();
                }}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "inline-flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px] leading-none transition-colors",
                  "disabled:cursor-not-allowed",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span>{option.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56 text-balance">
              <p className="font-medium text-primary-foreground">{option.fullLabel}</p>
              <p className="text-primary-foreground/85">{option.help}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ZoomControl({
  zoom,
  onChange,
}: {
  zoom: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm text-foreground">Zoom</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0 bg-card"
          title="Zoom out"
          onClick={() => onChange(zoom / RENDER_ZOOM_BUTTON_FACTOR)}
        >
          <Minus className="size-4" />
        </Button>
        <input
          type="range"
          value={zoom}
          min={RENDER_ZOOM_RANGE.min}
          max={RENDER_ZOOM_RANGE.max}
          step={RENDER_ZOOM_RANGE.step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
        />
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0 bg-card"
          title="Zoom in"
          onClick={() => onChange(zoom * RENDER_ZOOM_BUTTON_FACTOR)}
        >
          <Plus className="size-4" />
        </Button>
        <span className="w-10 shrink-0 text-right text-sm text-foreground">
          {zoom.toFixed(1)}×
        </span>
      </div>
    </div>
  );
}

export function VisualizationSidebar() {
  const { viewer, layout, volumes, view, display, teeth, scene, clip, render, measure, onReset, showPickFlash } =
    useVisualization();
  const [clearSelectionOpen, setClearSelectionOpen] = React.useState(false);
  const [selectAllOpen, setSelectAllOpen] = React.useState(false);
  const [resetViewOpen, setResetViewOpen] = React.useState(false);
  const [hoveredSliceType, setHoveredSliceType] = React.useState<SliceTypeKey | null>(null);

  const ready = viewer.viewPhase === ViewPhase.Ready;
  const hasMultipleVolumes = volumes.length > 1;
  const scanVolumeIdx = resolveScanVolumeIndex(volumes.length, teeth.overlayIndex);
  const maskVisible =
    teeth.overlayIndex >= 0 && (display.volumeVisibility[teeth.overlayIndex] ?? true);
  // Jaw bones sit in Layers like the CBCT scan; Teeth keeps the odontogram.
  const presentBones = BONE_CLASSES.filter((bone) =>
    teeth.presentBoneClasses.includes(bone),
  );
  const showToothSelection = teeth.hasToothLabels && maskVisible;
  // While the study loads, hold the place of the data-driven sections so the
  // sidebar does not open with only the generic controls and then jump.
  const loading = viewer.viewPhase === ViewPhase.Loading;
  const showLayersSkeleton = loading && volumes.length === 0;
  const showTeethSkeleton = loading && !showToothSelection;
  const teethPickerEnabled = teeth.teethDisplay.visible;
  const upperPresentIds = teeth.presentToothIds.filter((id) => {
    const fdi = toothIdToFdi(id);
    return fdi !== null && isUpperJawTooth(fdi);
  });
  const lowerPresentIds = teeth.presentToothIds.filter((id) => {
    const fdi = toothIdToFdi(id);
    return fdi !== null && isLowerJawTooth(fdi);
  });
  // Binary UI: on only when the whole jaw is selected; partial looks like off.
  const upperJawAllSelected =
    upperPresentIds.length > 0 &&
    upperPresentIds.every((id) => teeth.selectedToothIds.includes(id));
  const lowerJawAllSelected =
    lowerPresentIds.length > 0 &&
    lowerPresentIds.every((id) => teeth.selectedToothIds.includes(id));

  // Sections open by default; clip appears only where a 3D tile is shown.
  // Render View (slice type + zoom) stays available for every slice type.
  const openSections = [
    "volumes",
    // Listed even while empty, so the section is open when the first measurement adds it.
    "measurements",
    ...(showToothSelection || showTeethSkeleton ? ["teeth"] : []),
    "render",
    "scene",
    ...(view.showsRender ? ["clip"] : []),
  ];

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-secondary dark:bg-background">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">NiiVue Controls</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={viewer.statusText}>
            {viewer.isVolatile ? "Volatile mode" : viewer.statusText}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => layout.setSidebarVisible(false)}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          title="Hide sidebar"
        >
          <PanelLeftClose className="size-5" />
        </Button>
      </div>

      {/* Scrollable control groups */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 transition-opacity",
          !ready && "pointer-events-none opacity-50",
        )}
      >
        <fieldset disabled={!ready} className="m-0 min-w-0 border-0 p-0">
          <Accordion
            // Remount when sections come or go so their default-open state applies.
            key={
              showTeethSkeleton ? "loading" : showToothSelection ? "with-teeth" : "no-teeth"
            }
            type="multiple"
            defaultValue={openSections}
            className="w-full"
          >
            {/* Volume selection + per-layer appearance */}
            {volumes.length > 0 && (
              <ControlSection value="volumes" icon={Layers} title="Layers">
                <div className="space-y-3.5">
                  {volumes.map((vol, idx) => {
                    const visible = display.volumeVisibility[idx] ?? true;
                    const opacity =
                      display.volumeOpacities[idx] ?? OPACITY_RANGE.max;
                    const isScan = idx === scanVolumeIdx;
                    const isMask =
                      teeth.overlayIndex >= 0 && idx === teeth.overlayIndex;
                    const hasMaskParts =
                      isMask &&
                      (teeth.hasToothLabels || presentBones.length > 0);
                    const name = volumeLabel(idx, teeth.overlayIndex, vol.name);
                    return (
                      <LayerRow
                        key={idx}
                        name={name}
                        visible={visible}
                        opacity={opacity}
                        onVisibleChange={() => display.handleVolumeVisibilityToggle(idx)}
                        onOpacityChange={(value) => display.handleOpacityChange(idx, value)}
                        // Parts already expose per-structure opacity; a second
                        // whole-mask slider on top of them is confusing.
                        showOpacity={!hasMaskParts}
                        trailing={
                          isScan && hasMultipleVolumes ? (
                            <ScanViewMode
                              includeIn3d={display.scanIn3d}
                              onChange={display.setScanIn3d}
                              disabled={!visible}
                            />
                          ) : undefined
                        }
                      >
                        {isScan && (
                          <DisplayRangeSlider
                            lower={display.cal_min}
                            upper={display.cal_max}
                            min={display.cal_minGlobal}
                            max={display.cal_maxGlobal}
                            onLowerChange={display.handleCalMinChange}
                            onUpperChange={display.handleCalMaxChange}
                            onApplyRange={display.applyCalRange}
                            disabled={!visible}
                          />
                        )}
                        {hasMaskParts && (
                          <MaskPartsControls
                            parts={[
                              ...(teeth.hasToothLabels
                                ? [
                                    {
                                      id: "teeth",
                                      name: "Teeth",
                                      visible: teeth.teethDisplay.visible,
                                      opacity: teeth.teethDisplay.opacity,
                                      onVisibleChange: teeth.setTeethVisible,
                                      onOpacityChange: teeth.setTeethOpacity,
                                    } satisfies MaskPartItem,
                                  ]
                                : []),
                              ...presentBones.map((bone) => {
                                const boneDisplay = teeth.boneDisplays[bone];
                                return {
                                  id: String(bone),
                                  name: BONE_NAMES[bone],
                                  visible: boneDisplay.visible,
                                  opacity: boneDisplay.opacity,
                                  onVisibleChange: (next: boolean) =>
                                    teeth.setBoneVisible(bone, next),
                                  onOpacityChange: (value: number) =>
                                    teeth.setBoneOpacity(bone, value),
                                } satisfies MaskPartItem;
                              }),
                            ]}
                          />
                        )}
                      </LayerRow>
                    );
                  })}
                </div>
              </ControlSection>
            )}

            {showLayersSkeleton && (
              <ControlSection value="volumes" icon={Layers} title="Layers">
                <LayersSkeleton />
              </ControlSection>
            )}

            {measure.measurements.length > 0 && (
              <ControlSection value="measurements" icon={Ruler} title="Measurements">
                <MeasurementList measure={measure} />
              </ControlSection>
            )}

            {showTeethSkeleton && (
              <ControlSection value="teeth" icon={Tooth} title="Teeth">
                <TeethSkeleton />
              </ControlSection>
            )}

            {showToothSelection && (
              <ControlSection value="teeth" icon={Tooth} title="Teeth">
                <fieldset
                  disabled={!teethPickerEnabled}
                  className={cn(
                    "m-0 min-w-0 space-y-4 border-0 p-0",
                    !teethPickerEnabled && "pointer-events-none opacity-50",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{PICK_MODE_LABEL}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Switch
                            checked={teeth.pickFromPreview}
                            disabled={teeth.pickModePending || !teethPickerEnabled}
                            aria-label={PICK_MODE_LABEL}
                            onCheckedChange={(enabled) => {
                              if (enabled) {
                                teeth.setPickFromPreview(true);
                              } else {
                                teeth.requestPickModeExit("choose");
                              }
                            }}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-60 text-balance">
                        {!teethPickerEnabled
                          ? "Turn on Teeth under Tooth segmentation to use the picker."
                          : !teeth.pickFromPreview
                            ? PICK_MODE_HELP_OFF
                            : sameToothSelection(
                                  teeth.selectedToothIds,
                                  teeth.pickModeBaselineToothIds,
                                )
                              ? PICK_MODE_HELP_ON
                              : PICK_MODE_HELP_ON_DIRTY}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="whitespace-pre-line text-xs text-muted-foreground">
                    {!teethPickerEnabled
                      ? "Teeth are hidden. Show them under Tooth segmentation to pick and filter."
                      : teeth.pickModePending
                        ? PICK_MODE_PENDING
                        : teeth.pickFromPreview
                          ? PICK_MODE_HELP
                          : "Select on the chart below, or enable pick mode.\nColors match the labels in the viewer."}
                  </p>
                  <div className="toothviz-odontogram-row">
                    <div
                      className={cn(
                        "toothviz-odontogram",
                        teeth.pickModePending && "toothviz-odontogram--pending",
                      )}
                      onClick={(e) => {
                        if (!teethPickerEnabled || teeth.pickModePending) {
                          return;
                        }
                        const toothId = toothIdFromOdontogramTarget(e.target);
                        if (!toothId) {
                          return;
                        }
                        const changed = teeth.toggleToothFromChart(toothId);
                        if (!changed || !teeth.pickFromPreview) {
                          return;
                        }
                        const fdi = toothIdToFdi(toothId);
                        if (fdi) {
                          showPickFlash(
                            slicePickMessage(
                              fdi,
                              !teeth.selectedToothIds.includes(toothId),
                            ),
                          );
                        }
                      }}
                    >
                      <Odontogram
                        notation="FDI"
                        layout="square"
                        showTooltip={teethPickerEnabled}
                        showLabels={false}
                        readOnly
                        teethConditions={teeth.detectedConditions}
                        className="w-full"
                      />
                    </div>
                    <div className="toothviz-jaw-toggles" aria-hidden={false}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span data-jaw="upper" className="inline-flex">
                            <button
                              type="button"
                              className="toothviz-jaw-toggle"
                              data-state={upperJawAllSelected ? "on" : "off"}
                              disabled={
                                !teethPickerEnabled ||
                                teeth.pickModePending ||
                                upperPresentIds.length === 0
                              }
                              aria-label={
                                upperJawAllSelected
                                  ? "Deselect all upper jaw teeth"
                                  : "Select all upper jaw teeth"
                              }
                              onClick={(event) => {
                                teeth.toggleJawSelection("upper");
                                // Drop focus so the hover band does not stick after click.
                                event.currentTarget.blur();
                              }}
                            >
                              <ChevronLeft className="size-4" strokeWidth={2.25} />
                            </button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="z-[100] max-w-56 text-balance text-primary-foreground"
                        >
                          {upperJawAllSelected
                            ? "Deselect upper jaw"
                            : "Select upper jaw"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span data-jaw="lower" className="inline-flex">
                            <button
                              type="button"
                              className="toothviz-jaw-toggle"
                              data-state={lowerJawAllSelected ? "on" : "off"}
                              disabled={
                                !teethPickerEnabled ||
                                teeth.pickModePending ||
                                lowerPresentIds.length === 0
                              }
                              aria-label={
                                lowerJawAllSelected
                                  ? "Deselect all lower jaw teeth"
                                  : "Select all lower jaw teeth"
                              }
                              onClick={(event) => {
                                teeth.toggleJawSelection("lower");
                                event.currentTarget.blur();
                              }}
                            >
                              <ChevronLeft className="size-4" strokeWidth={2.25} />
                            </button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="z-[100] max-w-56 text-balance text-primary-foreground"
                        >
                          {lowerJawAllSelected
                            ? "Deselect lower jaw"
                            : "Select lower jaw"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <p className="whitespace-pre-line text-xs text-muted-foreground tabular-nums text-balance">
                    {teeth.selectedToothIds.length === 0
                      ? "No teeth selected."
                      : teeth.selectedToothIds.length === teeth.presentToothIds.length
                        ? `All ${teeth.presentToothIds.length} detected teeth selected.`
                        : `Selected ${teeth.selectedToothIds.length} of ${teeth.presentToothIds.length}:\n${formatFdiList(teeth.selectedToothIds)}`}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-card"
                      disabled={
                        !teethPickerEnabled ||
                        teeth.pickModePending ||
                        teeth.selectedToothIds.length === teeth.presentToothIds.length
                      }
                      onClick={() => setSelectAllOpen(true)}
                    >
                      Select all
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-card"
                      disabled={
                        !teethPickerEnabled ||
                        teeth.pickModePending ||
                        teeth.selectedToothIds.length === 0
                      }
                      onClick={() => setClearSelectionOpen(true)}
                    >
                      Clear selection
                    </Button>
                  </div>
                </fieldset>
              </ControlSection>
            )}

            {/* Render view — always shown for slice type + zoom */}
            <ControlSection value="render" icon={Box} title="Render View">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Slice type</span>
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    {SLICE_LAYOUT_OPTIONS.map((option) => (
                      <SliceTypeButton
                        key={option.key}
                        option={option}
                        selected={view.sliceType === option.key}
                        onSelect={view.handleSliceTypeChange}
                        onHover={setHoveredSliceType}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {SLICE_PLANE_OPTIONS.map((option) => (
                      <SliceTypeButton
                        key={option.key}
                        option={option}
                        selected={view.sliceType === option.key}
                        onSelect={view.handleSliceTypeChange}
                        onHover={setHoveredSliceType}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {SLICE_TYPE_LABELS[hoveredSliceType ?? view.sliceType]}
                </p>
              </div>

              {view.showsRender && (
                <>
                  <SliderRow
                    label="Azimuth"
                    valueLabel={`${render.renderAzimuth.toFixed(0)}°`}
                    value={render.renderAzimuth}
                    min={RENDER_AZIMUTH_RANGE.min}
                    max={RENDER_AZIMUTH_RANGE.max}
                    step={RENDER_AZIMUTH_RANGE.step}
                    onChange={render.handleRenderAzimuthChange}
                  />
                  <SliderRow
                    label="Elevation"
                    valueLabel={`${render.renderElevation.toFixed(0)}°`}
                    value={render.renderElevation}
                    min={RENDER_ELEVATION_RANGE.min}
                    max={RENDER_ELEVATION_RANGE.max}
                    step={RENDER_ELEVATION_RANGE.step}
                    onChange={render.handleRenderElevationChange}
                  />
                </>
              )}
              <ZoomControl zoom={render.renderZoom} onChange={render.handleRenderZoomChange} />
            </ControlSection>

            {/* Clip plane (3D only) */}
            {view.showsRender && (
              <ControlSection value="clip" icon={Scissors} title="3D Clip Plane">
                <SliderRow
                  label="Depth"
                  valueLabel={clip.clipPlaneDepth.toFixed(3)}
                  value={clip.clipPlaneDepth}
                  min={CLIP_DEPTH_RANGE.min}
                  max={CLIP_DEPTH_RANGE.max}
                  step={CLIP_DEPTH_RANGE.step}
                  onChange={clip.setClipPlaneDepth}
                />
                <SliderRow
                  label="Azimuth"
                  valueLabel={`${clip.clipPlaneAzimuth.toFixed(0)}°`}
                  value={clip.clipPlaneAzimuth}
                  min={CLIP_AZIMUTH_RANGE.min}
                  max={CLIP_AZIMUTH_RANGE.max}
                  step={CLIP_AZIMUTH_RANGE.step}
                  onChange={clip.setClipPlaneAzimuth}
                />
                <SliderRow
                  label="Elevation"
                  valueLabel={`${clip.clipPlaneElevation.toFixed(0)}°`}
                  value={clip.clipPlaneElevation}
                  min={CLIP_ELEVATION_RANGE.min}
                  max={CLIP_ELEVATION_RANGE.max}
                  step={CLIP_ELEVATION_RANGE.step}
                  onChange={clip.setClipPlaneElevation}
                />
              </ControlSection>
            )}

            {/* Scene (crosshair) */}
            <ControlSection value="scene" icon={Crosshair} title="Scene">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Crosshair</span>
                <div className="flex items-center gap-2">
                  <CrosshairColorPicker
                    value={scene.crosshairColor}
                    onChange={scene.handleCrosshairColorChange}
                    disabled={!scene.showCrosshair}
                  />
                  <Switch
                    checked={scene.showCrosshair}
                    aria-label="Crosshair"
                    onCheckedChange={scene.handleCrosshairToggle}
                  />
                </div>
              </div>
            </ControlSection>
          </Accordion>
        </fieldset>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-3">
        <Button
          variant="default"
          className="w-full"
          disabled={!ready}
          onClick={() => setResetViewOpen(true)}
        >
          <RotateCcw className="size-4" />
          Reset View
        </Button>
      </div>

      <ClearSelectionDialog
        open={clearSelectionOpen}
        presentCount={teeth.presentToothIds.length}
        pickMode={teeth.pickFromPreview}
        onOpenChange={setClearSelectionOpen}
        onConfirm={teeth.clearSelection}
      />
      <SelectAllDialog
        open={selectAllOpen}
        presentCount={teeth.presentToothIds.length}
        pickMode={teeth.pickFromPreview}
        onOpenChange={setSelectAllOpen}
        onConfirm={teeth.selectAll}
      />
      <ResetViewDialog
        open={resetViewOpen}
        selectedCount={teeth.selectedToothIds.length}
        presentCount={teeth.presentToothIds.length}
        pickMode={teeth.pickFromPreview}
        onOpenChange={setResetViewOpen}
        onConfirm={onReset}
      />
    </aside>
  );
}
