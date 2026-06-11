import type NiiVueGPU from "@niivue/niivue/webgl2";
import { useState, useCallback, useRef } from "react";

export const DEFAULT_RENDER_AZIMUTH = 120;
export const DEFAULT_RENDER_ELEVATION = 10;

// Degrees of rotation per pixel of pointer movement, matching the feel of
// niivue's built-in render-tile drag (which this hook's dragRotate replaces).
const DRAG_DEG_PER_PX = 0.5;

const normalizeAzimuth = (azimuth: number) => ((azimuth % 360) + 360) % 360;
const normalizeElevation = (elevation: number) => ((((elevation + 180) % 360) + 360) % 360) - 180;

interface NiivueRotation {
  /** Render azimuth in [0, 360), mirrored from niivue's scene. */
  azimuth: number;
  /** Render elevation in [-180, 180], mirrored from niivue's scene. */
  elevation: number;
  /**
   * Wire niivue's rotation events so rotation flows back into React state.
   */
  attach: (nv: NiiVueGPU) => void;
  /** Push a rotation into niivue (slider handlers) */
  setRotation: (azimuth: number, elevation: number) => void;
  /**
   * Apply a pointer-drag delta (in px) to the current rotation. Unlike
   * niivue's built-in drag this does not clamp elevation to ±90 — the view
   * can flip all the way over; elevation wraps continuously through ±180.
   */
  dragRotate: (dx: number, dy: number) => void;
  /** Reset rotation to the render defaults. */
  resetRotation: () => void;
}

/**
 * Two-way binding for niivue's 3D render rotation.
 *
 * niivue owns the rotation state, so React state can only ever mirror it —
 * this hook keeps that mirror in one place. All writes (sliders via
 * `setRotation`, canvas drags via `dragRotate`) go through niivue's
 * `azimuth`/`elevation` property setters, whose `azimuthElevationChange`
 * event mirrors the value straight back into state — so the sliders track
 * drags in real time. Mirroring is coalesced to one state update per
 * animation frame to keep React re-renders off the drag's critical path.
 */
export default function useNiivueSyncedRotation(nvRef: {
  current: NiiVueGPU | null;
}): NiivueRotation {
  const [azimuth, setAzimuth] = useState(DEFAULT_RENDER_AZIMUTH);
  const [elevation, setElevation] = useState(DEFAULT_RENDER_ELEVATION);

  // Latest un-mirrored rotation; null means no rAF flush is scheduled.
  const pendingMirror = useRef<{ azimuth: number; elevation: number } | null>(null);

  const mirror = useCallback((rawAzimuth: number, rawElevation: number) => {
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
      // Fired by the azimuth/elevation property setters (sliders, reset,
      // dragRotate). niivue-internal rotation paths that bypass the setters
      // (e.g. keyboard shortcuts) don't emit, hence the pointerUp safety net.
      nv.addEventListener("azimuthElevationChange", (e) => {
        mirror(e.detail.azimuth, e.detail.elevation);
      });
      nv.addEventListener("pointerUp", () => {
        mirror(nv.azimuth, nv.elevation);
      });
    },
    [mirror],
  );

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

  const dragRotate = useCallback(
    (dx: number, dy: number) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      const currentElevation = nv.elevation;
      // Past ±90 the camera is upside down, so horizontal pointer movement
      // must spin azimuth the opposite way to keep the scene following the
      // pointer (the same reason niivue clamps instead).
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
