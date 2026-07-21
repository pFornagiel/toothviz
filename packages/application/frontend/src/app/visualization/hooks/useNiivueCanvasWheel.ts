import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ViewPhase } from "../types";
import {
  CLIP_DEPTH_RANGE,
  RENDER_ZOOM_RANGE,
  RENDER_ZOOM_SCROLL_FACTOR,
  CLIP_DEPTH_SCROLL_STEP,
  PAN2D_ZOOM_RANGE,
} from "../constants";
import { clamp } from "../../utils/clamp";
import { sliceAxisIndex, zoomPan2D } from "./niivueZoom";

/*
  Wheel-canvas interaction.
  Niivue registers its own `wheel` listener on the canvas to scroll slices/zoom.
  We intercept on the canvas's parent in the capture phase and call stopPropagation,
  so the event never reaches niivue's handler.
  Plain scroll zooms the hovered tile (3D → scaleMultiplier, 2D → pan2Dxyzmm),
  Shift+scroll nudges the clip-plane depth,
  Ctrl/Cmd+scroll scrolls slices (since we block NiiVue's handler).
  Re-attaches whenever the canvas mounts.
*/
export default function useNiivueCanvasWheel({
  canvasRef,
  nvRef,
  viewPhase,
  setClipPlaneDepth,
  setRenderZoom,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
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

    const canvasCoords = (e: WheelEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    const hitsRenderTile = (e: WheelEvent): boolean => {
      const nv = nvRef.current;
      if (!nv?.view) {
        return false;
      }
      const { x, y } = canvasCoords(e);
      return nv.view.hitTest(x, y)?.isRender ?? false;
    };

    const hitSliceType = (e: WheelEvent): number | null => {
      const nv = nvRef.current;
      if (!nv?.view) {
        return null;
      }
      const { x, y } = canvasCoords(e);
      const hit = nv.view.hitTest(x, y);
      if (!hit || hit.isRender) {
        return null;
      }
      return typeof hit.sliceType === "number" ? hit.sliceType : null;
    };

    const handleWheel = (e: WheelEvent) => {
      const nv = nvRef.current;
      if (!nv || e.target !== canvas) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const direction = e.deltaY < 0 ? 1 : -1;

      if (e.shiftKey) {
        setClipPlaneDepth((prev) =>
          clamp(
            prev + direction * CLIP_DEPTH_SCROLL_STEP,
            CLIP_DEPTH_RANGE.min,
            CLIP_DEPTH_RANGE.max,
          ),
        );
        return;
      }

      // Slice scroll stays available because we block NiiVue's own wheel handler.
      if (e.ctrlKey || e.metaKey) {
        const sliceType = hitSliceType(e) ?? nv.sliceType;
        const axis = sliceAxisIndex(sliceType);
        const step = e.deltaY > 0 ? 1 : -1;
        const delta = [0, 0, 0] as [number, number, number];
        delta[axis] = step;
        nv.moveCrosshairInVox(delta[0], delta[1], delta[2]);
        return;
      }

      const factor = direction > 0 ? RENDER_ZOOM_SCROLL_FACTOR : 1 / RENDER_ZOOM_SCROLL_FACTOR;

      if (hitsRenderTile(e)) {
        const next = clamp(
          nv.scaleMultiplier * factor,
          RENDER_ZOOM_RANGE.min,
          RENDER_ZOOM_RANGE.max,
        );
        nv.scaleMultiplier = next;
        setRenderZoom(next);
        return;
      }

      const prev = nv.pan2Dxyzmm[3] ?? 1;
      const next = clamp(prev * factor, PAN2D_ZOOM_RANGE.min, PAN2D_ZOOM_RANGE.max);
      zoomPan2D(nv, next);
    };

    container.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => container.removeEventListener("wheel", handleWheel, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase]);
}
