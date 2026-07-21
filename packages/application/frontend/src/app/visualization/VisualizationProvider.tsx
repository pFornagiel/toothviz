import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { FromPage } from "../pipeline";
import useNvUpdateQueue from "./hooks/useNvUpdateQueue";
import useViewLayoutControls from "./hooks/useViewLayoutControls";
import useVolumeDisplayControls from "./hooks/useVolumeDisplayControls";
import useSceneControls from "./hooks/useSceneControls";
import useClipPlaneControls from "./hooks/useClipPlaneControls";
import useRenderControls from "./hooks/useRenderControls";
import useNiivueViewer from "./hooks/useNiivueViewer";
import useNiivueCanvasWheel from "./hooks/useNiivueCanvasWheel";
import useNiivueDragRotation from "./hooks/useNiivueDragRotation";
import useProcessingPreview from "./hooks/useProcessingPreview";
import type { VisualizationContextValue, VisualizationLocationState } from "./types";
import { ViewPhase } from "./types";

const VisualizationContext = createContext<VisualizationContextValue | null>(null);

/**
 * Owns the niivue/canvas refs, initializes a single nvUpdateQueue for performance,
 * exposes the result via `useVisualization()`.
 */
export function VisualizationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  // Memoised so the volatile loading effect (which depends on routeState) does
  // not re-run on unrelated re-renders.
  const routeState = useMemo(
    () => (location.state ?? {}) as VisualizationLocationState,
    [location.state],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<NiiVueGPU | null>(null);

  // UI state
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // Single queue instance shared by every hook 
  const queueNvUpdate = useNvUpdateQueue();

  // Control state hooks
  const viewLayout = useViewLayoutControls({ nvRef });
  const volumeDisplay = useVolumeDisplayControls({ nvRef, queueNvUpdate });
  const scene = useSceneControls({ nvRef });
  const clipPlane = useClipPlaneControls({ nvRef, queueNvUpdate });
  const render = useRenderControls({ nvRef, queueNvUpdate });

  // Global reset
  const resetSettings = () => {
    volumeDisplay.reset();
    render.reset();
  };

  const viewer = useNiivueViewer({
    studyId,
    routeState,
    canvasRef,
    nvRef,
    configureNv: render.configureNv,
    onVolumesLoaded: volumeDisplay.syncFromVolumes,
  });

  const previewEnabled =
    Boolean(studyId) &&
    routeState.previewWhileProcessing === true &&
    viewer.viewPhase !== ViewPhase.Error;

  const { processingNotice } = useProcessingPreview({
    studyId,
    nvRef,
    enabled: previewEnabled,
    onOverlayLoaded: volumeDisplay.syncFromVolumes,
  });

  // Wire the mouse-wheel interaction and sync with react state
  useNiivueCanvasWheel({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    setClipPlaneDepth: clipPlane.setClipPlaneDepth,
    setRenderZoom: render.setRenderZoom,
  });

  useNiivueDragRotation({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    dragRotate: render.dragRotate,
  });

  const handleBackFromError = useCallback(() => {
    const from = routeState.from ?? FromPage.Home;
    if (from === FromPage.Browse) {
      navigate("/browse");
    } else {
      navigate("/");
    }
  }, [navigate, routeState.from]);

  const handleReturnToProgress = useCallback(() => {
    if (!studyId) {
      return;
    }
    navigate(`/pipeline/${studyId}`, {
      state: {
        from: routeState.from ?? FromPage.Home,
        volumePreviewFileId: routeState.volumeFileId ?? null,
      },
    });
  }, [navigate, studyId, routeState.from, routeState.volumeFileId]);

  // Read from the ref each render on purpose: niivue mutates its volume list
  // outside React state, and the page re-renders often enough to stay fresh.
  const volumeList = nvRef.current?.volumes ?? [];

  // Not memoised: the sidebar re-renders on every page render
  // and memoising the value would change that.
  const value: VisualizationContextValue = {
    canvasRef,
    viewer: {
      viewPhase: viewer.viewPhase,
      statusText: viewer.statusText,
      errorTitle: viewer.errorTitle,
      errorMessage: viewer.errorMessage,
      errorHints: viewer.errorHints,
      isVolatile: !studyId,
      errorBackLabel: routeState.from === FromPage.Browse ? "Back to studies" : "Back to home",
      onBackFromError: handleBackFromError,
      processingNotice,
      onReturnToProgress: handleReturnToProgress,
    },
    layout: { sidebarVisible, setSidebarVisible },
    volumes: volumeList.map((v) => ({ name: v.name })),
    view: viewLayout,
    display: volumeDisplay,
    scene,
    clip: clipPlane,
    render,
    onReset: resetSettings,
  };

  return <VisualizationContext.Provider value={value}>{children}</VisualizationContext.Provider>;
}

export function useVisualization(): VisualizationContextValue {
  const ctx = useContext(VisualizationContext);
  if (!ctx) {
    throw new Error("useVisualization must be used within a VisualizationProvider");
  }
  return ctx;
}
