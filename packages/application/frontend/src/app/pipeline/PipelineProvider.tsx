import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useLoaderData } from "react-router";
import { deleteStudy, getStudy, listFiles, retryStudyPipeline } from "@/api/studies";
import { uploadFile } from "@/api/upload";
import { establishWebsocketConnection } from "@/api/ws";
import type { StudyResponse } from "@/api/types";
import { initialState, type LocationState, type PipelineContextValue } from "./types";
import { PipelineActionType, pipelineReducer } from "./reducer";
import { PipelineEngine, type PipelineApi } from "./pipelineEngine";

const PipelineContext = createContext<PipelineContextValue | null>(null);

/**
 * Context boundary for the study-processing lifecycle. Reads the router state,
 * owns a `PipelineEngine`, and exposes the reducer state to descendants via `usePipeline()`.
 */
export function PipelineProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const routeState = (location.state ?? {}) as LocationState;
  const study = useLoaderData() as StudyResponse;

  const [state, dispatch] = useReducer(pipelineReducer, initialState);
  const [retrying, setRetrying] = useState(false);
  const engineRef = useRef<PipelineEngine | null>(null);

  useEffect(() => {
    if (!studyId) {
      return;
    }

    if (routeState.volumePreviewFileId) {
      dispatch({
        type: PipelineActionType.SetVolumePreview,
        fileId: routeState.volumePreviewFileId,
      });
    }

    const api: PipelineApi = {
      getStudy,
      deleteStudy,
      uploadFile,
      listFiles,
      retryPipeline: retryStudyPipeline,
      establishWebsocketConnection,
    };
    const engine = new PipelineEngine({
      dispatch,
      api,
      onNavigateToViewer: (id, { from, volumeFileId, overlayFileId, previewWhileProcessing }) =>
        navigate(`/visualize/${id}`, {
          state: { from, volumeFileId, overlayFileId, previewWhileProcessing },
          replace: true,
        }),
    });
    engineRef.current = engine;
    engine.start({ studyId, study, routeState });

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // Same trigger set as the original hook effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    studyId,
    study,
    study.status,
    study.job_id,
    routeState.uploadPayload,
    routeState.from,
    routeState.volumePreviewFileId,
    location.key,
    navigate,
  ]);

  const retryFailedPipeline = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || retrying) {
      return;
    }
    setRetrying(true);
    void engine.retryFailedPipeline().finally(() => setRetrying(false));
  }, [retrying]);

  const canRetry = Boolean(state.error && study.source_file_id);

  return (
    <PipelineContext.Provider
      value={{
        ...state,
        canRetry,
        retryFailedPipeline: canRetry ? retryFailedPipeline : undefined,
      }}
    >
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) {
    throw new Error("usePipeline must be used within a PipelineProvider");
  }
  return ctx;
}
