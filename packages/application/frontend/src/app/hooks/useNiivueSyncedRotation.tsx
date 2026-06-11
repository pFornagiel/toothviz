import type NiiVueGPU from "@niivue/niivue/webgl2";
import { useState, useCallback } from "react";

export const DEFAULT_RENDER_AZIMUTH = 120;
export const DEFAULT_RENDER_ELEVATION = 10;

const normalizeAzimuth = (azimuth: number) => ((azimuth % 360) + 360) % 360;
const normalizeElevation = (elevation: number) => ((((elevation + 180) % 360) + 360) % 360) - 180;

interface NiivueRotation {
  /** Render azimuth in [0, 360), mirrored from niivue's scene. */
  azimuth: number;
  /** Render elevation in [-180, 180], mirrored from niivue's scene. */
  elevation: number;
  /**
   * Wire niivue's rotation events so canvas rotation flows back into React state.
   */
  attach: (nv: NiiVueGPU) => void;
  /** Push a rotation into niivue (slider handlers) */
  setRotation: (azimuth: number, elevation: number) => void;
  /** Reset rotation to the render defaults. */
  resetRotation: () => void;
}

/**
 * Two-way binding for niivue's 3D render rotation.
 *
 * niivue owns the canvas and rotation state, so React state can only ever
 * mirror it — this hook keeps that mirror in one place. `setRotation` pushes
 * React → niivue through the `azimuth`/`elevation` property setters, whose
 * `azimuthElevationChange` event mirrors the value straight back into state.
 * Drag rotation mutates niivue's scene directly without emitting that event,
 * so `attach` also listens for `pointerUp` and re-reads the scene on release.
 */
export default function useNiivueSyncedRotation(nvRef: {
  current: NiiVueGPU | null;
}): NiivueRotation {
  const [azimuth, setAzimuth] = useState(DEFAULT_RENDER_AZIMUTH);
  const [elevation, setElevation] = useState(DEFAULT_RENDER_ELEVATION);

  const attach = useCallback((nv: NiiVueGPU) => {
    const mirror = (rawAzimuth: number, rawElevation: number) => {
      setAzimuth(normalizeAzimuth(rawAzimuth));
      setElevation(normalizeElevation(rawElevation));
    };

    // Programmatic sets (sliders, reset) emit the typed event.
    nv.addEventListener("azimuthElevationChange", (e) => {
      mirror(e.detail.azimuth, e.detail.elevation);
    });
    // Drag rotation mutates nv's scene without emitting; sync when the drag ends.
    nv.addEventListener("pointerUp", () => {
      mirror(nv.azimuth, nv.elevation);
    });
  }, []);

  const setRotation = useCallback(
    (nextAzimuth: number, nextElevation: number) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      // the azimuthElevationChange listener mirrors the values back into state.
      nv.azimuth = normalizeAzimuth(nextAzimuth);
      nv.elevation = normalizeElevation(nextElevation);
    },
    [nvRef],
  );

  const resetRotation = useCallback(() => {
    setRotation(DEFAULT_RENDER_AZIMUTH, DEFAULT_RENDER_ELEVATION);
  }, [setRotation]);

  return { azimuth, elevation, attach, setRotation, resetRotation };
}
