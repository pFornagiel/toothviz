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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum FromPage {
  Home = "home",
  Browse = "browse",
}

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

export interface PipelineState {
  steps: LoadingStepId[];
  completedSteps: Set<number>;
  currentStepIndex: number | null;
  progress: number | null;
  statusText: string;
  error: { title: string; message: string; hints: string[] } | null;
}

export const initialState: PipelineState = {
  steps: [],
  completedSteps: new Set(),
  currentStepIndex: null,
  progress: 0,
  statusText: "Connecting…",
  error: null,
};

// ---------------------------------------------------------------------------
// Reducer — semantic, event-shaped actions. All progress math lives here.
// `totalStepsCount` is derived from `state.steps.length` (the `combinedSteps`
// length set by START_UPLOAD), so it never has to be threaded through actions.
// ---------------------------------------------------------------------------

export enum PipelineActionType {
  SetSteps = "SET_STEPS",
  SetError = "SET_ERROR",
  StartUpload = "START_UPLOAD",
  StartRunningAfterUpload = "START_RUNNING_AFTER_UPLOAD",
  StartRunningReconnect = "START_RUNNING_RECONNECT",
  UploadProgress = "UPLOAD_PROGRESS",
  PipelineUpdate = "PIPELINE_UPDATE",
  MarkUploadStepsDone = "MARK_UPLOAD_STEPS_DONE",
  UploadDoneNoPipeline = "UPLOAD_DONE_NO_PIPELINE",
  PipelineCompletedPending = "PIPELINE_COMPLETED_PENDING",
  ConnectionClosed = "CONNECTION_CLOSED",
}

export type PipelineAction =
  | { type: PipelineActionType.SetSteps; steps: LoadingStepId[] }
  | { type: PipelineActionType.SetError; title: string; message: string; hints: string[] }
  | { type: PipelineActionType.StartUpload; steps: LoadingStepId[] }
  | { type: PipelineActionType.StartRunningAfterUpload; uploadPrefixLen: number }
  | { type: PipelineActionType.StartRunningReconnect; currentStepIndex: number | null }
  | {
      // One chunked-upload progress event. The reducer turns the raw
      // `UploadProgress` + step layout into currentStepIndex/statusText/progress.
      type: PipelineActionType.UploadProgress;
      upload: UploadProgress;
      uploadStepIdx: number;
      finalizeStepIdx: number | null;
      volumeFinalizeOnSameStep: boolean;
    }
  | {
      // One non-terminal pipeline WebSocket message. The reducer blends the
      // pipeline progress over the upload weight and shifts step indices.
      type: PipelineActionType.PipelineUpdate;
      msg: PipelineMessage;
      uploadWeight: number;
      idxOffset: number;
    }
  | { type: PipelineActionType.MarkUploadStepsDone; upTo: number }
  | { type: PipelineActionType.UploadDoneNoPipeline }
  | { type: PipelineActionType.PipelineCompletedPending }
  | { type: PipelineActionType.ConnectionClosed };

const CONNECTION_CLOSED_TEXT =
  "Connection closed — check your network or refresh this page.";

export function pipelineReducer(
  state: PipelineState,
  action: PipelineAction,
): PipelineState {
  switch (action.type) {
    case PipelineActionType.SetSteps:
      return { ...state, steps: action.steps };

    case PipelineActionType.SetError:
      return {
        ...state,
        error: {
          title: action.title,
          message: action.message,
          hints: action.hints,
        },
      };

    case PipelineActionType.StartUpload:
      return {
        ...state,
        steps: action.steps,
        completedSteps: new Set(),
        currentStepIndex: 0,
        progress: 0,
        statusText: "Starting upload…",
        error: null,
      };

    case PipelineActionType.StartRunningAfterUpload: {
      const total = state.steps.length;
      const w =
        action.uploadPrefixLen > 0 ? action.uploadPrefixLen / total : 0;
      return {
        ...state,
        currentStepIndex: action.uploadPrefixLen,
        progress: w,
        statusText: "Pipeline running…",
      };
    }

    case PipelineActionType.StartRunningReconnect:
      return {
        ...state,
        statusText: "Pipeline running…",
        progress: 0,
        completedSteps: new Set(),
        currentStepIndex: action.currentStepIndex,
      };

    case PipelineActionType.UploadProgress: {
      const total = state.steps.length;
      const { upload, uploadStepIdx, finalizeStepIdx, volumeFinalizeOnSameStep } =
        action;

      if (upload.phase === "begin") {
        return {
          ...state,
          currentStepIndex: uploadStepIdx,
          statusText: "Starting upload…",
          progress: uploadStepIdx / total,
        };
      }

      if (upload.phase === "uploading" && upload.totalChunks) {
        const i = (upload.chunkIndex ?? 0) + 1;
        return {
          ...state,
          currentStepIndex: uploadStepIdx,
          statusText: `Uploading chunks ${i} / ${upload.totalChunks}`,
          progress: Math.min(
            1,
            uploadStepIdx / total + (i / upload.totalChunks) * (1 / total),
          ),
        };
      }

      if (upload.phase === "finalizing") {
        if (volumeFinalizeOnSameStep) {
          return {
            ...state,
            currentStepIndex: uploadStepIdx,
            statusText: "Finalizing upload...",
            progress: Math.min(1, (uploadStepIdx + 0.9) / total),
          };
        }
        if (finalizeStepIdx != null) {
          return {
            ...state,
            currentStepIndex: finalizeStepIdx,
            statusText: "Finalizing upload...",
            progress: (finalizeStepIdx + 0.5) / total,
          };
        }
        return state;
      }

      if (upload.phase === "done") {
        const progress =
          finalizeStepIdx != null && !volumeFinalizeOnSameStep
            ? (finalizeStepIdx + 1) / total
            : (uploadStepIdx + 1) / total;
        return { ...state, progress };
      }

      return state;
    }

    case PipelineActionType.PipelineUpdate: {
      const { msg, uploadWeight, idxOffset } = action;
      let next = state;

      const p = clamp01(msg.progress);
      if (p != null) {
        next = { ...next, progress: uploadWeight + p * (1 - uploadWeight) };
      }
      if (msg.step_index != null) {
        next = { ...next, currentStepIndex: msg.step_index + idxOffset };
      }
      if (msg.event === "step_completed" && msg.step_index != null) {
        const completedSteps = new Set(next.completedSteps);
        completedSteps.add(msg.step_index + idxOffset);
        next = {
          ...next,
          completedSteps,
          statusText: `Finished step: ${msg.step}`,
        };
      }
      if (msg.event === "step_started" && msg.step) {
        next = { ...next, statusText: `Started: ${msg.step}` };
      }
      return next;
    }

    case PipelineActionType.MarkUploadStepsDone: {
      const completedSteps = new Set<number>();
      for (let i = 0; i <= action.upTo; i++) completedSteps.add(i);
      return { ...state, completedSteps };
    }

    case PipelineActionType.UploadDoneNoPipeline:
      return {
        ...state,
        progress: 1,
        currentStepIndex: null,
        statusText: "Opening viewer…",
      };

    case PipelineActionType.PipelineCompletedPending:
      return {
        ...state,
        progress: 1,
        statusText: "Pipeline completed — loading…",
      };

    case PipelineActionType.ConnectionClosed:
      return { ...state, statusText: CONNECTION_CLOSED_TEXT };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Upload progress handler — de-curried. All arithmetic lives in the reducer;
// the handler only guards on cancellation and dispatches a single event.
// ---------------------------------------------------------------------------

export function makeUploadProgressHandler(
  dispatch: Dispatch<PipelineAction>,
  isCancelled: () => boolean,
) {
  return function makeHandler(
    uploadStepIdx: number,
    finalizeStepIdx: number | null,
    volumeFinalizeOnSameStep: boolean,
  ): (p: UploadProgress) => void {
    return (p: UploadProgress) => {
      if (isCancelled()) return;
      dispatch({
        type: PipelineActionType.UploadProgress,
        upload: p,
        uploadStepIdx,
        finalizeStepIdx,
        volumeFinalizeOnSameStep,
      });
    };
  };
}

// ---------------------------------------------------------------------------
// WebSocket message handling — shared by the upload and reconnect flows.
// Terminal events drive the side-effect callbacks; non-terminal events emit a
// single PIPELINE_UPDATE dispatch.
// ---------------------------------------------------------------------------

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
  if (msg.event === "pipeline_completed") {
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    dispatch({ type: PipelineActionType.PipelineCompletedPending });
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
    return;
  }

  dispatch({ type: PipelineActionType.PipelineUpdate, msg, uploadWeight, idxOffset });
}

// ---------------------------------------------------------------------------
// Flow controller + WS wiring helpers
// ---------------------------------------------------------------------------

/** Mutable controller shared by both execution flows. */
interface FlowCtx {
  studyId: string;
  study: StudyResponse;
  routeState: LocationState;
  navigate: NavigateFunction;
  dispatch: Dispatch<PipelineAction>;
  reconnectAttemptedRef: { current: boolean };
  isCancelled: () => boolean;
  isFinished: () => boolean;
  markFinished: () => void;
  setDisconnect: (fn: (() => void) | null) => void;
  disconnect: () => void;
  goError: (title: string, message: string, hints: string[]) => void;
  finishOk: () => Promise<void>;
}

interface PipelineConnectOptions {
  uploadWeight: number;
  idxOffset: number;
}

/** The shared terminal-event callbacks used by both flows. */
export function buildPipelineCallbacks(ctx: FlowCtx) {
  return {
    onPipelineCompleted: () => void ctx.finishOk(),
    onPipelineFailed: (m: PipelineMessage) =>
      ctx.goError(
        "Processing failed",
        m.error ?? "The pipeline reported a failure.",
        errorHints(m.failed_step),
      ),
    onPipelineCancelled: () =>
      ctx.goError(
        "Processing cancelled",
        "The pipeline was cancelled.",
        CANCELLED_HINTS,
      ),
  };
}

/**
 * Opens the pipeline WebSocket, routes every message through `applyWsMessage`,
 * registers the disconnect fn on the controller, and wires the given onClose.
 */
export function connectPipeline(
  jobId: string,
  ctx: FlowCtx,
  { uploadWeight, idxOffset }: PipelineConnectOptions,
  onClose: () => void,
): () => void {
  const disconnect = establishWebsocketConnection(
    jobId,
    (msg: PipelineMessage) =>
      applyWsMessage(msg, {
        uploadWeight,
        idxOffset,
        dispatch: ctx.dispatch,
        getPipelineFinished: ctx.isFinished,
        markPipelineFinished: ctx.markFinished,
        disconnect: ctx.disconnect,
        ...buildPipelineCallbacks(ctx),
      }),
    onClose,
  );
  ctx.setDisconnect(disconnect);
  return disconnect;
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

/** Fresh upload → (optional mask upload) → pipeline run over the WebSocket. */
export async function runUploadFlow(
  ctx: FlowCtx,
  uploadPayload: UploadPayload,
): Promise<void> {
  const { studyId, routeState, navigate, dispatch } = ctx;
  const combinedSteps = createLoadingSteps(uploadPayload);
  const hasMask = Boolean(uploadPayload.segmentationFile);
  const totalStepsCount = combinedSteps.length;

  dispatch({ type: PipelineActionType.StartUpload, steps: combinedSteps });

  const makeHandler = makeUploadProgressHandler(dispatch, ctx.isCancelled);

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
    if (ctx.isCancelled()) return;

    dispatch({ type: PipelineActionType.MarkUploadStepsDone, upTo: hasMask ? 0 : 1 });

    if (uploadPayload.segmentationFile) {
      const maskOnProgress = makeHandler(1, 2, false);
      await uploadFile(
        studyId,
        uploadPayload.segmentationFile,
        UploadKind.NiftiMask,
        [],
        maskOnProgress,
      );
      if (ctx.isCancelled()) return;
      dispatch({ type: PipelineActionType.MarkUploadStepsDone, upTo: 2 });
    }

    const fromPage = routeState.from ?? FromPage.Home;

    if (!baseResult.job_id) {
      dispatch({ type: PipelineActionType.UploadDoneNoPipeline });
      navigate(`/visualize/${studyId}`, {
        replace: true,
        state: { from: fromPage },
      });
      return;
    }

    const uploadPrefixLen = hasMask ? 3 : 2;
    const uploadWeight = uploadPrefixLen / totalStepsCount;
    const idxOffset = uploadPrefixLen;

    dispatch({ type: PipelineActionType.StartRunningAfterUpload, uploadPrefixLen });

    connectPipeline(baseResult.job_id, ctx, { uploadWeight, idxOffset }, () => {
      if (ctx.isCancelled() || ctx.isFinished()) return;
      dispatch({ type: PipelineActionType.ConnectionClosed });
    });
  } catch (err: unknown) {
    if (ctx.isCancelled()) return;
    try {
      await deleteStudy(studyId);
    } catch {
      /* best-effort */
    }
    const msg = err instanceof Error ? err.message : String(err);
    ctx.goError("Upload failed", msg, errorHints(null));
  }
}

/** Reconnect to an in-flight pipeline after a reload. */
export async function runReconnectFlow(
  ctx: FlowCtx,
  jobId: string,
): Promise<void> {
  const { studyId, dispatch } = ctx;
  const idxOffset = 0;
  const uploadWeight = 0;

  let stepNames: LoadingStepId[] = [];
  try {
    const fresh = await getStudy(studyId);
    if (ctx.isCancelled()) return;
    stepNames = fresh.steps ?? [];
    dispatch({ type: PipelineActionType.SetSteps, steps: stepNames });
  } catch (e: unknown) {
    if (ctx.isCancelled()) return;
    if (e instanceof ApiError && e.status === 404) {
      ctx.goError(
        "Study not found",
        "Processing may have failed and the study was removed.",
        errorHints(null),
      );
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    ctx.goError("Could not load study", msg, errorHints(null));
    return;
  }

  if (ctx.isCancelled()) return;

  dispatch({
    type: PipelineActionType.StartRunningReconnect,
    currentStepIndex: stepNames.length > 0 ? 0 : null,
  });

  connectPipeline(jobId, ctx, { uploadWeight, idxOffset }, () => {
    if (ctx.isCancelled() || ctx.isFinished()) return;
    void (async () => {
      try {
        await ctx.finishOk();
      } catch {
        /* finishOk handles errors */
      }
      try {
        const s = await getStudy(studyId);
        if (s.status === "processing" && !ctx.reconnectAttemptedRef.current) {
          ctx.reconnectAttemptedRef.current = true;
          dispatch({ type: PipelineActionType.ConnectionClosed });
        }
      } catch (e: unknown) {
        if (e instanceof ApiError && e.status === 404) {
          ctx.goError(
            "Study not found",
            "Processing may have failed and the study was removed.",
            errorHints(null),
          );
        }
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

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

    const goError = (title: string, message: string, hints: string[]) => {
      dispatch({ type: PipelineActionType.SetError, title, message, hints });
    };

    const finishOk = async () => {
      try {
        const fresh = await getStudy(studyId);
        if (cancelled) return;
        if (fresh.status === "ready") {
          navigate(`/visualize/${studyId}`, {
            state: { from: routeState.from ?? FromPage.Home },
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

    const ctx: FlowCtx = {
      studyId,
      study,
      routeState,
      navigate,
      dispatch,
      reconnectAttemptedRef,
      isCancelled: () => cancelled,
      isFinished: () => pipelineFinished,
      markFinished: () => {
        pipelineFinished = true;
      },
      setDisconnect: (fn) => {
        disconnect = fn;
      },
      disconnect: () => disconnect?.(),
      goError,
      finishOk,
    };

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

    const uploadPayload = routeState.uploadPayload;
    if (uploadPayload) {
      void runUploadFlow(ctx, uploadPayload);
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

    void runReconnectFlow(ctx, jobId);

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
