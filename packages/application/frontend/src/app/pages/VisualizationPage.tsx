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

  const [activeMenu, setActiveMenu] = useState<string | null>(null);
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

  const [overlayVisible, setOverlayVisible] = useState(true);

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
  }, [routeState]);

  const initNiivue = useCallback(() => {
    if (!canvasRef.current) return null;
    if (nvRef.current) return nvRef.current;
    const nv = new Niivue({
      backColor: [0.1, 0.1, 0.12, 1],
      show3Dcrosshair: true,
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

  const toggleOverlay = () => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length < 2) return;
    const next = !overlayVisible;
    setOverlayVisible(next);
    nv.setOpacity(1, next ? 0.5 : 0);
  };

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const showFooter = viewPhase === "ready";

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <div className="bg-gray-800 border-b border-gray-700 flex items-center shrink-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu("file")}
            className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            File &#x25BE;
          </button>

          {activeMenu === "file" && (
            <div className="absolute top-full left-0 w-48 bg-gray-800 border border-gray-700 z-50">
              <button
                type="button"
                onClick={() => {
                  setActiveMenu(null);
                  navigate("/");
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Open Raw File
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMenu(null);
                  navigate("/browse");
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Open Study
              </button>
              <div className="border-t border-gray-700" />
              <button
                type="button"
                onClick={() => navigate("/")}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Close Window
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu("show")}
            className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Show &#x25BE;
          </button>

          {activeMenu === "show" && viewPhase === "ready" && (
            <div className="absolute top-full left-0 w-48 bg-gray-800 border border-gray-700 z-50">
              <button
                type="button"
                onClick={() => {
                  toggleOverlay();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                {overlayVisible ? "Hide Overlay" : "Show Overlay"}
              </button>
            </div>
          )}
        </div>

        <div className="ml-auto px-4 py-2 text-sm text-gray-500">
          {studyId ? `Study: ${studyId}` : "Volatile Mode"}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
        {viewPhase === "error" && (
          <StudyErrorScreen
            title={errorTitle}
            message={errorMessage}
            hints={errorHintsList}
            backLabel={routeState.from === "browse" ? "Back to studies" : "Back to home"}
            onBack={handleBackFromError}
          />
        )}

        {(viewPhase === "checking" ||
          viewPhase === "processing" ||
          viewPhase === "volatile_loading") && (
          <div className="absolute inset-0 z-10 bg-gray-900 flex-1 overflow-auto">
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

        {(viewPhase === "loading" ||
          viewPhase === "ready" ||
          viewPhase === "volatile_loading") && (
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        )}
      </div>

      {showFooter && (
        <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 text-xs text-gray-500 flex items-center gap-4 shrink-0">
          <span className="flex-1">{statusText}</span>
        </div>
      )}

      {activeMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setActiveMenu(null)}
          role="presentation"
        />
      )}
    </div>
  );
}
