import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Niivue } from "@niivue/niivue";
import { listFiles, fileContentUrl, getStudy } from "@/api/studies";
import { connectPipeline } from "@/api/ws";
import { ApiError } from "@/api/client";
import type { PipelineMessage } from "@/api/types";
import { StudyLoadingScreen } from "../components/StudyLoadingScreen";
import { StudyErrorScreen } from "../components/StudyErrorScreen";

type FromPage = "home" | "browse";

interface LocationState {
  primary?: File;
  mask?: File;
  jobId?: string | null;
  from?: FromPage;
}

type ViewPhase =
  | "checking"
  | "processing"
  | "loading"
  | "ready"
  | "error"
  | "volatile_loading";

function clamp01(x: number | undefined | null): number | undefined {
  if (x == null || Number.isNaN(x)) return undefined;
  return Math.min(1, Math.max(0, x));
}

function errorHints(failedStep?: string | null): string[] {
  const base = [
    "Ensure the file is a valid NIfTI (.nii / .nii.gz) or a ZIP of DICOM files.",
    "For DICOM, confirm the archive contains readable slices (not empty or corrupt).",
    "Try again with automated segmentation disabled and upload a precomputed mask instead.",
    "Create a new study from the home page if this message appeared after a failed run.",
  ];
  if (failedStep === "dicom_to_nifti") {
    return [
      "DICOM conversion failed — check that the ZIP is not corrupt and contains valid DICOM.",
      ...base.slice(1),
    ];
  }
  if (failedStep === "segment_nifti") {
    return [
      "Segmentation failed — the volume may be unsupported or too small for the model.",
      ...base.slice(2),
    ];
  }
  return base;
}

export function VisualizationPage() {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const routeState = (location.state ?? {}) as LocationState;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);

  const [statusText, setStatusText] = useState("Ready");

  const [viewPhase, setViewPhase] = useState<ViewPhase>(() =>
    studyId ? "checking" : "volatile_loading",
  );
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const [errorTitle, setErrorTitle] = useState("Something went wrong");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorHintsList, setErrorHintsList] = useState<string[]>([]);

  const [pipelineSteps, setPipelineSteps] = useState<string[]>([]);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(() => new Set());
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<number | null>(null);
  const [sliceType, setSliceType] = useState<string>("multiplanar");

  // UI state
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [lightBackground, setLightBackground] = useState(false);

  // Volume controls
  const [selectedVolume, setSelectedVolume] = useState(0);
  const [volumeVisibility, setVolumeVisibility] = useState<boolean[]>([]);
  const [volumeOpacities, setVolumeOpacities] = useState<number[]>([]);
  const [opacity, setOpacity] = useState(1.0);
  const [colormap, setColormap] = useState("gray");
  const [cal_min, setCalMin] = useState(0);
  const [cal_max, setCalMax] = useState(100);

  // Crosshair and display settings
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [crosshairWidth, setCrosshairWidth] = useState(1);

  // Clip plane settings
  const [clipPlaneDepth, setClipPlaneDepth] = useState(2);
  const [clipPlaneAzimuth, setClipPlaneAzimuth] = useState(0);
  const [clipPlaneElevation, setClipPlaneElevation] = useState(0);

  // Render settings
  const [renderAzimuth, setRenderAzimuth] = useState(120);
  const [renderElevation, setRenderElevation] = useState(10);

  // Available colormaps
  const colormaps = [
    "gray", "red", "green", "blue", "plasma", "viridis", "inferno",
    "magma", "hot", "winter", "cool", "spring", "summer", "autumn",
    "bone", "copper", "grays", "warm", "red_yellow", "blue_green",
  ];

  const reconnectAttemptedRef = useRef(false);

  const disposeNv = useCallback(() => {
    const nv = nvRef.current;
    if (nv) {
      try {
        nv.close();
      } catch {
        /* ignore */
      }
    }
    nvRef.current = null;
  }, []);

  const loadStudyFiles = useCallback(
    async (nv: Niivue) => {
      if (!studyId) return;
      setStatusText("Loading files...");
      const files = await listFiles(studyId, "viewer_volume,viewer_overlay");

      const volumes: { url: string; name: string; opacity?: number; colormap?: string }[] = [];
      const volume = files.find((f) => f.viewer_purpose === "viewer_volume");
      const overlay = files.find((f) => f.viewer_purpose === "viewer_overlay");

      if (volume) {
        volumes.push({
          url: fileContentUrl(studyId, volume.id),
          name: volume.display_name ?? "volume.nii",
          colormap: "gray",
        });
      }
      if (overlay) {
        volumes.push({
          url: fileContentUrl(studyId, overlay.id),
          name: overlay.display_name ?? "overlay.nii",
          opacity: 0.5,
          colormap: "red",
        });
      }

      if (volumes.length > 0) {
        await nv.loadVolumes(volumes);
        setStatusText(`Loaded ${volumes.length} volume(s)`);
        
        // Update UI state based on loaded volume
        if (nv.volumes.length > 0) {
          const vol = nv.volumes[0];
          setOpacity(vol.opacity);
          setColormap(vol.colormap || "gray");
          setCalMin(vol.cal_min ?? 0);
          setCalMax(vol.cal_max ?? 100);
          // Initialize visibility and store opacities for all volumes
          setVolumeVisibility(nv.volumes.map(() => true));
          setVolumeOpacities(nv.volumes.map((v) => v.opacity));
        }
        nv.setSliceType(nv.sliceTypeMultiplanar);
        nv.setMultiplanarLayout(0);
      } else {
        setStatusText("No viewable files found for this study");
        throw new Error("No viewable volume or overlay files are available yet.");
      }
    },
    [studyId],
  );

  const loadVolatileFiles = useCallback(async (nv: Niivue) => {
    const { primary, mask } = routeState;
    if (!primary) {
      throw new Error("No file was provided. Go back and choose Open Raw File.");
    }

    setStatusText("Loading local file...");
    const volumes: { url: string; name: string; opacity?: number; colormap?: string }[] = [];

    volumes.push({
      url: URL.createObjectURL(primary),
      name: primary.name,
      colormap: "gray",
    });
    if (mask) {
      volumes.push({
        url: URL.createObjectURL(mask),
        name: mask.name,
        opacity: 0.5,
        colormap: "red",
      });
    }

    await nv.loadVolumes(volumes);
    setStatusText(`Volatile mode — ${primary.name}`);

    // Update UI state based on loaded volume
    if (nv.volumes.length > 0) {
      const vol = nv.volumes[0];
      setOpacity(vol.opacity);
      setColormap(vol.colormap || "gray");
      setCalMin(vol.cal_min ?? 0);
      setCalMax(vol.cal_max ?? 100);
      setVolumeVisibility(nv.volumes.map(() => true));
      setVolumeOpacities(nv.volumes.map((v) => v.opacity));
    }
    nv.setSliceType(nv.sliceTypeMultiplanar);
    nv.setMultiplanarLayout(0);
  }, [routeState]);

  const initNiivue = useCallback(() => {
    if (!canvasRef.current) return null;
    if (nvRef.current) return nvRef.current;
    const nv = new Niivue({
      backColor: [0, 0, 0, 1],
      show3Dcrosshair: true,
      crosshairWidth: 1,
    });
    nv.attachToCanvas(canvasRef.current);
    nvRef.current = nv;
    return nv;
  }, []);

  const goError = useCallback(
    (title: string, message: string, hints: string[]) => {
      setErrorTitle(title);
      setErrorMessage(message);
      setErrorHintsList(hints);
      setActiveJobId(null);
      setViewPhase("error");
    },
    [],
  );

  const handleBackFromError = useCallback(() => {
    const from = routeState.from ?? "home";
    if (from === "browse") navigate("/browse");
    else navigate("/");
  }, [navigate, routeState.from]);

  /** Volatile (no persisted study) */
  useEffect(() => {
    if (studyId) return;

    let cancelled = false;
    (async () => {
      setViewPhase("volatile_loading");
      setStatusText("Loading…");
      try {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const nv = initNiivue();
        if (!nv || cancelled) return;
        await loadVolatileFiles(nv);
        if (!cancelled) setViewPhase("ready");
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        disposeNv();
        goError(
          "Could not load file",
          msg,
          [
            "Check that the file is a supported NIfTI format.",
            "Try a smaller file or a different browser if the problem persists.",
          ],
        );
      }
    })();

    return () => {
      cancelled = true;
      disposeNv();
    };
  }, [studyId, initNiivue, loadVolatileFiles, goError, disposeNv]);

  /** Load persisted study: status + ready path */
  useEffect(() => {
    if (!studyId) return;

    let cancelled = false;
    reconnectAttemptedRef.current = false;
    setActiveJobId(null);

    (async () => {
      setViewPhase("checking");
      setStatusText("Checking study status…");
      try {
        const study = await getStudy(studyId);
        if (cancelled) return;

        setPipelineSteps(study.steps ?? []);

        const initialJob =
          typeof routeState.jobId === "string" ? routeState.jobId : study.job_id;

        if (study.status === "failed" || study.status === "cancelled") {
          goError(
            "Study is not available",
            study.error ??
              (study.status === "cancelled"
                ? "Processing was cancelled."
                : "Processing failed."),
            errorHints(null),
          );
          return;
        }

        if (study.status === "processing") {
          const job = initialJob ?? study.job_id;
          if (!job) {
            goError(
              "Cannot track processing",
              "No pipeline job id is available. Try refreshing or open the study again.",
              errorHints(null),
            );
            return;
          }
          setActiveJobId(job);
          setViewPhase("processing");
          setStatusText("Pipeline running…");
          setPipelineProgress(0);
          setCompletedSteps(new Set());
          setCurrentStep(null);
          return;
        }

        if (study.status === "ready") {
          setStatusText("Loading visualization…");
          setViewPhase("loading");
          return;
        }

        if (study.status === "created") {
          setStatusText("Loading…");
          setViewPhase("loading");
          return;
        }

        goError(
          "Unknown study state",
          `Status: ${study.status}`,
          errorHints(null),
        );
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          goError(
            "Study not found",
            "This study no longer exists. It may have been removed after a processing error.",
            [
              "Return home and create a new study.",
              "If you uploaded invalid data, fix the file and try again.",
            ],
          );
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        goError("Could not open study", msg, errorHints(null));
      }
    })();

    return () => {
      cancelled = true;
      disposeNv();
    };
  }, [studyId, routeState.jobId, goError, disposeNv]);

  /** Run after canvas is in the DOM: Niivue needs a mounted `<canvas>`. */
  useLayoutEffect(() => {
    if (!studyId || viewPhase !== "loading") return;

    let cancelled = false;

    const run = async () => {
      const nv = initNiivue();
      if (!nv || cancelled) return;
      try {
        await loadStudyFiles(nv);
        if (!cancelled) setViewPhase("ready");
      } catch (err: unknown) {
        if (cancelled) return;
        disposeNv();
        try {
          const s = await getStudy(studyId);
          if (s.status === "processing" && s.job_id) {
            setPipelineSteps(s.steps ?? []);
            setActiveJobId(s.job_id);
            setViewPhase("processing");
            setPipelineProgress(0);
            setCompletedSteps(new Set());
            setCurrentStep(null);
            setStatusText("Pipeline running…");
            return;
          }
        } catch {
          /* fall through */
        }
        const msg = err instanceof Error ? err.message : String(err);
        goError(
          "Could not load study",
          msg,
          [
            "The study may still be processing — refresh or open it again from Browse.",
            "If the problem continues, delete the study and upload again.",
          ],
        );
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [studyId, viewPhase, initNiivue, loadStudyFiles, goError, disposeNv]);
  useEffect(() => {
    if (!studyId || viewPhase !== "processing" || !activeJobId) return;

    let cancelled = false;
    let pipelineFinished = false;

    const finishOk = async () => {
      try {
        const study = await getStudy(studyId);
        if (cancelled) return;
        if (study.status === "ready") {
          setActiveJobId(null);
          setStatusText("Loading visualization…");
          setViewPhase("loading");
        }
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          goError(
            "Study not found",
            "Processing may have failed and the study was removed.",
            errorHints(null),
          );
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        goError("Could not load study after pipeline", msg, errorHints(null));
      }
    };

    const disconnect = connectPipeline(
      activeJobId,
      (msg: PipelineMessage) => {
        const p = clamp01(msg.progress);
        if (p != null) setPipelineProgress(p);
        if (msg.step) setCurrentStep(msg.step);
        if (msg.status === "running" && msg.step) {
          setStatusText(`Running: ${msg.step}`);
        }
        if (msg.event === "step_completed" && msg.step) {
          setCompletedSteps((prev) => new Set(prev).add(msg.step!));
          setStatusText(`Finished step: ${msg.step}`);
        }
        if (msg.event === "step_started" && msg.step) {
          setStatusText(`Started: ${msg.step}`);
        }

        if (msg.status === "completed" || msg.event === "pipeline_completed") {
          if (pipelineFinished) return;
          pipelineFinished = true;
          disconnect();
          setPipelineProgress(1);
          setStatusText("Pipeline completed — loading…");
          void finishOk();
        }

        if (msg.status === "failed" || msg.event === "pipeline_failed") {
          if (pipelineFinished) return;
          pipelineFinished = true;
          disconnect();
          goError(
            "Processing failed",
            msg.error ?? "The pipeline reported a failure.",
            errorHints(msg.failed_step),
          );
        }

        if (msg.status === "cancelled" || msg.event === "pipeline_cancelled") {
          if (pipelineFinished) return;
          pipelineFinished = true;
          disconnect();
          goError("Processing cancelled", "The pipeline was cancelled.", [
            "Open another study or start again from the home page.",
          ]);
        }
      },
      () => {
        if (cancelled || pipelineFinished) return;
        void (async () => {
          try {
            await finishOk();
          } catch {
            /* finishOk handles errors */
          }
          try {
            const s = await getStudy(studyId);
            if (s.status === "processing" && !reconnectAttemptedRef.current) {
              reconnectAttemptedRef.current = true;
              setStatusText("Connection closed — check your network or refresh this page.");
            }
          } catch (e: unknown) {
            if (e instanceof ApiError && e.status === 404) {
              goError(
                "Study not found",
                "Processing may have failed and the study was removed.",
                errorHints(null),
              );
            }
          }
        })();
      },
    );

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [
    studyId,
    viewPhase,
    activeJobId,
    goError,
  ]);

  const handleSliceTypeChange = (type: string) => {
    const nv = nvRef.current;
    if (!nv) return;
    setSliceType(type);
    
    switch (type) {
      case "multiplanar":
        nv.setSliceType(nv.sliceTypeMultiplanar);
        nv.setMultiplanarLayout(0);
        break;
      case "multiplanar_4view":
        nv.setSliceType(nv.sliceTypeMultiplanar);
        nv.setMultiplanarLayout(2); // Grid layout with 3 slices + 3D render
        break;
      case "axial":
        nv.setSliceType(nv.sliceTypeAxial);
        break;
      case "coronal":
        nv.setSliceType(nv.sliceTypeCoronal);
        break;
      case "sagittal":
        nv.setSliceType(nv.sliceTypeSagittal);
        break;
      case "render":
        nv.setSliceType(nv.sliceTypeRender);
        break;
    }
  };

  const handleVolumeChange = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) return;
    
    setSelectedVolume(index);
    const vol = nv.volumes[index];
    setOpacity(vol.opacity);
    setColormap(vol.colormap || "gray");
    setCalMin(vol.cal_min ?? 0);
    setCalMax(vol.cal_max ?? 100);
  };

  const handleOpacityChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) return;
    
    setOpacity(value);
    nv.setOpacity(selectedVolume, value);
    
    // Update stored opacity if volume is visible
    if (volumeVisibility[selectedVolume]) {
      const newOpacities = [...volumeOpacities];
      newOpacities[selectedVolume] = value;
      setVolumeOpacities(newOpacities);
    }
  };

  const handleColormapChange = (value: string) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) return;
    
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
    if (!nv || !nv.volumes[selectedVolume]) return;
    
    setCalMin(value);
    nv.volumes[selectedVolume].cal_min = value;
    nv.updateGLVolume();
  };

  const handleCalMaxChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) return;
    
    setCalMax(value);
    nv.volumes[selectedVolume].cal_max = value;
    nv.updateGLVolume();
  };

  const handleCrosshairToggle = () => {
    const nv = nvRef.current;
    if (!nv) return;
    
    const newValue = !showCrosshair;
    setShowCrosshair(newValue);
    nv.opts.show3Dcrosshair = newValue;
    nv.drawScene();
  };

  const handleCrosshairWidthChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) return;
    
    setCrosshairWidth(value);
    nv.setCrosshairWidth(value);
  };

  const handleVolumeVisibilityToggle = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) return;
    
    const newVisibility = [...volumeVisibility];
    newVisibility[index] = !newVisibility[index];
    setVolumeVisibility(newVisibility);
    
    // Set opacity to 0 to hide, restore stored opacity to show
    if (newVisibility[index]) {
      // Restore the stored opacity
      const opacityToRestore = volumeOpacities[index] ?? 1.0;
      nv.setOpacity(index, opacityToRestore);
    } else {
      // Store current opacity before hiding
      const newOpacities = [...volumeOpacities];
      newOpacities[index] = nv.volumes[index].opacity;
      setVolumeOpacities(newOpacities);
      // Hide by setting opacity to 0
      nv.setOpacity(index, 0);
    }
  };

  const handleBackgroundToggle = () => {
    const nv = nvRef.current;
    if (!nv) return;
    
    const newValue = !lightBackground;
    setLightBackground(newValue);
    nv.opts.backColor = newValue ? [1, 1, 1, 1] : [0, 0, 0, 1];
    nv.drawScene();
  };

  const handleClipPlaneChange = () => {
    const nv = nvRef.current;
    if (!nv) return;
    
    nv.setClipPlane([clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation]);
  };

  const handleRenderAzimuthChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) return;
    
    setRenderAzimuth(value);
    nv.setRenderAzimuthElevation(value, renderElevation);
  };

  const handleRenderElevationChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) return;
    
    setRenderElevation(value);
    nv.setRenderAzimuthElevation(renderAzimuth, value);
  };

  useEffect(() => {
    handleClipPlaneChange();
  }, [clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation]);

  useEffect(() => {
    // Update multiplanar layout when switching to multiplanar_4view
    const nv = nvRef.current;
    if (!nv) return;
    
    if (sliceType === "multiplanar_4view") {
      nv.setMultiplanarLayout(2);
    }
  }, [sliceType]);

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Ribbon - Top Controls */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center gap-6">
          {/* Sidebar Toggle */}
          <button
            onClick={() => setSidebarVisible(!sidebarVisible)}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm flex items-center gap-2"
            title="Toggle Sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {sidebarVisible ? "Hide" : "Show"} Sidebar
          </button>

          {/* Crosshair Controls */}
          <div className="flex items-center gap-3 border-l border-gray-700 pl-6">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showCrosshair}
                onChange={handleCrosshairToggle}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700"
              />
              <span>Crosshair</span>
            </label>

            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Width:</label>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={crosshairWidth}
                onChange={(e) => handleCrosshairWidthChange(parseFloat(e.target.value))}
                className="w-20"
                disabled={!showCrosshair}
              />
              <span className="text-xs text-gray-400 w-4">{crosshairWidth}</span>
            </div>
          </div>

          {/* Background Toggle */}
          <div className="flex items-center gap-2 border-l border-gray-700 pl-6">
            <label className="text-sm text-gray-300">Background:</label>
            <button
              onClick={handleBackgroundToggle}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                lightBackground
                  ? "bg-white text-gray-900"
                  : "bg-gray-900 text-gray-300 border border-gray-600"
              }`}
            >
              {lightBackground ? "Light" : "Dark"}
            </button>
          </div>

          {/* Status */}
          <div className="ml-auto text-xs text-gray-500">
            {statusText}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2 border-l border-gray-700 pl-6">
            <button
              onClick={() => navigate("/")}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm flex items-center gap-2"
              title="Back to Home"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </button>
            <button
              onClick={() => navigate("/browse")}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm flex items-center gap-2"
              title="Browse Studies"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Browse
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {viewPhase === "error" && (
          <div className="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-gray-900">
            <StudyErrorScreen
              title={errorTitle}
              message={errorMessage}
              hints={errorHintsList}
              backLabel={routeState.from === "browse" ? "Back to studies" : "Back to home"}
              onBack={handleBackFromError}
            />
          </div>
        )}

        {(viewPhase === "checking" ||
          viewPhase === "processing" ||
          viewPhase === "volatile_loading") && (
          <div className="absolute inset-0 z-10 flex flex-col overflow-auto bg-gray-900">
            <StudyLoadingScreen
              title={viewPhase === "volatile_loading" ? "Loading file" : "Processing study"}
              steps={pipelineSteps}
              completedSteps={completedSteps}
              currentStep={currentStep}
              progressFraction={pipelineProgress}
              statusLine={statusText}
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar - Controls */}
        {sidebarVisible && (
          <div className="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto">
            <div className="p-4 space-y-6">
              {/* Header */}
              <div className="border-b border-gray-700 pb-4">
                <h1 className="text-xl font-bold text-white mb-2">NiiVue Controls</h1>
                <div className="text-xs text-gray-400">
                  {studyId ? `Study: ${studyId}` : "Volatile Mode"}
                </div>
              </div>

              {/* Volume Selection and Visibility */}
              {nvRef.current && nvRef.current.volumes.length > 0 && (
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-gray-300">Volumes</label>
                  
                  {/* Volume visibility checkboxes */}
                  <div className="space-y-2">
                    {nvRef.current.volumes.map((vol, idx) => (
                      <label key={idx} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={volumeVisibility[idx] ?? true}
                          onChange={() => handleVolumeVisibilityToggle(idx)}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-700"
                        />
                        <span>{vol.name || `Volume ${idx}`}</span>
                      </label>
                    ))}
                  </div>
                  
                  {/* Volume selector for editing */}
                  <div className="space-y-2">
                    <label className="text-xs text-gray-400">Edit Volume:</label>
                    <select
                      value={selectedVolume}
                      onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                      className="w-full bg-gray-700 text-gray-300 border border-gray-600 rounded px-3 py-2 text-sm"
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
                <label className="text-sm font-semibold text-gray-300">Slice Type</label>
                <select
                  value={sliceType}
                  onChange={(e) => handleSliceTypeChange(e.target.value)}
                  className="w-full bg-gray-700 text-gray-300 border border-gray-600 rounded px-3 py-2 text-sm"
                >
                  <option value="multiplanar">Multiplanar</option>
                  <option value="multiplanar_4view">Multiplanar (4 Views)</option>
                  <option value="axial">Axial</option>
                  <option value="coronal">Coronal</option>
                  <option value="sagittal">Sagittal</option>
                  <option value="render">Render</option>
                </select>
              </div>

              {/* Opacity */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-300">
                  Opacity: {opacity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={opacity}
                  onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Colormap */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-300">Colormap</label>
                <select
                  value={colormap}
                  onChange={(e) => handleColormapChange(e.target.value)}
                  className="w-full bg-gray-700 text-gray-300 border border-gray-600 rounded px-3 py-2 text-sm"
                >
                  {colormaps.map((cm) => (
                    <option key={cm} value={cm}>
                      {cm}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cal Min */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-300">
                  Cal Min: {cal_min.toFixed(0)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="255"
                  step="1"
                  value={cal_min}
                  onChange={(e) => handleCalMinChange(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Cal Max */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-300">
                  Cal Max: {cal_max.toFixed(0)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="255"
                  step="1"
                  value={cal_max}
                  onChange={(e) => handleCalMaxChange(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Clip Plane */}
              <div className="space-y-3 border-t border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-300">Clip Plane</h3>
                
                <div className="space-y-2">
                  <label className="text-sm text-gray-300">
                    Depth: {clipPlaneDepth.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={clipPlaneDepth}
                    onChange={(e) => setClipPlaneDepth(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-gray-300">
                    Azimuth: {clipPlaneAzimuth.toFixed(0)}°
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    value={clipPlaneAzimuth}
                    onChange={(e) => setClipPlaneAzimuth(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-gray-300">
                    Elevation: {clipPlaneElevation.toFixed(0)}°
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="180"
                    step="1"
                    value={clipPlaneElevation}
                    onChange={(e) => setClipPlaneElevation(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Render Settings */}
              {sliceType === "render" && (
                <div className="space-y-3 border-t border-gray-700 pt-4">
                  <h3 className="text-sm font-semibold text-gray-300">Render View</h3>
                  
                  <div className="space-y-2">
                    <label className="text-sm text-gray-300">
                      Azimuth: {renderAzimuth.toFixed(0)}°
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="1"
                      value={renderAzimuth}
                      onChange={(e) => handleRenderAzimuthChange(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-gray-300">
                      Elevation: {renderElevation.toFixed(0)}°
                    </label>
                    <input
                      type="range"
                      min="-90"
                      max="90"
                      step="1"
                      value={renderElevation}
                      onChange={(e) => handleRenderElevationChange(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Canvas Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            style={{ backgroundColor: lightBackground ? "#ffffff" : "#000000" }}
          >
            {(viewPhase === "loading" ||
              viewPhase === "ready" ||
              viewPhase === "volatile_loading") && (
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-4 border-t border-gray-700 bg-gray-800 px-4 py-2">
            <span className="flex-1 text-xs text-gray-500">{statusText}</span>
            {pipelineProgress != null && (
              <div className="h-2 w-48 overflow-hidden rounded bg-gray-700">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${Math.round(pipelineProgress * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
