import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ViewPhase } from "../visualization/types";
import { CLIP_DEPTH_RANGE, RENDER_ZOOM_RANGE } from "../pages/visualizationConstants";

// Mouse-wheel interaction over the canvas
const RENDER_ZOOM_SCROLL_FACTOR = 1.1; // multiplicative zoom step per wheel notch
const CLIP_DEPTH_SCROLL_STEP = 0.05; // additive clip-depth step per wheel notch

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/*
  Wheel-canvas interaction.
  Niivue registers its own `wheel` listener on the canvas to scroll slices/zoom;
  we intercept on the canvas's parent in the capture phase and call stopPropagation,
  so the event never reaches niivue's handler.
  Plain scroll zooms the render (scaleMultiplier),
  Shift+scroll nudges the clip-plane depth.
  Re-attaches whenever the canvas mounts, which is keyed off viewPhase.
*/
export default function useNiivueCanvasWheel({
  canvasRef,
  nvRef,
  viewPhase,
  setClipPlaneDepth,
  setRenderZoom,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: MutableRefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  setClipPlaneDepth: Dispatch<SetStateAction<number>>;
  setRenderZoom: (zoom: number) => void;
}): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      const nv = nvRef.current;
      if (!nv || e.target !== canvas) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      // deltaY < 0 means scrolling up: zoom in / increase depth.
      const direction = e.deltaY < 0 ? 1 : -1;

      if (e.shiftKey) {
        setClipPlaneDepth((prev) =>
          clamp(
            prev + direction * CLIP_DEPTH_SCROLL_STEP,
            CLIP_DEPTH_RANGE.min,
            CLIP_DEPTH_RANGE.max,
          ),
        );
      } else {
        const factor = direction > 0 ? RENDER_ZOOM_SCROLL_FACTOR : 1 / RENDER_ZOOM_SCROLL_FACTOR;
        const next = clamp(
          nv.scaleMultiplier * factor,
          RENDER_ZOOM_RANGE.min,
          RENDER_ZOOM_RANGE.max,
        );
        nv.scaleMultiplier = next;
        setRenderZoom(next);
      }
    };

    container.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => container.removeEventListener("wheel", handleWheel, { capture: true });
    // Keyed on viewPhase only (byte-identical to the original page effect): the
    // refs and the state setter are stable, and the listener must re-attach
    // exactly when the canvas (re)mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase]);
}
