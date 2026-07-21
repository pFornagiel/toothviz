import { useEffect, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE } from "@niivue/niivue";
import type { ViewPhase } from "../types";
import { SliceTypeKey, DEFAULT_SLICE_TYPE } from "../constants";

function hitToSliceKey(hit: { isRender?: boolean; sliceType?: number }): SliceTypeKey | null {
  if (hit.isRender) {
    return SliceTypeKey.Render;
  }
  switch (hit.sliceType) {
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

/*
  Double-click a multiplanar tile to expand it to a single-plane (or 3D) view.
  Double-click again in a single view restores the default multiplanar layout.
  Intercepted in capture phase so NiiVue's own dblclick (crosshair pick) does not run.
*/
export default function useNiivueTileDoubleClick({
  canvasRef,
  nvRef,
  viewPhase,
  sliceType,
  handleSliceTypeChange,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  sliceType: SliceTypeKey;
  handleSliceTypeChange: (type: SliceTypeKey) => void;
}): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      return;
    }

    const handleDblClick = (e: MouseEvent) => {
      const nv = nvRef.current;
      if (!nv?.view || e.target !== canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const hit = nv.view.hitTest(x, y);
      if (!hit) {
        return;
      }

      const target = hitToSliceKey(hit);
      if (!target) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const isMulti =
        sliceType === SliceTypeKey.Multiplanar ||
        sliceType === SliceTypeKey.Multiplanar4View;

      if (isMulti) {
        handleSliceTypeChange(target);
        return;
      }

      // Already a single view: toggle back to default multiplanar.
      handleSliceTypeChange(DEFAULT_SLICE_TYPE);
    };

    container.addEventListener("dblclick", handleDblClick, { capture: true });
    return () => container.removeEventListener("dblclick", handleDblClick, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPhase, sliceType, handleSliceTypeChange]);
}
