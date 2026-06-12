import type { Dispatch, RefObject, SetStateAction } from "react";
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
}

export interface VolumeInfo {
  name: string;
}

/** Viewer lifecycle + error-screen state, surfaced to the page shell. */
export interface ViewerInfo extends NiivueViewerState {
  isVolatile: boolean;
  errorBackLabel: string;
  onBackFromError: () => void;
}

/** Sidebar show/hide, owned by the provider. */
export interface LayoutControls {
  sidebarVisible: boolean;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;
}

/**
 * Domain-grouped context exposed via `useVisualization()`. Each control group
 * is the verbatim return of its hook (`useViewLayoutControls`,
 * `useVolumeDisplayControls`, …), so the names match the hook that owns them and
 * there's no translation layer to cross-reference. A few fields on those groups
 * (`render.configureNv`, `display.syncFromVolumes`, the per-group `reset`s) are
 * provider↔hook wiring rather than consumer API — the provider uses them; the
 * sidebar ignores them.
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
