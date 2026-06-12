import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import { CLIP_DEPTH_EDGE } from "../constants";

// start fully visible (nothing clipped)
const DEFAULT_CLIP_PLANE_DEPTH = CLIP_DEPTH_EDGE;

export interface ClipPlaneControls {
  clipPlaneDepth: number;
  setClipPlaneDepth: Dispatch<SetStateAction<number>>;
  clipPlaneAzimuth: number;
  setClipPlaneAzimuth: Dispatch<SetStateAction<number>>;
  clipPlaneElevation: number;
  setClipPlaneElevation: Dispatch<SetStateAction<number>>;
}

/**
 * 3D clip-plane orientation (depth/azimuth/elevation). The setters are exposed
 * raw — the wheel-interaction hook drives `setClipPlaneDepth` directly — and an
 * effect pushes the composed plane into niivue through the shared update queue.
 */
export default function useClipPlaneControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: RefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): ClipPlaneControls {
  const [clipPlaneDepth, setClipPlaneDepth] = useState(DEFAULT_CLIP_PLANE_DEPTH);
  const [clipPlaneAzimuth, setClipPlaneAzimuth] = useState(0);
  const [clipPlaneElevation, setClipPlaneElevation] = useState(0);

  const handleClipPlaneChange = useCallback(() => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    queueNvUpdate(NvUpdateKey.ClipPlane, () =>
      nv.setClipPlane([clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation, queueNvUpdate]);

  useEffect(() => {
    handleClipPlaneChange();
  }, [handleClipPlaneChange]);

  return {
    clipPlaneDepth,
    setClipPlaneDepth,
    clipPlaneAzimuth,
    setClipPlaneAzimuth,
    clipPlaneElevation,
    setClipPlaneElevation,
  };
}
