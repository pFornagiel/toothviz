import { useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { hexToRgba } from "../../utils/hexToRgba";
import {
  DEFAULT_BACK_COLOR_DARK,
  DEFAULT_SHOW_3D_CROSSHAIR,
  DEFAULT_CROSSHAIR_COLOR,
  DEFAULT_PAN2D_XYZMM,
  DEFAULT_CROSSHAIR_POS,
} from "../constants";

export interface SceneControls {
  showCrosshair: boolean;
  handleCrosshairToggle: () => void;
  /** Crosshair colour as `#rrggbb`. */
  crosshairColor: string;
  handleCrosshairColorChange: (value: string) => void;
  /** Restores crosshair, background, pan/zoom-2D, and crosshair position. */
  reset: () => void;
}

function applyCrosshairVisibility(nv: NiiVueGPU, visible: boolean): void {
  nv.is3DCrosshairVisible = visible;
  nv.isCrossLinesVisible = visible;
}

/**
 * Scene-level toggles (crosshair visibility/colour) pushed onto the niivue
 * instance. `reset` restores defaults including 2D pan and crosshair center.
 */
export default function useSceneControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): SceneControls {
  const [showCrosshair, setShowCrosshair] = useState(DEFAULT_SHOW_3D_CROSSHAIR);
  const [crosshairColor, setCrosshairColor] = useState(DEFAULT_CROSSHAIR_COLOR);

  const handleCrosshairToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !showCrosshair;
    setShowCrosshair(newValue);
    applyCrosshairVisibility(nv, newValue);
  };

  const handleCrosshairColorChange = (value: string) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setCrosshairColor(value);
    queueNvUpdate(NvUpdateKey.CrosshairColor, () => {
      nv.crosshairColor = hexToRgba(value);
    });
  };

  const reset = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setShowCrosshair(DEFAULT_SHOW_3D_CROSSHAIR);

    applyCrosshairVisibility(nv, DEFAULT_SHOW_3D_CROSSHAIR);
    handleCrosshairColorChange(DEFAULT_CROSSHAIR_COLOR);
    nv.backgroundColor = DEFAULT_BACK_COLOR_DARK;
    nv.pan2Dxyzmm = [...DEFAULT_PAN2D_XYZMM];
    nv.crosshairPos = [...DEFAULT_CROSSHAIR_POS];
  };

  return {
    showCrosshair,
    handleCrosshairToggle,
    crosshairColor,
    handleCrosshairColorChange,
    reset,
  };
}
