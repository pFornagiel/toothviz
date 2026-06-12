import { useCallback, useRef } from "react";

// Keys for the per-frame niivue update queue; one pending update per key,
// so distinct settings changed in the same frame never overwrite each other
export enum NvUpdateKey {
  CalMin = "cal_min",
  CalMax = "cal_max",
  Opacity = "opacity",
  RenderZoom = "render_zoom",
  ClipPlane = "clip_plane",
}

export type QueueNvUpdate = (key: NvUpdateKey, apply: () => void) => void;

/**
 * Slider drags and other options emit more change events than the GPU pipeline can absorb
 * (nv.updateGLVolume re-runs the volume display pass), so niivue updates are
 * coalesced to at most one per animation frame per setting, always applying
 * the latest value.
 *
 * Keyed per setting: updates to different settings queued in the same frame
 * (mainly for resetSettings which touches cal_min, cal_max and zoom in one commit) must
 * all apply, not overwrite one another.
 *
 * Must be instantiated exactly once (in `VisualizationProvider`) and shared by
 * everything that pokes niivue — a single queue instance is what makes
 * `resetSettings`' cal/zoom updates flush together in one frame.
 */
export default function useNvUpdateQueue(): QueueNvUpdate {
  const queuedNvUpdatesRef = useRef<Map<NvUpdateKey, () => void>>(new Map());

  return useCallback((key: NvUpdateKey, apply: () => void) => {
    const queue = queuedNvUpdatesRef.current;
    const alreadyQueued = queue.size > 0;
    queue.set(key, apply);
    if (!alreadyQueued) {
      requestAnimationFrame(() => {
        const fns = [...queue.values()];
        queue.clear();
        fns.forEach((fn) => fn());
      });
    }
  }, []);
}
