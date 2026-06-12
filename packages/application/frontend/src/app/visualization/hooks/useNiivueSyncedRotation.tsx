import type NiiVueGPU from "@niivue/niivue/webgl2";
import { useState, useCallback, useRef } from "react";

export const DEFAULT_RENDER_AZIMUTH = 120;
export const DEFAULT_RENDER_ELEVATION = 10;

const DRAG_DEG_PER_PX = 0.5;

const normalizeAzimuth = (azimuth: number) => ((azimuth % 360) + 360) % 360;
const normalizeElevation = (elevation: number) => ((((elevation + 180) % 360) + 360) % 360) - 180;

interface NiivueRotation {
  azimuth: number;
  elevation: number;
  attach: (nv: NiiVueGPU) => void;
  setRotation: (azimuth: number, elevation: number) => void;
  dragRotate: (dx: number, dy: number) => void;
  resetRotation: () => void;
}

/**
 * Two-way binding for niivue's 3D render rotation.
 *
 * All writes go through niivue's azimuth/elevation property setters, whose
 * azimuthElevationChange event syncs back to React state batched via rAF.
 */
export default function useNiivueSyncedRotation(nvRef: {
  current: NiiVueGPU | null;
}): NiivueRotation {
  const [azimuth, setAzimuth] = useState(DEFAULT_RENDER_AZIMUTH);
  const [elevation, setElevation] = useState(DEFAULT_RENDER_ELEVATION);

  const pendingMirror = useRef<{ azimuth: number; elevation: number } | null>(null);

  const syncState = useCallback((rawAzimuth: number, rawElevation: number) => {
    const flushScheduled = pendingMirror.current !== null;
    pendingMirror.current = { azimuth: rawAzimuth, elevation: rawElevation };
    if (!flushScheduled) {
      requestAnimationFrame(() => {
        const value = pendingMirror.current;
        pendingMirror.current = null;
        if (value) {
          setAzimuth(normalizeAzimuth(value.azimuth));
          setElevation(normalizeElevation(value.elevation));
        }
      });
    }
  }, []);

  const attach = useCallback(
    (nv: NiiVueGPU) => {
      nv.addEventListener("azimuthElevationChange", (e) => {
        syncState(e.detail.azimuth, e.detail.elevation);
      });
      nv.addEventListener("pointerUp", () => {
        syncState(nv.azimuth, nv.elevation);
      });
    },
    [syncState],
  );

  const setRotation = useCallback(
    (nextAzimuth: number, nextElevation: number) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      nv.azimuth = normalizeAzimuth(nextAzimuth);
      nv.elevation = normalizeElevation(nextElevation);
    },
    [nvRef],
  );

  const dragRotate = useCallback(
    (dx: number, dy: number) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      const currentElevation = nv.elevation;
      const upsideDown = Math.cos((currentElevation * Math.PI) / 180) < 0;
      const azimuthDirection = upsideDown ? -1 : 1;
      nv.azimuth = normalizeAzimuth(nv.azimuth + azimuthDirection * dx * DRAG_DEG_PER_PX);
      nv.elevation = normalizeElevation(currentElevation + dy * DRAG_DEG_PER_PX);
    },
    [nvRef],
  );

  const resetRotation = useCallback(() => {
    setRotation(DEFAULT_RENDER_AZIMUTH, DEFAULT_RENDER_ELEVATION);
  }, [setRotation]);

  return { azimuth, elevation, attach, setRotation, dragRotate, resetRotation };
}
