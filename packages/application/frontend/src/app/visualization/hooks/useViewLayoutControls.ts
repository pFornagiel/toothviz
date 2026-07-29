import { useEffect, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE, MULTIPLANAR_TYPE, SHOW_RENDER } from "@niivue/niivue";
import { SliceTypeKey, DEFAULT_SLICE_TYPE } from "../constants";

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

  // Slice types that include a 3D render tile and therefore expose render controls
  const showsRender =
    sliceType === SliceTypeKey.Render ||
    sliceType === SliceTypeKey.Multiplanar ||
    sliceType === SliceTypeKey.Multiplanar4View;

  const showsSlices =
    sliceType === SliceTypeKey.Axial ||
    sliceType === SliceTypeKey.Coronal ||
    sliceType === SliceTypeKey.Sagittal ||
    sliceType === SliceTypeKey.Multiplanar ||
    sliceType === SliceTypeKey.Multiplanar4View;

  const handleSliceTypeChange = (type: SliceTypeKey) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }
    setSliceType(type);

    switch (type) {
      case SliceTypeKey.Multiplanar:
        nv.sliceType = SLICE_TYPE.MULTIPLANAR;
        nv.multiplanarType = MULTIPLANAR_TYPE.AUTO;
        nv.showRender = SHOW_RENDER.AUTO;
        break;
      case SliceTypeKey.Multiplanar4View:
        nv.sliceType = SLICE_TYPE.MULTIPLANAR;
        nv.multiplanarType = MULTIPLANAR_TYPE.GRID;
        nv.showRender = SHOW_RENDER.ALWAYS;
        break;
      case SliceTypeKey.Axial:
        nv.sliceType = SLICE_TYPE.AXIAL;
        break;
      case SliceTypeKey.Coronal:
        nv.sliceType = SLICE_TYPE.CORONAL;
        break;
      case SliceTypeKey.Sagittal:
        nv.sliceType = SLICE_TYPE.SAGITTAL;
        break;
      case SliceTypeKey.Render:
        nv.sliceType = SLICE_TYPE.RENDER;
        break;
    }
  };

  useEffect(() => {
    // Update multiplanar layout when switching to multiplanar_4view
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    if (sliceType === SliceTypeKey.Multiplanar4View) {
      nv.multiplanarType = MULTIPLANAR_TYPE.GRID;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceType]);

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
