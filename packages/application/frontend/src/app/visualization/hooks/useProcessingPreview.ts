import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { getStudy, listFiles, fileContentUrl } from "@/api/studies";
import {
  ProcessingNotice,
} from "../../pages/screens/ProcessingNoticeBar";
import { resolveViewerFileIds } from "../../pipeline/viewerFiles";
import { watchStudyUntilTerminal } from "../../pipeline/studyWatch";
import {
  DEFAULT_OVERLAY_NAME,
  DEFAULT_OVERLAY_OPACITY,
  OVERLAY_COLORMAP,
} from "../constants";
import type { VisualizationLocationState } from "../types";

const SUCCESS_BANNER_DISMISS_MS = 5_000;

/**
 * While previewing a raw scan mid-pipeline: poll until the study is terminal,
 * then load the overlay (or show failure). Surfaces ProcessingNotice for the UI.
 */
export default function useProcessingPreview({
  studyId,
  routeState,
  nvRef,
  enabled,
  onOverlayLoaded,
}: {
  studyId?: string;
  routeState: VisualizationLocationState;
  nvRef: RefObject<NiiVueGPU | null>;
  enabled: boolean;
  onOverlayLoaded?: (nv: NiiVueGPU) => void;
}): {
  processingNotice: ProcessingNotice;
  setProcessingNotice: (n: ProcessingNotice) => void;
} {
  const [processingNotice, setProcessingNotice] = useState<ProcessingNotice>("none");
  const overlayLoadedRef = useRef(false);

  const loadOverlayArtifact = useCallback(async () => {
    if (!studyId || overlayLoadedRef.current) {
      return;
    }
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setProcessingNotice("loading-artifacts");

    try {
      const resolved = await resolveViewerFileIds(listFiles, studyId, {
        overlayFileId: routeState.overlayFileId,
      });
      const overlayId = resolved.overlayFileId;
      if (!overlayId) {
        setProcessingNotice("preview-waiting");
        return;
      }

      await nv.addVolume({
        url: fileContentUrl(studyId, overlayId),
        name: resolved.overlayDisplayName ?? DEFAULT_OVERLAY_NAME,
        opacity: DEFAULT_OVERLAY_OPACITY,
        colormap: OVERLAY_COLORMAP,
      });

      overlayLoadedRef.current = true;
      onOverlayLoaded?.(nv);
      setProcessingNotice("artifacts-ready");
    } catch {
      setProcessingNotice("processing-failed");
    }
  }, [studyId, routeState.overlayFileId, nvRef, onOverlayLoaded]);

  useEffect(() => {
    if (!enabled) {
      setProcessingNotice("none");
      overlayLoadedRef.current = false;
      return;
    }
    setProcessingNotice("preview-waiting");
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !studyId) {
      return;
    }

    return watchStudyUntilTerminal({
      getStudy,
      studyId,
      onTerminal: async (study) => {
        if (overlayLoadedRef.current) {
          return;
        }
        if (study.status === "ready") {
          await loadOverlayArtifact();
          return;
        }
        if (study.status === "failed" || study.status === "cancelled") {
          setProcessingNotice("processing-failed");
        }
      },
    });
  }, [enabled, studyId, loadOverlayArtifact]);

  useEffect(() => {
    if (processingNotice !== "artifacts-ready") {
      return;
    }
    const timer = setTimeout(() => {
      setProcessingNotice("none");
    }, SUCCESS_BANNER_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [processingNotice]);

  return { processingNotice, setProcessingNotice };
}
