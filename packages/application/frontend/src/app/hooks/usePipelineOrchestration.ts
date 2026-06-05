import { useEffect, useReducer, useRef, type Dispatch } from "react";
import type { NavigateFunction } from "react-router";
import { deleteStudy, getStudy } from "@/api/studies";
import { uploadFile, type UploadProgress } from "@/api/upload";
import { establishWebsocketConnection } from "@/api/ws";
import { ApiError } from "@/api/client";
import {
  ClientStepName,
  LoadingStepId,
  PipelineStepName,
  UploadKind,
  type PipelineMessage,
  type PipelineRequestItem,
  type StudyResponse,
} from "@/api/types";

export type FromPage = "home" | "browse";

export interface UploadPayload {
  baseImageFile: File;
  baseKind: UploadKind;
  pipelines: PipelineRequestItem[];
  segmentationFile?: File;
}

export interface LocationState {
  uploadPayload?: UploadPayload;
  jobId?: string | null;
  from?: FromPage;
}

type PipelinePhase = "uploading" | "connecting" | "running" | "error";

export interface PipelineState {
  phase: PipelinePhase;
  steps: LoadingStepId[];
  completedSteps: Set<number>;
  currentStepIndex: number | null;
  progress: number | null;
  statusText: string;
  error: { title: string; message: string; hints: string[] } | null;
}

const initialState: PipelineState = {
  phase: "connecting",
  steps: [],
  completedSteps: new Set(),
  currentStepIndex: null,
  progress: 0,
  statusText: "Connecting…",
  error: null,
};

type PipelineAction =
  | { type: "SET_PHASE"; phase: PipelinePhase }
  | { type: "SET_STEPS"; steps: LoadingStepId[] }
  | { type: "SET_COMPLETED_STEPS"; completedSteps: Set<number> }
  | { type: "ADD_COMPLETED_STEP"; index: number }
  | { type: "SET_CURRENT_STEP_INDEX"; index: number | null }
  | { type: "SET_PROGRESS"; progress: number | null }
  | { type: "SET_STATUS_TEXT"; text: string }
  | {
      type: "SET_ERROR";
      title: string;
      message: string;
      hints: string[];
    }
  | {
      type: "START_UPLOAD";
      steps: LoadingStepId[];
    }
  | {
      type: "START_RUNNING_AFTER_UPLOAD";
      uploadPrefixLen: number;
      totalStepsCount: number;
    }
  | {
      type: "START_RUNNING_RECONNECT";
      currentStepIndex: number | null;
    };

function pipelineReducer(
  state: PipelineState,
  action: PipelineAction,
): PipelineState {
  switch (action.type) {
    case "SET_PHASE":
      return { ...state, phase: action.phase };
    case "SET_STEPS":
      return { ...state, steps: action.steps };
    case "SET_COMPLETED_STEPS":
      return { ...state, completedSteps: action.completedSteps };
    case "ADD_COMPLETED_STEP": {
      const next = new Set(state.completedSteps);
      next.add(action.index);
      return { ...state, completedSteps: next };
    }
    case "SET_CURRENT_STEP_INDEX":
      return { ...state, currentStepIndex: action.index };
    case "SET_PROGRESS":
      return { ...state, progress: action.progress };
    case "SET_STATUS_TEXT":
      return { ...state, statusText: action.text };
    case "SET_ERROR":
      return {
        ...state,
        phase: "error",
        error: {
          title: action.title,
          message: action.message,
          hints: action.hints,
        },
      };
    case "START_UPLOAD":
      return {
        ...state,
        phase: "uploading",
        steps: action.steps,
        completedSteps: new Set(),
        currentStepIndex: 0,
        progress: 0,
        statusText: "Starting upload…",
        error: null,
      };
    case "START_RUNNING_AFTER_UPLOAD": {
      const w =
        action.uploadPrefixLen > 0
          ? action.uploadPrefixLen / action.totalStepsCount
          : 0;
      return {
        ...state,
        phase: "running",
        currentStepIndex: action.uploadPrefixLen,
        progress: w,
        statusText: "Pipeline running…",
      };
    }
    case "START_RUNNING_RECONNECT":
      return {
        ...state,
        phase: "running",
        statusText: "Pipeline running…",
        progress: 0,
        completedSteps: new Set(),
        currentStepIndex: action.currentStepIndex,
      };
  }
}

function clamp01(x: number | undefined | null): number | undefined {
  if (x == null || Number.isNaN(x)) return undefined;
  return Math.min(1, Math.max(0, x));
}

export function errorHints(failedStep?: string | null): string[] {
  const validFormat =
    "Ensure the file is a valid NIfTI (.nii / .nii.gz) or a ZIP of DICOM files.";
  const dicomArchive =
    "For DICOM, confirm the archive contains readable slices (not empty or corrupt).";
  const precomputedMask =
    "Try again with automated segmentation disabled and upload a precomputed mask instead.";
  const newStudy =
    "Create a new study from the home page if this message appeared after a failed run.";

  if (failedStep === "dicom_to_nifti") {
    return [
      "DICOM conversion failed — check that the ZIP is not corrupt and contains valid DICOM.",
      dicomArchive,
      precomputedMask,
      newStudy,
    ];
  }
  if (failedStep === PipelineStepName.SegmentNifti) {
    return [
      "Segmentation failed — the volume may be unsupported or too small for the model.",
      precomputedMask,
      newStudy,
    ];
  }
  return [validFormat, dicomArchive, precomputedMask, newStudy];
}

export function createLoadingSteps(payload: UploadPayload): LoadingStepId[] {
  const hasMask = !!payload.segmentationFile;
  const uploadPrefix = hasMask
    ? [ClientStepName.UploadVolume, ClientStepName.UploadMask, ClientStepName.FinalizeUpload]
    : [ClientStepName.UploadVolume, ClientStepName.FinalizeUpload];
  const pipelineNames = payload.pipelines.map((p) => p.name);
  return [...uploadPrefix, ...pipelineNames];
}

const CANCELLED_HINTS = [
  "Open another study or start again from the home page.",
];

export function makeUploadProgressHandler(
  totalStepsCount: number,
  isCancelled: () => boolean,
  dispatch: Dispatch<PipelineAction>,
) {
  return function makeHandler(
    uploadStepIdx: number,
    finalizeStepIdx: number | null,
    volumeFinalizeOnSameStep: boolean,
  ): (p: UploadProgress) => void {
    return (p: UploadProgress) => {
      if (isCancelled()) return;
      if (p.phase === "begin") {
        dispatch({ type: "SET_CURRENT_STEP_INDEX", index: uploadStepIdx });
        dispatch({ type: "SET_STATUS_TEXT", text: "Starting upload…" });
        dispatch({
          type: "SET_PROGRESS",
          progress: uploadStepIdx / totalStepsCount,
        });
      } else if (p.phase === "uploading" && p.totalChunks) {
        const i = (p.chunkIndex ?? 0) + 1;
        dispatch({ type: "SET_CURRENT_STEP_INDEX", index: uploadStepIdx });
        dispatch({
          type: "SET_STATUS_TEXT",
          text: `Uploading chunks ${i} / ${p.totalChunks}`,
        });
        dispatch({
          type: "SET_PROGRESS",
          progress: Math.min(
            1,
            uploadStepIdx / totalStepsCount +
              (i / p.totalChunks) * (1 / totalStepsCount),
          ),
        });
      } else if (p.phase === "finalizing") {
        if (volumeFinalizeOnSameStep) {
          dispatch({ type: "SET_CURRENT_STEP_INDEX", index: uploadStepIdx });
          dispatch({ type: "SET_STATUS_TEXT", text: "Finalizing upload..." });
          dispatch({
            type: "SET_PROGRESS",
            progress: Math.min(1, (uploadStepIdx + 0.9) / totalStepsCount),
          });
        } else if (finalizeStepIdx != null) {
          dispatch({ type: "SET_CURRENT_STEP_INDEX", index: finalizeStepIdx });
          dispatch({ type: "SET_STATUS_TEXT", text: "Finalizing upload..." });
          dispatch({
            type: "SET_PROGRESS",
            progress: (finalizeStepIdx + 0.5) / totalStepsCount,
          });
        }
      } else if (p.phase === "done") {
        if (finalizeStepIdx != null && !volumeFinalizeOnSameStep) {
          dispatch({
            type: "SET_PROGRESS",
            progress: (finalizeStepIdx + 1) / totalStepsCount,
          });
        } else {
          dispatch({
            type: "SET_PROGRESS",
            progress: (uploadStepIdx + 1) / totalStepsCount,
          });
        }
      }
    };
  };
}

interface WsHandlerOptions {
  uploadWeight: number;
  idxOffset: number;
  dispatch: Dispatch<PipelineAction>;
  getPipelineFinished: () => boolean;
  markPipelineFinished: () => void;
  disconnect: () => void;
  onPipelineCompleted: () => void;
  onPipelineFailed: (msg: PipelineMessage) => void;
  onPipelineCancelled: () => void;
}

/** Shared WebSocket message handling for upload+pipeline and reconnect flows. */
export function applyWsMessage(
  msg: PipelineMessage,
  {
    uploadWeight,
    idxOffset,
    dispatch,
    getPipelineFinished,
    markPipelineFinished,
    disconnect,
    onPipelineCompleted,
    onPipelineFailed,
    onPipelineCancelled,
  }: WsHandlerOptions,
): void {
  const p = clamp01(msg.progress);
  if (p != null) {
    dispatch({
      type: "SET_PROGRESS",
      progress: uploadWeight + p * (1 - uploadWeight),
    });
  }
  if (msg.step_index != null) {
    dispatch({
      type: "SET_CURRENT_STEP_INDEX",
      index: msg.step_index + idxOffset,
    });
  }
  if (msg.event === "step_completed" && msg.step_index != null) {
    dispatch({
      type: "ADD_COMPLETED_STEP",
      index: msg.step_index + idxOffset,
    });
    dispatch({
      type: "SET_STATUS_TEXT",
      text: `Finished step: ${msg.step}`,
    });
  }
  if (msg.event === "step_started" && msg.step) {
    dispatch({ type: "SET_STATUS_TEXT", text: `Started: ${msg.step}` });
  }

  if (msg.event === "pipeline_completed") {
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    dispatch({ type: "SET_PROGRESS", progress: 1 });
    dispatch({
      type: "SET_STATUS_TEXT",
      text: "Pipeline completed — loading…",
    });
    onPipelineCompleted();
    return;
  }

  if (msg.event === "pipeline_failed") {
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    onPipelineFailed(msg);
    return;
  }

  if (msg.event === "pipeline_cancelled") {
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    onPipelineCancelled();
  }
}

export function usePipelineOrchestration(
  studyId: string | undefined,
  study: StudyResponse,
  routeState: LocationState,
  locationKey: string,
  navigate: NavigateFunction,
): PipelineState {
  const [state, dispatch] = useReducer(pipelineReducer, initialState);
  const reconnectAttemptedRef = useRef(false);

  useEffect(() => {
    if (!studyId) return;

    let cancelled = false;
    let pipelineFinished = false;
    let disconnect: (() => void) | null = null;

    const isCancelled = () => cancelled;

    const goError = (title: string, message: string, hints: string[]) => {
      dispatch({ type: "SET_ERROR", title, message, hints });
    };

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
        const fresh = await getStudy(studyId);
        if (cancelled) return;
        if (fresh.status === "ready") {
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
        goError("Could not load study after pipeline", msg, errorHints(null));
      }
    };

    if (uploadPayload) {
      const combinedSteps = createLoadingSteps(uploadPayload);
      const hasMask = Boolean(uploadPayload.segmentationFile);
      const totalStepsCount = combinedSteps.length;

      dispatch({ type: "START_UPLOAD", steps: combinedSteps });

      const makeHandler = makeUploadProgressHandler(
        totalStepsCount,
        isCancelled,
        dispatch,
      );

      void (async () => {
        try {
          const baseOnProgress = hasMask
            ? makeHandler(0, null, true)
            : makeHandler(0, 1, false);

          const baseResult = await uploadFile(
            studyId,
            uploadPayload.baseImageFile,
            uploadPayload.baseKind,
            uploadPayload.pipelines,
            baseOnProgress,
          );
          if (cancelled) return;

          if (hasMask) {
            dispatch({ type: "SET_COMPLETED_STEPS", completedSteps: new Set([0]) });
          } else {
            dispatch({
              type: "SET_COMPLETED_STEPS",
              completedSteps: new Set([0, 1]),
            });
          }

          if (uploadPayload.segmentationFile) {
            const maskOnProgress = makeHandler(1, 2, false);
            await uploadFile(
              studyId,
              uploadPayload.segmentationFile,
              UploadKind.NiftiMask,
              [],
              maskOnProgress,
            );
            if (cancelled) return;
            dispatch({
              type: "SET_COMPLETED_STEPS",
              completedSteps: new Set([0, 1, 2]),
            });
          }

          const fromPage = routeState.from ?? "home";

          if (!baseResult.job_id) {
            dispatch({ type: "SET_PROGRESS", progress: 1 });
            dispatch({ type: "SET_CURRENT_STEP_INDEX", index: null });
            dispatch({ type: "SET_STATUS_TEXT", text: "Opening viewer…" });
            navigate(`/visualize/${studyId}`, {
              replace: true,
              state: { from: fromPage },
            });
          } else {
            const uploadPrefixLen = hasMask ? 3 : 2;
            const uploadWeight = uploadPrefixLen / totalStepsCount;
            const idxOffset = uploadPrefixLen;

            dispatch({
              type: "START_RUNNING_AFTER_UPLOAD",
              uploadPrefixLen,
              totalStepsCount,
            });

            disconnect = establishWebsocketConnection(
              baseResult.job_id,
              (msg: PipelineMessage) => {
                applyWsMessage(msg, {
                  uploadWeight,
                  idxOffset,
                  dispatch,
                  getPipelineFinished: () => pipelineFinished,
                  markPipelineFinished: () => {
                    pipelineFinished = true;
                  },
                  disconnect: () => disconnect?.(),
                  onPipelineCompleted: () => void finishOk(),
                  onPipelineFailed: (m) =>
                    goError(
                      "Processing failed",
                      m.error ?? "The pipeline reported a failure.",
                      errorHints(m.failed_step),
                    ),
                  onPipelineCancelled: () =>
                    goError(
                      "Processing cancelled",
                      "The pipeline was cancelled.",
                      CANCELLED_HINTS,
                    ),
                });
              },
              () => {
                if (cancelled || pipelineFinished) return;
                dispatch({
                  type: "SET_STATUS_TEXT",
                  text: "Connection closed — check your network or refresh this page.",
                });
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
        : (study.job_id ?? null);

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

    const idxOffset = 0;
    const uploadWeight = 0;

    void (async () => {
      let stepNames: LoadingStepId[] = [];
      try {
        const fresh = await getStudy(studyId);
        if (cancelled) return;
        stepNames = fresh.steps ?? [];
        dispatch({ type: "SET_STEPS", steps: stepNames });
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

      dispatch({
        type: "START_RUNNING_RECONNECT",
        currentStepIndex: stepNames.length > 0 ? 0 : null,
      });

      disconnect = establishWebsocketConnection(
        jobId,
        (msg: PipelineMessage) => {
          applyWsMessage(msg, {
            uploadWeight,
            idxOffset,
            dispatch,
            getPipelineFinished: () => pipelineFinished,
            markPipelineFinished: () => {
              pipelineFinished = true;
            },
            disconnect: () => disconnect?.(),
            onPipelineCompleted: () => void finishOk(),
            onPipelineFailed: (m) =>
              goError(
                "Processing failed",
                m.error ?? "The pipeline reported a failure.",
                errorHints(m.failed_step),
              ),
            onPipelineCancelled: () =>
              goError(
                "Processing cancelled",
                "The pipeline was cancelled.",
                CANCELLED_HINTS,
              ),
          });
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
              if (s.status === "processing" && !reconnectAttemptedRef.current) {
                reconnectAttemptedRef.current = true;
                dispatch({
                  type: "SET_STATUS_TEXT",
                  text: "Connection closed — check your network or refresh this page.",
                });
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
    locationKey,
    navigate,
  ]);

  return state;
}
