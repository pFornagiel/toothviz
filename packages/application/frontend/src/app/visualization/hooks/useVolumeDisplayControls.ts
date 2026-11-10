import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import {
  DEFAULT_COLORMAP,
  DEFAULT_VISIBLE_OPACITY,
  CAL_MIN_GLOBAL_VAL,
  CAL_MAX_GLOBAL_VAL,
  HIDDEN_OPACITY,
  DEFAULT_OVERLAY_OPACITY,
  DEFAULT_OVERLAY_NAME,
  DEFAULT_CAL_MAX,
  DEFAULT_CAL_MIN,
} from "../constants";
import { resolveDensityPreset } from "../densityPresets";

/** Overlay index from a known mask slot (`-1` when there is no mask). */
export function resolveOverlayVolumeIndex(
  volumeCount: number,
  overlayIndexByName: number,
): number {
  if (overlayIndexByName >= 0) {
    return overlayIndexByName;
  }
  return volumeCount > 1 ? 1 : -1;
}

/** Scan index: first volume that is not the mask overlay (normally 0). */
export function resolveScanVolumeIndex(
  volumeCount: number,
  overlayIndex: number,
): number {
  if (volumeCount <= 0) {
    return 0;
  }
  for (let i = 0; i < volumeCount; i++) {
    if (i !== overlayIndex) {
      return i;
    }
  }
  return 0;
}

/** Same resolution as tooth-selection overlay lookup. */
function overlayVolumeIndex(nv: NiiVueGPU): number {
  const byName = nv.volumes.findIndex(
    (v) => (v.name ?? "").toLowerCase() === DEFAULT_OVERLAY_NAME,
  );
  return resolveOverlayVolumeIndex(nv.volumes.length, byName);
}

function isOverlayVolumeIndex(nv: NiiVueGPU, index: number): boolean {
  const overlay = overlayVolumeIndex(nv);
  return overlay >= 0 && index === overlay;
}

function scanVolumeIndex(nv: NiiVueGPU): number {
  return resolveScanVolumeIndex(nv.volumes.length, overlayVolumeIndex(nv));
}

export interface VolumeDisplayControls {
  volumeVisibility: boolean[];
  handleVolumeVisibilityToggle: (index: number) => void;
  /** Stored opacity per volume (kept while a layer is hidden). */
  volumeOpacities: number[];
  handleOpacityChange: (index: number, value: number) => void;
  /** Whether the scan is drawn in the 3D render; 2D slices are not affected. */
  scanIn3d: boolean;
  setScanIn3d: (visible: boolean) => void;

  // Scan windowing (intensity display range)
  cal_min: number;
  cal_max: number;
  cal_minGlobal: number;
  cal_maxGlobal: number;
  handleCalMinChange: (value: number) => void;
  handleCalMaxChange: (value: number) => void;
  /** Apply both ends of the scan window in one step (presets). */
  applyCalRange: (calMin: number, calMax: number) => void;

  /** Post-load UI sync: mirrors the loaded volumes into control state. */
  syncFromVolumes: (nv: NiiVueGPU) => void;
  /** Restores display params and all volumes' visibility. */
  reset: () => void;
}

/**
 * Per-layer visibility/opacity plus the scan's intensity window. Each layer's
 * opacity sits under its name in Layers; windowing always targets the scan.
 * niivue updates flow through the shared per-frame queue; instance
 * lifecycle/loading lives in `useNiivueViewer`, which talks back only through
 * the identity-stable `syncFromVolumes` bridge.
 */
/**
 * Patched into NiiVue: overrides the scan's opacity in the 3D render only. Without a mask the
 * scan is all the 3D view has, and the checkbox that could bring it back is not shown.
 */
function applyScanIn3d(nv: NiiVueGPU, visible: boolean): void {
  const scan = nv.volumes[scanVolumeIndex(nv)] as { renderOpacity?: number } | undefined;
  if (scan) {
    scan.renderOpacity = visible || nv.volumes.length < 2 ? undefined : HIDDEN_OPACITY;
  }
}

export default function useVolumeDisplayControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): VolumeDisplayControls {
  const [volumeVisibility, setVolumeVisibility] = useState<boolean[]>([]);
  const [volumeOpacities, setVolumeOpacities] = useState<number[]>([]);
  const [scanIn3d, setScanIn3dState] = useState(false);
  const [cal_min, _setCalMin] = useState(DEFAULT_CAL_MIN);
  const [cal_max, _setCalMax] = useState(DEFAULT_CAL_MAX);
  const [cal_minGlobal, _setCalMinGlobal] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_maxGlobal, _setCalMaxGlobal] = useState(CAL_MAX_GLOBAL_VAL);

  // Initialised cal_min and cal_max for reset (Default density window).
  const initialCalMin = useRef(DEFAULT_CAL_MIN);
  const initialCalMax = useRef(DEFAULT_CAL_MAX);
  // Sync also runs when an overlay arrives later; that must not undo the user's windowing.
  const windowInitializedFor = useRef<object | null>(null);

  const setCalMax = useCallback(
    (value: number | undefined, setInitial: boolean = false) => {
      if (Number.isNaN(value) || value === undefined) {
        _setCalMax(CAL_MAX_GLOBAL_VAL);
        if (setInitial) {
          initialCalMax.current = CAL_MAX_GLOBAL_VAL;
        }
        return;
      }
      if (value < cal_min) {
        _setCalMax(cal_min);
        if (setInitial) {
          initialCalMax.current = cal_min;
        }
        return;
      }
      _setCalMax(value);
      if (setInitial) {
        initialCalMax.current = value;
      }
    },
    [cal_min],
  );

  const setCalMin = useCallback(
    (value: number | undefined, setInitial: boolean = false) => {
      if (Number.isNaN(value) || value === undefined) {
        _setCalMin(CAL_MIN_GLOBAL_VAL);
        if (setInitial) {
          initialCalMin.current = CAL_MIN_GLOBAL_VAL;
        }
        return;
      }

      if (value > cal_max) {
        _setCalMin(cal_max);
        if (setInitial) {
          initialCalMin.current = cal_max;
        }
        return;
      }
      _setCalMin(value);
      if (setInitial) {
        initialCalMin.current = value;
      }
    },
    [cal_max],
  );

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length === 0) {
      return;
    }
    const scanIdx = scanVolumeIndex(nv);
    if (isOverlayVolumeIndex(nv, scanIdx)) {
      return;
    }

    queueNvUpdate(NvUpdateKey.CalMin, () => {
      void nv.setVolume(scanIdx, { calMin: cal_min });
    });
  }, [cal_min, nvRef, queueNvUpdate]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length === 0) {
      return;
    }
    const scanIdx = scanVolumeIndex(nv);
    if (isOverlayVolumeIndex(nv, scanIdx)) {
      return;
    }

    queueNvUpdate(NvUpdateKey.CalMax, () => {
      void nv.setVolume(scanIdx, { calMax: cal_max });
    });
  }, [cal_max, nvRef, queueNvUpdate]);

  const setCalMinGlobal = (value: number | undefined) => {
    if (Number.isNaN(value) || value === undefined) {
      return CAL_MIN_GLOBAL_VAL;
    }
    _setCalMinGlobal(value);
  };

  const setCalMaxGlobal = (value: number | undefined) => {
    if (Number.isNaN(value) || value === undefined) {
      return CAL_MAX_GLOBAL_VAL;
    }
    _setCalMaxGlobal(value);
  };

  const handleOpacityChange = (index: number, value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }
    // Do not write opacity to a hidden volume (would unhide it without the checkbox).
    if (!(volumeVisibility[index] ?? true)) {
      return;
    }

    queueNvUpdate(NvUpdateKey.Opacity, () => nv.setVolume(index, { opacity: value }));

    const newOpacities = [...volumeOpacities];
    newOpacities[index] = value;
    setVolumeOpacities(newOpacities);
  };

  const setScanIn3d = useCallback((visible: boolean) => {
    setScanIn3dState(visible);
  }, []);

  const handleCalMinChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length === 0) {
      return;
    }
    const scanIdx = scanVolumeIndex(nv);
    if (!(volumeVisibility[scanIdx] ?? true)) {
      return;
    }
    if (isOverlayVolumeIndex(nv, scanIdx)) {
      return;
    }
    setCalMin(value);
  };

  const handleCalMaxChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length === 0) {
      return;
    }
    const scanIdx = scanVolumeIndex(nv);
    if (!(volumeVisibility[scanIdx] ?? true)) {
      return;
    }
    if (isOverlayVolumeIndex(nv, scanIdx)) {
      return;
    }
    setCalMax(value);
  };

  const applyCalRange = (nextMin: number, nextMax: number) => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length === 0) {
      return;
    }
    const scanIdx = scanVolumeIndex(nv);
    if (!(volumeVisibility[scanIdx] ?? true)) {
      return;
    }
    if (isOverlayVolumeIndex(nv, scanIdx)) {
      return;
    }

    if (Number.isNaN(nextMin) || Number.isNaN(nextMax)) {
      return;
    }
    let lo = Math.min(cal_maxGlobal, Math.max(cal_minGlobal, nextMin));
    let hi = Math.min(cal_maxGlobal, Math.max(cal_minGlobal, nextMax));
    if (lo > hi) {
      [lo, hi] = [hi, lo];
    }
    if (lo === hi) {
      if (hi < cal_maxGlobal) {
        hi += 1;
      } else if (lo > cal_minGlobal) {
        lo -= 1;
      }
    }
    // Set both ends directly so mid-update clamping cannot fight a preset jump.
    _setCalMin(lo);
    _setCalMax(hi);
  };

  useEffect(() => {
    const nv = nvRef.current;
    if (nv) {
      applyScanIn3d(nv, scanIn3d);
      nv.drawScene();
    }
  }, [nvRef, scanIn3d]);

  const handleVolumeVisibilityToggle = (index: number): void => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    const newVisibility = [...volumeVisibility];
    newVisibility[index] = !newVisibility[index];
    setVolumeVisibility(newVisibility);

    if (newVisibility[index]) {
      const opacityToRestore = volumeOpacities[index] ?? DEFAULT_VISIBLE_OPACITY;
      void nv.setVolume(index, { opacity: opacityToRestore });
    } else {
      const newOpacities = [...volumeOpacities];
      newOpacities[index] = nv.volumes[index].opacity ?? DEFAULT_VISIBLE_OPACITY;
      setVolumeOpacities(newOpacities);
      void nv.setVolume(index, { opacity: HIDDEN_OPACITY });
    }
  };

  /**
   * Post-load UI sync, identity-stable via the latest-ref pattern: the
   * implementation closes over `setCalMin`/`setCalMax`, whose identities change
   * with every `cal_min`/`cal_max` move. If this callback's identity tracked
   * theirs, the loading effects in `useNiivueViewer` (which depend on it
   * transitively) would re-fire on every cal slider drag and reload the volumes.
   */
  const syncFromVolumesRef = useRef<(nv: NiiVueGPU) => void>(() => {});
  syncFromVolumesRef.current = (nv: NiiVueGPU) => {
    if (nv.volumes.length === 0) {
      return;
    }
    const scanIdx = scanVolumeIndex(nv);
    const vol = nv.volumes[scanIdx] ?? nv.volumes[0];
    // A freshly loaded scan does not carry the override yet.
    applyScanIn3d(nv, scanIn3d);
    setCalMinGlobal(vol.globalMin);
    setCalMaxGlobal(vol.globalMax);
    const isNewBaseVolume = windowInitializedFor.current !== vol;
    windowInitializedFor.current = vol;
    let calMin = vol.calMin;
    let calMax = vol.calMax;
    if (isNewBaseVolume && !isOverlayVolumeIndex(nv, scanIdx)) {
      // Same window as the Default density preset chip.
      const preferred = resolveDensityPreset("default", vol.globalMin, vol.globalMax);
      calMin = preferred.calMin;
      calMax = preferred.calMax;
      // Written directly: effects stay silent if state already matches.
      void nv.setVolume(scanIdx, { calMin, calMax });
    }
    // Direct setters avoid mid-update clamping when both ends change together.
    _setCalMin(calMin);
    _setCalMax(calMax);
    if (isNewBaseVolume) {
      initialCalMin.current = calMin;
      initialCalMax.current = calMax;
    }
    setVolumeVisibility(nv.volumes.map(() => true));
    setVolumeOpacities(nv.volumes.map((v) => v.opacity ?? DEFAULT_VISIBLE_OPACITY));
  };

  const syncFromVolumes = useCallback((nv: NiiVueGPU) => syncFromVolumesRef.current(nv), []);

  const reset = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const restoredCalMin = initialCalMin.current;
    const restoredCalMax = initialCalMax.current;
    setCalMin(restoredCalMin);
    setCalMax(restoredCalMax);
    setVolumeVisibility(nv.volumes.map(() => true));
    setScanIn3d(false);

    const opacities = nv.volumes.map((_, i) =>
      i === 0 ? DEFAULT_VISIBLE_OPACITY : DEFAULT_OVERLAY_OPACITY,
    );
    setVolumeOpacities(opacities);

    // Write through to every loaded volume so Reset View actually restores the canvas.
    nv.volumes.forEach((_, i) => {
      if (i === 0) {
        void nv.setVolume(i, {
          opacity: opacities[i],
          colormap: DEFAULT_COLORMAP,
          calMin: restoredCalMin,
          calMax: restoredCalMax,
        });
      } else {
        void nv.setVolume(i, { opacity: opacities[i] });
      }
    });
  };

  return {
    volumeVisibility,
    handleVolumeVisibilityToggle,
    volumeOpacities,
    handleOpacityChange,
    scanIn3d,
    setScanIn3d,
    cal_min,
    cal_max,
    cal_minGlobal,
    cal_maxGlobal,
    handleCalMinChange,
    handleCalMaxChange,
    applyCalRange,
    syncFromVolumes,
    reset,
  };
}
