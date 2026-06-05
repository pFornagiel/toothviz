import { useState } from "react";
import { useNavigate } from "react-router";
import { OpenRawFileModal } from "../components/OpenRawFileModal";
import { CreateStudyModal, type CreateStudyData } from "../components/CreateStudyModal";
import { listStudies, createStudy, deleteStudy } from "@/api/studies";
import type { UploadKind, PipelineRequestItem } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";

export function StartPage() {
  const navigate = useNavigate();
  const [showOpenRawModal, setShowOpenRawModal] = useState(false);
  const [showCreateStudyModal, setShowCreateStudyModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenRawFile = (primary: File, mask?: File) => {
    setShowOpenRawModal(false);
    navigate("/visualize", { state: { primary, mask, from: "home" } });
  };

  const handleCreateStudy = async (data: CreateStudyData) => {
    setShowCreateStudyModal(false);
    setBusy(true);
    setError(null);

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

      let pipelines: PipelineRequestItem[] = [];
      if (data.segmentationType === "automated") {
        pipelines = [{ name: "segment_nifti" }];
      } else if (data.segmentationType === "testing_stub") {
        pipelines = [
          { name: "stub" },
          { name: "stub" },
          { name: "stub" },
          { name: "passthrough" },
        ];
      }

      const uploadPayload = {
        baseImageFile: data.baseImageFile,
        baseKind,
        pipelines,
        segmentationFile:
          data.segmentationType === "precomputed" && data.segmentationFile
            ? data.segmentationFile
            : undefined,
      };

      navigate(`/pipeline/${study.id}`, {
        state: { uploadPayload, from: "home" as const },
      });
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
    }
  };

  return (
    <PageLayout title="ToothViz" mainClassName="flex items-center justify-center p-8">
      {busy ? (
        <div className="text-muted-foreground text-center max-w-md w-full mx-auto">
          <div className="mb-4 text-lg">Creating study…</div>
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="space-y-6 w-full max-w-5xl">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md px-4 py-3 text-sm text-destructive font-medium">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              type="button"
              onClick={() => setShowOpenRawModal(true)}
              className="bg-card border border-border rounded-lg p-12 hover:border-primary hover:shadow-md transition-all flex flex-col items-center justify-center gap-4 min-h-[240px] group cursor-pointer"
            >
              <div className="w-16 h-16 border-2 border-primary/20 rounded flex items-center justify-center bg-primary/5 group-hover:bg-primary/10 transition-colors" />
              <div className="text-center">
                <h2 className="text-base text-foreground font-semibold mb-2">Open Raw File</h2>
                <p className="text-sm text-muted-foreground">Volatile workspace</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowCreateStudyModal(true)}
              className="bg-card border border-border rounded-lg p-12 hover:border-primary hover:shadow-md transition-all flex flex-col items-center justify-center gap-4 min-h-[240px] group cursor-pointer"
            >
              <div className="w-16 h-16 border-2 border-primary/20 rounded flex items-center justify-center bg-primary/5 group-hover:bg-primary/10 transition-colors" />
              <div className="text-center">
                <h2 className="text-base text-foreground font-semibold mb-2">Create a Study</h2>
                <p className="text-sm text-muted-foreground">Persistent workspace</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate("/browse")}
              className="bg-card border border-border rounded-lg p-12 hover:border-primary hover:shadow-md transition-all flex flex-col items-center justify-center gap-4 min-h-[240px] group cursor-pointer"
            >
              <div className="w-16 h-16 border-2 border-primary/20 rounded flex items-center justify-center bg-primary/5 group-hover:bg-primary/10 transition-colors" />
              <div className="text-center">
                <h2 className="text-base text-foreground font-semibold mb-2">Browse Studies</h2>
                <p className="text-sm text-muted-foreground">Saved studies</p>
              </div>
            </button>
          </div>
        </div>
      )}

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
    </PageLayout>
  );
}
