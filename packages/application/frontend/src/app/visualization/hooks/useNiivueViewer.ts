import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE, MULTIPLANAR_TYPE, DRAG_MODE } from "@niivue/niivue";
import { listFiles, fileContentUrl } from "@/api/studies";
import { resolveViewerFileIds } from "../../pipeline/viewerFiles";
import { ViewPhase, type VisualizationLocationState } from "../types";
import {
  DEFAULT_BACK_COLOR_DARK,
  DEFAULT_SHOW_3D_CROSSHAIR,
  DEFAULT_CROSSHAIR_WIDTH,
  DEFAULT_RENDER_AZIMUTH,
  DEFAULT_RENDER_ELEVATION,
  VOLUME_COLORMAP,
  OVERLAY_COLORMAP,
  DEFAULT_OVERLAY_OPACITY,
  DEFAULT_VOLUME_NAME,
  DEFAULT_OVERLAY_NAME,
} from "../constants";

export interface NiivueViewerState {
  viewPhase: ViewPhase;
  statusText: string;
  errorTitle: string;
  errorMessage: string;
  errorHints: string[];
}

/**
 * Niivue instance lifecycle and file loading for the visualization page:
 * creates/disposes the instance, loads either a persisted study's files or
 * volatile route-state files, and tracks the loading/ready/error phase.
 * Control-state sync after a load is delegated to `onVolumesLoaded`.
 */
export default function useNiivueViewer({
  studyId,
  routeState,
  canvasRef,
  nvRef,
  configureNv,
  onVolumesLoaded,
}: {
  studyId?: string;
  routeState: VisualizationLocationState;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  configureNv: (nv: NiiVueGPU) => void;
  onVolumesLoaded: (nv: NiiVueGPU) => void;
}): NiivueViewerState {
  const blobUrlsRef = useRef<string[]>([]);

  const [statusText, setStatusText] = useState("Ready");
  const [viewPhase, setViewPhase] = useState<ViewPhase>(ViewPhase.Loading);

  const [errorTitle, setErrorTitle] = useState("Something went wrong");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorHintsList, setErrorHintsList] = useState<string[]>([]);

  const disposeNv = useCallback(() => {
    const nv = nvRef.current;
    if (nv) {
      try {
        nv.destroy();
      } catch {
        /* ignore */
      }
    }
    nvRef.current = null;
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, [nvRef]);

  const loadStudyFiles = useCallback(
    async (nv: NiiVueGPU) => {
      if (!studyId) {
        return;
      }
      setStatusText("Loading files...");
      const { volumeFileId, previewWhileProcessing } = routeState;
      const skipOverlay = previewWhileProcessing === true;

      // Final display always resolves by viewer_purpose via REST. Route file ids
      // are only hints for mid-pipeline preview (volume only).
      const resolved = await resolveViewerFileIds(listFiles, studyId, {
        volumeFileId: skipOverlay ? volumeFileId : undefined,
        includeOverlay: !skipOverlay,
      });

      const volumeId = resolved.volumeFileId;
      const overlayId = resolved.overlayFileId;
      const volumeName = resolved.volumeDisplayName ?? DEFAULT_VOLUME_NAME;
      const overlayName = resolved.overlayDisplayName ?? DEFAULT_OVERLAY_NAME;

      const volumes: { url: string; name: string; opacity?: number; colormap?: string }[] = [];

      if (volumeId) {
        volumes.push({
          url: fileContentUrl(studyId, volumeId),
          name: volumeName,
          colormap: VOLUME_COLORMAP,
        });
      }
      if (overlayId) {
        volumes.push({
          url: fileContentUrl(studyId, overlayId),
          name: overlayName,
          opacity: DEFAULT_OVERLAY_OPACITY,
          colormap: OVERLAY_COLORMAP,
        });
      }

      if (volumes.length > 0) {
        await nv.loadVolumes(volumes);
        setStatusText(`Loaded ${volumes.length} volume(s)`);

        // Update UI state based on loaded volume
        onVolumesLoaded(nv);
        nv.sliceType = SLICE_TYPE.MULTIPLANAR;
        nv.multiplanarType = MULTIPLANAR_TYPE.AUTO;
      } else {
        setStatusText("No viewable files found for this study");
        throw new Error("No viewable volume or overlay files are available yet.");
      }
    },
    [
      studyId,
      routeState.volumeFileId,
      routeState.previewWhileProcessing,
      onVolumesLoaded,
    ],
  );

  const loadVolatileFiles = useCallback(
    async (nv: NiiVueGPU) => {
      const { primary, mask } = routeState;
      if (!primary) {
        throw new Error("No file was provided. Go back and choose Open Raw File.");
      }

      setStatusText("Loading volume...");
      const primaryUrl = URL.createObjectURL(primary);
      blobUrlsRef.current.push(primaryUrl);
      await nv.loadVolumes([
        {
          url: primaryUrl,
          name: primary.name,
          colormap: VOLUME_COLORMAP,
        },
      ]);

      if (mask) {
        setStatusText("Loading overlay...");
        const maskUrl = URL.createObjectURL(mask);
        blobUrlsRef.current.push(maskUrl);
        await nv.addVolume({
          url: maskUrl,
          name: mask.name,
          opacity: DEFAULT_OVERLAY_OPACITY,
          colormap: OVERLAY_COLORMAP,
        });
      }

      setStatusText(`Volatile mode - ${primary.name}`);

      onVolumesLoaded(nv);
      nv.sliceType = SLICE_TYPE.MULTIPLANAR;
      nv.multiplanarType = MULTIPLANAR_TYPE.AUTO;
    },
    [routeState, onVolumesLoaded],
  );

  const initNiivue = useCallback(async () => {
    if (!canvasRef.current) {
      return null;
    }
    if (nvRef.current) {
      return nvRef.current;
    }
    const nv = new NiiVueGPU({
      backgroundColor: DEFAULT_BACK_COLOR_DARK,
      is3DCrosshairVisible: DEFAULT_SHOW_3D_CROSSHAIR,
      isCrossLinesVisible: DEFAULT_SHOW_3D_CROSSHAIR,
      crosshairWidth: DEFAULT_CROSSHAIR_WIDTH,
      azimuth: DEFAULT_RENDER_AZIMUTH,
      elevation: DEFAULT_RENDER_ELEVATION,
      secondaryDragMode: DRAG_MODE.pan,
    });
    // Set up event listeners before canvas attach
    configureNv(nv);
    await nv.attachToCanvas(canvasRef.current);
    nvRef.current = nv;
    return nv;
  }, [canvasRef, nvRef, configureNv]);

  const goError = useCallback((title: string, message: string, hints: string[]) => {
    setErrorTitle(title);
    setErrorMessage(message);
    setErrorHintsList(hints);
    setViewPhase(ViewPhase.Error);
  }, []);

  /** Volatile handling (no persisted study) */
  useEffect(() => {
    if (studyId) {
      return;
    }

    let cancelled = false;
    (async () => {
      setViewPhase(ViewPhase.Loading);
      setStatusText("Loading...");
      try {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const nv = await initNiivue();
        if (!nv || cancelled) {
          return;
        }
        await loadVolatileFiles(nv);
        if (!cancelled) {
          setViewPhase(ViewPhase.Ready);
        }
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        disposeNv();
        goError("Could not load file", msg, [
          "Check that the file is a supported NIfTI format.",
          "Try a smaller file or a different browser if the problem persists.",
        ]);
      }
    })();

    return () => {
      cancelled = true;
      disposeNv();
    };
  }, [studyId, initNiivue, loadVolatileFiles, goError, disposeNv]);

  /** Persistent study handling: status + ready path */
  useEffect(() => {
    if (!studyId) {
      return;
    }

    let cancelled = false;

    (async () => {
      setViewPhase(ViewPhase.Loading);
      setStatusText("Loading study files...");
      try {
        const nv = await initNiivue();
        if (!nv || cancelled) {
          return;
        }
        await loadStudyFiles(nv);
        if (!cancelled) {
          setViewPhase(ViewPhase.Ready);
        }
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }
        disposeNv();
        const msg = err instanceof Error ? err.message : String(err);
        goError("Could not load study", msg, [
          "The study may still be processing - try opening it again.",
          "If the problem continues, delete the study and upload again.",
        ]);
      }
    })();

    return () => {
      cancelled = true;
      disposeNv();
    };
  }, [studyId, initNiivue, loadStudyFiles, goError, disposeNv]);

  return {
    viewPhase,
    statusText,
    errorTitle,
    errorMessage,
    errorHints: errorHintsList,
  };
}
