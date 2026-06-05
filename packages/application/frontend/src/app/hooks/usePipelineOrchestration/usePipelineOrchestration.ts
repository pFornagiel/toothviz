import { useEffect, useReducer, useRef } from "react";
import type { NavigateFunction } from "react-router";
import { getStudy } from "@/api/studies";
import { ApiError } from "@/api/client";
import type { StudyResponse } from "@/api/types";
import {
  FromPage,
  initialState,
  type LocationState,
  type PipelineState,
} from "./types";
import { PipelineActionType, pipelineReducer } from "./reducer";
import { errorHints } from "./errorHints";
import { runReconnectFlow, runUploadFlow, type FlowCtx } from "./flows";

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
