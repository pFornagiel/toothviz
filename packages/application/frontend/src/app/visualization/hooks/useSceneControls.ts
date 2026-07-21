import { useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import {
  DEFAULT_BACK_COLOR_DARK,
  DEFAULT_BACK_COLOR_LIGHT,
  DEFAULT_SHOW_3D_CROSSHAIR,
  DEFAULT_CROSSHAIR_WIDTH,
  DEFAULT_PAN2D_XYZMM,
  DEFAULT_CROSSHAIR_POS,
} from "../constants";

export interface SceneControls {
  showCrosshair: boolean;
  handleCrosshairToggle: () => void;
  crosshairWidth: number;
  handleCrosshairWidthChange: (value: number) => void;
  lightBackground: boolean;
  handleBackgroundToggle: () => void;
  /** Restores crosshair, background, pan/zoom-2D, and crosshair position. */
  reset: () => void;
}

function applyCrosshairVisibility(nv: NiiVueGPU, visible: boolean): void {
  nv.is3DCrosshairVisible = visible;
  nv.isCrossLinesVisible = visible;
}

/**
 * Scene-level toggles (crosshair visibility/width and light vs dark
 * background) pushed onto the niivue instance. `reset` restores defaults
 * including 2D pan and crosshair center.
 */
export default function useSceneControls({
  nvRef,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
}): SceneControls {
  const [showCrosshair, setShowCrosshair] = useState(DEFAULT_SHOW_3D_CROSSHAIR);
  const [crosshairWidth, setCrosshairWidth] = useState(DEFAULT_CROSSHAIR_WIDTH);
  const [lightBackground, setLightBackground] = useState(false);

  const handleCrosshairToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !showCrosshair;
    setShowCrosshair(newValue);
    applyCrosshairVisibility(nv, newValue);
  };

  const handleCrosshairWidthChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setCrosshairWidth(value);
    nv.crosshairWidth = value;
  };

  const handleBackgroundToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !lightBackground;
    setLightBackground(newValue);
    nv.backgroundColor = newValue ? DEFAULT_BACK_COLOR_LIGHT : DEFAULT_BACK_COLOR_DARK;
  };

  const reset = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setShowCrosshair(DEFAULT_SHOW_3D_CROSSHAIR);
    setCrosshairWidth(DEFAULT_CROSSHAIR_WIDTH);
    setLightBackground(false);

    applyCrosshairVisibility(nv, DEFAULT_SHOW_3D_CROSSHAIR);
    nv.crosshairWidth = DEFAULT_CROSSHAIR_WIDTH;
    nv.backgroundColor = DEFAULT_BACK_COLOR_DARK;
    nv.pan2Dxyzmm = [...DEFAULT_PAN2D_XYZMM];
    nv.crosshairPos = [...DEFAULT_CROSSHAIR_POS];
  };

  return {
    showCrosshair,
    handleCrosshairToggle,
    crosshairWidth,
    handleCrosshairWidthChange,
    lightBackground,
    handleBackgroundToggle,
    reset,
  };
}
