import { Niivue } from "@niivue/niivue";
import { useState, useCallback } from "react";

const DEFAULT_RENDER_AZIMUTH = 120;
const DEFAULT_RENDER_ELEVATION = 10;

const normalizeAzimuth = (azimuth: number) => ((azimuth % 360) + 360) % 360;
const normalizeElevation = (elevation: number) => ((((elevation + 180) % 360) + 360) % 360) - 180;

interface NiivueRotation {
  /** Render azimuth in [0, 360), mirrored from niivue's scene. */
  azimuth: number;
  /** Render elevation in [-180, 180], mirrored from niivue's scene. */
  elevation: number;
  /**F
   * Wire niivue's rotation callbacks so canvas-drag rotation flows back into React state.
   */
  attach: (nv: Niivue) => void;
  /** Push a rotation into niivue (slider handlers) */
  setRotation: (azimuth: number, elevation: number) => void;
  /** Reset rotation to the render defaults. */
  resetRotation: () => void;
}

/**
 * Two-way binding for niivue's 3D render rotation.
 *
 * niivue owns the canvas and mutates `scene.renderAzimuth`/`renderElevation`
 * directly on drag, so React state can only ever mirror it — this hook keeps
 * that mirror in one place. The `attach` callback wires niivue → React (drag),
 * `setRotation` pushes React → niivue (sliders / reset), and the wired callback
 * mirrors that push straight back so there is a single source of truth for the
 * displayed values.
 */
export default function useNiivueSyncedRotation(nvRef: { current: Niivue | null }): NiivueRotation {
  const [azimuth, setAzimuth] = useState(DEFAULT_RENDER_AZIMUTH);
  const [elevation, setElevation] = useState(DEFAULT_RENDER_ELEVATION);

  const attach = useCallback((nv: Niivue) => {
    const handleChange = (rawAzimuth: number, rawElevation: number) => {
      if (rawAzimuth < 0 || rawAzimuth > 360) {
        const wrapped = normalizeAzimuth(rawAzimuth);
        nv.scene.sceneData.azimuth = wrapped;
        setAzimuth(wrapped);
      } else {
        setAzimuth(rawAzimuth);
      }

      if (rawElevation < -180 || rawElevation > 180) {
        const wrapped = normalizeElevation(rawElevation);
        nv.scene.sceneData.elevation = wrapped;
        setElevation(wrapped);
      } else {
        setElevation(rawElevation);
      }
    };

    nv.onAzimuthElevationChange = handleChange;
    nv.scene.onAzimuthElevationChange = handleChange;
  }, []);

  const setRotation = useCallback(
    (nextAzimuth: number, nextElevation: number) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      // the wired callback mirrors the value back into state.
      nv.setRenderAzimuthElevation(nextAzimuth, nextElevation);
    },
    [nvRef],
  );

  const resetRotation = useCallback(() => {
    setRotation(DEFAULT_RENDER_AZIMUTH, DEFAULT_RENDER_ELEVATION);
  }, [setRotation]);

  return { azimuth, elevation, attach, setRotation, resetRotation };
}
