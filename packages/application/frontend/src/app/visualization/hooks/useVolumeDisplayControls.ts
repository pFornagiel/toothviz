import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { DEFAULT_COLORMAP, DEFAULT_VISIBLE_OPACITY, CAL_MIN_GLOBAL_VAL, CAL_MAX_GLOBAL_VAL, HIDDEN_OPACITY, DEFAULT_OVERLAY_OPACITY } from "../constants";
export interface VolumeDisplayControls {
  // Volumes
  selectedVolume: number;
  handleVolumeChange: (index: number) => void;
  volumeVisibility: boolean[];
  handleVolumeVisibilityToggle: (index: number) => void;

  // Display (active volume)
  opacity: number;
  handleOpacityChange: (value: number) => void;
  colormap: string;
  colormaps: string[];
  handleColormapChange: (value: string) => void;
  cal_min: number;
  cal_max: number;
  cal_minGlobal: number;
  cal_maxGlobal: number;
  handleCalMinChange: (value: number) => void;
  handleCalMaxChange: (value: number) => void;

  /** Post-load UI sync: mirrors the loaded volumes into control state. */
  syncFromVolumes: (nv: NiiVueGPU) => void;
  /** Restores the active volume's display params and all volumes' visibility. */
  reset: () => void;
}

/**
 * Volume selection plus the active volume's display parameters (opacity,
 * colormap, cal_min/max windowing). These two concerns share state — switching
 * the active volume mirrors that volume's display params into the controls, and
 * the opacity slider writes back into the per-volume opacity store used for
 * show/hide — so they live in one hook. niivue updates flow through the shared
 * per-frame queue; instance lifecycle/loading lives in `useNiivueViewer`, which
 * talks back only through the identity-stable `syncFromVolumes` bridge.
 */
export default function useVolumeDisplayControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): VolumeDisplayControls {
  // Volume controls
  const [selectedVolume, setSelectedVolume] = useState(0);
  const [volumeVisibility, setVolumeVisibility] = useState<boolean[]>([]);
  const [volumeOpacities, setVolumeOpacities] = useState<number[]>([]);
  const [opacity, setOpacity] = useState(DEFAULT_VISIBLE_OPACITY);
  const [colormap, _setColormap] = useState(DEFAULT_COLORMAP);
  const [colormaps, setColormaps] = useState<string[]>([]);
  const [cal_min, _setCalMin] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_max, _setCalMax] = useState(CAL_MAX_GLOBAL_VAL);
  const [cal_minGlobal, _setCalMinGlobal] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_maxGlobal, _setCalMaxGlobal] = useState(CAL_MAX_GLOBAL_VAL);

  // Initialised cal_min and cal_max for reset
  const initialCalMin = useRef(CAL_MIN_GLOBAL_VAL);
  const initialCalMax = useRef(CAL_MAX_GLOBAL_VAL);

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
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    queueNvUpdate(NvUpdateKey.CalMin, () => {
      void nv.setVolume(selectedVolume, { calMin: cal_min });
    });
    // Deliberately omits selectedVolume: switching the active volume must not
    // push the previous volume's cal_min into the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal_min, queueNvUpdate]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    queueNvUpdate(NvUpdateKey.CalMax, () => {
      void nv.setVolume(selectedVolume, { calMax: cal_max });
    });
    // Deliberately omits selectedVolume: switching the active volume must not
    // push the previous volume's cal_max into the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal_max, queueNvUpdate]);

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

  const setColormap = (value: string | undefined) => {
    _setColormap(value || DEFAULT_COLORMAP);
  };

  const handleVolumeChange = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    setSelectedVolume(index);
    const vol = nv.volumes[index];
    setOpacity(vol.opacity ?? DEFAULT_VISIBLE_OPACITY);
    setColormap(vol.colormap);
    setCalMin(vol.calMin);
    setCalMax(vol.calMax);
  };

  const handleOpacityChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setOpacity(value);
    queueNvUpdate(NvUpdateKey.Opacity, () => nv.setVolume(selectedVolume, { opacity: value }));

    // Update stored opacity if volume is visible
    if (volumeVisibility[selectedVolume]) {
      const newOpacities = [...volumeOpacities];
      newOpacities[selectedVolume] = value;
      setVolumeOpacities(newOpacities);
    }
  };

  const handleColormapChange = (value: string) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setColormap(value);
    nv.setVolume(selectedVolume, { colormap: value });
  };

  const handleCalMinChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }
    setCalMin(value);
  };

  const handleCalMaxChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setCalMax(value);
  };

  const handleVolumeVisibilityToggle = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    const newVisibility = [...volumeVisibility];
    newVisibility[index] = !newVisibility[index];
    setVolumeVisibility(newVisibility);

    // Set opacity to 0 to hide, restore stored opacity to show
    if (newVisibility[index]) {
      // Restore the stored opacity
      const opacityToRestore = volumeOpacities[index] ?? DEFAULT_VISIBLE_OPACITY;
      void nv.setVolume(index, { opacity: opacityToRestore });
    } else {
      // Store current opacity before hiding
      const newOpacities = [...volumeOpacities];
      newOpacities[index] = nv.volumes[index].opacity ?? DEFAULT_VISIBLE_OPACITY;
      setVolumeOpacities(newOpacities);
      // Hide by setting opacity to 0
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
    const vol = nv.volumes[0];
    setOpacity(vol.opacity ?? DEFAULT_VISIBLE_OPACITY);
    setColormap(vol.colormap);
    setCalMinGlobal(vol.globalMin);
    setCalMaxGlobal(vol.globalMax);
    setCalMin(vol.calMin, true);
    setCalMax(vol.calMax, true);
    // Initialize visibility and store opacities for all volumes
    setVolumeVisibility(nv.volumes.map(() => true));
    setVolumeOpacities(nv.volumes.map((v) => v.opacity ?? DEFAULT_VISIBLE_OPACITY));
    setColormaps(nv.colormaps);
  };
  
  const syncFromVolumes = useCallback((nv: NiiVueGPU) => syncFromVolumesRef.current(nv), []);

  const reset = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const restoredCalMin = initialCalMin.current;
    const restoredCalMax = initialCalMax.current;
    setSelectedVolume(0);
    setCalMin(restoredCalMin);
    setCalMax(restoredCalMax);
    setOpacity(DEFAULT_VISIBLE_OPACITY);
    setColormap(DEFAULT_COLORMAP);
    setVolumeVisibility(nv.volumes.map(() => true));

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
    selectedVolume,
    handleVolumeChange,
    volumeVisibility,
    handleVolumeVisibilityToggle,
    opacity,
    handleOpacityChange,
    colormap,
    colormaps,
    handleColormapChange,
    cal_min,
    cal_max,
    cal_minGlobal,
    cal_maxGlobal,
    handleCalMinChange,
    handleCalMaxChange,
    syncFromVolumes,
    reset,
  };
}
