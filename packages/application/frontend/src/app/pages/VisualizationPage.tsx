import type { LoaderFunctionArgs } from "react-router";
import { PanelLeftOpen } from "lucide-react";
import { StudyErrorScreen } from "./screens/StudyErrorScreen";
import { getStudy } from "@/api/studies";
import { PageLayout } from "../components/layout/page-layout";
import { Button } from "../components/ui/button";
import { VisualizationSidebar } from "./VisualizationSidebar";
import { VisualizationProvider, useVisualization, ViewPhase } from "../visualization";

export async function visualizationLoader({ params }: LoaderFunctionArgs) {
  if (!params.studyId) {
    return null;
  }
  // Pre-fetch study to ensure it exists
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

/** Layout shell: error screen, sidebar mount, canvas + loading overlay. */
function VisualizationView() {
  const {
    canvasRef,
    viewPhase,
    statusText,
    errorTitle,
    errorMessage,
    errorHints,
    errorBackLabel,
    onBackFromError,
    sidebarVisible,
    setSidebarVisible,
    lightBackground,
  } = useVisualization();

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
        <>
          {sidebarVisible && <VisualizationSidebar />}

          {/* Main canvas area */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{ backgroundColor: lightBackground ? "#ffffff" : "#000000" }}
            >
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
              {viewPhase === ViewPhase.Loading && (
                <div className="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                  <div
                    className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-muted-foreground">{statusText}</p>
                </div>
              )}
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
