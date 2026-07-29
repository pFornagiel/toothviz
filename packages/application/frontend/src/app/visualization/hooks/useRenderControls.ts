import { useCallback, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import useNiivueSyncedRotation from "./useNiivueSyncedRotation";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { RENDER_ZOOM_RANGE, DEFAULT_RENDER_ZOOM } from "../constants";
import { clamp } from "../../utils/clamp";
import { setUnifiedZoom } from "./niivueZoom";

export interface RenderControls {
  renderAzimuth: number;
  handleRenderAzimuthChange: (value: number) => void;
  renderElevation: number;
  handleRenderElevationChange: (value: number) => void;
  renderZoom: number;
  handleRenderZoomChange: (value: number) => void;
  setRenderZoom: (value: number) => void;

  // Drag rotation, driven by the canvas drag-interaction hook
  dragRotate: (dx: number, dy: number) => void;

  /** Wires niivue → React rotation callbacks on a freshly created instance. */
  configureNv: (nv: NiiVueGPU) => void;
  /** Restores azimuth/elevation/zoom to their defaults. */
  reset: () => void;
}

/**
 * 3D render-view orientation (azimuth/elevation via `useNiivueSyncedRotation`)
 * and zoom. Owns the niivue rotation wiring (`configureNv`) and a `reset` that
 * the provider folds into the page-wide `resetSettings`.
 */
export default function useRenderControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): RenderControls {
  const {
    azimuth: renderAzimuth,
    elevation: renderElevation,
    attach: attachRotation,
    setRotation,
    dragRotate,
    resetRotation,
  } = useNiivueSyncedRotation(nvRef);

  const [renderZoom, setRenderZoom] = useState(DEFAULT_RENDER_ZOOM);

  const handleRenderAzimuthChange = (value: number) => {
    setRotation(value, renderElevation);
  };

  const handleRenderElevationChange = (value: number) => {
    setRotation(renderAzimuth, value);
  };

  const handleRenderZoomChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const clamped = clamp(value, RENDER_ZOOM_RANGE.min, RENDER_ZOOM_RANGE.max);
    setRenderZoom(clamped);
    queueNvUpdate(NvUpdateKey.RenderZoom, () => {
      setUnifiedZoom(nv, clamped);
    });
  };

  const configureNv = useCallback(
    (nv: NiiVueGPU) => {
      attachRotation(nv);
    },
    [attachRotation],
  );

  const reset = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    resetRotation();

    queueNvUpdate(NvUpdateKey.RenderZoom, () => {
      setUnifiedZoom(nv, DEFAULT_RENDER_ZOOM);
      setRenderZoom(DEFAULT_RENDER_ZOOM);
    });
  };

  return {
    renderAzimuth,
    handleRenderAzimuthChange,
    renderElevation,
    handleRenderElevationChange,
    renderZoom,
    handleRenderZoomChange,
    setRenderZoom,
    dragRotate,
    configureNv,
    reset,
  };
}
