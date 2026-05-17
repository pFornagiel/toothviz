import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getStudy } from "@/api/studies";
import { connectPipeline } from "@/api/ws";
import { ApiError } from "@/api/client";
import type { PipelineMessage, StudyResponse } from "@/api/types";
import { StudyLoadingScreen } from "../components/StudyLoadingScreen";
import { StudyErrorScreen } from "../components/StudyErrorScreen";

export async function pipelineLoader({ params }: LoaderFunctionArgs) {
  if (!params.studyId) return redirect("/");

  try {
    const study = await getStudy(params.studyId);
    
    if (study.status === "ready") {
      return redirect(`/visualize/${study.id}`);
    }
    
    return study;
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) {
      throw err; // React Router error element could handle it, or we handle below
    }
    throw err;
  }
}

type FromPage = "home" | "browse";

interface LocationState {
  jobId?: string | null;
  from?: FromPage;
}

type PipelinePhase = "connecting" | "running" | "error";

function clamp01(x: number | undefined | null): number | undefined {
  if (x == null || Number.isNaN(x)) return undefined;
  return Math.min(1, Math.max(0, x));
}

function errorHints(failedStep?: string | null): string[] {
  const base = [
    "Ensure the file is a valid NIfTI (.nii / .nii.gz) or a ZIP of DICOM files.",
    "For DICOM, confirm the archive contains readable slices (not empty or corrupt).",
    "Try again with automated segmentation disabled and upload a precomputed mask instead.",
    "Create a new study from the home page if this message appeared after a failed run.",
  ];
  if (failedStep === "dicom_to_nifti") {
    return [
      "DICOM conversion failed — check that the ZIP is not corrupt and contains valid DICOM.",
      ...base.slice(1),
    ];
  }
  if (failedStep === "segment_nifti") {
    return [
      "Segmentation failed — the volume may be unsupported or too small for the model.",
      ...base.slice(2),
    ];
  }
  return base;
}

export function PipelinePage() {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const routeState = (location.state ?? {}) as LocationState;
  
  const study = useLoaderData() as StudyResponse;

  const [phase, setPhase] = useState<PipelinePhase>("connecting");

  // Progress tracking
  const [steps, setSteps] = useState<string[]>([]);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    () => new Set(),
  );
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [statusText, setStatusText] = useState("Connecting…");

  // Error state
  const [errorTitle, setErrorTitle] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorHintsList, setErrorHintsList] = useState<string[]>([]);

  const reconnectAttemptedRef = useRef(false);

  const goError = useCallback(
    (title: string, message: string, hints: string[]) => {
      setErrorTitle(title);
      setErrorMessage(message);
      setErrorHintsList(hints);
      setPhase("error");
    },
    [],
  );

  const handleBack = useCallback(() => {
    const from = routeState.from ?? "home";
    if (from === "browse") navigate("/browse");
    else navigate("/");
  }, [navigate, routeState.from]);

  /** On mount: check study status and connect to WebSocket */
  useEffect(() => {
    if (!studyId) return;

    let cancelled = false;
    let pipelineFinished = false;
    let disconnect: (() => void) | null = null;

    setSteps(study.steps ?? []);

    if (study.status === "failed" || study.status === "cancelled") {
      goError(
        "Study is not available",
        study.error ??
          (study.status === "cancelled"
            ? "Processing was cancelled."
            : "Processing failed."),
        errorHints(null),
      );
      return;
    }

    // Determine jobId
    const jobId =
      typeof routeState.jobId === "string"
        ? routeState.jobId
        : study.job_id;

    if (study.status !== "processing" || !jobId) {
      // Not processing or no job — try viewer anyway
      navigate(`/visualize/${studyId}`, {
        state: { from: routeState.from },
        replace: true,
      });
      return;
    }

    // Study is processing — connect WebSocket
    setPhase("running");
    setStatusText("Pipeline running…");
    setProgress(0);
    setCompletedSteps(new Set());
    setCurrentStepIndex(null);

    const finishOk = async () => {
          try {
            const s = await getStudy(studyId);
            if (cancelled) return;
            if (s.status === "ready") {
              navigate(`/visualize/${studyId}`, {
                state: { from: routeState.from },
                replace: true,
              });
            }
          } catch (e: unknown) {
            if (cancelled) return;
            if (e instanceof ApiError && e.status === 404) {
              goError(
                "Study not found",
                "Processing may have failed and the study was removed.",
                errorHints(null),
              );
              return;
            }
            const msg = e instanceof Error ? e.message : String(e);
            goError(
              "Could not load study after pipeline",
              msg,
              errorHints(null),
            );
          }
        };

        disconnect = connectPipeline(
          jobId,
          (msg: PipelineMessage) => {
            const p = clamp01(msg.progress);
            if (p != null) setProgress(p);
            if (msg.step_index != null) setCurrentStepIndex(msg.step_index);
            if (msg.status === "running" && msg.step) {
              setStatusText(`Running: ${msg.step}`);
            }
            if (msg.event === "step_completed" && msg.step_index != null) {
              setCompletedSteps((prev) => new Set(prev).add(msg.step_index!));
              setStatusText(`Finished step: ${msg.step}`);
            }
            if (msg.event === "step_started" && msg.step) {
              setStatusText(`Started: ${msg.step}`);
            }

            if (msg.event === "pipeline_completed") {
              if (pipelineFinished) return;
              pipelineFinished = true;
              disconnect?.();
              setProgress(1);
              setStatusText("Pipeline completed — loading…");
              void finishOk();
            }

            if (msg.event === "pipeline_failed") {
              if (pipelineFinished) return;
              pipelineFinished = true;
              disconnect?.();
              goError(
                "Processing failed",
                msg.error ?? "The pipeline reported a failure.",
                errorHints(msg.failed_step),
              );
            }

            if (msg.event === "pipeline_cancelled") {
              if (pipelineFinished) return;
              pipelineFinished = true;
              disconnect?.();
              goError("Processing cancelled", "The pipeline was cancelled.", [
                "Open another study or start again from the home page.",
              ]);
            }
          },
          () => {
            // onClose
            if (cancelled || pipelineFinished) return;
            void (async () => {
              try {
                await finishOk();
              } catch {
                /* finishOk handles errors */
              }
              try {
                const s = await getStudy(studyId);
                if (
                  s.status === "processing" &&
                  !reconnectAttemptedRef.current
                ) {
                  reconnectAttemptedRef.current = true;
                  setStatusText(
                    "Connection closed — check your network or refresh this page.",
                  );
                }
              } catch (e: unknown) {
                if (e instanceof ApiError && e.status === 404) {
                  goError(
                    "Study not found",
                    "Processing may have failed and the study was removed.",
                    errorHints(null),
                  );
                }
              }
            })();
          },
        );

    return () => {
      cancelled = true;
      disconnect?.();
    };
  }, [studyId, study, routeState.jobId, routeState.from, navigate, goError]);

  if (phase === "error") {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
        <StudyErrorScreen
          title={errorTitle}
          message={errorMessage}
          hints={errorHintsList}
          backLabel={
            routeState.from === "browse" ? "Back to studies" : "Back to home"
          }
          onBack={handleBack}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <StudyLoadingScreen
        title="Processing study"
        steps={steps}
        completedSteps={completedSteps}
        currentStepIndex={currentStepIndex}
        progressFraction={progress}
        statusLine={statusText}
      />
    </div>
  );
}
