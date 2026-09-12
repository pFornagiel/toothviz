import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import useToothSelectionControls from "./hooks/useToothSelectionControls";
import useSceneControls from "./hooks/useSceneControls";
import useClipPlaneControls from "./hooks/useClipPlaneControls";
import useRenderControls from "./hooks/useRenderControls";
import useNiivueViewer from "./hooks/useNiivueViewer";
import useNiivueCanvasWheel from "./hooks/useNiivueCanvasWheel";
import useNiivueDragRotation from "./hooks/useNiivueDragRotation";
import useNiivueTileDoubleClick from "./hooks/useNiivueTileDoubleClick";
import useNiivueToothPick from "./hooks/useNiivueToothPick";
import useNiivueLegendCursor from "./hooks/useNiivueLegendCursor";
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
  const teeth = useToothSelectionControls({ nvRef, queueNvUpdate });
  const scene = useSceneControls({ nvRef });
  const clipPlane = useClipPlaneControls({ nvRef, queueNvUpdate });
  const render = useRenderControls({ nvRef, queueNvUpdate });

  const syncVolumeDisplay = volumeDisplay.syncFromVolumes;
  const syncTeeth = teeth.syncFromVolumes;
  const syncAfterVolumesLoaded = useCallback(
    (nv: NiiVueGPU) => {
      syncVolumeDisplay(nv);
      syncTeeth(nv);
    },
    [syncVolumeDisplay, syncTeeth],
  );

  // Global reset
  const resetSettings = () => {
    volumeDisplay.reset();
    teeth.reset();
    render.reset();
    clipPlane.reset();
    scene.reset();
    viewLayout.reset();
  };

  const viewer = useNiivueViewer({
    studyId,
    routeState,
    canvasRef,
    nvRef,
    configureNv: render.configureNv,
    onVolumesLoaded: syncAfterVolumesLoaded,
  });

  const previewEnabled =
    Boolean(studyId) &&
    routeState.previewWhileProcessing === true &&
    viewer.viewPhase !== ViewPhase.Error;

  const { processingNotice } = useProcessingPreview({
    studyId,
    nvRef,
    enabled: previewEnabled,
    onOverlayLoaded: syncAfterVolumesLoaded,
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

  useNiivueTileDoubleClick({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    sliceType: viewLayout.sliceType,
    handleSliceTypeChange: viewLayout.handleSliceTypeChange,
  });

  const maskVisible =
    teeth.overlayIndex >= 0 && (volumeDisplay.volumeVisibility[teeth.overlayIndex] ?? true);
  const pickCursor =
    teeth.pickFromPreview && teeth.hasToothLabels && maskVisible ? "cell" : "";
  const busyCursor = teeth.pickModePending ? "wait" : "";

  useNiivueToothPick({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    enabled: Boolean(pickCursor) && !teeth.pickModePending,
    overlayIndex: teeth.overlayIndex,
    presentToothIds: teeth.presentToothIds,
    toggleToothFromPreview: teeth.toggleToothFromPreview,
  });

  useNiivueLegendCursor({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    enabled: teeth.hasToothLabels && maskVisible && !teeth.pickModePending,
    pickCursor: busyCursor || pickCursor,
    lightBackground: scene.lightBackground,
  });

  // Busy wait cursor over the app while the overlay colormap is applying.
  useEffect(() => {
    if (!teeth.pickModePending) {
      return;
    }
    const root = document.documentElement;
    const canvas = canvasRef.current;
    root.classList.add("toothviz-busy");
    if (canvas) {
      canvas.style.cursor = "wait";
    }
    return () => {
      root.classList.remove("toothviz-busy");
      if (canvas) {
        canvas.style.cursor = pickCursor || "";
      }
    };
  }, [teeth.pickModePending, pickCursor, canvasRef]);

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
    teeth,
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
