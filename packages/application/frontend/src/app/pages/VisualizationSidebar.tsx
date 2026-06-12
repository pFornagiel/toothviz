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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
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
} from "./visualizationConstants";
import { useVisualization, ViewPhase } from "../visualization";

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

export function VisualizationSidebar() {
  const {
    statusText,
    isVolatile,
    viewPhase,
    setSidebarVisible,
    volumes,
    volumeVisibility,
    onToggleVolumeVisibility,
    selectedVolume,
    onSelectVolume,
    sliceType,
    onSliceTypeChange,
    colormap,
    colormaps,
    onColormapChange,
    opacity,
    onOpacityChange,
    calMin,
    calMax,
    calMinGlobal,
    calMaxGlobal,
    onCalMinChange,
    onCalMaxChange,
    showCrosshair,
    onToggleCrosshair,
    crosshairWidth,
    onCrosshairWidthChange,
    lightBackground,
    onToggleBackground,
    clipPlaneDepth,
    onClipDepthChange,
    clipPlaneAzimuth,
    onClipAzimuthChange,
    clipPlaneElevation,
    onClipElevationChange,
    showsRender,
    renderAzimuth,
    onRenderAzimuthChange,
    renderElevation,
    onRenderElevationChange,
    renderZoom,
    onRenderZoomChange,
    onReset,
  } = useVisualization();

  const ready = viewPhase === ViewPhase.Ready;
  const hasMultipleVolumes = volumes.length > 1;

  // Sections open by default; clip/render appear only where a 3D tile is shown.
  const openSections = [
    "volumes",
    "view",
    "display",
    "scene",
    ...(showsRender ? ["clip", "render"] : []),
  ];

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-border bg-secondary">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">NiiVue Controls</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={statusText}>
            {isVolatile ? "Volatile mode" : statusText}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarVisible(false)}
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
          <Accordion type="multiple" defaultValue={openSections} className="w-full">
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
                        checked={volumeVisibility[idx] ?? true}
                        onCheckedChange={() => onToggleVolumeVisibility(idx)}
                      />
                      <span className="truncate">{vol.name || `Volume ${idx}`}</span>
                    </label>
                  ))}
                </div>

                {hasMultipleVolumes && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Active volume</span>
                    <Select
                      value={String(selectedVolume)}
                      onValueChange={(v) => onSelectVolume(parseInt(v))}
                    >
                      <SelectTrigger className="w-full bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {volumes.map((vol, idx) => (
                          <SelectItem key={idx} value={String(idx)}>
                            {vol.name || `Volume ${idx}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </ControlSection>
            )}

            {/* Display (active volume) */}
            <ControlSection value="display" icon={SlidersHorizontal} title="Display">
            <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Slice type</span>
                <Select value={sliceType} onValueChange={(v) => onSliceTypeChange(v as SliceTypeKey)}>
                  <SelectTrigger className="w-full bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(SliceTypeKey).map((key) => (
                      <SelectItem key={key} value={key}>
                        {SLICE_TYPE_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Colormap</span>
                <Select value={colormap} onValueChange={onColormapChange}>
                  <SelectTrigger className="w-full bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {colormaps.map((cm) => (
                      <SelectItem key={cm} value={cm}>
                        {cm}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <SliderRow
                label="Opacity"
                valueLabel={opacity.toFixed(2)}
                value={opacity}
                min={OPACITY_RANGE.min}
                max={OPACITY_RANGE.max}
                step={OPACITY_RANGE.step}
                onChange={onOpacityChange}
              />
              <SliderRow
                label="Cal min"
                valueLabel={calMin.toFixed(0)}
                value={calMin}
                min={calMinGlobal}
                max={calMaxGlobal}
                step={1}
                onChange={onCalMinChange}
              />
              <SliderRow
                label="Cal max"
                valueLabel={calMax.toFixed(0)}
                value={calMax}
                min={calMinGlobal}
                max={calMaxGlobal}
                step={1}
                onChange={onCalMaxChange}
              />
            </ControlSection>

            {/* Render view (3D only) */}
            {showsRender && (
              <ControlSection value="render" icon={Box} title="Render View">
                <SliderRow
                  label="Azimuth"
                  valueLabel={`${renderAzimuth.toFixed(0)}°`}
                  value={renderAzimuth}
                  min={RENDER_AZIMUTH_RANGE.min}
                  max={RENDER_AZIMUTH_RANGE.max}
                  step={RENDER_AZIMUTH_RANGE.step}
                  onChange={onRenderAzimuthChange}
                />
                <SliderRow
                  label="Elevation"
                  valueLabel={`${renderElevation.toFixed(0)}°`}
                  value={renderElevation}
                  min={RENDER_ELEVATION_RANGE.min}
                  max={RENDER_ELEVATION_RANGE.max}
                  step={RENDER_ELEVATION_RANGE.step}
                  onChange={onRenderElevationChange}
                />
                <div className="space-y-1.5">
                  <span className="text-sm text-foreground">Zoom</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0 bg-card"
                      title="Zoom out"
                      onClick={() => onRenderZoomChange(renderZoom / RENDER_ZOOM_BUTTON_FACTOR)}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <input
                      type="range"
                      value={renderZoom}
                      min={RENDER_ZOOM_RANGE.min}
                      max={RENDER_ZOOM_RANGE.max}
                      step={RENDER_ZOOM_RANGE.step}
                      onChange={(e) => onRenderZoomChange(parseFloat(e.target.value))}
                      className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0 bg-card"
                      title="Zoom in"
                      onClick={() => onRenderZoomChange(renderZoom * RENDER_ZOOM_BUTTON_FACTOR)}
                    >
                      <Plus className="size-4" />
                    </Button>
                    <span className="w-10 shrink-0 text-right text-sm text-foreground">
                      {renderZoom.toFixed(1)}×
                    </span>
                  </div>
                </div>
              </ControlSection>
            )}

                        {/* Clip plane (3D only) */}
            {showsRender && (
              <ControlSection value="clip" icon={Scissors} title="3D Clip Plane">
                <SliderRow
                  label="Depth"
                  valueLabel={clipPlaneDepth.toFixed(2)}
                  value={clipPlaneDepth}
                  min={CLIP_DEPTH_RANGE.min}
                  max={CLIP_DEPTH_RANGE.max}
                  step={CLIP_DEPTH_RANGE.step}
                  onChange={onClipDepthChange}
                />
                <SliderRow
                  label="Azimuth"
                  valueLabel={`${clipPlaneAzimuth.toFixed(0)}°`}
                  value={clipPlaneAzimuth}
                  min={CLIP_AZIMUTH_RANGE.min}
                  max={CLIP_AZIMUTH_RANGE.max}
                  step={CLIP_AZIMUTH_RANGE.step}
                  onChange={onClipAzimuthChange}
                />
                <SliderRow
                  label="Elevation"
                  valueLabel={`${clipPlaneElevation.toFixed(0)}°`}
                  value={clipPlaneElevation}
                  min={CLIP_ELEVATION_RANGE.min}
                  max={CLIP_ELEVATION_RANGE.max}
                  step={CLIP_ELEVATION_RANGE.step}
                  onChange={onClipElevationChange}
                />
              </ControlSection>
            )}


            {/* Scene (crosshair + background) */}
            <ControlSection value="scene" icon={Crosshair} title="Scene">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Crosshair</span>
                <Switch checked={showCrosshair} onCheckedChange={onToggleCrosshair} />
              </div>
              <SliderRow
                label="Crosshair width"
                valueLabel={`${crosshairWidth}px`}
                value={crosshairWidth}
                min={CROSSHAIR_WIDTH_RANGE.min}
                max={CROSSHAIR_WIDTH_RANGE.max}
                step={CROSSHAIR_WIDTH_RANGE.step}
                onChange={onCrosshairWidthChange}
                disabled={!showCrosshair}
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Light background</span>
                <Switch checked={lightBackground} onCheckedChange={onToggleBackground} />
              </div>
            </ControlSection>
          </Accordion>
        </fieldset>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-3">
        <Button variant="default" className="w-full" disabled={!ready} onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset View
        </Button>
      </div>
    </aside>
  );
}
