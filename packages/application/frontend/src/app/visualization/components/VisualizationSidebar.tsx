import * as React from "react";
import {
  Layers,
  SlidersHorizontal,
  Crosshair,
  Scissors,
  Box,
  PanelLeftClose,
  RotateCcw,
  Minus,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Odontogram } from "react-odontogram";
import "react-odontogram/style.css";
import "../odontogram.css";
import { cn } from "@/lib/utils";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Checkbox } from "../../components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Tooth } from "../../components/icons/tooth";
import { toothIdFromOdontogramTarget, toothIdToFdi } from "../toothLabels";
import { formatFdiList, sameToothSelection } from "../selectionSummary";
import {
  SliceTypeKey,
  SLICE_TYPE_LABELS,
  CROSSHAIR_WIDTH_RANGE,
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
import { ResetViewDialog } from "./ResetViewDialog";
import { SelectAllDialog } from "./SelectAllDialog";
import { useVisualization } from "../VisualizationProvider";
import { ViewPhase } from "../types";

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

/** Label on the left, monospace value readout on the right, slider underneath. */
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
  const { viewer, layout, volumes, view, display, teeth, scene, clip, render, onReset, showPickFlash } =
    useVisualization();
  const [clearSelectionOpen, setClearSelectionOpen] = React.useState(false);
  const [selectAllOpen, setSelectAllOpen] = React.useState(false);
  const [resetViewOpen, setResetViewOpen] = React.useState(false);
  const [hoveredSliceType, setHoveredSliceType] = React.useState<SliceTypeKey | null>(null);

  const ready = viewer.viewPhase === ViewPhase.Ready;
  const hasMultipleVolumes = volumes.length > 1;
  const visibleVolumeIndices = volumes
    .map((_, idx) => idx)
    .filter((idx) => display.volumeVisibility[idx] ?? true);
  const hasActiveVolume = visibleVolumeIndices.includes(display.selectedVolume);
  const isMaskActive =
    teeth.overlayIndex >= 0 && display.selectedVolume === teeth.overlayIndex;
  const maskVisible =
    teeth.overlayIndex >= 0 && (display.volumeVisibility[teeth.overlayIndex] ?? true);
  // Only show tooth picking when a mask overlay is loaded, visible, and has labels.
  const showToothSelection = teeth.hasToothLabels && maskVisible;

  // Sections open by default; clip appears only where a 3D tile is shown.
  // Render View (slice type + zoom) stays available for every slice type.
  const openSections = [
    "volumes",
    ...(showToothSelection ? ["teeth"] : []),
    "render",
    "display",
    "scene",
    ...(view.showsRender ? ["clip"] : []),
  ];

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-secondary">
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
            key={showToothSelection ? "with-teeth" : "no-teeth"}
            type="multiple"
            defaultValue={openSections}
            className="w-full"
          >
            {/* Volume selection */}
            {volumes.length > 0 && (
              <ControlSection value="volumes" icon={Layers} title="Volume Selection">
                <div className="space-y-2.5">
                  {volumes.map((vol, idx) => (
                    <label
                      key={idx}
                      className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
                    >
                      <Checkbox
                        checked={display.volumeVisibility[idx] ?? true}
                        onCheckedChange={() => display.handleVolumeVisibilityToggle(idx)}
                      />
                      <span className="truncate">{vol.name || `Volume ${idx}`}</span>
                    </label>
                  ))}
                </div>
              </ControlSection>
            )}

            {showToothSelection && (
              <ControlSection value="teeth" icon={Tooth} title="Tooth Selection">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">{PICK_MODE_LABEL}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Switch
                          checked={teeth.pickFromPreview}
                          disabled={teeth.pickModePending}
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
                      {!teeth.pickFromPreview
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
                  {teeth.pickModePending
                    ? PICK_MODE_PENDING
                    : teeth.pickFromPreview
                      ? PICK_MODE_HELP
                      : "Select on the chart below, or enable pick mode.\nColors match the labels in the viewer."}
                </p>
                <div
                  className={cn(
                    "toothviz-odontogram w-full overflow-x-auto",
                    teeth.pickModePending && "toothviz-odontogram--pending",
                  )}
                  onClick={(e) => {
                    if (teeth.pickModePending) {
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
                        slicePickMessage(fdi, !teeth.selectedToothIds.includes(toothId)),
                      );
                    }
                  }}
                >
                  <Odontogram
                    notation="FDI"
                    layout="square"
                    showTooltip
                    showLabels={false}
                    readOnly
                    teethConditions={teeth.detectedConditions}
                    className="w-full"
                  />
                </div>
                <p className="whitespace-pre-line text-xs text-muted-foreground tabular-nums text-balance">
                  {teeth.selectedToothIds.length === 0
                    ? "No teeth selected."
                    : teeth.selectedToothIds.length === teeth.presentToothIds.length
                      ? `All ${teeth.presentToothIds.length} detected teeth selected.`
                      : `Selected ${teeth.selectedToothIds.length} of ${teeth.presentToothIds.length}:\n${formatFdiList(teeth.selectedToothIds)}`}
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-card"
                    disabled={
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
                    disabled={teeth.pickModePending || teeth.selectedToothIds.length === 0}
                    onClick={() => setClearSelectionOpen(true)}
                  >
                    Clear selection
                  </Button>
                </div>
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

            {/* Display: volume appearance */}
            <ControlSection value="display" icon={SlidersHorizontal} title="Display">
              {hasMultipleVolumes && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Settings for</span>
                  <Select
                    value={String(display.selectedVolume)}
                    onValueChange={(v) => display.handleVolumeChange(parseInt(v))}
                    disabled={visibleVolumeIndices.length === 0}
                  >
                    <SelectTrigger className="w-full bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleVolumeIndices.map((idx) => (
                        <SelectItem key={idx} value={String(idx)}>
                          {volumes[idx]?.name || `Volume ${idx}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <SliderRow
                label="Opacity"
                valueLabel={display.opacity.toFixed(2)}
                value={display.opacity}
                min={OPACITY_RANGE.min}
                max={OPACITY_RANGE.max}
                step={OPACITY_RANGE.step}
                onChange={display.handleOpacityChange}
                disabled={!hasActiveVolume}
              />
              {!isMaskActive && (
                <>
                  <SliderRow
                    label="Cal min"
                    valueLabel={display.cal_min.toFixed(0)}
                    value={display.cal_min}
                    min={display.cal_minGlobal}
                    max={display.cal_maxGlobal}
                    step={1}
                    onChange={display.handleCalMinChange}
                    disabled={!hasActiveVolume}
                  />
                  <SliderRow
                    label="Cal max"
                    valueLabel={display.cal_max.toFixed(0)}
                    value={display.cal_max}
                    min={display.cal_minGlobal}
                    max={display.cal_maxGlobal}
                    step={1}
                    onChange={display.handleCalMaxChange}
                    disabled={!hasActiveVolume}
                  />
                </>
              )}
            </ControlSection>

            {/* Clip plane (3D only) */}
            {view.showsRender && (
              <ControlSection value="clip" icon={Scissors} title="3D Clip Plane">
                <SliderRow
                  label="Depth"
                  valueLabel={clip.clipPlaneDepth.toFixed(2)}
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
                <Switch checked={scene.showCrosshair} onCheckedChange={scene.handleCrosshairToggle} />
              </div>
              <SliderRow
                label="Crosshair width"
                valueLabel={`${scene.crosshairWidth}px`}
                value={scene.crosshairWidth}
                min={CROSSHAIR_WIDTH_RANGE.min}
                max={CROSSHAIR_WIDTH_RANGE.max}
                step={CROSSHAIR_WIDTH_RANGE.step}
                onChange={scene.handleCrosshairWidthChange}
                disabled={!scene.showCrosshair}
              />
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
