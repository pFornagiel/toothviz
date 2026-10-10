import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { StudyErrorScreen } from "./screens/StudyErrorScreen";
import { ProcessingNoticeBar } from "./screens/ProcessingNoticeBar";
import { PickModeNoticeBar } from "./screens/PickModeNoticeBar";
import { getStudy } from "@/api/studies";
import { PageLayout } from "../components/layout/page-layout";
import { Button } from "../components/ui/button";
import {
  VisualizationProvider,
  VisualizationSidebar,
  ToothLegend,
  useVisualization,
  ViewPhase,
} from "../visualization";
import { PickModeExitDialog } from "../visualization/components/PickModeExitDialog";

/** Pixel widths — hide/show one panel does not change the other. */
const SIDEBAR = { default: 320, min: 240, max: 480 };
const LEGEND = { default: 176, min: 140, max: 320 };

function clamp(px: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/** Drag handle; `onDrag(deltaX)` from pointer-down (positive = right). */
function ResizeHandle({
  onDragStart,
  onDrag,
}: {
  onDragStart: () => void;
  onDrag: (deltaX: number) => void;
}) {
  const startX = useRef(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startX.current = e.clientX;
    onDragStart();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => onDrag(ev.clientX - startX.current);
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40"
    />
  );
}

export async function visualizationLoader({ params }: LoaderFunctionArgs) {
  if (!params.studyId) {
    return null;
  }
  const study = await getStudy(params.studyId);
  return study;
}

export function VisualizationPage() {
  return (
    <VisualizationProvider>
      <VisualizationView />
    </VisualizationProvider>
  );
}

function VisualizationView() {
  const { canvasRef, viewer, layout, scene, display, teeth, pickFlash } = useVisualization();

  const {
    viewPhase,
    statusText,
    errorTitle,
    errorMessage,
    errorHints,
    errorBackLabel,
    onBackFromError,
    processingNotice,
    onReturnToProgress,
  } = viewer;
  const { sidebarVisible, setSidebarVisible, legendVisible, setLegendVisible } = layout;
  const { lightBackground } = scene;
  const maskVisible =
    teeth.overlayIndex >= 0 && (display.volumeVisibility[teeth.overlayIndex] ?? true);
  const legendAvailable =
    viewPhase === ViewPhase.Ready && teeth.hasToothLabels && maskVisible;
  const showLegend = legendAvailable && legendVisible;

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR.default);
  const [legendWidth, setLegendWidth] = useState(LEGEND.default);
  const sidebarOrigin = useRef(sidebarWidth);
  const legendOrigin = useRef(legendWidth);

  return (
    <PageLayout fullHeight title="ToothViz" mainClassName="flex min-h-0 overflow-hidden">
      {viewPhase === ViewPhase.Error ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <StudyErrorScreen
            title={errorTitle}
            message={errorMessage}
            hints={errorHints}
            backLabel={errorBackLabel}
            onBack={onBackFromError}
          />
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          {sidebarVisible && (
            <>
              <div className="flex h-full min-h-0 shrink-0 flex-col" style={{ width: sidebarWidth }}>
                <VisualizationSidebar />
              </div>
              <ResizeHandle
                onDragStart={() => {
                  sidebarOrigin.current = sidebarWidth;
                }}
                onDrag={(dx) => setSidebarWidth(clamp(sidebarOrigin.current + dx, SIDEBAR))}
              />
            </>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{ backgroundColor: lightBackground ? "#ffffff" : "#000000" }}
            >
              <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" />
              {!sidebarVisible && (
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setSidebarVisible(true)}
                  className="absolute top-3 left-3 z-30 size-9 shadow-sm"
                  title="Show controls"
                >
                  <PanelLeftOpen className="size-5" />
                </Button>
              )}
              {(processingNotice !== "none" || teeth.pickFromPreview) && (
                <div
                  className={`absolute top-3 z-30 flex flex-col gap-2 ${
                    sidebarVisible ? "left-3" : "left-14"
                  }`}
                >
                  {processingNotice !== "none" && (
                    <ProcessingNoticeBar
                      notice={processingNotice}
                      showReturnLink={processingNotice !== "artifacts-ready"}
                      onReturnToProgress={onReturnToProgress}
                      placement="overlay"
                    />
                  )}
                  {teeth.pickFromPreview && (
                    <PickModeNoticeBar
                      pending={teeth.pickModePending}
                      selectedCount={teeth.selectedToothIds.length}
                      onApply={() => teeth.requestPickModeExit("apply")}
                      onDiscard={() => teeth.requestPickModeExit("discard")}
                      placement="overlay"
                    />
                  )}
                </div>
              )}
              <PickModeExitDialog
                intent={teeth.pickModeExitIntent}
                selectedToothIds={teeth.selectedToothIds}
                baselineToothIds={teeth.pickModeBaselineToothIds}
                presentCount={teeth.presentToothIds.length}
                onCancel={teeth.cancelPickModeExit}
                onConfirm={teeth.confirmPickModeExit}
              />
              {legendAvailable && !legendVisible && (
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setLegendVisible(true)}
                  className="absolute top-3 right-3 z-30 size-9 shadow-sm"
                  title="Show legend"
                >
                  <PanelRightOpen className="size-5" />
                </Button>
              )}
              {viewPhase === ViewPhase.Loading && (
                <div className="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                  <div
                    className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-muted-foreground">{statusText}</p>
                </div>
              )}
              {pickFlash && (
                <div
                  key={pickFlash.id}
                  className="pointer-events-none absolute bottom-3 left-1/2 z-40 -translate-x-1/2 animate-in fade-in-0 zoom-in-95 rounded-full border border-primary/30 bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-md duration-150"
                  role="status"
                  aria-live="polite"
                >
                  {pickFlash.message}
                </div>
              )}
            </div>
          </div>

          {showLegend && (
            <>
              <ResizeHandle
                onDragStart={() => {
                  legendOrigin.current = legendWidth;
                }}
                onDrag={(dx) => setLegendWidth(clamp(legendOrigin.current - dx, LEGEND))}
              />
              <div className="flex h-full min-h-0 shrink-0 flex-col" style={{ width: legendWidth }}>
                <ToothLegend />
              </div>
            </>
          )}
        </div>
      )}
    </PageLayout>
  );
}
