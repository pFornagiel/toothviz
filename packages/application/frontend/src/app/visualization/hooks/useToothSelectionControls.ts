import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ToothDetail, ToothConditionGroup } from "react-odontogram";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { DEFAULT_OVERLAY_NAME } from "../constants";
import {
  buildDetectedConditions,
  buildToothLabelColormap,
  classesToToothIds,
  presentClassesFromImg,
  visibleClassesFromSelection,
} from "../toothLabels";

export interface ToothSelectionControls {
  /** True when the loaded overlay has at least one tooth class. */
  hasToothLabels: boolean;
  presentToothIds: string[];
  selectedToothIds: string[];
  detectedConditions: ToothConditionGroup[];
  /** Bump to remount uncontrolled Odontogram after Show all. */
  odontogramKey: number;
  onOdontogramChange: (selected: ToothDetail[]) => void;
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
  const overlayIndexRef = useRef(-1);
  const presentClassIdsRef = useRef<number[]>([]);

  presentClassIdsRef.current = presentClassIds;

  const presentToothIds = classesToToothIds(presentClassIds);
  const detectedConditions = buildDetectedConditions(presentToothIds);
  const hasToothLabels = presentToothIds.length > 0;

  const applyColormap = useCallback(
    (present: number[], selected: string[]) => {
      const nv = nvRef.current;
      const overlayIndex = overlayIndexRef.current;
      if (!nv || overlayIndex < 0 || present.length === 0) {
        return;
      }

      const visible = visibleClassesFromSelection(present, selected);
      const cmap = buildToothLabelColormap(present, visible);

      queueNvUpdate(NvUpdateKey.ToothLabels, () => {
        nv.volumeIsAlphaClipDark = true;
        void nv.setColormapLabel(overlayIndex, cmap).then(() => {
          void nv.updateGLVolume();
        });
      });
    },
    [nvRef, queueNvUpdate],
  );

  useEffect(() => {
    if (presentClassIds.length === 0) {
      return;
    }
    applyColormap(presentClassIds, selectedToothIds);
  }, [presentClassIds, selectedToothIds, applyColormap]);

  const syncFromVolumesRef = useRef<(nv: NiiVueGPU) => void>(() => {});
  syncFromVolumesRef.current = (nv: NiiVueGPU) => {
    const overlayIndex = findOverlayIndex(nv);
    overlayIndexRef.current = overlayIndex;
    if (overlayIndex < 0) {
      setPresentClassIds([]);
      setSelectedToothIds([]);
      return;
    }
    const present = readPresentClasses(nv, overlayIndex);
    setPresentClassIds(present);
    // Drop selection that no longer exists in the new mask.
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
    setSelectedToothIds(selected.map((t) => t.id));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedToothIds([]);
    setOdontogramKey((k) => k + 1);
  }, []);

  const reset = useCallback(() => {
    setSelectedToothIds([]);
    setOdontogramKey((k) => k + 1);
    applyColormap(presentClassIdsRef.current, []);
  }, [applyColormap]);

  return {
    hasToothLabels,
    presentToothIds,
    selectedToothIds,
    detectedConditions,
    odontogramKey,
    onOdontogramChange,
    clearSelection,
    syncFromVolumes,
    reset,
  };
}
