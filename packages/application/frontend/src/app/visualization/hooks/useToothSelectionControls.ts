import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ToothConditionGroup } from "react-odontogram";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import {
  DEFAULT_BONE_OPACITY,
  DEFAULT_OVERLAY_NAME,
  DEFAULT_OVERLAY_OPACITY,
} from "../constants";
import {
  BONE_CLASSES,
  boneOpacityToAlpha,
  buildLabelLut,
  buildSelectionConditions,
  buildToothLabelColormap,
  classesToToothIds,
  presentClassesFromCounts,
  selectionCentreOfMass,
  maskVoxelCounts,
  presentNonToothClassesFromCounts,
  toggleToothId,
  toothIdToFdi,
  visibilityKey,
  visibleClassesFromSelection,
  withColormapVisibility,
  type BoneAlphas,
  type BoneClass,
  type LabelColorMap,
} from "../toothLabels";
import { sameToothSelection } from "../selectionSummary";
import { setRotationPivot } from "./niivueRotationPivot";

const FILTER_DEBOUNCE_MS = 80;

type RuntimeLabelColormap = {
  lut: Uint8ClampedArray;
  min: number;
  max: number;
  labels?: string[];
  centroids?: Record<string, [number, number, number]>;
};

export type PickModeExitIntent = "apply" | "discard" | "choose";
export type PickModeExitConfirmIntent = Exclude<PickModeExitIntent, "choose">;

export interface BoneDisplay {
  visible: boolean;
  opacity: number;
}
export type BoneDisplays = Record<BoneClass, BoneDisplay>;

function defaultBoneDisplays(): BoneDisplays {
  return Object.fromEntries(
    BONE_CLASSES.map((c) => [c, { visible: true, opacity: DEFAULT_BONE_OPACITY }]),
  ) as BoneDisplays;
}

function boneAlphasFrom(displays: BoneDisplays, overlayOpacity: number): BoneAlphas {
  return Object.fromEntries(
    BONE_CLASSES.map((c) => [
      c,
      displays[c].visible ? boneOpacityToAlpha(displays[c].opacity, overlayOpacity) : 0,
    ]),
  ) as BoneAlphas;
}

export interface ToothSelectionControls {
  /** Jaw bone classes that have voxels in the loaded mask. */
  presentBoneClasses: BoneClass[];
  boneDisplays: BoneDisplays;
  setBoneVisible: (bone: BoneClass, visible: boolean) => void;
  setBoneOpacity: (bone: BoneClass, opacity: number) => void;
  /** True when the loaded overlay has at least one tooth class. */
  hasToothLabels: boolean;
  presentToothIds: string[];
  selectedToothIds: string[];
  detectedConditions: ToothConditionGroup[];
  /**
   * Pick mode: all teeth stay visible while selecting.
   * Leaving asks for confirmation only when the selection changed while picking.
   */
  pickFromPreview: boolean;
  /** True while applying colormap after a pick-mode toggle. */
  pickModePending: boolean;
  /** Selection from when pick mode was entered (for discard summary / restore). */
  pickModeBaselineToothIds: string[];
  /** Pending leave confirmation; `null` when no dialog is open. */
  pickModeExitIntent: PickModeExitIntent | null;
  setPickFromPreview: (enabled: boolean) => void;
  /**
   * Leave pick mode. Opens confirmation only if picks changed; otherwise exits immediately.
   */
  requestPickModeExit: (intent: PickModeExitIntent) => void;
  /** Confirm leaving pick mode with apply or discard. */
  confirmPickModeExit: (intent: PickModeExitConfirmIntent) => void;
  /** Dismiss the leave confirmation without changing pick mode. */
  cancelPickModeExit: () => void;
  /**
   * Toggle a detected tooth from the chart (no odontogram remount).
   * Returns false when the tooth is not in the present set and selection is unchanged.
   */
  toggleToothFromChart: (toothId: string) => boolean;
  /** Toggle a tooth from a preview click. */
  toggleToothFromPreview: (toothId: string) => void;
  /** Move the crosshair to a tooth's centroid (legend click). */
  focusTooth: (toothId: string) => void;
  /** Overlay volume index in niivue (-1 if none). */
  overlayIndex: number;
  /** Deselect every tooth (show none outside pick mode). */
  clearSelection: () => void;
  /** Select every detected tooth. */
  selectAll: () => void;
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

function readVoxelCounts(nv: NiiVueGPU, overlayIndex: number): Uint32Array {
  const img = nv.volumes[overlayIndex]?.img;
  return img ? maskVoxelCounts(img) : new Uint32Array(0);
}


/**
 * Scans the segmentation overlay for ToothSeg class labels, drives odontogram
 * selection, and filters the overlay via NiiVue label colormap alpha.
 *
 * Empty selection means show none. Default / reset selects every present tooth.
 */
export default function useToothSelectionControls({
  nvRef,
  queueNvUpdate,
  volumeVisibility,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
  volumeVisibility: boolean[];
}): ToothSelectionControls {
  const [presentClassIds, setPresentClassIds] = useState<number[]>([]);
  const [presentNonToothClassIds, setPresentNonToothClassIds] = useState<number[]>([]);
  const [boneDisplays, setBoneDisplays] = useState<BoneDisplays>(defaultBoneDisplays);
  const [selectedToothIds, setSelectedToothIds] = useState<string[]>([]);
  const [pickFromPreview, setPickFromPreviewState] = useState(false);
  const [pickModePending, setPickModePending] = useState(false);
  const [pickModeBaselineToothIds, setPickModeBaselineToothIds] = useState<string[]>([]);
  const [pickModeExitIntent, setPickModeExitIntent] = useState<PickModeExitIntent | null>(null);
  const [overlayIndex, setOverlayIndex] = useState(-1);

  const overlayIndexRef = useRef(-1);
  const presentClassIdsRef = useRef<number[]>([]);
  const voxelCountsRef = useRef<Uint32Array>(new Uint32Array(0));
  const selectedToothIdsRef = useRef<string[]>([]);
  const pickFromPreviewRef = useRef(false);
  const pickModePendingGenRef = useRef(0);
  /** Selection snapshot taken when pick mode was entered (for discard). */
  const selectionBeforePickRef = useRef<string[]>([]);
  /** True after a non-empty mask has been synced (so empty selection can mean cleared). */
  const hadMaskRef = useRef(false);
  const showAllCmapRef = useRef<LabelColorMap | null>(null);
  /** Whether the overlay GPU state currently shows every present tooth. */
  const overlayShowsAllRef = useRef(true);
  /** Last applied visibility signature (`*` = all). */
  const appliedVisibilityKeyRef = useRef<string | null>(null);
  /** True after the initial setColormapLabel installed centroids. */
  const labelColormapInstalledRef = useRef(false);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boneDisplaysRef = useRef(boneDisplays);
  /** Tooth visibility last sent to `pushVisibility`, re-applied when only a bone changes. */
  const lastVisibleClassIdsRef = useRef<number[] | null>(null);

  presentClassIdsRef.current = presentClassIds;
  selectedToothIdsRef.current = selectedToothIds;
  pickFromPreviewRef.current = pickFromPreview;

  const maskVisible = volumeVisibility[overlayIndex] ?? true;
  const maskVisibleRef = useRef(maskVisible);
  maskVisibleRef.current = maskVisible;

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

      lastVisibleClassIdsRef.current = visibleClassIds;
      // A hidden mask has opacity 0 and restores its opacity later; this is only a divisor.
      const overlayOpacity = nv.volumes[idx]?.opacity || DEFAULT_OVERLAY_OPACITY;
      const boneAlphas = boneAlphasFrom(boneDisplaysRef.current, overlayOpacity);
      const key = visibilityKey(visibleClassIds, boneAlphas);
      if (appliedVisibilityKeyRef.current === key && labelColormapInstalledRef.current) {
        overlayShowsAllRef.current = showsAll;
        return Promise.resolve();
      }

      const cmap = withColormapVisibility(base, visibleClassIds, boneAlphas);

      return new Promise((resolve) => {
        queueNvUpdate(NvUpdateKey.ToothLabels, () => {
          const vol = nv.volumes[idx] as
            | {
                colormapLabel?: RuntimeLabelColormap | null;
                isDirty?: boolean;
              }
            | undefined;
          if (!vol) {
            resolve();
            return;
          }

          const finish = () => {
            appliedVisibilityKeyRef.current = key;
            overlayShowsAllRef.current = showsAll;
            resolve();
          };

          // Hot path: after the first `setColormapLabel` (centroids computed once),
          // visibility toggles only swap LUT alphas + one `updateGLVolume`
          // — no volume rescan and no duplicate GPU refresh.
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

  const focusTooth = useCallback(
    (toothId: string) => {
      const nv = nvRef.current;
      const idx = overlayIndexRef.current;
      const fdi = toothIdToFdi(toothId);
      if (!nv || idx < 0 || fdi === null) {
        return;
      }
      const vol = nv.volumes[idx] as
        | { colormapLabel?: RuntimeLabelColormap | null }
        | undefined;
      // Label colormap entries are keyed by FDI number (see buildToothLabelColormap).
      const centroid = vol?.colormapLabel?.centroids?.[fdi];
      if (centroid) {
        nv.setCrosshairPos(centroid);
      }
    },
    [nvRef],
  );

  const showAllTeeth = useCallback((): Promise<void> => {
    if (!showAllCmapRef.current) {
      return Promise.resolve();
    }
    return pushVisibility(null, true);
  }, [pushVisibility]);

  /**
   * Rotate the 3D view around the selected teeth, or the scan centre while the
   * segmentation is hidden. Needs the colormap's centroids.
   */
  const pivotOnSelection = useCallback(
    (selected: string[]) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      const vol = nv.volumes[overlayIndexRef.current] as
        | { colormapLabel?: RuntimeLabelColormap | null }
        | undefined;
      setRotationPivot(
        nv,
        maskVisibleRef.current
          ? selectionCentreOfMass(
              selected,
              presentClassIdsRef.current,
              voxelCountsRef.current,
              vol?.colormapLabel?.centroids,
            )
          : null,
      );
    },
    [nvRef],
  );

  // Pick mode has not applied its picks yet, so it pivots on the earlier selection.
  useEffect(() => {
    pivotOnSelection(
      pickFromPreviewRef.current ? selectionBeforePickRef.current : selectedToothIdsRef.current,
    );
  }, [maskVisible, pivotOnSelection]);

  const filterToSelection = useCallback(
    (selected: string[]): Promise<void> => {
      const present = presentClassIdsRef.current;
      if (!showAllCmapRef.current) {
        return Promise.resolve();
      }
      const visible = visibleClassesFromSelection(present, selected);
      const applied =
        selected.length === 0
          ? pushVisibility([], false)
          : visible.length === present.length
            ? showAllTeeth()
            : pushVisibility(visible, false);
      return applied.then(() => pivotOnSelection(selected));
    },
    [pushVisibility, showAllTeeth, pivotOnSelection],
  );

  // Rebuild cached full colormap when the mask changes; apply current visibility.
  useEffect(() => {
    if (presentClassIds.length === 0 && presentNonToothClassIds.length === 0) {
      showAllCmapRef.current = null;
      overlayShowsAllRef.current = true;
      labelColormapInstalledRef.current = false;
      appliedVisibilityKeyRef.current = null;
      return;
    }
    const base = buildToothLabelColormap(presentClassIds, null, presentNonToothClassIds);
    showAllCmapRef.current = base;
    // New mask → force cold setColormapLabel so centroids match the volume.
    labelColormapInstalledRef.current = false;
    appliedVisibilityKeyRef.current = null;
    overlayShowsAllRef.current = false;
    if (pickFromPreviewRef.current) {
      void pushVisibility(null, true);
    } else {
      void filterToSelection(selectedToothIdsRef.current);
    }
    // Only re-run when the mask set changes — not on selection/pick toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentClassIds, presentNonToothClassIds, pushVisibility]);

  const updateBone = useCallback(
    (bone: BoneClass, change: Partial<BoneDisplay>) => {
      const next = {
        ...boneDisplaysRef.current,
        [bone]: { ...boneDisplaysRef.current[bone], ...change },
      };
      boneDisplaysRef.current = next;
      setBoneDisplays(next);
      void pushVisibility(lastVisibleClassIdsRef.current, overlayShowsAllRef.current);
    },
    [pushVisibility],
  );

  const setBoneVisible = useCallback(
    (bone: BoneClass, visible: boolean) => updateBone(bone, { visible }),
    [updateBone],
  );

  const setBoneOpacity = useCallback(
    (bone: BoneClass, opacity: number) => updateBone(bone, { opacity }),
    [updateBone],
  );

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
      voxelCountsRef.current = new Uint32Array(0);
      setPresentClassIds([]);
      setPresentNonToothClassIds([]);
      setSelectedToothIds([]);
      setPickFromPreviewState(false);
      pickFromPreviewRef.current = false;
      selectionBeforePickRef.current = [];
      setPickModeBaselineToothIds([]);
      setPickModeExitIntent(null);
      hadMaskRef.current = false;
      showAllCmapRef.current = null;
      labelColormapInstalledRef.current = false;
      appliedVisibilityKeyRef.current = null;
      return;
    }
    const voxelCounts = readVoxelCounts(nv, nextOverlayIndex);
    voxelCountsRef.current = voxelCounts;
    const present = presentClassesFromCounts(voxelCounts);
    const allIds = classesToToothIds(present);
    const firstMask = !hadMaskRef.current && present.length > 0;
    hadMaskRef.current = present.length > 0;
    setPresentClassIds(present);
    setPresentNonToothClassIds(presentNonToothClassesFromCounts(voxelCounts));
    setSelectedToothIds((prev) => {
      if (firstMask) {
        return allIds;
      }
      if (prev.length === 0) {
        return prev;
      }
      const allowed = new Set(allIds);
      return prev.filter((id) => allowed.has(id));
    });
  };

  const syncFromVolumes = useCallback((nv: NiiVueGPU) => {
    syncFromVolumesRef.current(nv);
  }, []);

  const toggleToothFromChart = useCallback((toothId: string): boolean => {
    const allowed = new Set(classesToToothIds(presentClassIdsRef.current));
    if (!allowed.has(toothId)) {
      return false;
    }
    setSelectedToothIds((prev) => toggleToothId(prev, toothId));
    return true;
  }, []);

  const toggleToothFromPreview = useCallback((toothId: string) => {
    setSelectedToothIds((prev) => toggleToothId(prev, toothId));
  }, []);

  const beginPickModeTransition = useCallback(
    (apply: () => Promise<void>) => {
      const gen = ++pickModePendingGenRef.current;
      setPickModePending(true);

      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
        filterDebounceRef.current = null;
      }

      void apply().finally(() => {
        if (gen === pickModePendingGenRef.current) {
          setPickModePending(false);
        }
      });
    },
    [],
  );

  const setPickFromPreview = useCallback(
    (enabled: boolean) => {
      if (pickModePending) {
        return;
      }
      if (enabled === pickFromPreviewRef.current) {
        return;
      }

      if (enabled) {
        const baseline = [...selectedToothIdsRef.current];
        selectionBeforePickRef.current = baseline;
        setPickModeBaselineToothIds(baseline);
        setPickModeExitIntent(null);
      }

      pickFromPreviewRef.current = enabled;
      setPickFromPreviewState(enabled);

      beginPickModeTransition(() =>
        enabled ? showAllTeeth() : filterToSelection(selectedToothIdsRef.current),
      );
    },
    [showAllTeeth, filterToSelection, pickModePending, beginPickModeTransition],
  );

  const discardPickMode = useCallback(() => {
    if (pickModePending || !pickFromPreviewRef.current) {
      return;
    }

    const restored = [...selectionBeforePickRef.current];
    pickFromPreviewRef.current = false;
    setPickFromPreviewState(false);
    selectedToothIdsRef.current = restored;
    setSelectedToothIds(restored);
    setPickModeExitIntent(null);

    beginPickModeTransition(() => filterToSelection(restored));
  }, [pickModePending, filterToSelection, beginPickModeTransition]);

  const requestPickModeExit = useCallback(
    (intent: PickModeExitIntent) => {
      if (pickModePending || !pickFromPreviewRef.current) {
        return;
      }
      // No confirmation when nothing changed — apply and discard are the same.
      if (sameToothSelection(selectedToothIdsRef.current, selectionBeforePickRef.current)) {
        setPickFromPreview(false);
        return;
      }
      setPickModeExitIntent(intent);
    },
    [pickModePending, setPickFromPreview],
  );

  const cancelPickModeExit = useCallback(() => {
    setPickModeExitIntent(null);
  }, []);

  const confirmPickModeExit = useCallback(
    (intent: PickModeExitConfirmIntent) => {
      setPickModeExitIntent(null);
      if (intent === "apply") {
        setPickFromPreview(false);
      } else {
        discardPickMode();
      }
    },
    [setPickFromPreview, discardPickMode],
  );

  const clearSelection = useCallback(() => {
    setSelectedToothIds([]);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedToothIds(classesToToothIds(presentClassIdsRef.current));
  }, []);

  const reset = useCallback(() => {
    pickModePendingGenRef.current += 1;
    setPickModePending(false);
    const allIds = classesToToothIds(presentClassIdsRef.current);
    selectedToothIdsRef.current = allIds;
    setSelectedToothIds(allIds);
    setPickFromPreviewState(false);
    pickFromPreviewRef.current = false;
    selectionBeforePickRef.current = [];
    setPickModeBaselineToothIds([]);
    setPickModeExitIntent(null);
    const bones = defaultBoneDisplays();
    boneDisplaysRef.current = bones;
    setBoneDisplays(bones);
    void showAllTeeth();
    if (nvRef.current) {
      setRotationPivot(nvRef.current, null);
    }
  }, [showAllTeeth, nvRef]);

  return {
    presentBoneClasses: BONE_CLASSES.filter((c) => presentNonToothClassIds.includes(c)),
    boneDisplays,
    setBoneVisible,
    setBoneOpacity,
    hasToothLabels,
    presentToothIds,
    selectedToothIds,
    detectedConditions,
    pickFromPreview,
    pickModePending,
    pickModeBaselineToothIds,
    pickModeExitIntent,
    setPickFromPreview,
    requestPickModeExit,
    confirmPickModeExit,
    cancelPickModeExit,
    toggleToothFromChart,
    toggleToothFromPreview,
    focusTooth,
    overlayIndex,
    clearSelection,
    selectAll,
    syncFromVolumes,
    reset,
  };
}
