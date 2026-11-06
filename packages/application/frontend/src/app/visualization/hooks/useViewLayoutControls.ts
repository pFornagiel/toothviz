import { useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE } from "@niivue/niivue";
import { SliceTypeKey, DEFAULT_SLICE_TYPE } from "../constants";
import { showMultiplanarLayout, showSingleTile } from "./niivueLayout";

export interface ViewLayoutControls {
  sliceType: SliceTypeKey;
  handleSliceTypeChange: (type: SliceTypeKey) => void;
  /** Slice types that include a 3D render tile and therefore expose render controls */
  showsRender: boolean;
  /** Slice types that include at least one 2D plane tile */
  showsSlices: boolean;
  /** Restores the default multiplanar layout. */
  reset: () => void;
}

/**
 * Slice-type selection and the derived `showsRender` flag that gates the
 * clip/render control sections. Pushes the niivue slice/multiplanar/render
 * mode directly on change.
 */
export default function useViewLayoutControls({
  nvRef,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
}): ViewLayoutControls {
  const [sliceType, setSliceType] = useState<SliceTypeKey>(DEFAULT_SLICE_TYPE);

  const showsRender =
    sliceType === SliceTypeKey.Render || sliceType === SliceTypeKey.Multiplanar;

  const showsSlices =
    sliceType === SliceTypeKey.Axial ||
    sliceType === SliceTypeKey.Coronal ||
    sliceType === SliceTypeKey.Sagittal ||
    sliceType === SliceTypeKey.Multiplanar;

  const handleSliceTypeChange = (type: SliceTypeKey) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }
    setSliceType(type);

    switch (type) {
      case SliceTypeKey.Multiplanar:
        showMultiplanarLayout(nv);
        break;
      case SliceTypeKey.Axial:
        showSingleTile(nv, SLICE_TYPE.AXIAL);
        break;
      case SliceTypeKey.Coronal:
        showSingleTile(nv, SLICE_TYPE.CORONAL);
        break;
      case SliceTypeKey.Sagittal:
        showSingleTile(nv, SLICE_TYPE.SAGITTAL);
        break;
      case SliceTypeKey.Render:
        showSingleTile(nv, SLICE_TYPE.RENDER);
        break;
    }
  };

  const reset = () => {
    handleSliceTypeChange(DEFAULT_SLICE_TYPE);
  };

  return {
    sliceType,
    handleSliceTypeChange,
    showsRender,
    showsSlices,
    reset,
  };
}
