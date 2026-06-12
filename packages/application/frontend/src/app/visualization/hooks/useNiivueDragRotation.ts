import { useEffect, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ViewPhase } from "../types";
import { RENDER_DRAG_DPR_SCALE, NATIVE_DPR_AUTO } from "../constants";

/*
  Render-tile drag rotation.
  Left-button drags that start inside the 3D render tile are intercepted on the
  canvas's parent in the capture phase and routed through dragRotate (unclamped
  elevation). Resolution is scaled down during the drag and restored on release.
*/
export default function useNiivueDragRotation({
  canvasRef,
  nvRef,
  viewPhase,
  dragRotate,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  dragRotate: (dx: number, dy: number) => void;
}): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      return;
    }

    let dragging = false;
    let pointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const beginInteractiveResolution = () => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      (nv as unknown as { devicePixelRatio: number }).devicePixelRatio =
        (window.devicePixelRatio || 1) * RENDER_DRAG_DPR_SCALE;
    };
    const endInteractiveResolution = () => {
      const nv = nvRef.current;
      if (!nv) {
        return;
      }
      (nv as unknown as { devicePixelRatio: number }).devicePixelRatio = NATIVE_DPR_AUTO;
    };

    const hitsRenderTile = (e: PointerEvent): boolean => {
      const nv = nvRef.current;
      if (!(nv as unknown as { view: unknown })?.view) {
        return false;
      }
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (nv as any).view?.hitTest(x, y)?.isRender ?? false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey || e.target !== canvas) {
        return;
      }
      if (!hitsRenderTile(e)) {
        return;
      }
      e.stopPropagation();
      dragging = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      beginInteractiveResolution();
      canvas.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) {
        return;
      }
      e.stopPropagation();
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dx !== 0 || dy !== 0) {
        dragRotate(dx, dy);
      }
    };

    const endDrag = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) {
        return;
      }
      e.stopPropagation();
      dragging = false;
      pointerId = null;
      endInteractiveResolution();
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };

    const options = { capture: true } as const;
    container.addEventListener("pointerdown", handlePointerDown, options);
    container.addEventListener("pointermove", handlePointerMove, options);
    container.addEventListener("pointerup", endDrag, options);
    container.addEventListener("pointercancel", endDrag, options);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, options);
      container.removeEventListener("pointermove", handlePointerMove, options);
      container.removeEventListener("pointerup", endDrag, options);
      container.removeEventListener("pointercancel", endDrag, options);
      if (dragging) {
        endInteractiveResolution();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase, dragRotate]);
}
