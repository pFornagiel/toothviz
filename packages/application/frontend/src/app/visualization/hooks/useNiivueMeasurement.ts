import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { DRAG_MODE } from "@niivue/niivue";
import type { ViewPhase } from "../types";
import { POINTER_CLICK_SLOP_PX } from "../constants";

export type MeasurePhase = "off" | "firstPoint" | "secondPoint";

export interface MeasurementControls {
  phase: MeasurePhase;
  /** Measurements currently drawn on the slices. */
  count: number;
  /** False where measuring cannot work: pick mode, or the 3D-only view. */
  available: boolean;
  start: () => void;
  /** Leaves measuring and drops an unfinished measurement. */
  cancel: () => void;
  clear: () => void;
  /** Cancels measuring and removes every measurement (Reset View). */
  reset: () => void;
}

const MIN_DISTANCE_MM = 0.01;
/** A second click also fires `dblclick`, which must not expand the tile. */
const DOUBLE_CLICK_GUARD_MS = 500;

/*
  Distance between two clicked points on a 2D tile.
  NiiVue only measures by dragging: press, move, release. So the first click reaches
  NiiVue as the press and its release is held back, which leaves NiiVue drawing a live
  line to the pointer; the second click's release is what ends the drag.
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
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  available: boolean;
  /** Tiles move when this changes, which would misplace a point already set. */
  layoutKey: string;
}): MeasurementControls {
  const [phase, setPhaseState] = useState<MeasurePhase>("off");
  const [count, setCount] = useState(0);
  const phaseRef = useRef<MeasurePhase>("off");
  const previousDragModeRef = useRef<number | null>(null);
  const pointerIdRef = useRef(0);
  const firstPressRef = useRef<{ x: number; y: number } | null>(null);
  const secondPressRef = useRef(false);
  const releasingRef = useRef(false);
  const finishedAtRef = useRef(-Infinity);

  const setPhase = useCallback((next: MeasurePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const leave = useCallback(() => {
    const nv = nvRef.current;
    if (nv && previousDragModeRef.current !== null) {
      nv.primaryDragMode = previousDragModeRef.current;
    }
    previousDragModeRef.current = null;
    firstPressRef.current = null;
    secondPressRef.current = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "";
    }
    setPhase("off");
    setCount(nv?.model.completedMeasurements.length ?? 0);
  }, [canvasRef, nvRef, setPhase]);

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
    setCount(0);
  }, [nvRef]);

  const reset = useCallback(() => {
    cancel();
    clear();
  }, [cancel, clear]);

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

    const hitsSliceTile = (e: PointerEvent): boolean => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const hit = nvRef.current?.view?.hitTest(x, y);
      return Boolean(hit && !hit.isRender);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.target !== canvas) {
        return;
      }
      if (phaseRef.current === "firstPoint") {
        // Scrolling, panning and rotating the 3D view stay available until a point is set.
        if (e.button !== 0 || e.shiftKey || !hitsSliceTile(e)) {
          return;
        }
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
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, capture);
      container.removeEventListener("pointerup", handlePointerUp, capture);
      container.removeEventListener("wheel", blockWhilePointIsSet, capture);
      container.removeEventListener("dblclick", handleDoubleClick, capture);
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase, cancel, finish]);

  return { phase, count, available, start, cancel, clear, reset };
}
