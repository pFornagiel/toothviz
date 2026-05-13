import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Niivue } from "@niivue/niivue";
import { listFiles, fileContentUrl } from "@/api/studies";
import { connectPipeline } from "@/api/ws";
import type { FileRecordResponse, PipelineMessage } from "@/api/types";

interface LocationState {
  primary?: File;
  mask?: File;
  jobId?: string | null;
}

export function VisualizationPage() {
  const navigate = useNavigate();
  const { studyId } = useParams();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);

  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Ready");
  const [pipelineProgress, setPipelineProgress] = useState<number | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [imageVisible, setImageVisible] = useState(true);
  const [sliceType, setSliceType] = useState<string>("multiplanar");
  const [heroImage, setHeroImage] = useState(0.5);

  const loadStudyFiles = useCallback(
    async (nv: Niivue) => {
      if (!studyId) return;
      setStatusText("Loading files...");
      const files = await listFiles(studyId, "viewer_volume,viewer_overlay");

      const volumes: { url: string; name: string; opacity?: number }[] = [];
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
        });
      }

      if (volumes.length > 0) {
        await nv.loadVolumes(volumes);
        setStatusText(`Loaded ${volumes.length} volume(s)`);
      } else {
        setStatusText("No viewable files found for this study");
      }
    },
    [studyId],
  );

  const loadVolatileFiles = useCallback(async (nv: Niivue) => {
    const { primary, mask } = state;
    if (!primary) return;

    setStatusText("Loading local file...");
    const volumes: { url: string; name: string; opacity?: number }[] = [];

    volumes.push({
      url: URL.createObjectURL(primary),
      name: primary.name,
    });
    if (mask) {
      volumes.push({
        url: URL.createObjectURL(mask),
        name: mask.name,
        opacity: 0.5,
      });
    }

    await nv.loadVolumes(volumes);
    setStatusText(`Volatile mode — ${primary.name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const nv = new Niivue({
      backColor: [0.1, 0.1, 0.12, 1],
      show3Dcrosshair: true,
    });
    nv.attachToCanvas(canvasRef.current);
    nvRef.current = nv;

    nv.setSliceType(nv.sliceTypeMultiplanar);
    nv.setMultiplanarLayout(3); // Row Layout
    nv.setHeroImage(0.5);

    if (studyId) {
      loadStudyFiles(nv);
    } else {
      loadVolatileFiles(nv);
    }

    return () => {
      nvRef.current = null;
    };
  }, [studyId, loadStudyFiles, loadVolatileFiles]);

  useEffect(() => {
    if (!state.jobId) return;

    setStatusText("Pipeline running...");
    setPipelineProgress(0);

    const disconnect = connectPipeline(
      state.jobId,
      (msg: PipelineMessage) => {
        if (msg.progress != null) {
          setPipelineProgress(msg.progress);
        }
        if (msg.step) {
          setStatusText(`Pipeline: ${msg.step} — ${msg.status ?? ""}`);
        }
        if (msg.status === "completed") {
          setPipelineProgress(null);
          setStatusText("Pipeline completed — reloading files...");
          if (nvRef.current) loadStudyFiles(nvRef.current);
        }
        if (msg.status === "failed") {
          setPipelineProgress(null);
          setStatusText(`Pipeline failed: ${msg.error ?? "unknown error"}`);
        }
      },
      () => {
        if (pipelineProgress != null) {
          setStatusText("Pipeline connection closed");
          setPipelineProgress(null);
        }
      },
    );

    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.jobId]);

  const toggleOverlay = () => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length < 2) return;
    const next = !overlayVisible;
    setOverlayVisible(next);
    nv.setOpacity(1, next ? 0.5 : 0);
  };

  const toggleImage = () => {
    const nv = nvRef.current;
    if (!nv || nv.volumes.length < 1) return;
    const next = !imageVisible;
    setImageVisible(next);
    nv.setOpacity(0, next ? 1 : 0);
  };

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const handleSliceTypeChange = (type: string) => {
    const nv = nvRef.current;
    if (!nv) return;
    setSliceType(type);
    
    switch (type) {
      case "multiplanar":
        nv.setSliceType(nv.sliceTypeMultiplanar);
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
    
    // Reset the view to prevent zoom issues
    nv.scene.volScaleMultiplier = 1;
    nv.drawScene();
  };

  const handleHeroImageChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) return;
    setHeroImage(value);
    nv.setHeroImage(value);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Menu Bar */}
      <div className="bg-gray-800 border-b border-gray-700 flex items-center">
        <div className="relative">
          <button
            onClick={() => toggleMenu("file")}
            className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            File &#x25BE;
          </button>

          {activeMenu === "file" && (
            <div className="absolute top-full left-0 w-48 bg-gray-800 border border-gray-700 z-50">
              <button
                onClick={() => { setActiveMenu(null); navigate("/"); }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Open Raw File
              </button>
              <button
                onClick={() => { setActiveMenu(null); navigate("/browse"); }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Open Study
              </button>
              <div className="border-t border-gray-700" />
              <button
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
            onClick={() => toggleMenu("show")}
            className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Show &#x25BE;
          </button>

          {activeMenu === "show" && (
            <div className="absolute top-full left-0 w-48 bg-gray-800 border border-gray-700 z-50">
              <button
                onClick={() => { toggleOverlay(); setActiveMenu(null); }}
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

      {/* NiiVue Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Controls Bar */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-3 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-300">Slice Type:</label>
          <select
            value={sliceType}
            onChange={(e) => handleSliceTypeChange(e.target.value)}
            className="bg-gray-700 text-gray-300 border border-gray-600 rounded px-2 py-1 text-sm"
          >
            <option value="multiplanar">Multiplanar</option>
            <option value="axial">Axial</option>
            <option value="coronal">Coronal</option>
            <option value="sagittal">Sagittal</option>
            <option value="render">Render</option>
          </select>
        </div>

        {sliceType === "multiplanar" && (
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <label className="text-gray-300">Hero Image:</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={heroImage}
              onChange={(e) => handleHeroImageChange(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-gray-400 w-12 text-right">{heroImage.toFixed(1)}</span>
          </div>
        )}

        <div className="flex items-center gap-4 border-l border-gray-700 pl-4">
          <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={imageVisible}
              onChange={toggleImage}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
            />
            <span>Show Image</span>
          </label>
          {nvRef.current && nvRef.current.volumes.length > 1 && (
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={overlayVisible}
                onChange={toggleOverlay}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              <span>Show Mask</span>
            </label>
          )}
        </div>

        <div className="text-gray-500 text-xs ml-auto">
          Current: Multiplanar (Row Layout)
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 text-xs text-gray-500 flex items-center gap-4">
        <span className="flex-1">{statusText}</span>
        {pipelineProgress != null && (
          <div className="w-48 h-2 bg-gray-700 rounded overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.round(pipelineProgress * 100)}%` }}
            />
          </div>
        )}
      </div>

      {activeMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
      )}
    </div>
  );
}
