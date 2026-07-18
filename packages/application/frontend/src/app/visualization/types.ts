import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ProcessingNotice } from "../pages/screens/ProcessingNoticeBar";
import type { FromPage } from "../pipeline";
import type { NiivueViewerState } from "./hooks/useNiivueViewer";
import type { ViewLayoutControls } from "./hooks/useViewLayoutControls";
import type { VolumeDisplayControls } from "./hooks/useVolumeDisplayControls";
import type { SceneControls } from "./hooks/useSceneControls";
import type { ClipPlaneControls } from "./hooks/useClipPlaneControls";
import type { RenderControls } from "./hooks/useRenderControls";

// Lifecycle phase of the visualization view
export enum ViewPhase {
  Loading = "loading",
  Ready = "ready",
  Error = "error",
}

// Router location state passed when navigating to the visualization page
export interface VisualizationLocationState {
  primary?: File;
  mask?: File;
  from?: FromPage;
  volumeFileId?: string | null;
  overlayFileId?: string | null;
  /** Open volume-only while the pipeline is still running. */
  previewWhileProcessing?: boolean;
}

export interface VolumeInfo {
  name: string;
}

/** Viewer lifecycle + error-screen state, surfaced to the page shell. */
export interface ViewerInfo extends NiivueViewerState {
  isVolatile: boolean;
  errorBackLabel: string;
  onBackFromError: () => void;
  processingNotice: ProcessingNotice;
  onReturnToProgress: () => void;
}

/** Sidebar show/hide, owned by the provider. */
export interface LayoutControls {
  sidebarVisible: boolean;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;
}

/**
 * Domain-grouped context exposed via `useVisualization()`. Each control group
 * is tied to a hook, so the names match the hook that owns them.
 */
export interface VisualizationContextValue {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewer: ViewerInfo;
  layout: LayoutControls;
  /** Loaded volumes, read off the niivue instance each render. */
  volumes: VolumeInfo[];
  view: ViewLayoutControls;
  display: VolumeDisplayControls;
  scene: SceneControls;
  clip: ClipPlaneControls;
  render: RenderControls;
  onReset: () => void;
}
