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
import useNvUpdateQueue from "../hooks/useNvUpdateQueue";
import useNiivueControls from "../hooks/useNiivueControls";
import useNiivueViewer from "../hooks/useNiivueViewer";
import useNiivueCanvasWheel from "../hooks/useNiivueCanvasWheel";
import useNiivueDragRotation from "../hooks/useNiivueDragRotation";
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

  // Single queue instance shared by every hook that pokes niivue — see useNvUpdateQueue.
  const queueNvUpdate = useNvUpdateQueue();
  const controls = useNiivueControls({ nvRef, queueNvUpdate });
  const viewer = useNiivueViewer({
    studyId,
    routeState,
    canvasRef,
    nvRef,
    configureNv: controls.configureNv,
    onVolumesLoaded: controls.syncFromVolumes,
  });
  useNiivueCanvasWheel({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    setClipPlaneDepth: controls.setClipPlaneDepth,
    setRenderZoom: controls.setRenderZoom,
  });
  useNiivueDragRotation({
    canvasRef,
    nvRef,
    viewPhase: viewer.viewPhase,
    dragRotate: controls.dragRotate,
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
  const value: VisualizationContextValue = {
    canvasRef,
    viewPhase: viewer.viewPhase,
    statusText: viewer.statusText,
    isVolatile: !studyId,

    errorTitle: viewer.errorTitle,
    errorMessage: viewer.errorMessage,
    errorHints: viewer.errorHints,
    errorBackLabel: routeState.from === FromPage.Browse ? "Back to studies" : "Back to home",
    onBackFromError: handleBackFromError,

    sidebarVisible,
    setSidebarVisible,

    volumes: volumeList.map((v) => ({ name: v.name })),
    volumeVisibility: controls.volumeVisibility,
    onToggleVolumeVisibility: controls.handleVolumeVisibilityToggle,
    selectedVolume: controls.selectedVolume,
    onSelectVolume: controls.handleVolumeChange,

    sliceType: controls.sliceType,
    onSliceTypeChange: controls.handleSliceTypeChange,

    colormap: controls.colormap,
    colormaps: controls.colormaps,
    onColormapChange: controls.handleColormapChange,
    opacity: controls.opacity,
    onOpacityChange: controls.handleOpacityChange,
    calMin: controls.cal_min,
    calMax: controls.cal_max,
    calMinGlobal: controls.cal_minGlobal,
    calMaxGlobal: controls.cal_maxGlobal,
    onCalMinChange: controls.handleCalMinChange,
    onCalMaxChange: controls.handleCalMaxChange,

    showCrosshair: controls.showCrosshair,
    onToggleCrosshair: controls.handleCrosshairToggle,
    crosshairWidth: controls.crosshairWidth,
    onCrosshairWidthChange: controls.handleCrosshairWidthChange,
    lightBackground: controls.lightBackground,
    onToggleBackground: controls.handleBackgroundToggle,

    clipPlaneDepth: controls.clipPlaneDepth,
    onClipDepthChange: controls.setClipPlaneDepth,
    clipPlaneAzimuth: controls.clipPlaneAzimuth,
    onClipAzimuthChange: controls.setClipPlaneAzimuth,
    clipPlaneElevation: controls.clipPlaneElevation,
    onClipElevationChange: controls.setClipPlaneElevation,

    showsRender: controls.showsRender,
    renderAzimuth: controls.renderAzimuth,
    onRenderAzimuthChange: controls.handleRenderAzimuthChange,
    renderElevation: controls.renderElevation,
    onRenderElevationChange: controls.handleRenderElevationChange,
    renderZoom: controls.renderZoom,
    onRenderZoomChange: controls.handleRenderZoomChange,

    onReset: controls.resetSettings,
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
