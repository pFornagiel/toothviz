import { useEffect, useRef, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { NiiVueLocation } from "@niivue/niivue";
import type { ViewPhase } from "../types";
import { DEFAULT_OVERLAY_NAME, POINTER_CLICK_SLOP_PX } from "../constants";
import { slicePickMessage } from "../pickModeCopy";
import {
  classToToothId,
  toothClassFromLocationValues,
  toothIdToFdi,
} from "../toothLabels";

/**
 * When pick-from-preview mode is on, a short click on the viewer toggles the
 * tooth class under the crosshair (from the segmentation overlay).
 */
export default function useNiivueToothPick({
  canvasRef,
  nvRef,
  viewPhase,
  enabled,
  overlayIndex,
  presentToothIds,
  selectedToothIds,
  toggleToothFromPreview,
  onSlicePickFeedback,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  enabled: boolean;
  overlayIndex: number;
  presentToothIds: string[];
  selectedToothIds: string[];
  toggleToothFromPreview: (toothId: string) => void;
  /** Short toast after a successful slice pick (e.g. "Selected 16"). */
  onSlicePickFeedback?: (message: string) => void;
}): void {
  const lastLocationRef = useRef<NiiVueLocation | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const presentSetRef = useRef(new Set(presentToothIds));
  const selectedSetRef = useRef(new Set(selectedToothIds));
  const toggleRef = useRef(toggleToothFromPreview);
  const feedbackRef = useRef(onSlicePickFeedback);
  const overlayIndexRef = useRef(overlayIndex);

  presentSetRef.current = new Set(presentToothIds);
  selectedSetRef.current = new Set(selectedToothIds);
  toggleRef.current = toggleToothFromPreview;
  feedbackRef.current = onSlicePickFeedback;
  overlayIndexRef.current = overlayIndex;

  // Keep latest location from niivue while pick mode may be on or off.
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const onLocation = (e: CustomEvent<NiiVueLocation>) => {
      lastLocationRef.current = e.detail;
    };
    nv.addEventListener("locationChange", onLocation);
    return () => {
      nv.removeEventListener("locationChange", onLocation);
    };
    // Re-attach when viewer becomes ready / nv instance is recreated.
  }, [viewPhase, nvRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.style.cursor = enabled ? "pointer" : "";

    if (!enabled) {
      downRef.current = null;
      return () => {
        canvas.style.cursor = "";
      };
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== canvas) {
        return;
      }
      downRef.current = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: PointerEvent) => {
      const down = downRef.current;
      downRef.current = null;
      if (!down || e.button !== 0) {
        return;
      }
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist > POINTER_CLICK_SLOP_PX) {
        return;
      }

      const loc = lastLocationRef.current;
      if (!loc?.values?.length) {
        return;
      }

      const classId = toothClassFromLocationValues(
        loc.values,
        overlayIndexRef.current,
        DEFAULT_OVERLAY_NAME,
      );
      if (classId === null) {
        return;
      }
      const toothId = classToToothId(classId);
      if (!toothId || !presentSetRef.current.has(toothId)) {
        return;
      }

      const fdi = toothIdToFdi(toothId);
      const nowSelected = !selectedSetRef.current.has(toothId);
      toggleRef.current(toothId);
      // Optimistic: keep the ref in sync before React re-renders.
      if (nowSelected) {
        selectedSetRef.current.add(toothId);
      } else {
        selectedSetRef.current.delete(toothId);
      }
      if (fdi) {
        feedbackRef.current?.(slicePickMessage(fdi, nowSelected));
      }
    };

    const handlePointerCancel = () => {
      downRef.current = null;
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [canvasRef, enabled, viewPhase]);
}
