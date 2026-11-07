import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { DRAG_MODE, SLICE_TYPE } from "@niivue/niivue";
import type { ViewPhase } from "../types";
import { POINTER_CLICK_SLOP_PX, SliceTypeKey } from "../constants";
import { clamp } from "../../utils/clamp";
import { centerPan2D } from "./niivueZoom";

export type MeasurePhase = "off" | "firstPoint" | "secondPoint";

export interface MeasurementItem {
  distance: number;
  /** The plane it was measured on, or `null` for any other slice type. */
  plane: SliceTypeKey | null;
}

export interface MeasurementControls {
  phase: MeasurePhase;
  /** Every measurement, in the order they were made. */
  measurements: MeasurementItem[];
  /** False where measuring cannot work: pick mode, or the 3D-only view. */
  available: boolean;
  start: () => void;
  /** Leaves measuring and drops an unfinished measurement. */
  cancel: () => void;
  clear: () => void;
  /** Removes one measurement. */
  remove: (index: number) => void;
  /** Moves the crosshair to a measurement and makes sure its plane is on screen. */
  goTo: (index: number) => void;
  /** Cancels measuring and removes every measurement (Reset View). */
  reset: () => void;
}

/** A tile's edges in client (CSS pixel) coordinates. */
type TileBounds = { left: number; top: number; right: number; bottom: number };

function planeOf(sliceType: number): SliceTypeKey | null {
  switch (sliceType) {
    case SLICE_TYPE.AXIAL:
      return SliceTypeKey.Axial;
    case SLICE_TYPE.CORONAL:
      return SliceTypeKey.Coronal;
    case SLICE_TYPE.SAGITTAL:
      return SliceTypeKey.Sagittal;
    default:
      return null;
  }
}

const MIN_DISTANCE_MM = 0.01;
/** A second click also fires `dblclick`, which must not expand the tile. */
const DOUBLE_CLICK_GUARD_MS = 500;

/*
  Distance between two clicked points on a 2D tile.
  NiiVue only measures by dragging: press, move, release. So the first click reaches
  NiiVue as the press and its release is held back, which leaves NiiVue drawing a live
  line to the pointer; the second click's release is what ends the drag.
  NiiVue stores a measurement clamped to the first point's tile but draws the live line
  anywhere, so pointer moves are clamped to that tile to keep the two the same.
  With a point placed, other presses and the wheel are blocked: panning would restart
  NiiVue's drag, and zooming would move the first point, which it keeps in screen pixels.
  Measuring ends by itself after one measurement. Must be registered before the other
  canvas hooks, so that its capture listeners run first.
*/
export default function useNiivueMeasurement({
  canvasRef,
  nvRef,
  viewPhase,
  available,
  layoutKey,
  onShowPlane,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  available: boolean;
  /** Tiles move when this changes, which would misplace a point already set. */
  layoutKey: string;
  /** Makes a plane visible, when going to a measurement made on it. */
  onShowPlane: (plane: SliceTypeKey | null) => void;
}): MeasurementControls {
  const [phase, setPhaseState] = useState<MeasurePhase>("off");
  const [measurements, setMeasurements] = useState<MeasurementItem[]>([]);
  const phaseRef = useRef<MeasurePhase>("off");
  const previousDragModeRef = useRef<number | null>(null);
  const pointerIdRef = useRef(0);
  const firstPressRef = useRef<{ x: number; y: number } | null>(null);
  const secondPressRef = useRef(false);
  const releasingRef = useRef(false);
  const tileBoundsRef = useRef<TileBounds | null>(null);
  const forwardingMoveRef = useRef(false);
  const finishedAtRef = useRef(-Infinity);

  const setPhase = useCallback((next: MeasurePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const syncList = useCallback(() => {
    const list = nvRef.current?.model.completedMeasurements ?? [];
    setMeasurements(list.map((m) => ({ distance: m.distance, plane: planeOf(m.sliceType) })));
  }, [nvRef]);

  const leave = useCallback(() => {
    const nv = nvRef.current;
    if (nv && previousDragModeRef.current !== null) {
      nv.primaryDragMode = previousDragModeRef.current;
    }
    previousDragModeRef.current = null;
    firstPressRef.current = null;
    secondPressRef.current = false;
    tileBoundsRef.current = null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "";
    }
    setPhase("off");
    syncList();
  }, [canvasRef, nvRef, setPhase, syncList]);

  /** Ends measuring once NiiVue has handled the release and stored the measurement. */
  const finish = useCallback(() => {
    finishedAtRef.current = performance.now();
    const nv = nvRef.current;
    if (nv) {
      const list = nv.model.completedMeasurements;
      if (list.length > 0 && list[list.length - 1].distance < MIN_DISTANCE_MM) {
        list.pop();
        nv.drawScene();
      }
    }
    leave();
  }, [leave, nvRef]);

  const cancel = useCallback(() => {
    if (phaseRef.current === "off") {
      return;
    }
    const nv = nvRef.current;
    const canvas = canvasRef.current;
    if (phaseRef.current === "secondPoint" && nv && canvas) {
      // NiiVue has no way to abort a drag: end it, then drop what it stored.
      const stored = nv.model.completedMeasurements.length;
      releasingRef.current = true;
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: pointerIdRef.current }),
      );
      releasingRef.current = false;
      nv.model.completedMeasurements.length = stored;
      nv.drawScene();
    }
    leave();
  }, [canvasRef, leave, nvRef]);

  const start = useCallback(() => {
    const nv = nvRef.current;
    if (!nv || phaseRef.current !== "off") {
      return;
    }
    previousDragModeRef.current = nv.primaryDragMode;
    nv.primaryDragMode = DRAG_MODE.measurement;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "crosshair";
    }
    setPhase("firstPoint");
  }, [canvasRef, nvRef, setPhase]);

  const clear = useCallback(() => {
    nvRef.current?.clearMeasurements();
    syncList();
  }, [nvRef, syncList]);

  const remove = useCallback(
    (index: number) => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      cancel();
      nv.model.completedMeasurements.splice(index, 1);
      nv.drawScene();
      syncList();
    },
    [cancel, nvRef, syncList],
  );

  const goTo = useCallback(
    (index: number) => {
      const nv = nvRef.current;
      const measurement = nv?.model.completedMeasurements[index];
      if (!nv || !measurement) {
        return;
      }
      cancel();
      onShowPlane(planeOf(measurement.sliceType));
      const { startMM, endMM } = measurement;
      const middle: [number, number, number] = [
        (startMM[0] + endMM[0]) / 2,
        (startMM[1] + endMM[1]) / 2,
        (startMM[2] + endMM[2]) / 2,
      ];
      nv.setCrosshairPos(middle);
      centerPan2D(nv, middle);
    },
    [cancel, nvRef, onShowPlane],
  );

  const reset = useCallback(() => {
    cancel();
    clear();
  }, [cancel, clear]);

  // A newly loaded scan starts without measurements.
  useEffect(() => {
    syncList();
  }, [viewPhase, syncList]);

  useEffect(() => {
    if (!available) {
      cancel();
    }
  }, [available, cancel]);

  useEffect(() => {
    cancel();
  }, [layoutKey, cancel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      return;
    }

    /** Edges of the 2D tile under the pointer, or `null` when there is none. */
    const sliceTileBounds = (e: PointerEvent): TileBounds | null => {
      const view = nvRef.current?.view;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const hit = view?.hitTest((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
      const tile = hit && !hit.isRender ? view?.screenSlices[hit.tileIndex]?.leftTopWidthHeight : null;
      if (!tile) {
        return null;
      }
      const [left, top, width, height] = tile;
      return {
        left: rect.left + left / scaleX,
        top: rect.top + top / scaleY,
        right: rect.left + (left + width) / scaleX,
        bottom: rect.top + (top + height) / scaleY,
      };
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.target !== canvas) {
        return;
      }
      if (phaseRef.current === "firstPoint") {
        // Scrolling, panning and rotating the 3D view stay available until a point is set.
        const bounds = e.button === 0 && !e.shiftKey ? sliceTileBounds(e) : null;
        if (!bounds) {
          return;
        }
        tileBoundsRef.current = bounds;
        pointerIdRef.current = e.pointerId;
        firstPressRef.current = { x: e.clientX, y: e.clientY };
        setPhase("secondPoint");
        return;
      }
      if (phaseRef.current === "secondPoint") {
        e.stopImmediatePropagation();
        if (e.button === 0) {
          secondPressRef.current = true;
          pointerIdRef.current = e.pointerId;
          canvas.setPointerCapture(e.pointerId);
        }
      }
    };

    // On the window, so the line also stops at the tile's edge when the pointer leaves the canvas.
    const handlePointerMove = (e: PointerEvent) => {
      const bounds = tileBoundsRef.current;
      if (phaseRef.current !== "secondPoint" || !bounds || forwardingMoveRef.current) {
        return;
      }
      const clientX = clamp(e.clientX, bounds.left, bounds.right);
      const clientY = clamp(e.clientY, bounds.top, bounds.bottom);
      const onCanvas = e.target === canvas;
      if (onCanvas && clientX === e.clientX && clientY === e.clientY) {
        return;
      }
      if (onCanvas) {
        e.stopImmediatePropagation();
      }
      forwardingMoveRef.current = true;
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX,
          clientY,
          pointerId: e.pointerId,
          buttons: e.buttons,
        }),
      );
      forwardingMoveRef.current = false;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (phaseRef.current !== "secondPoint" || releasingRef.current) {
        return;
      }
      const first = firstPressRef.current;
      if (first) {
        firstPressRef.current = null;
        const dragged =
          Math.hypot(e.clientX - first.x, e.clientY - first.y) > POINTER_CLICK_SLOP_PX;
        if (!dragged) {
          e.stopImmediatePropagation();
          return;
        }
      } else if (!secondPressRef.current || e.button !== 0) {
        e.stopImmediatePropagation();
        return;
      }
      // Let NiiVue's own listener store the measurement first.
      setTimeout(finish, 0);
    };

    const blockWhilePointIsSet = (e: Event) => {
      if (phaseRef.current === "secondPoint") {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    const handleDoubleClick = (e: MouseEvent) => {
      const justFinished = performance.now() - finishedAtRef.current < DOUBLE_CLICK_GUARD_MS;
      if (phaseRef.current !== "off" || justFinished) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancel();
      }
    };

    const capture = { capture: true } as const;
    const wheel = { capture: true, passive: false } as const;
    container.addEventListener("pointerdown", handlePointerDown, capture);
    container.addEventListener("pointerup", handlePointerUp, capture);
    container.addEventListener("wheel", blockWhilePointIsSet, wheel);
    container.addEventListener("dblclick", handleDoubleClick, capture);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointermove", handlePointerMove, capture);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, capture);
      container.removeEventListener("pointerdown", handlePointerDown, capture);
      container.removeEventListener("pointerup", handlePointerUp, capture);
      container.removeEventListener("wheel", blockWhilePointIsSet, capture);
      container.removeEventListener("dblclick", handleDoubleClick, capture);
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase, cancel, finish]);

  return { phase, measurements, available, start, cancel, clear, remove, goTo, reset };
}
