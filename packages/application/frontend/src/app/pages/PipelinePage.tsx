import { useNavigate, useLocation, redirect, useParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getStudy } from "@/api/studies";
import { StudyLoadingScreen } from "./screens/StudyLoadingScreen";
import { StudyErrorScreen } from "./screens/StudyErrorScreen";
import { PipelineProvider, usePipeline, FromPage, type LocationState } from "../pipeline";

export async function pipelineLoader({ params }: LoaderFunctionArgs) {
  if (!params.studyId) {
    return redirect("/");
  }

  const study = await getStudy(params.studyId);

  if (study.status === "ready") {
    return redirect(`/visualize/${study.id}`);
  }

  return study;
}

export type { LocationState };

export function PipelinePage() {
  return (
    <PipelineProvider>
      <PipelineScreens />
    </PipelineProvider>
  );
}

function PipelineScreens() {
  const navigate = useNavigate();
  const location = useLocation();
  const { studyId } = useParams();
  const routeState = (location.state ?? {}) as LocationState;

  const {
    error,
    steps,
    completedSteps,
    currentStepIndex,
    progress,
    statusText,
    volumePreviewFileId,
    pipelineFinished,
  } = usePipeline();

  const handleBack = () => {
    const from = routeState.from ?? FromPage.Home;
    if (from === FromPage.Browse) {
      navigate("/browse");
    } else {
      navigate("/");
    }
  };

  const handlePreviewRawScan = () => {
    if (!studyId || !volumePreviewFileId) {
      return;
    }
    navigate(`/visualize/${studyId}`, {
      state: {
        from: routeState.from ?? FromPage.Home,
        volumeFileId: volumePreviewFileId,
        previewWhileProcessing: true,
      },
    });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col font-sans">
        <StudyErrorScreen
          title={error.title}
          message={error.message}
          hints={error.hints}
          backLabel={routeState.from === FromPage.Browse ? "Back to studies" : "Back to home"}
          onBack={handleBack}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <StudyLoadingScreen
        title="Processing scan"
        steps={steps}
        completedSteps={completedSteps}
        currentStepIndex={currentStepIndex}
        progressFraction={progress ?? 0}
        statusLine={statusText}
        previewAvailable={volumePreviewFileId != null}
        pipelineFinished={pipelineFinished}
        onPreviewRawScan={handlePreviewRawScan}
      />
    </div>
  );
}
