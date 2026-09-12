import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ToothDetail, ToothConditionGroup } from "react-odontogram";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { DEFAULT_OVERLAY_NAME } from "../constants";
import {
  buildSelectionConditions,
  buildToothLabelColormap,
  classesToToothIds,
  presentClassesFromImg,
  toggleToothId,
  visibleClassesFromSelection,
  withColormapVisibility,
  type LabelColorMap,
} from "../toothLabels";

export interface ToothSelectionControls {
  /** True when the loaded overlay has at least one tooth class. */
  hasToothLabels: boolean;
  presentToothIds: string[];
  selectedToothIds: string[];
  detectedConditions: ToothConditionGroup[];
  /** Bump to remount uncontrolled Odontogram after external selection changes. */
  odontogramKey: number;
  /**
   * Pick mode: all teeth stay visible while selecting.
   * Turning it off applies the filter (hides non-selected).
   */
  pickFromPreview: boolean;
  setPickFromPreview: (enabled: boolean) => void;
  onOdontogramChange: (selected: ToothDetail[]) => void;
  /** Toggle a tooth from a preview click; remounts chart so colors stay in sync. */
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
 * Pick-mode toggles skip redundant GPU work when the overlay is already in the
 * desired visibility state, and reuse a cached full colormap.
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
  const [odontogramKey, setOdontogramKey] = useState(0);
  const [pickFromPreview, setPickFromPreviewState] = useState(false);
  const [overlayIndex, setOverlayIndex] = useState(-1);

  const overlayIndexRef = useRef(-1);
  const presentClassIdsRef = useRef<number[]>([]);
  const selectedToothIdsRef = useRef<string[]>([]);
  const pickFromPreviewRef = useRef(false);
  const showAllCmapRef = useRef<LabelColorMap | null>(null);
  /** Whether the overlay GPU state currently shows every present tooth. */
  const overlayShowsAllRef = useRef(true);

  presentClassIdsRef.current = presentClassIds;
  selectedToothIdsRef.current = selectedToothIds;
  pickFromPreviewRef.current = pickFromPreview;

  const presentToothIds = classesToToothIds(presentClassIds);
  const hasToothLabels = presentToothIds.length > 0;
  const detectedConditions = buildSelectionConditions(presentToothIds, selectedToothIds);

  const pushColormap = useCallback(
    (cmap: LabelColorMap, showsAll: boolean) => {
      const nv = nvRef.current;
      const idx = overlayIndexRef.current;
      if (!nv || idx < 0) {
        return;
      }
      overlayShowsAllRef.current = showsAll;
      queueNvUpdate(NvUpdateKey.ToothLabels, () => {
        nv.volumeIsAlphaClipDark = true;
        void nv.setColormapLabel(idx, cmap).then(() => {
          // Keep the per-class color legend in sync with overlay display.
          nv.isLegendVisible = true;
          const vol = nv.volumes[idx] as { isLegendVisible?: boolean } | undefined;
          if (vol) {
            vol.isLegendVisible = true;
          }
          void nv.updateGLVolume();
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

  const showAllTeeth = useCallback(() => {
    const base = showAllCmapRef.current;
    if (!base) {
      return;
    }
    if (overlayShowsAllRef.current) {
      return;
    }
    pushColormap(base, true);
  }, [pushColormap]);

  const filterToSelection = useCallback(
    (selected: string[]) => {
      const present = presentClassIdsRef.current;
      const base = showAllCmapRef.current;
      if (!base || present.length === 0) {
        return;
      }
      if (selected.length === 0) {
        showAllTeeth();
        return;
      }
      const visible = visibleClassesFromSelection(present, selected);
      pushColormap(withColormapVisibility(base, visible), false);
    },
    [pushColormap, showAllTeeth],
  );

  // Rebuild cached full colormap when the mask changes; apply current visibility.
  useEffect(() => {
    if (presentClassIds.length === 0) {
      showAllCmapRef.current = null;
      overlayShowsAllRef.current = true;
      return;
    }
    const base = buildToothLabelColormap(presentClassIds, null);
    showAllCmapRef.current = base;
    // Force apply after a new mask (cache identity changed).
    overlayShowsAllRef.current = false;
    if (pickFromPreviewRef.current || selectedToothIdsRef.current.length === 0) {
      pushColormap(base, true);
    } else {
      filterToSelection(selectedToothIdsRef.current);
    }
    // Only re-run when the mask set changes — not on selection/pick toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentClassIds, pushColormap]);

  // Chart/selection changes while pick mode is off: filter immediately.
  // Pick-mode enter/exit handles GPU visibility itself (avoids a double update).
  useEffect(() => {
    if (pickFromPreviewRef.current || presentClassIdsRef.current.length === 0) {
      return;
    }
    filterToSelection(selectedToothIds);
  }, [selectedToothIds, filterToSelection]);

  const syncFromVolumesRef = useRef<(nv: NiiVueGPU) => void>(() => {});
  syncFromVolumesRef.current = (nv: NiiVueGPU) => {
    const nextOverlayIndex = findOverlayIndex(nv);
    overlayIndexRef.current = nextOverlayIndex;
    setOverlayIndex(nextOverlayIndex);
    if (nextOverlayIndex < 0) {
      setPresentClassIds([]);
      setSelectedToothIds([]);
      setPickFromPreviewState(false);
      pickFromPreviewRef.current = false;
      showAllCmapRef.current = null;
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

  const onOdontogramChange = useCallback((selected: ToothDetail[]) => {
    const allowed = new Set(classesToToothIds(presentClassIdsRef.current));
    const next = selected.map((t) => t.id).filter((id) => allowed.has(id));
    // Reject chart picks for teeth not in the mask; remount so the chart UI snaps back.
    if (next.length !== selected.length) {
      setOdontogramKey((k) => k + 1);
    }
    setSelectedToothIds(next);
  }, []);

  const toggleToothFromPreview = useCallback((toothId: string) => {
    setSelectedToothIds((prev) => toggleToothId(prev, toothId));
    setOdontogramKey((k) => k + 1);
  }, []);

  const setPickFromPreview = useCallback(
    (enabled: boolean) => {
      if (enabled === pickFromPreviewRef.current) {
        return;
      }
      pickFromPreviewRef.current = enabled;
      setPickFromPreviewState(enabled);

      if (enabled) {
        showAllTeeth();
        return;
      }

      filterToSelection(selectedToothIdsRef.current);
    },
    [showAllTeeth, filterToSelection],
  );

  const clearSelection = useCallback(() => {
    setSelectedToothIds([]);
    setOdontogramKey((k) => k + 1);
    showAllTeeth();
  }, [showAllTeeth]);

  const reset = useCallback(() => {
    setSelectedToothIds([]);
    setPickFromPreviewState(false);
    pickFromPreviewRef.current = false;
    setOdontogramKey((k) => k + 1);
    showAllTeeth();
  }, [showAllTeeth]);

  return {
    hasToothLabels,
    presentToothIds,
    selectedToothIds,
    detectedConditions,
    odontogramKey,
    pickFromPreview,
    setPickFromPreview,
    onOdontogramChange,
    toggleToothFromPreview,
    overlayIndex,
    setMaskLegendVisible,
    clearSelection,
    syncFromVolumes,
    reset,
  };
}
