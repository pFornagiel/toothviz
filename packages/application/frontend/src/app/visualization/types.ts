import type { Dispatch, RefObject, SetStateAction } from "react";
import type { FromPage } from "../pipeline";
import type { SliceTypeKey } from "../pages/visualizationConstants";

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

/**
 * Flat context shape consumed by `VisualizationView` and `VisualizationSidebar`
 * via `useVisualization()`; mirrors the sidebar's former props plus the canvas
 * and error-screen needs of the page itself.
 */
export interface VisualizationContextValue {
  // Canvas + lifecycle
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewPhase: ViewPhase;
  statusText: string;
  isVolatile: boolean;

  // Error screen
  errorTitle: string;
  errorMessage: string;
  errorHints: string[];
  errorBackLabel: string;
  onBackFromError: () => void;

  // Layout
  sidebarVisible: boolean;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;

  // Volumes
  volumes: VolumeInfo[];
  volumeVisibility: boolean[];
  onToggleVolumeVisibility: (index: number) => void;
  selectedVolume: number;
  onSelectVolume: (index: number) => void;

  // View layout
  sliceType: SliceTypeKey;
  onSliceTypeChange: (type: SliceTypeKey) => void;

  // Display (active volume)
  colormap: string;
  colormaps: string[];
  onColormapChange: (value: string) => void;
  opacity: number;
  onOpacityChange: (value: number) => void;
  calMin: number;
  calMax: number;
  calMinGlobal: number;
  calMaxGlobal: number;
  onCalMinChange: (value: number) => void;
  onCalMaxChange: (value: number) => void;

  // Scene
  showCrosshair: boolean;
  onToggleCrosshair: () => void;
  crosshairWidth: number;
  onCrosshairWidthChange: (value: number) => void;
  lightBackground: boolean;
  onToggleBackground: () => void;

  // Clip plane
  clipPlaneDepth: number;
  onClipDepthChange: (value: number) => void;
  clipPlaneAzimuth: number;
  onClipAzimuthChange: (value: number) => void;
  clipPlaneElevation: number;
  onClipElevationChange: (value: number) => void;

  // Render view
  showsRender: boolean;
  renderAzimuth: number;
  onRenderAzimuthChange: (value: number) => void;
  renderElevation: number;
  onRenderElevationChange: (value: number) => void;
  renderZoom: number;
  onRenderZoomChange: (value: number) => void;

  onReset: () => void;
}
