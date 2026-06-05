import type { Dispatch } from "react";
import type { NavigateFunction } from "react-router";
import { deleteStudy, getStudy } from "@/api/studies";
import { uploadFile } from "@/api/upload";
import { establishWebsocketConnection } from "@/api/ws";
import { ApiError } from "@/api/client";
import {
  UploadKind,
  type LoadingStepId,
  type PipelineMessage,
  type StudyResponse,
} from "@/api/types";
import { FromPage, type LocationState, type UploadPayload } from "./types";
import { PipelineActionType, type PipelineAction } from "./reducer";
import { createLoadingSteps } from "./steps";
import { CANCELLED_HINTS, errorHints } from "./errorHints";
import { makeUploadProgressHandler } from "./uploadProgress";
import { applyWsMessage } from "./wsMessage";

// ---------------------------------------------------------------------------
// Flow controller + WS wiring helpers
// ---------------------------------------------------------------------------

/** Mutable controller shared by both execution flows. */
export interface FlowCtx {
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
