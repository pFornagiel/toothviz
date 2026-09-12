import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ToothConditionGroup } from "react-odontogram";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { DEFAULT_OVERLAY_NAME } from "../constants";
import {
  buildLabelLut,
  buildSelectionConditions,
  buildToothLabelColormap,
  classesToToothIds,
  presentClassesFromImg,
  toggleToothId,
  visibilityKey,
  visibleClassesFromSelection,
  withColormapVisibility,
  type LabelColorMap,
} from "../toothLabels";

const FILTER_DEBOUNCE_MS = 80;

type RuntimeLabelColormap = {
  lut: Uint8ClampedArray;
  min: number;
  max: number;
  labels?: string[];
  centroids?: Record<string, [number, number, number]>;
};

export interface ToothSelectionControls {
  /** True when the loaded overlay has at least one tooth class. */
  hasToothLabels: boolean;
  presentToothIds: string[];
  selectedToothIds: string[];
  detectedConditions: ToothConditionGroup[];
  /**
   * Pick mode: all teeth stay visible while selecting.
   * Turning it off applies the filter (hides non-selected).
   */
  pickFromPreview: boolean;
  /** True while applying colormap after a pick-mode toggle. */
  pickModePending: boolean;
  setPickFromPreview: (enabled: boolean) => void;
  /** Toggle a detected tooth from the chart (no odontogram remount). */
  toggleToothFromChart: (toothId: string) => void;
  /** Toggle a tooth from a preview click. */
  toggleToothFromPreview: (toothId: string) => void;
  /** Overlay volume index in niivue (-1 if none). */
  overlayIndex: number;
  /** Sync NiiVue label color legend with mask overlay visibility. */
  setMaskLegendVisible: (visible: boolean) => void;
  clearSelection: () => void;
  /** Scan overlay img after volumes load; identity-stable. */
  syncFromVolumes: (nv: NiiVueGPU) => void;
  reset: () => void;
}

function findOverlayIndex(nv: NiiVueGPU): number {
  const byName = nv.volumes.findIndex(
    (v) => (v.name ?? "").toLowerCase() === DEFAULT_OVERLAY_NAME,
  );
  if (byName >= 0) {
    return byName;
  }
  return nv.volumes.length > 1 ? 1 : -1;
}

function readPresentClasses(nv: NiiVueGPU, overlayIndex: number): number[] {
  const vol = nv.volumes[overlayIndex];
  const img = vol?.img;
  if (!img) {
    return [];
  }
  return presentClassesFromImg(img);
}

/**
 * Scans the segmentation overlay for ToothSeg class labels, drives odontogram
 * selection, and filters the overlay via NiiVue label colormap alpha.
 *
 * Hot path: after the first `setColormapLabel` (centroids computed once),
 * visibility toggles only swap LUT alphas + one `updateGLVolume` — no volume
 * rescan and no duplicate GPU refresh.
 */
export default function useToothSelectionControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): ToothSelectionControls {
  const [presentClassIds, setPresentClassIds] = useState<number[]>([]);
  const [selectedToothIds, setSelectedToothIds] = useState<string[]>([]);
  const [pickFromPreview, setPickFromPreviewState] = useState(false);
  const [pickModePending, setPickModePending] = useState(false);
  const [overlayIndex, setOverlayIndex] = useState(-1);

  const overlayIndexRef = useRef(-1);
  const presentClassIdsRef = useRef<number[]>([]);
  const selectedToothIdsRef = useRef<string[]>([]);
  const pickFromPreviewRef = useRef(false);
  const pickModePendingGenRef = useRef(0);
  const showAllCmapRef = useRef<LabelColorMap | null>(null);
  /** Whether the overlay GPU state currently shows every present tooth. */
  const overlayShowsAllRef = useRef(true);
  /** Last applied visibility signature (`*` = all). */
  const appliedVisibilityKeyRef = useRef<string | null>(null);
  /** True after the initial setColormapLabel installed centroids. */
  const labelColormapInstalledRef = useRef(false);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  presentClassIdsRef.current = presentClassIds;
  selectedToothIdsRef.current = selectedToothIds;
  pickFromPreviewRef.current = pickFromPreview;

  const presentToothIds = classesToToothIds(presentClassIds);
  const hasToothLabels = presentToothIds.length > 0;
  const detectedConditions = buildSelectionConditions(presentToothIds, selectedToothIds);

  const pushVisibility = useCallback(
    (visibleClassIds: number[] | null, showsAll: boolean): Promise<void> => {
      const nv = nvRef.current;
      const idx = overlayIndexRef.current;
      const base = showAllCmapRef.current;
      if (!nv || idx < 0 || !base) {
        return Promise.resolve();
      }

      const key = visibilityKey(visibleClassIds);
      if (appliedVisibilityKeyRef.current === key && labelColormapInstalledRef.current) {
        overlayShowsAllRef.current = showsAll;
        return Promise.resolve();
      }

      const cmap = withColormapVisibility(base, visibleClassIds);

      return new Promise((resolve) => {
        queueNvUpdate(NvUpdateKey.ToothLabels, () => {
          const vol = nv.volumes[idx] as
            | {
                colormapLabel?: RuntimeLabelColormap | null;
                isDirty?: boolean;
                isLegendVisible?: boolean;
              }
            | undefined;
          if (!vol) {
            resolve();
            return;
          }

          const finish = () => {
            appliedVisibilityKeyRef.current = key;
            overlayShowsAllRef.current = showsAll;
            nv.isLegendVisible = true;
            vol.isLegendVisible = true;
            resolve();
          };

          // Fast path: keep centroids, swap LUT identity, single GPU update.
          if (labelColormapInstalledRef.current && vol.colormapLabel?.lut) {
            const prev = vol.colormapLabel;
            const { lut, min, max } = buildLabelLut(cmap);
            vol.colormapLabel = {
              lut,
              min,
              max,
              labels: prev.labels ?? cmap.labels,
              centroids: prev.centroids,
            };
            vol.isDirty = true;
            void nv
              .updateGLVolume()
              .catch(() => undefined)
              .finally(finish);
            return;
          }

          // Cold path once per mask: builds LUT + centroids via NiiVue.
          void nv
            .setColormapLabel(idx, cmap)
            .then(() => {
              labelColormapInstalledRef.current = true;
              // setColormapLabel already awaits updateGLVolume — do not call again.
            })
            .catch(() => undefined)
            .finally(finish);
        });
      });
    },
    [nvRef, queueNvUpdate],
  );

  const setMaskLegendVisible = useCallback(
    (visible: boolean) => {
      const nv = nvRef.current;
      const idx = overlayIndexRef.current;
      if (!nv) {
        return;
      }
      nv.isLegendVisible = visible;
      if (idx >= 0) {
        const vol = nv.volumes[idx] as { isLegendVisible?: boolean } | undefined;
        if (vol) {
          vol.isLegendVisible = visible;
        }
      }
      void nv.updateGLVolume();
    },
    [nvRef],
  );

  const showAllTeeth = useCallback((): Promise<void> => {
    if (!showAllCmapRef.current) {
      return Promise.resolve();
    }
    return pushVisibility(null, true);
  }, [pushVisibility]);

  const filterToSelection = useCallback(
    (selected: string[]): Promise<void> => {
      const present = presentClassIdsRef.current;
      if (!showAllCmapRef.current || present.length === 0) {
        return Promise.resolve();
      }
      if (selected.length === 0) {
        return showAllTeeth();
      }
      const visible = visibleClassesFromSelection(present, selected);
      return pushVisibility(visible, false);
    },
    [pushVisibility, showAllTeeth],
  );

  // Rebuild cached full colormap when the mask changes; apply current visibility.
  useEffect(() => {
    if (presentClassIds.length === 0) {
      showAllCmapRef.current = null;
      overlayShowsAllRef.current = true;
      labelColormapInstalledRef.current = false;
      appliedVisibilityKeyRef.current = null;
      return;
    }
    const base = buildToothLabelColormap(presentClassIds, null);
    showAllCmapRef.current = base;
    // New mask → force cold setColormapLabel so centroids match the volume.
    labelColormapInstalledRef.current = false;
    appliedVisibilityKeyRef.current = null;
    overlayShowsAllRef.current = false;
    if (pickFromPreviewRef.current || selectedToothIdsRef.current.length === 0) {
      void pushVisibility(null, true);
    } else {
      void filterToSelection(selectedToothIdsRef.current);
    }
    // Only re-run when the mask set changes — not on selection/pick toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentClassIds, pushVisibility]);

  // Chart/selection changes while pick mode is off: debounced filter.
  useEffect(() => {
    if (pickFromPreviewRef.current || presentClassIdsRef.current.length === 0) {
      return;
    }
    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current);
    }
    filterDebounceRef.current = setTimeout(() => {
      filterDebounceRef.current = null;
      if (pickFromPreviewRef.current) {
        return;
      }
      void filterToSelection(selectedToothIdsRef.current);
    }, FILTER_DEBOUNCE_MS);
    return () => {
      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
        filterDebounceRef.current = null;
      }
    };
  }, [selectedToothIds, filterToSelection]);

  const syncFromVolumesRef = useRef<(nv: NiiVueGPU) => void>(() => {});
  syncFromVolumesRef.current = (nv: NiiVueGPU) => {
    const nextOverlayIndex = findOverlayIndex(nv);
    overlayIndexRef.current = nextOverlayIndex;
    setOverlayIndex(nextOverlayIndex);
    if (nextOverlayIndex < 0) {
      pickModePendingGenRef.current += 1;
      setPickModePending(false);
      setPresentClassIds([]);
      setSelectedToothIds([]);
      setPickFromPreviewState(false);
      pickFromPreviewRef.current = false;
      showAllCmapRef.current = null;
      labelColormapInstalledRef.current = false;
      appliedVisibilityKeyRef.current = null;
      return;
    }
    const present = readPresentClasses(nv, nextOverlayIndex);
    setPresentClassIds(present);
    setSelectedToothIds((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const allowed = new Set(classesToToothIds(present));
      return prev.filter((id) => allowed.has(id));
    });
  };

  const syncFromVolumes = useCallback((nv: NiiVueGPU) => {
    syncFromVolumesRef.current(nv);
  }, []);

  const toggleToothFromChart = useCallback((toothId: string) => {
    const allowed = new Set(classesToToothIds(presentClassIdsRef.current));
    if (!allowed.has(toothId)) {
      return;
    }
    setSelectedToothIds((prev) => toggleToothId(prev, toothId));
  }, []);

  const toggleToothFromPreview = useCallback((toothId: string) => {
    setSelectedToothIds((prev) => toggleToothId(prev, toothId));
  }, []);

  const setPickFromPreview = useCallback(
    (enabled: boolean) => {
      if (pickModePending) {
        return;
      }
      if (enabled === pickFromPreviewRef.current) {
        return;
      }
      pickFromPreviewRef.current = enabled;
      setPickFromPreviewState(enabled);

      const gen = ++pickModePendingGenRef.current;
      setPickModePending(true);

      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
        filterDebounceRef.current = null;
      }

      const apply = enabled
        ? showAllTeeth()
        : filterToSelection(selectedToothIdsRef.current);

      void apply.finally(() => {
        if (gen === pickModePendingGenRef.current) {
          setPickModePending(false);
        }
      });
    },
    [showAllTeeth, filterToSelection, pickModePending],
  );

  const clearSelection = useCallback(() => {
    setSelectedToothIds([]);
    void showAllTeeth();
  }, [showAllTeeth]);

  const reset = useCallback(() => {
    pickModePendingGenRef.current += 1;
    setPickModePending(false);
    setSelectedToothIds([]);
    setPickFromPreviewState(false);
    pickFromPreviewRef.current = false;
    void showAllTeeth();
  }, [showAllTeeth]);

  return {
    hasToothLabels,
    presentToothIds,
    selectedToothIds,
    detectedConditions,
    pickFromPreview,
    pickModePending,
    setPickFromPreview,
    toggleToothFromChart,
    toggleToothFromPreview,
    overlayIndex,
    setMaskLegendVisible,
    clearSelection,
    syncFromVolumes,
    reset,
  };
}
