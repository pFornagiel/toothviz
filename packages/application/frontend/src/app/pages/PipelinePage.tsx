import { useCallback, useEffect, useRef, useState } from "react";
import {
  useNavigate,
  useParams,
  useLocation,
  redirect,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { deleteStudy, getStudy } from "@/api/studies";
import { uploadFile, type UploadProgress } from "@/api/upload";
import { connectPipeline } from "@/api/ws";
import { ApiError } from "@/api/client";
import type {
  PipelineMessage,
  StudyResponse,
  UploadKind,
  PipelineRequestItem,
} from "@/api/types";
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
      throw err;
    }
    throw err;
  }
}

type FromPage = "home" | "browse";

export interface UploadPayload {
  baseImageFile: File;
  baseKind: UploadKind;
  pipelines: PipelineRequestItem[];
  segmentationFile?: File;
}

interface LocationState {
  uploadPayload?: UploadPayload;
  jobId?: string | null;
  from?: FromPage;
}

type PipelinePhase = "uploading" | "connecting" | "running" | "error";

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

function buildUploadPhaseSteps(payload: UploadPayload): string[] {
  const hasMask = Boolean(payload.segmentationFile);
  const uploadPrefix = hasMask
    ? ["upload_volume", "upload_mask", "finalize_upload"]
    : ["upload_volume", "finalize_upload"];
  const pipelineNames = payload.pipelines.map((p) => p.name);
  return [...uploadPrefix, ...pipelineNames];
}

export function PipelinePage() {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const routeState = (location.state ?? {}) as LocationState;

  const study = useLoaderData() as StudyResponse;

  const [phase, setPhase] = useState<PipelinePhase>("connecting");

  const [steps, setSteps] = useState<string[]>([]);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    () => new Set(),
  );
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [statusText, setStatusText] = useState("Connecting…");
  const wsStepIndexOffsetRef = useRef(0);

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

  useEffect(() => {
    if (!studyId) return;

    let cancelled = false;
    let pipelineFinished = false;
    let disconnect: (() => void) | null = null;

    const uploadPayload = routeState.uploadPayload;

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

    const finishOk = async () => {
      try {
        const s = await getStudy(studyId);
        if (cancelled) return;
        if (s.status === "ready") {
          navigate(`/visualize/${studyId}`, {
            state: { from: routeState.from ?? "home" },
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

    if (uploadPayload) {
      const combinedSteps = buildUploadPhaseSteps(uploadPayload);
      const hasMask = Boolean(uploadPayload.segmentationFile);
      const totalStepsCount = combinedSteps.length;

      wsStepIndexOffsetRef.current = 0;

      setPhase("uploading");
      setSteps(combinedSteps);
      setCompletedSteps(new Set());
      setCurrentStepIndex(0);
      setProgress(0);
      setStatusText("Starting upload…");

      const makeOnProgress =
        (
          uploadStepIdx: number,
          finalizeStepIdx: number | null,
          volumeFinalizeOnSameStep: boolean,
        ) =>
        (p: UploadProgress) => {
          if (cancelled) return;
          if (p.phase === "begin") {
            setCurrentStepIndex(uploadStepIdx);
            setStatusText("Starting upload…");
            setProgress(uploadStepIdx / totalStepsCount);
          } else if (p.phase === "uploading" && p.totalChunks) {
            const i = (p.chunkIndex ?? 0) + 1;
            setCurrentStepIndex(uploadStepIdx);
            setStatusText(`Uploading chunks ${i} / ${p.totalChunks}`);
            setProgress(
              Math.min(
                1,
                uploadStepIdx / totalStepsCount +
                  (i / p.totalChunks) * (1 / totalStepsCount),
              ),
            );
          } else if (p.phase === "finalizing") {
            if (volumeFinalizeOnSameStep) {
              setCurrentStepIndex(uploadStepIdx);
              setStatusText("Finalizing upload...");
              setProgress(Math.min(1, (uploadStepIdx + 0.9) / totalStepsCount));
            } else if (finalizeStepIdx != null) {
              setCurrentStepIndex(finalizeStepIdx);
              setStatusText("Finalizing upload...");
              setProgress((finalizeStepIdx + 0.5) / totalStepsCount);
            }
          } else if (p.phase === "done") {
            if (finalizeStepIdx != null && !volumeFinalizeOnSameStep) {
              setProgress((finalizeStepIdx + 1) / totalStepsCount);
            } else {
              setProgress((uploadStepIdx + 1) / totalStepsCount);
            }
          }
        };

      void (async () => {
        try {
          const baseOnProgress = hasMask
            ? makeOnProgress(0, null, true)
            : makeOnProgress(0, 1, false);

          const baseResult = await uploadFile(
            studyId,
            uploadPayload.baseImageFile,
            uploadPayload.baseKind,
            uploadPayload.pipelines,
            baseOnProgress,
          );
          if (cancelled) return;

          if (hasMask) {
            setCompletedSteps(new Set([0]));
          } else {
            setCompletedSteps(new Set([0, 1]));
          }

          if (uploadPayload.segmentationFile) {
            const maskOnProgress = makeOnProgress(1, 2, false);
            await uploadFile(
              studyId,
              uploadPayload.segmentationFile,
              "nifti_mask",
              [],
              maskOnProgress,
            );
            if (cancelled) return;
            setCompletedSteps(new Set([0, 1, 2]));
          }

          const fromPage = routeState.from ?? "home";

          if (!baseResult.job_id) {
            setProgress(1);
            setCurrentStepIndex(null);
            setStatusText("Opening viewer…");
            navigate(`/visualize/${studyId}`, {
              replace: true,
              state: { from: fromPage },
            });
          } else {
            const uploadPrefixLen = hasMask ? 3 : 2;
            wsStepIndexOffsetRef.current = uploadPrefixLen;
            const uploadWeight = uploadPrefixLen / totalStepsCount;

            setPhase("running");
            setCurrentStepIndex(uploadPrefixLen);
            setProgress(uploadWeight);
            setStatusText("Pipeline running…");

            const idxOffset = wsStepIndexOffsetRef.current;

            disconnect = connectPipeline(
              baseResult.job_id,
              (msg: PipelineMessage) => {
                const p = clamp01(msg.progress);
                if (p != null) {
                  setProgress(uploadWeight + p * (1 - uploadWeight));
                }
                if (msg.step_index != null) {
                  setCurrentStepIndex(msg.step_index + idxOffset);
                }
                if (msg.event === "step_completed" && msg.step_index != null) {
                  setCompletedSteps((prev) =>
                    new Set(prev).add(msg.step_index! + idxOffset),
                  );
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
                if (cancelled || pipelineFinished) return;
                setStatusText(
                  "Connection closed — check your network or refresh this page.",
                );
              },
            );
          }
        } catch (err: unknown) {
          if (cancelled) return;
          try {
            await deleteStudy(studyId);
          } catch {
            /* best-effort */
          }
          const msg = err instanceof Error ? err.message : String(err);
          goError("Upload failed", msg, errorHints(null));
        }
      })();

      return () => {
        cancelled = true;
        disconnect?.();
      };
    }

    const jobId =
      typeof routeState.jobId === "string"
        ? routeState.jobId
        : study.job_id ?? null;

    if (
      !jobId &&
      study.status !== "processing" &&
      study.status !== "failed" &&
      study.status !== "cancelled"
    ) {
      goError(
        "Upload state was lost",
        "Please create the study again from the home page.",
        [
          "This can happen if you refreshed during the initial upload.",
          "Use “Create a Study” again from home.",
        ],
      );
      return;
    }

    if (!jobId) {
      navigate(`/visualize/${studyId}`, {
        state: { from: routeState.from },
        replace: true,
      });
      return;
    }

    wsStepIndexOffsetRef.current = 0;

    void (async () => {
      let stepNames: string[] = [];
      try {
        const fresh = await getStudy(studyId);
        if (cancelled) return;
        stepNames = fresh.steps ?? [];
        setSteps(stepNames);
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
        goError("Could not load study", msg, errorHints(null));
        return;
      }

      if (cancelled) return;

      setPhase("running");
      setStatusText("Pipeline running…");
      setProgress(0);
      setCompletedSteps(new Set());
      setCurrentStepIndex(stepNames.length > 0 ? 0 : null);

      const idxOffset = wsStepIndexOffsetRef.current;

      disconnect = connectPipeline(
        jobId,
        (msg: PipelineMessage) => {
          const p = clamp01(msg.progress);
          if (p != null) setProgress(p);
          if (msg.step_index != null) {
            setCurrentStepIndex(msg.step_index + idxOffset);
          }
          if (msg.event === "step_completed" && msg.step_index != null) {
            setCompletedSteps((prev) =>
              new Set(prev).add(msg.step_index! + idxOffset),
            );
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
    })();

    return () => {
      cancelled = true;
      disconnect?.();
    };
  }, [
    studyId,
    study,
    study.status,
    study.job_id,
    routeState.uploadPayload,
    routeState.jobId,
    routeState.from,
    location.key,
    navigate,
    goError,
  ]);

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
