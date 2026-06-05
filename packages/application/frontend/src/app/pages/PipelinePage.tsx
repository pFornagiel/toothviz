import {
  useNavigate,
  useParams,
  useLocation,
  redirect,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getStudy } from "@/api/studies";
import type { StudyResponse } from "@/api/types";
import { StudyLoadingScreen } from "./screens/StudyLoadingScreen";
import { StudyErrorScreen } from "./screens/StudyErrorScreen";
import {
  usePipelineOrchestration,
  FromPage,
  type LocationState,
} from "../hooks/usePipelineOrchestration";

export async function pipelineLoader({ params }: LoaderFunctionArgs) {
  if (!params.studyId) return redirect("/");

  const study = await getStudy(params.studyId);

  if (study.status === "ready") {
    return redirect(`/visualize/${study.id}`);
  }

  return study;
}

export type { LocationState };

export function PipelinePage() {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const routeState = (location.state ?? {}) as LocationState;

  const study = useLoaderData() as StudyResponse;

  const {
    steps,
    completedSteps,
    currentStepIndex,
    progress,
    statusText,
    error,
  } = usePipelineOrchestration(
    studyId,
    study,
    routeState,
    location.key,
    navigate,
  );

  const handleBack = () => {
    const from = routeState.from ?? FromPage.Home;
    if (from === FromPage.Browse) navigate("/browse");
    else navigate("/");
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col font-sans">
        <StudyErrorScreen
          title={error.title}
          message={error.message}
          hints={error.hints}
          backLabel={
            routeState.from === FromPage.Browse
              ? "Back to studies"
              : "Back to home"
          }
          onBack={handleBack}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <StudyLoadingScreen
        title="Processing study"
        steps={steps}
        completedSteps={completedSteps}
        currentStepIndex={currentStepIndex}
        progressFraction={progress ?? 0}
        statusLine={statusText}
      />
    </div>
  );
}
