import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, FileUp, FolderPlus, Table2 } from "lucide-react";
import { OpenRawFileModal } from "../components/OpenRawFileModal";
import { CreateStudyModal, type CreateStudyData } from "../components/CreateStudyModal";
import { listStudies, createStudy, deleteStudy } from "@/api/studies";
import { UploadKind } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { FromPage, FileType, STUDY_MODES, buildUploadPayload } from "../pipeline";

export function StartPage() {
  const navigate = useNavigate();
  const [showOpenRawModal, setShowOpenRawModal] = useState(false);
  const [showCreateStudyModal, setShowCreateStudyModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenRawFile = (primary: File, mask?: File) => {
    setShowOpenRawModal(false);
    navigate("/visualize", { state: { primary, mask, from: FromPage.Home } });
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

      const baseKind = data.fileType === FileType.Dicom ? UploadKind.DicomZip : UploadKind.NiftiRaw;
      const mode = STUDY_MODES[data.segmentationType];
      const uploadPayload = buildUploadPayload(
        { file: data.baseImageFile, kind: baseKind },
        mode,
        data.segmentationFile,
      );

      navigate(`/pipeline/${study.id}`, {
        state: { uploadPayload, from: FromPage.Home },
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
          <div className="mb-4 text-lg">Creating study...</div>
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
              className="group flex flex-col items-start text-left h-full min-h-[260px] bg-card border border-border rounded-lg p-8 cursor-pointer transition-all duration-300 hover:border-primary "
            >
              <div className="w-12 h-12 rounded-lg bg-muted text-primary flex items-center justify-center mb-6 transition-colors group-hover:bg-secondary">
                <FileUp className="size-6" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-primary mb-2">Open Raw File</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                Open workspace for NIfTI images visualization. No record saved.
              </p>
              <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary group-hover:gap-2 transition-all">
                Select File <ArrowRight className="size-4" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowCreateStudyModal(true)}
              className="group relative overflow-hidden flex flex-col items-start text-left h-full min-h-[260px] bg-card border border-border rounded-lg p-8 cursor-pointer transition-all duration-300 hover:border-primary hover:shadow-[0_4px_24px_rgba(0,94,184,0.10)]"
            >
              
              <div className="relative w-12 h-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center mb-6 transition-colors">
                <FolderPlus className="size-6" />
              </div>
              <h2 className="relative text-xl font-semibold tracking-tight text-primary mb-2">Create a Study</h2>
              <p className="relative text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                Save record of NIfTI images and run automated segmentation or manual mask upload.
              </p>
              <span className="relative flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary group-hover:gap-2 transition-all">
                Open Wizard <ArrowRight className="size-4" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/browse")}
              className="group flex flex-col items-start text-left h-full min-h-[260px] bg-card border border-border rounded-lg p-8 cursor-pointer transition-all duration-300 hover:border-primary hover:shadow-[0_4px_24px_rgba(0,94,184,0.10)]"
            >
              <div className="w-12 h-12 rounded-lg bg-muted text-primary flex items-center justify-center mb-6 transition-colors group-hover:bg-secondary">
                <Table2 className="size-6" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-primary mb-2">Browse Studies</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                Browse and manage the archive of saved studies.
              </p>
              <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary group-hover:gap-2 transition-all">
                View files <ArrowRight className="size-4" />
              </span>
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
