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
import type { VisualizationContextValue, VisualizationLocationState } from "./types";

const VisualizationContext = createContext<VisualizationContextValue | null>(null);

/**
 * Context boundary for the visualization page. Reads the route, owns the
 * niivue/canvas refs, and composes the viewer-lifecycle, control-state and
 * wheel-interaction hooks around a single per-frame update queue, exposing the
 * result to descendants via `useVisualization()`.
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

  // Single queue instance shared by every control hook that pokes niivue — a
  // lone instance is what lets resetSettings' cal/zoom updates flush in one
  // frame. See useNvUpdateQueue.
  const queueNvUpdate = useNvUpdateQueue();

  // Control state, split by domain. Each hook owns one slice and pushes it into
  // the shared niivue instance; the provider just composes them.
  const viewLayout = useViewLayoutControls({ nvRef });
  const volumeDisplay = useVolumeDisplayControls({ nvRef, queueNvUpdate });
  const scene = useSceneControls({ nvRef });
  const clipPlane = useClipPlaneControls({ nvRef, queueNvUpdate });
  const render = useRenderControls({ nvRef, queueNvUpdate });

  // Page-wide reset folds in the only two domains with reset semantics; scene
  // and clip-plane settings are deliberately left untouched.
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

  // Read from the ref each render on purpose: niivue mutates its volume list
  // outside React state, and the page re-renders often enough to stay fresh.
  const volumeList = nvRef.current?.volumes ?? [];

  // Deliberately not memoised: the sidebar re-renders on every page render
  // today, and memoising the value would change that.
  //
  // Grouped by domain — each control group is the verbatim hook return, so the
  // sidebar reads e.g. `display.colormap` straight off the hook that owns it.
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
