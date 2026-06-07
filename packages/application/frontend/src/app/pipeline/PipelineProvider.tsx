import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useLoaderData } from "react-router";
import { deleteStudy, getStudy } from "@/api/studies";
import { uploadFile } from "@/api/upload";
import { establishWebsocketConnection } from "@/api/ws";
import type { StudyResponse } from "@/api/types";
import { initialState, type LocationState, type PipelineContextValue } from "./types";
import { pipelineReducer } from "./reducer";
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
  const engineRef = useRef<PipelineEngine | null>(null);

  useEffect(() => {
    if (!studyId) {
      return;
    }

    const api: PipelineApi = {
      getStudy,
      deleteStudy,
      uploadFile,
      establishWebsocketConnection,
    };
    const engine = new PipelineEngine({
      dispatch,
      api,
      onNavigateToViewer: (id, { from, volumeFileId, overlayFileId }) =>
        navigate(`/visualize/${id}`, {
          state: { from, volumeFileId, overlayFileId },
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
    location.key,
    navigate,
  ]);

  return <PipelineContext.Provider value={state}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) {
    throw new Error("usePipeline must be used within a PipelineProvider");
  }
  return ctx;
}
