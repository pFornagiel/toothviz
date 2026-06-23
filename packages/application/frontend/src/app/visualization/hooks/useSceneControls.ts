import { useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import {
  DEFAULT_BACK_COLOR_DARK,
  DEFAULT_BACK_COLOR_LIGHT,
  DEFAULT_SHOW_3D_CROSSHAIR,
  DEFAULT_CROSSHAIR_WIDTH,
} from "../constants";

export interface SceneControls {
  showCrosshair: boolean;
  handleCrosshairToggle: () => void;
  crosshairWidth: number;
  handleCrosshairWidthChange: (value: number) => void;
  lightBackground: boolean;
  handleBackgroundToggle: () => void;
}

/**
 * Scene-level toggles (3D crosshair visibility/width and light vs dark
 * background) that are pushed straight onto the niivue instance. These are
 * deliberately not touched by `resetSettings`.
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
    nv.is3DCrosshairVisible = newValue;
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

  return {
    showCrosshair,
    handleCrosshairToggle,
    crosshairWidth,
    handleCrosshairWidthChange,
    lightBackground,
    handleBackgroundToggle,
  };
}
