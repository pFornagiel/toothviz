import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, FileUp, FolderPlus, Table2 } from "lucide-react";
import { OpenRawFileModal } from "../components/OpenRawFileModal";
import { CreateStudyModal, type CreateStudyData } from "../components/CreateStudyModal";
import { createStudy } from "@/api/studies";
import { UploadKind } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { FromPage, FileType, STUDY_MODES, buildUploadPayload } from "../pipeline";

export function StartPage() {
  const navigate = useNavigate();
  const [showOpenRawModal, setShowOpenRawModal] = useState(false);
  const [showCreateStudyModal, setShowCreateStudyModal] = useState(false);

  const handleOpenRawFile = (primary: File, mask?: File) => {
    setShowOpenRawModal(false);
    navigate("/visualize", { state: { primary, mask, from: FromPage.Home } });
  };

  /** Errors (e.g. 409 duplicate name) propagate to the modal, which stays open. */
  const handleCreateStudy = async (data: CreateStudyData) => {
    const study = await createStudy(data.studyName);

    const baseKind = data.fileType === FileType.Dicom ? UploadKind.DicomZip : UploadKind.NiftiRaw;
    const mode = STUDY_MODES[data.segmentationType];
    const uploadPayload = buildUploadPayload(
      { file: data.baseImageFile, kind: baseKind },
      mode,
      data.segmentationFile,
    );

    setShowCreateStudyModal(false);
    navigate(`/pipeline/${study.id}`, {
      state: { uploadPayload, from: FromPage.Home },
    });
  };

  return (
    <PageLayout title="ToothViz" mainClassName="flex items-center justify-center p-8">
      <div className="space-y-6 w-full max-w-5xl">
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
              Open workspace for NIfTI volumes visualization. No record saved.
            </p>
            <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary group-hover:gap-2 transition-all">
              Select File <ArrowRight className="size-4" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateStudyModal(true)}
            className="group relative overflow-hidden flex flex-col items-start text-left h-full min-h-[260px] bg-card border border-border rounded-lg p-8 cursor-pointer transition-all duration-300 hover:border-primary"
          >
            
            <div className="relative w-12 h-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center mb-6 transition-colors">
              <FolderPlus className="size-6" />
            </div>
            <h2 className="relative text-xl font-semibold tracking-tight text-primary mb-2">Load New Scan</h2>
            <p className="relative text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
              Save record of NIfTI volume and run automated segmentation or manual mask upload.
            </p>
            <span className="relative flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary group-hover:gap-2 transition-all">
              Open Wizard <ArrowRight className="size-4" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/browse")}
            className="group flex flex-col items-start text-left h-full min-h-[260px] bg-card border border-border rounded-lg p-8 cursor-pointer transition-all duration-300 hover:border-primary"
          >
            <div className="w-12 h-12 rounded-lg bg-muted text-primary flex items-center justify-center mb-6 transition-colors group-hover:bg-secondary">
              <Table2 className="size-6" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-primary mb-2">Browse Scans</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
              Browse and manage the archive of saved volumes.
            </p>
            <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary group-hover:gap-2 transition-all">
              View files <ArrowRight className="size-4" />
            </span>
          </button>
        </div>
      </div>

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
