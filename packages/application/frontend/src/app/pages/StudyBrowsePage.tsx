import { useCallback, useEffect, useState } from "react";
import { useNavigate, useLoaderData, useRevalidator } from "react-router";
import {
  cancelStudyPipeline,
  deleteStudy,
  listStudies,
  retryStudyPipeline,
} from "@/api/studies";
import type { StudyResponse } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { canCancelStudy, canRetryStudy, FromPage, isProcessingStudy } from "../pipeline";
import { Folder, EllipsisVertical, Dot } from "lucide-react";
import { CancelPipelineDialog } from "../components/CancelPipelineDialog";
import { DeleteStudyDialog } from "../components/DeleteStudyDialog";
import { Button } from "../components/ui/button";
import { EditStudyModal } from "../components/EditStudyModal";
import { StudyStatusIndicator } from "../components/StudyStatusIndicator";

export async function browseLoader() {
  return await listStudies();
}

interface StudyItemProps {
  study: StudyResponse;
  onEdit: (study: StudyResponse) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}

function StudyItem({ study, onEdit, isSelected, onSelect, onRefresh }: StudyItemProps) {
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const showRetry = canRetryStudy(study);
  const showCancel = canCancelStudy(study);

  const actionBtnClass = `px-2 h-8 cursor-pointer rounded text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 ${
    isSelected ? "hover:bg-primary/20" : "hover:bg-accent"
  }`;

  const handleEditClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onEdit(study);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const handleNavigate = (study: StudyResponse) => {
    if (isProcessingStudy(study) && study.job_id) {
      navigate(`/pipeline/${study.id}`, {
        state: { from: FromPage.Browse },
      });
    } else {
      navigate(`/visualize/${study.id}`, { state: { from: FromPage.Browse } });
    }
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (retrying) {
      return;
    }
    setRetrying(true);
    try {
      await retryStudyPipeline(study.id);
      navigate(`/pipeline/${study.id}`, { state: { from: FromPage.Browse } });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Retry failed");
      setRetrying(false);
    }
  };

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (cancelling) {
      return;
    }
    setConfirmCancelOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (cancelling) {
      return;
    }
    setCancelling(true);
    try {
      await cancelStudyPipeline(study.id);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <tr
      key={study.id}
      className={`transition-colors border-l-2 cursor-pointer select-none ${
        isSelected
          ? "bg-primary/10 border-l-primary"
          : "even:bg-muted/20 hover:bg-muted/50 border-transparent hover:border-l-primary"
      }`}
      onClick={(e) => { e.stopPropagation(); onSelect(study.id); }}
      onDoubleClick={() => handleNavigate(study)}
    >
      <td className="px-6 py-4 text-sm text-foreground font-medium flex items-center content-center gap-4">
        <Folder
          className={`size-10 rounded-md p-2 transition-colors ${
            isSelected ? "bg-primary text-primary-foreground" : "bg-accent"
          }`}
        />
        {study.name}
      </td>
      <td className="px-6 py-4 text-sm">
        <StudyStatusIndicator status={study.status} />
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
        {formatDate(study.created_at)}
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">
        <div className="flex items-center justify-end gap-1">
          {showCancel && (
            <Button
              variant="ghost"
              onClick={handleCancelClick}
              disabled={cancelling}
              className={actionBtnClass}
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {showRetry && (
            <Button
              variant="ghost"
              onClick={handleRetry}
              disabled={retrying}
              className={actionBtnClass}
            >
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={handleEditClick}
            className={`p-1 w-8 h-8 cursor-pointer rounded text-muted-foreground hover:text-foreground transition-colors ${isSelected ? "hover:bg-primary/20" : "hover:bg-accent"}`}
          >
            <EllipsisVertical className="!size-5" />
          </Button>
        </div>
        <CancelPipelineDialog
          open={confirmCancelOpen}
          onOpenChange={setConfirmCancelOpen}
          onConfirm={() => void handleConfirmCancel()}
          stopPropagation
        />
      </td>
    </tr>
  );
}

export function StudyBrowsePage() {
  const studies = useLoaderData() as StudyResponse[];
  const [openEditStudyModal, setOpenEditStudyModal] = useState(false);
  const [editedStudy, setEditedStudy] = useState<StudyResponse | null>(null);
  const [studyToDelete, setStudyToDelete] = useState<StudyResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);

  useEffect(() => {
    const handleDocumentClick = () => setSelectedStudyId(null);
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  const revalidator = useRevalidator();
  const refresh = useCallback(async () => {
    revalidator.revalidate();
  }, [revalidator]);

  const onCloseEditModal = () => {
    setOpenEditStudyModal(false);
    setEditedStudy(null);
  };

  const onEdit = (study: StudyResponse) => {
    setEditedStudy(study);
    setOpenEditStudyModal(true);
  };

  const onRequestDelete = () => {
    if (!editedStudy) {
      return;
    }
    const target = editedStudy;
    onCloseEditModal();
    // Let the edit Dialog fully release body scroll/pointer lock first.
    window.setTimeout(() => setStudyToDelete(target), 0);
  };

  const handleConfirmDelete = async () => {
    if (!studyToDelete || deleting) {
      return;
    }
    setDeleting(true);
    try {
      await deleteStudy(studyToDelete.id);
      setStudyToDelete(null);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
      // Safety: nested/rapid modal close can leave Radix removeScroll stuck.
      document.body.style.pointerEvents = "";
    }
  };

  return (
    <PageLayout
      showBackButton
      mainClassName="p-8 flex items-center flex-col"
    >
      {studies.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No studies found. Create one from the start page.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden max-w-5xl w-full">
          <table className="w-full">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Created
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {studies.map((study) => (
                <StudyItem
                  key={study.id}
                  study={study}
                  onEdit={onEdit}
                  isSelected={selectedStudyId === study.id}
                  onSelect={setSelectedStudyId}
                  onRefresh={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 text-sm text-muted-foreground w-full max-w-5xl text-right">
        Click to select <Dot className="inline" /> Double-click to open
      </div>

      {editedStudy && (
        <EditStudyModal
          study={editedStudy}
          isOpen={openEditStudyModal}
          onClose={onCloseEditModal}
          onSave={refresh}
          onRequestDelete={onRequestDelete}
        />
      )}

      <DeleteStudyDialog
        open={studyToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setStudyToDelete(null);
          }
        }}
        studyName={studyToDelete?.name}
        onConfirm={() => void handleConfirmDelete()}
      />
    </PageLayout>
  );
}
