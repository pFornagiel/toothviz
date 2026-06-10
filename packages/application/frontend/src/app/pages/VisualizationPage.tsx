import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Niivue } from "@niivue/niivue";
import { StudyErrorScreen } from "./screens/StudyErrorScreen";
import { FromPage } from "../pipeline";
import { listFiles, fileContentUrl, getStudy } from "@/api/studies";

export async function visualizationLoader({ params }: LoaderFunctionArgs) {
  if (!params.studyId) {
    return null;
  }
  // Pre-fetch study to ensure it exists
  const study = await getStudy(params.studyId);
  return study;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface LocationState {
  primary?: File;
  mask?: File;
  from?: FromPage;
}

const CAL_MIN_GLOBAL_VAL = -1000;
const CAL_MAX_GLOBAL_VAL = 3000;

// Slice-type identifiers used by the slice-type selector and niivue layout switching
enum SliceTypeKey {
  Multiplanar = "multiplanar",
  Multiplanar4View = "multiplanar_4view",
  Axial = "axial",
  Coronal = "coronal",
  Sagittal = "sagittal",
  Render = "render",
}

const DEFAULT_COLORMAP = "gray";
const DEFAULT_SLICE_TYPE = SliceTypeKey.Multiplanar;

// Colormaps applied to loaded volumes/overlays
const VOLUME_COLORMAP = "gray";
const OVERLAY_COLORMAP = "red";

// Default values for newly loaded volumes/overlays
const DEFAULT_OVERLAY_OPACITY = 0.5;
const DEFAULT_VOLUME_NAME = "volume";
const DEFAULT_OVERLAY_NAME = "overlay";
const DEFAULT_VISIBLE_OPACITY = 1.0;

// Niivue init / display defaults
const DEFAULT_BACK_COLOR_DARK: [number, number, number, number] = [0, 0, 0, 1];
const DEFAULT_BACK_COLOR_LIGHT: [number, number, number, number] = [1, 1, 1, 1];
const DEFAULT_SHOW_3D_CROSSHAIR = true;
const DEFAULT_CROSSHAIR_WIDTH = 1;
const HIDDEN_OPACITY = 0;

// Niivue multiplanar layout modes
const MULTIPLANAR_LAYOUT_DEFAULT = 0;
const MULTIPLANAR_LAYOUT_GRID = 2;

// niivue normalises every volume into a unit cube and uses clip depth as the
// SIGNED distance of the plane from the centre (the raw 4th component of the
// plane equation). The furthest corner sits at √3, so the plane fully clears
// the volume at ±√3 and bisects it at 0. Sweeping -√3..+√3 moves the plane
// continuously from "everything hidden" to "fully visible".
const CLIP_DEPTH_EDGE = Math.sqrt(3); // ≈1.732 — worst-case (cubic) furthest corner

// Default initial values for clip plane / render controls
const DEFAULT_CLIP_PLANE_DEPTH = CLIP_DEPTH_EDGE; // start fully visible (nothing clipped)
const DEFAULT_RENDER_AZIMUTH = 120;
const DEFAULT_RENDER_ELEVATION = 10;
const DEFAULT_RENDER_ZOOM = 1.0; // niivue volScaleMultiplier default (1 = no zoom)
const RENDER_ZOOM_BUTTON_FACTOR = 1.2; // multiplicative step for the +/- buttons

// Mouse-wheel interaction over the canvas
const RENDER_ZOOM_SCROLL_FACTOR = 1.1; // multiplicative zoom step per wheel notch
const CLIP_DEPTH_SCROLL_STEP = 0.05; // additive clip-depth step per wheel notch

// Slider bounds for UI controls
const CROSSHAIR_WIDTH_RANGE = { min: 1, max: 5, step: 1 };
const OPACITY_RANGE = { min: 0, max: 1, step: 0.01 };
const CLIP_DEPTH_RANGE = { min: -CLIP_DEPTH_EDGE, max: CLIP_DEPTH_EDGE, step: 0.01 };
const CLIP_AZIMUTH_RANGE = { min: -90, max: 90, step: 1 };
const CLIP_ELEVATION_RANGE = { min: -90, max: 90, step: 1 };
const RENDER_AZIMUTH_RANGE = { min: 0, max: 360, step: 1 };
const RENDER_ELEVATION_RANGE = { min: -90, max: 90, step: 1 };
const RENDER_ZOOM_RANGE = { min: 0.1, max: 5, step: 0.1 };

// Available colormaps
const COLORMAPS = [
  "gray",
  "red",
  "green",
  "blue",
  "plasma",
  "viridis",
  "inferno",
  "magma",
  "hot",
  "winter",
  "cool",
  "spring",
  "summer",
  "autumn",
  "bone",
  "copper",
  "grays",
  "warm",
  "red_yellow",
  "blue_green",
];

type ViewPhase = "loading" | "ready" | "error";

export function VisualizationPage() {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const routeState = useMemo(() => (location.state ?? {}) as LocationState, [location.state]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const blobUrlsRef = useRef<string[]>([]);

  const [statusText, setStatusText] = useState("Ready");
  const [viewPhase, setViewPhase] = useState<ViewPhase>("loading");

  const [errorTitle, setErrorTitle] = useState("Something went wrong");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorHintsList, setErrorHintsList] = useState<string[]>([]);

  const [sliceType, setSliceType] = useState<SliceTypeKey>(DEFAULT_SLICE_TYPE);

  // Slice types that include a 3D render tile and therefore expose render controls
  const showsRender =
    sliceType === SliceTypeKey.Render ||
    sliceType === SliceTypeKey.Multiplanar ||
    sliceType === SliceTypeKey.Multiplanar4View;

  // UI state
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [lightBackground, setLightBackground] = useState(false);

  // Volume controls
  const [selectedVolume, setSelectedVolume] = useState(0);
  const [volumeVisibility, setVolumeVisibility] = useState<boolean[]>([]);
  const [volumeOpacities, setVolumeOpacities] = useState<number[]>([]);
  const [opacity, setOpacity] = useState(DEFAULT_VISIBLE_OPACITY);
  const [colormap, _setColormap] = useState(DEFAULT_COLORMAP);
  const [cal_min, _setCalMin] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_max, _setCalMax] = useState(CAL_MAX_GLOBAL_VAL);
  const [cal_minGlobal, _setCalMinGlobal] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_maxGlobal, _setCalMaxGlobal] = useState(CAL_MAX_GLOBAL_VAL);

  // Initialised cal_min and cal_max for reset
  const initialCalMin = useRef(CAL_MIN_GLOBAL_VAL);
  const initialCalMax = useRef(CAL_MAX_GLOBAL_VAL);

  // Crosshair and display settings
  const [showCrosshair, setShowCrosshair] = useState(DEFAULT_SHOW_3D_CROSSHAIR);
  const [crosshairWidth, setCrosshairWidth] = useState(DEFAULT_CROSSHAIR_WIDTH);

  // Clip plane settings
  const [clipPlaneDepth, setClipPlaneDepth] = useState(DEFAULT_CLIP_PLANE_DEPTH);
  const [clipPlaneAzimuth, setClipPlaneAzimuth] = useState(0);
  const [clipPlaneElevation, setClipPlaneElevation] = useState(0);

  // Render settings
  const [renderAzimuth, setRenderAzimuth] = useState(DEFAULT_RENDER_AZIMUTH);
  const [renderElevation, setRenderElevation] = useState(DEFAULT_RENDER_ELEVATION);
  const [renderZoom, setRenderZoom] = useState(DEFAULT_RENDER_ZOOM);

  // Slider drags emit more change events than the GPU pipeline can absorb
  // (nv.updateGLVolume re-runs the volume display pass), so niivue updates are
  // coalesced to at most one per animation frame, always applying the latest value.
  const queuedNvUpdateRef = useRef<(() => void) | null>(null);
  const queueNvUpdate = useCallback((apply: () => void) => {
    const alreadyQueued = queuedNvUpdateRef.current !== null;
    queuedNvUpdateRef.current = apply;
    if (!alreadyQueued) {
      requestAnimationFrame(() => {
        const fn = queuedNvUpdateRef.current;
        queuedNvUpdateRef.current = null;
        fn?.();
      });
    }
  }, []);

  const setCalMax = useCallback(
    (value: number | undefined, setInitial: boolean = false) => {
      if (Number.isNaN(value) || value === undefined) {
        _setCalMax(CAL_MAX_GLOBAL_VAL);
        if (setInitial) {
          initialCalMax.current = CAL_MAX_GLOBAL_VAL;
        }
        return;
      }
      if (value < cal_min) {
        _setCalMax(cal_min);
        if (setInitial) {
          initialCalMax.current = cal_min;
        }
        return;
      }
      _setCalMax(value);
      if (setInitial) {
        initialCalMax.current = value;
      }
    },
    [cal_min],
  );

  const setCalMin = useCallback(
    (value: number | undefined, setInitial: boolean = false) => {
      if (Number.isNaN(value) || value === undefined) {
        _setCalMin(CAL_MIN_GLOBAL_VAL);
        if (setInitial) {
          initialCalMin.current = CAL_MIN_GLOBAL_VAL;
        }
        return;
      }

      if (value > cal_max) {
        _setCalMin(cal_max);
        if (setInitial) {
          initialCalMin.current = cal_max;
        }
        return;
      }
      _setCalMin(value);
      if (setInitial) {
        initialCalMin.current = value;
      }
    },
    [cal_max],
  );

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    queueNvUpdate(() => {
      nv.volumes[selectedVolume].cal_min = cal_min;
      nv.updateGLVolume();
    });
  }, [cal_min]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    queueNvUpdate(() => {
      nv.volumes[selectedVolume].cal_max = cal_max;
      nv.updateGLVolume();
    });
  }, [cal_max]);

  const setCalMinGlobal = (value: number | undefined) => {
    if (Number.isNaN(value) || value === undefined) {
      return CAL_MIN_GLOBAL_VAL;
    }
    _setCalMinGlobal(value);
  };

  const setCalMaxGlobal = (value: number | undefined) => {
    if (Number.isNaN(value) || value === undefined) {
      return CAL_MAX_GLOBAL_VAL;
    }
    _setCalMaxGlobal(value);
  };

  const setColormap = (value: string | undefined) => {
    _setColormap(value || DEFAULT_COLORMAP);
  };

  const resetSettings = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setCalMin(initialCalMin.current);
    setCalMax(initialCalMax.current);
    setOpacity(DEFAULT_VISIBLE_OPACITY);
    setColormap(DEFAULT_COLORMAP);
    setVolumeVisibility(nv.volumes.map(() => true));
    setVolumeOpacities(nv.volumes.map((v) => v.opacity));
  };

  const disposeNv = useCallback(() => {
    const nv = nvRef.current;
    if (nv) {
      try {
        [...nv.volumes].forEach((vol) => nv.removeVolume(vol));
        nv.cleanup();
      } catch {
        /* ignore */
      }
    }
    nvRef.current = null;
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const loadStudyFiles = useCallback(
    async (nv: Niivue) => {
      if (!studyId) {
        return;
      }
      setStatusText("Loading files...");
      const files = await listFiles(studyId, "viewer_volume,viewer_overlay");

      const volumes: { url: string; name: string; opacity?: number; colormap?: string }[] = [];
      const volume = files.find((f) => f.viewer_purpose === "viewer_volume");
      const overlay = files.find((f) => f.viewer_purpose === "viewer_overlay");

      if (volume) {
        volumes.push({
          url: fileContentUrl(studyId, volume.id),
          name: volume.display_name ?? DEFAULT_VOLUME_NAME,
          colormap: VOLUME_COLORMAP,
        });
      }
      if (overlay) {
        volumes.push({
          url: fileContentUrl(studyId, overlay.id),
          name: overlay.display_name ?? DEFAULT_OVERLAY_NAME,
          opacity: DEFAULT_OVERLAY_OPACITY,
          colormap: OVERLAY_COLORMAP,
        });
      }

      if (volumes.length > 0) {
        await nv.loadVolumes(volumes);
        setStatusText(`Loaded ${volumes.length} volume(s)`);

        // Update UI state based on loaded volume
        if (nv.volumes.length > 0) {
          const vol = nv.volumes[0];
          setOpacity(vol.opacity);
          setColormap(vol.colormap);
          setCalMinGlobal(vol.global_min);
          setCalMaxGlobal(vol.global_max);
          setCalMin(vol.cal_min, true);
          setCalMax(vol.cal_max, true);
          // Initialize visibility and store opacities for all volumes
          setVolumeVisibility(nv.volumes.map(() => true));
          setVolumeOpacities(nv.volumes.map((v) => v.opacity));
        }
        nv.setSliceType(nv.sliceTypeMultiplanar);
        nv.setMultiplanarLayout(MULTIPLANAR_LAYOUT_DEFAULT);
      } else {
        setStatusText("No viewable files found for this study");
        throw new Error("No viewable volume or overlay files are available yet.");
      }
    },
    [studyId],
  );

  const loadVolatileFiles = useCallback(
    async (nv: Niivue) => {
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
        await nv.addVolumeFromUrl({
          url: maskUrl,
          name: mask.name,
          opacity: DEFAULT_OVERLAY_OPACITY,
          colormap: OVERLAY_COLORMAP,
        });
      }

      setStatusText(`Volatile mode - ${primary.name}`);

      if (nv.volumes.length > 0) {
        const vol = nv.volumes[0];
        setOpacity(vol.opacity);
        setColormap(vol.colormap);
        setCalMin(vol.cal_min, true);
        setCalMax(vol.cal_max, true);
        setCalMinGlobal(vol.global_min);
        setCalMaxGlobal(vol.global_max);
        setVolumeVisibility(nv.volumes.map(() => true));
        setVolumeOpacities(nv.volumes.map((v) => v.opacity));
      }
      nv.setSliceType(nv.sliceTypeMultiplanar);
      nv.setMultiplanarLayout(MULTIPLANAR_LAYOUT_DEFAULT);
    },
    [routeState],
  );

  const initNiivue = useCallback(() => {
    if (!canvasRef.current) {
      return null;
    }
    if (nvRef.current) {
      return nvRef.current;
    }
    const nv = new Niivue({
      backColor: DEFAULT_BACK_COLOR_DARK,
      show3Dcrosshair: DEFAULT_SHOW_3D_CROSSHAIR,
      crosshairWidth: DEFAULT_CROSSHAIR_WIDTH,
    });
    nv.attachToCanvas(canvasRef.current);
    nv.onZoom3DChange = (zoom) => setRenderZoom(zoom);
    nv.onAzimuthElevationChange = (azimuth, elevation) => {
      setRenderAzimuth(azimuth);
      setRenderElevation(elevation);
    };
    nvRef.current = nv;
    return nv;
  }, []);

  const goError = useCallback((title: string, message: string, hints: string[]) => {
    setErrorTitle(title);
    setErrorMessage(message);
    setErrorHintsList(hints);
    setViewPhase("error");
  }, []);

  const handleBackFromError = useCallback(() => {
    const from = routeState.from ?? FromPage.Home;
    if (from === FromPage.Browse) {
      navigate("/browse");
    } else {
      navigate("/");
    }
  }, [navigate, routeState.from]);

  /** Volatile (no persisted study) */
  useEffect(() => {
    if (studyId) {
      return;
    }

    let cancelled = false;
    (async () => {
      setViewPhase("loading");
      setStatusText("Loading...");
      try {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const nv = initNiivue();
        if (!nv || cancelled) {
          return;
        }
        await loadVolatileFiles(nv);
        if (!cancelled) {
          setViewPhase("ready");
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

  /** Load persisted study: status + ready path */
  useEffect(() => {
    if (!studyId) {
      return;
    }

    let cancelled = false;

    (async () => {
      setViewPhase("loading");
      setStatusText("Loading study files...");
      try {
        const nv = initNiivue();
        if (!nv || cancelled) {
          return;
        }
        await loadStudyFiles(nv);
        if (!cancelled) {
          setViewPhase("ready");
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

  const handleSliceTypeChange = (type: SliceTypeKey) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }
    setSliceType(type);

    switch (type) {
      case SliceTypeKey.Multiplanar:
        nv.setSliceType(nv.sliceTypeMultiplanar);
        nv.setMultiplanarLayout(MULTIPLANAR_LAYOUT_DEFAULT);
        break;
      case SliceTypeKey.Multiplanar4View:
        nv.setSliceType(nv.sliceTypeMultiplanar);
        nv.setMultiplanarLayout(MULTIPLANAR_LAYOUT_GRID); // Grid layout with 3 slices + 3D render
        break;
      case SliceTypeKey.Axial:
        nv.setSliceType(nv.sliceTypeAxial);
        break;
      case SliceTypeKey.Coronal:
        nv.setSliceType(nv.sliceTypeCoronal);
        break;
      case SliceTypeKey.Sagittal:
        nv.setSliceType(nv.sliceTypeSagittal);
        break;
      case SliceTypeKey.Render:
        nv.setSliceType(nv.sliceTypeRender);
        break;
    }
  };

  const handleVolumeChange = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    setSelectedVolume(index);
    const vol = nv.volumes[index];
    setOpacity(vol.opacity);
    setColormap(vol.colormap);
    setCalMin(vol.cal_min);
    setCalMax(vol.cal_max);
  };

  const handleOpacityChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setOpacity(value);
    queueNvUpdate(() => nv.setOpacity(selectedVolume, value));

    // Update stored opacity if volume is visible
    if (volumeVisibility[selectedVolume]) {
      const newOpacities = [...volumeOpacities];
      newOpacities[selectedVolume] = value;
      setVolumeOpacities(newOpacities);
    }
  };

  const handleColormapChange = (value: string) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setColormap(value);
    const vol = nv.volumes[selectedVolume];

    // Preserve cal_min and cal_max
    const currentCalMin = cal_min;
    const currentCalMax = cal_max;

    vol.colormap = value;
    vol.cal_min = currentCalMin;
    vol.cal_max = currentCalMax;
    nv.updateGLVolume();
  };

  const handleCalMinChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }
    setCalMin(value);
  };

  const handleCalMaxChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setCalMax(value);
  };

  const handleCrosshairToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !showCrosshair;
    setShowCrosshair(newValue);
    nv.opts.show3Dcrosshair = newValue;
    nv.drawScene();
  };

  const handleCrosshairWidthChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setCrosshairWidth(value);
    nv.setCrosshairWidth(value);
  };

  const handleVolumeVisibilityToggle = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    const newVisibility = [...volumeVisibility];
    newVisibility[index] = !newVisibility[index];
    setVolumeVisibility(newVisibility);

    // Set opacity to 0 to hide, restore stored opacity to show
    if (newVisibility[index]) {
      // Restore the stored opacity
      const opacityToRestore = volumeOpacities[index] ?? DEFAULT_VISIBLE_OPACITY;
      nv.setOpacity(index, opacityToRestore);
    } else {
      // Store current opacity before hiding
      const newOpacities = [...volumeOpacities];
      newOpacities[index] = nv.volumes[index].opacity;
      setVolumeOpacities(newOpacities);
      // Hide by setting opacity to 0
      nv.setOpacity(index, HIDDEN_OPACITY);
    }
  };

  const handleBackgroundToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !lightBackground;
    setLightBackground(newValue);
    nv.opts.backColor = newValue ? DEFAULT_BACK_COLOR_LIGHT : DEFAULT_BACK_COLOR_DARK;
    nv.drawScene();
  };

  const handleClipPlaneChange = useCallback(() => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    nv.setClipPlane([clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation]);
  }, [clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation]);

  const handleRenderAzimuthChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setRenderAzimuth(value);
    nv.setRenderAzimuthElevation(value, renderElevation);
  };

  const handleRenderElevationChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setRenderElevation(value);
    nv.setRenderAzimuthElevation(renderAzimuth, value);
  };

  const handleRenderZoomChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const clamped = Math.min(RENDER_ZOOM_RANGE.max, Math.max(RENDER_ZOOM_RANGE.min, value));
    setRenderZoom(clamped);
    queueNvUpdate(() => nv.setScale(clamped));
  };

  useEffect(() => {
    handleClipPlaneChange();
  }, [handleClipPlaneChange]);

  /* 
    Wheel-canvas interaction. 
    Niivue registers its own `wheel` listener on the canvas to scroll slices/zoom; 
    we intercept on the canvas's parent in the capture phase and call stopPropagation,
    so the event never reaches niivue's handler. 
    Plain scroll zooms the render (volScaleMultiplier),
    Shift+scroll nudges the clip-plane depth. 
    Re-attaches whenever the canvas mounts, which is keyed off viewPhase.
  */
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
          nv.volScaleMultiplier * factor,
          RENDER_ZOOM_RANGE.min,
          RENDER_ZOOM_RANGE.max,
        );
        // setScale fires onZoom3DChange, which keeps the renderZoom slider in sync.
        nv.setScale(next);
      }
    };

    container.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => container.removeEventListener("wheel", handleWheel, { capture: true });
  }, [viewPhase]);

  useEffect(() => {
    // Update multiplanar layout when switching to multiplanar_4view
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    if (sliceType === SliceTypeKey.Multiplanar4View) {
      nv.setMultiplanarLayout(MULTIPLANAR_LAYOUT_GRID);
    }
  }, [sliceType]);

  return (
    <div className="h-screen flex flex-col bg-background font-sans">
      {/* Ribbon - Top Controls */}
      <div className="bg-card border-b border-border px-4 py-2 shadow-sm relative z-10">
        <div className="flex items-center gap-6">
          {/* Sidebar Toggle */}
          <button
            onClick={() => setSidebarVisible(!sidebarVisible)}
            className="px-3 py-1.5 bg-secondary hover:bg-muted border border-border text-secondary-foreground rounded text-sm flex items-center gap-2 transition-colors"
            title="Toggle Sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            {sidebarVisible ? "Hide" : "Show"} Sidebar
          </button>

          {/* Crosshair Controls */}
          <div className="flex items-center gap-3 border-l border-border pl-6">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={showCrosshair}
                onChange={handleCrosshairToggle}
                className="w-4 h-4 rounded border-border bg-card text-primary focus:ring-primary"
              />
              <span>Crosshair</span>
            </label>

            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground font-medium">Width:</label>
              <input
                type="range"
                min={CROSSHAIR_WIDTH_RANGE.min}
                max={CROSSHAIR_WIDTH_RANGE.max}
                step={CROSSHAIR_WIDTH_RANGE.step}
                value={crosshairWidth}
                onChange={(e) => handleCrosshairWidthChange(parseFloat(e.target.value))}
                className="w-20"
                disabled={!showCrosshair}
              />
              <span className="text-xs text-muted-foreground font-medium w-4">
                {crosshairWidth}
              </span>
            </div>
          </div>

          {/* Background Toggle */}
          <div className="flex items-center gap-2 border-l border-border pl-6">
            <label className="text-sm text-foreground font-medium">Background:</label>
            <button
              onClick={handleBackgroundToggle}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                lightBackground
                  ? "bg-primary text-primary-foreground border border-primary"
                  : "bg-card text-foreground border border-border hover:bg-muted"
              }`}
            >
              {lightBackground ? "Light" : "Dark"}
            </button>
          </div>

          {/* Status */}
          <div className="ml-auto text-xs text-muted-foreground font-medium">{statusText}</div>

          {/* Navigation */}
          <div className="flex items-center gap-2 border-l border-border pl-6">
            <button
              onClick={() => navigate("/")}
              className="px-3 py-1.5 bg-secondary hover:bg-muted border border-border text-secondary-foreground rounded text-sm flex items-center gap-2 transition-colors"
              title="Back to Home"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Home
            </button>
            <button
              onClick={() => navigate("/browse")}
              className="px-3 py-1.5 bg-secondary hover:bg-muted border border-border text-secondary-foreground rounded text-sm flex items-center gap-2 transition-colors"
              title="Browse Studies"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              Browse
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {viewPhase === "error" && (
          <div className="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-background">
            <StudyErrorScreen
              title={errorTitle}
              message={errorMessage}
              hints={errorHintsList}
              backLabel={routeState.from === FromPage.Browse ? "Back to studies" : "Back to home"}
              onBack={handleBackFromError}
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Sidebar - Controls */}
          {sidebarVisible && (
            <div className="w-80 bg-secondary border-r border-border overflow-y-auto shadow-inner relative z-0">
              <div className="p-4 space-y-6">
                {/* Header */}
                <div className="border-b border-border pb-4">
                  <h1 className="text-xl font-semibold text-foreground mb-2 tracking-tight">
                    NiiVue Controls
                  </h1>
                  <div className="text-xs text-muted-foreground font-mono">
                    {studyId ? `Study: ${studyId}` : "Volatile Mode"}
                  </div>
                </div>

                <fieldset
                  disabled={viewPhase !== "ready"}
                  className={`m-0 min-w-0 space-y-6 border-0 p-0 transition-opacity ${
                    viewPhase === "ready" ? "" : "pointer-events-none opacity-50"
                  }`}
                >
                  {/* Volume Selection and Visibility */}
                  {nvRef.current && nvRef.current.volumes.length > 0 && (
                    <div className="space-y-3">
                      <label className="text-sm font-semibold text-foreground">Volumes</label>

                      {/* Volume visibility checkboxes */}
                      <div className="space-y-2">
                        {nvRef.current.volumes.map((vol, idx) => (
                          <label
                            key={idx}
                            className="flex items-center gap-2 text-sm text-foreground cursor-pointer font-medium"
                          >
                            <input
                              type="checkbox"
                              checked={volumeVisibility[idx] ?? true}
                              onChange={() => handleVolumeVisibilityToggle(idx)}
                              className="w-4 h-4 rounded border-border bg-card text-primary focus:ring-primary"
                            />
                            <span>{vol.name || `Volume ${idx}`}</span>
                          </label>
                        ))}
                      </div>

                      {/* Volume selector for editing */}
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground font-medium">
                          Edit Volume:
                        </label>
                        <select
                          value={selectedVolume}
                          onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                          className="w-full bg-card text-foreground border border-border shadow-sm rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none"
                        >
                          {nvRef.current.volumes.map((vol, idx) => (
                            <option key={idx} value={idx}>
                              {vol.name || `Volume ${idx}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Slice Type */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Slice Type</label>
                    <select
                      value={sliceType}
                      onChange={(e) => handleSliceTypeChange(e.target.value as SliceTypeKey)}
                      className="w-full bg-card text-foreground border border-border shadow-sm rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none"
                    >
                      <option value={SliceTypeKey.Multiplanar}>Multiplanar</option>
                      <option value={SliceTypeKey.Multiplanar4View}>Multiplanar (4 Views)</option>
                      <option value={SliceTypeKey.Axial}>Axial</option>
                      <option value={SliceTypeKey.Coronal}>Coronal</option>
                      <option value={SliceTypeKey.Sagittal}>Sagittal</option>
                      <option value={SliceTypeKey.Render}>Render</option>
                    </select>
                  </div>

                  {/* Colormap */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Colormap</label>
                    <select
                      value={colormap}
                      onChange={(e) => handleColormapChange(e.target.value)}
                      className="w-full bg-card text-foreground border border-border shadow-sm rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none"
                    >
                      {COLORMAPS.map((cm) => (
                        <option key={cm} value={cm}>
                          {cm}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Opacity */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      Opacity: {opacity.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min={OPACITY_RANGE.min}
                      max={OPACITY_RANGE.max}
                      step={OPACITY_RANGE.step}
                      value={opacity}
                      onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  {/* Cal Min */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      Cal Min: {cal_min.toFixed(0)}
                    </label>
                    <input
                      type="range"
                      min={cal_minGlobal.toFixed(0)}
                      max={cal_maxGlobal.toFixed(0)}
                      step="1"
                      value={cal_min}
                      onChange={(e) => handleCalMinChange(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  {/* Cal Max */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      Cal Max: {cal_max.toFixed(0)}
                    </label>
                    <input
                      type="range"
                      min={cal_minGlobal.toFixed(0)}
                      max={cal_maxGlobal.toFixed(0)}
                      step="1"
                      value={cal_max}
                      onChange={(e) => handleCalMaxChange(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  {/* Clip Plane */}
                  <div className="space-y-3 border-t border-border pt-4">
                    <h3 className="text-sm font-semibold text-foreground">Clip Plane</h3>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Depth: {clipPlaneDepth.toFixed(2)}
                      </label>
                      <input
                        type="range"
                        min={CLIP_DEPTH_RANGE.min}
                        max={CLIP_DEPTH_RANGE.max}
                        step={CLIP_DEPTH_RANGE.step}
                        value={clipPlaneDepth}
                        onChange={(e) => setClipPlaneDepth(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Azimuth: {clipPlaneAzimuth.toFixed(0)}°
                      </label>
                      <input
                        type="range"
                        min={CLIP_AZIMUTH_RANGE.min}
                        max={CLIP_AZIMUTH_RANGE.max}
                        step={CLIP_AZIMUTH_RANGE.step}
                        value={clipPlaneAzimuth}
                        onChange={(e) => setClipPlaneAzimuth(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Elevation: {clipPlaneElevation.toFixed(0)}°
                      </label>
                      <input
                        type="range"
                        min={CLIP_ELEVATION_RANGE.min}
                        max={CLIP_ELEVATION_RANGE.max}
                        step={CLIP_ELEVATION_RANGE.step}
                        value={clipPlaneElevation}
                        onChange={(e) => setClipPlaneElevation(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Render Settings */}
                  {showsRender && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <h3 className="text-sm font-semibold text-foreground">Render View</h3>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Azimuth: {renderAzimuth.toFixed(0)}°
                        </label>
                        <input
                          type="range"
                          min={RENDER_AZIMUTH_RANGE.min}
                          max={RENDER_AZIMUTH_RANGE.max}
                          step={RENDER_AZIMUTH_RANGE.step}
                          value={renderAzimuth}
                          onChange={(e) => handleRenderAzimuthChange(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Elevation: {renderElevation.toFixed(0)}°
                        </label>
                        <input
                          type="range"
                          min={RENDER_ELEVATION_RANGE.min}
                          max={RENDER_ELEVATION_RANGE.max}
                          step={RENDER_ELEVATION_RANGE.step}
                          value={renderElevation}
                          onChange={(e) => handleRenderElevationChange(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Zoom: {renderZoom.toFixed(1)}×
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              handleRenderZoomChange(renderZoom / RENDER_ZOOM_BUTTON_FACTOR)
                            }
                            className="h-8 w-8 shrink-0 rounded border border-border bg-card text-foreground hover:bg-muted transition-colors"
                            title="Zoom out"
                          >
                            −
                          </button>
                          <input
                            type="range"
                            min={RENDER_ZOOM_RANGE.min}
                            max={RENDER_ZOOM_RANGE.max}
                            step={RENDER_ZOOM_RANGE.step}
                            value={renderZoom}
                            onChange={(e) => handleRenderZoomChange(parseFloat(e.target.value))}
                            className="w-full"
                          />
                          <button
                            onClick={() =>
                              handleRenderZoomChange(renderZoom * RENDER_ZOOM_BUTTON_FACTOR)
                            }
                            className="h-8 w-8 shrink-0 rounded border border-border bg-card text-foreground hover:bg-muted transition-colors"
                            title="Zoom in"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Reset to initial */}
                  <div className="space-y-2">
                    <button
                      onClick={resetSettings}
                      className="w-full bg-card text-foreground border border-border shadow-sm rounded px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none"
                    >
                      Reset Display Settings
                    </button>
                  </div>
                </fieldset>
              </div>
            </div>
          )}

          {/* Main Canvas Area */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{ backgroundColor: lightBackground ? "#ffffff" : "#000000" }}
            >
              {viewPhase === "loading" && (
                <div className="absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                  <div
                    className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-muted-foreground">{statusText}</p>
                </div>
              )}
              {viewPhase !== "error" && (
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
              )}
            </div>

            <div className="flex shrink-0 items-center gap-4 border-t border-border bg-card px-4 py-2">
              <span className="flex-1 text-xs font-medium text-muted-foreground">{statusText}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
