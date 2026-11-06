import { useEffect, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ViewPhase } from "../types";

const MIDDLE_BUTTON = 1;
const SECONDARY_BUTTON = 2;

/*
  Middle-button drag pans the 2D tiles.
  NiiVue only binds drag modes to the left and right buttons, so a middle press on
  a slice tile is re-dispatched as a right press, which runs NiiVue's own pan
  (`secondaryDragMode: DRAG_MODE.pan`). Only the press needs translating: NiiVue
  tracks the rest of the drag from its own state, whichever button is released.
  The 3D tile has nothing to pan, so middle presses there are swallowed.
*/
export default function useNiivueMiddleButtonPan({
  canvasRef,
  nvRef,
  viewPhase,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
}): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      return;
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== MIDDLE_BUTTON || e.target !== canvas) {
        return;
      }
      e.stopPropagation();

      const nv = nvRef.current;
      if (!nv?.view) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const hit = nv.view.hitTest(x, y);
      if (!hit || hit.isRender) {
        return;
      }

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          clientX: e.clientX,
          clientY: e.clientY,
          shiftKey: e.shiftKey,
          button: SECONDARY_BUTTON,
          buttons: e.buttons,
        }),
      );
    };

    // Stops the browser's middle-click autoscroll from starting over the canvas.
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === MIDDLE_BUTTON && e.target === canvas) {
        e.preventDefault();
      }
    };

    const options = { capture: true } as const;
    container.addEventListener("pointerdown", handlePointerDown, options);
    container.addEventListener("mousedown", handleMouseDown, options);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, options);
      container.removeEventListener("mousedown", handleMouseDown, options);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase]);
}
