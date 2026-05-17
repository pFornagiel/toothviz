import { useState } from "react";
import { useNavigate } from "react-router";
import { OpenRawFileModal } from "../components/OpenRawFileModal";
import { CreateStudyModal, type CreateStudyData } from "../components/CreateStudyModal";
import { listStudies, createStudy, deleteStudy } from "@/api/studies";
import { uploadFile, type UploadProgress } from "@/api/upload";
import type { UploadKind, PipelineRequestItem } from "@/api/types";
import { Progress } from "../components/ui/progress";

export function StartPage() {
  const navigate = useNavigate();
  const [showOpenRawModal, setShowOpenRawModal] = useState(false);
  const [showCreateStudyModal, setShowCreateStudyModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  const handleOpenRawFile = (primary: File, mask?: File) => {
    setShowOpenRawModal(false);
    navigate("/visualize", { state: { primary, mask, from: "home" } });
  };

  const applyUploadProgress = (p: UploadProgress) => {
    if (p.phase === "begin") {
      setUploadLabel("Starting upload…");
      setUploadPercent(0);
    } else if (p.phase === "uploading" && p.totalChunks) {
      const idx = (p.chunkIndex ?? 0) + 1;
      setUploadLabel(`Uploading chunks ${idx} / ${p.totalChunks}`);
      setUploadPercent(Math.round((idx / p.totalChunks) * 100));
    } else if (p.phase === "finalizing") {
      setUploadLabel("Finalizing on server…");
      setUploadPercent(100);
    } else if (p.phase === "done") {
      setUploadPercent(100);
    }
  };

  const handleCreateStudy = async (data: CreateStudyData) => {
    setShowCreateStudyModal(false);
    setBusy(true);
    setError(null);
    setUploadLabel("");
    setUploadPercent(null);

    let createdId: string | undefined;

    try {
      const existing = await listStudies(data.studyName);
      if (existing.length > 0) {
        setError(`A study named "${data.studyName}" already exists.`);
        setBusy(false);
        return;
      }

      const study = await createStudy(data.studyName);
      createdId = study.id;

      const baseKind: UploadKind =
        data.fileType === "dicom" ? "dicom_zip" : "nifti_raw";

      const pipelines: PipelineRequestItem[] =
        data.segmentationType === "automated"
          ? [{ name: "segment_nifti" }]
          : [];

      const baseResult = await uploadFile(
        study.id,
        data.baseImageFile,
        baseKind,
        pipelines,
        applyUploadProgress,
      );

      if (data.segmentationType === "precomputed" && data.segmentationFile) {
        setUploadLabel("Uploading mask…");
        await uploadFile(
          study.id,
          data.segmentationFile,
          "nifti_mask",
          [],
          applyUploadProgress,
        );
      }

      if (baseResult.job_id) {
        // Pipeline was dispatched — go to pipeline loading screen
        navigate(`/pipeline/${study.id}`, {
          state: { jobId: baseResult.job_id, from: "home" },
        });
      } else {
        // No pipeline — go straight to viewer
        navigate(`/visualize/${study.id}`, {
          state: { from: "home" },
        });
      }
    } catch (err: unknown) {
      if (createdId) {
        try {
          await deleteStudy(createdId);
        } catch {
          /* best-effort cleanup */
        }
      }
      setError(err instanceof Error ? err.message : "Study creation failed");
    } finally {
      setBusy(false);
      setUploadLabel("");
      setUploadPercent(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <header className="border-b border-gray-700 px-6 py-4">
        <h1 className="text-lg text-gray-200">Medical Visualization App</h1>
      </header>

      <main className="flex-1 flex items-center justify-center p-8">
        {busy ? (
          <div className="text-gray-400 text-center max-w-md w-full">
            <div className="mb-4 text-lg">Creating study and uploading files…</div>
            {uploadLabel && (
              <p className="text-sm text-gray-500 mb-3">{uploadLabel}</p>
            )}
            {uploadPercent != null && (
              <Progress
                value={uploadPercent}
                className="h-2 bg-gray-700 [&_[data-slot=progress-indicator]]:bg-blue-500 mb-4"
              />
            )}
            {uploadPercent == null && (
              <div className="w-8 h-8 border-2 border-gray-500 border-t-gray-200 rounded-full animate-spin mx-auto" />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
            <div className="grid grid-cols-3 gap-6 max-w-5xl w-full">
              <button
                type="button"
                onClick={() => setShowOpenRawModal(true)}
                className="bg-gray-800 border border-gray-700 rounded p-12 hover:border-gray-500 transition-colors flex flex-col items-center justify-center gap-4 min-h-[240px]"
              >
                <div className="w-16 h-16 border-2 border-gray-600 rounded" />
                <div className="text-center">
                  <h2 className="text-base text-gray-200 mb-2">Open Raw File</h2>
                  <p className="text-sm text-gray-500">Volatile workspace</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setShowCreateStudyModal(true)}
                className="bg-gray-800 border border-gray-700 rounded p-12 hover:border-gray-500 transition-colors flex flex-col items-center justify-center gap-4 min-h-[240px]"
              >
                <div className="w-16 h-16 border-2 border-gray-600 rounded" />
                <div className="text-center">
                  <h2 className="text-base text-gray-200 mb-2">Create a Study</h2>
                  <p className="text-sm text-gray-500">Persistent workspace</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/browse")}
                className="bg-gray-800 border border-gray-700 rounded p-12 hover:border-gray-500 transition-colors flex flex-col items-center justify-center gap-4 min-h-[240px]"
              >
                <div className="w-16 h-16 border-2 border-gray-600 rounded" />
                <div className="text-center">
                  <h2 className="text-base text-gray-200 mb-2">Browse Studies</h2>
                  <p className="text-sm text-gray-500">Saved studies</p>
                </div>
              </button>
            </div>
          </div>
        )}
      </main>

      <OpenRawFileModal
        isOpen={showOpenRawModal}
        onClose={() => setShowOpenRawModal(false)}
        onSubmit={handleOpenRawFile}
      />
      <CreateStudyModal
        isOpen={showCreateStudyModal}
        onClose={() => setShowCreateStudyModal(false)}
        onSubmit={handleCreateStudy}
      />
    </div>
  );
}
