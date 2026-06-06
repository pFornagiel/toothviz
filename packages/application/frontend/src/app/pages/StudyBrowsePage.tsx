import { useCallback, useEffect, useState } from "react";
import { useNavigate, useLoaderData, useRevalidator } from "react-router";
import { listStudies, renameStudy, deleteStudy } from "@/api/studies";
import type { StudyResponse } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { FromPage } from "../pipeline";
import { Folder, EllipsisVertical, Dot } from "lucide-react";
import { Button } from "../components/ui/button";
import { EditStudyModal } from "../components/EditStudyModal";

export async function browseLoader() {
  return await listStudies();
}

interface StudyItemProps {
  study: StudyResponse;
  onEdit: (study: StudyResponse) => void;
  validatorRefresher: () => Promise<void>;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function StudyItem({ study, onEdit, validatorRefresher, isSelected, onSelect }: StudyItemProps) {
  const navigate = useNavigate();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const handleEditClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onEdit(study);
  };

  const handleRename = async (study: StudyResponse) => {
    const newName = prompt("New study name:", study.name ?? "");
    if (!newName || newName === study.name) {
      return;
    }
    setActiveDropdown(null);
    await renameStudy(study.id, newName);
    validatorRefresher();
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const handleNavigate = (study: StudyResponse) => {
    if (study.status === "processing" && study.job_id) {
      navigate(`/pipeline/${study.id}`, {
        state: { from: FromPage.Browse },
      });
    } else {
      navigate(`/visualize/${study.id}`, { state: { from: FromPage.Browse } });
    }
  };

  const handleDeleteStudy = async (id: string) => {
    if (!confirm("Delete this study?")) {
      return;
    }
    setActiveDropdown(null);
    await deleteStudy(id);
    validatorRefresher();
  };

  const getStatusColor = (status: string) => {
    if (status === "ready") {
      return "text-emerald-600 font-medium";
    }
    if (status === "processing") {
      return "text-amber-600 font-medium";
    }
    if (status === "failed") {
      return "text-destructive font-medium";
    }
    if (status === "cancelled") {
      return "text-orange-500 font-medium";
    }
    return "text-muted-foreground";
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
        <span className={getStatusColor(study.status)}>{study.status}</span>
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
        {formatDate(study.created_at)}
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">
        <div className="relative">
          <Button
            variant="ghost"
            onClick={handleEditClick}
            className={`p-1 w-8 h-8 cursor-pointer rounded text-muted-foreground hover:text-foreground transition-colors ${isSelected ? "hover:bg-primary/20" : "hover:bg-accent"}`}
          >
            <EllipsisVertical className="!size-5" />
          </Button>

          {activeDropdown === study.id && (
            <div className="absolute right-0 mt-2 w-48 bg-popover border border-border rounded-md shadow-lg z-10 overflow-hidden">
              <button
                onClick={() => handleRename(study)}
                className="w-full text-left px-4 py-2 text-sm text-popover-foreground hover:bg-muted transition-colors"
              >
                Edit Name
              </button>
              <button
                onClick={() => handleDeleteStudy(study.id)}
                className="w-full text-left px-4 py-2 text-sm text-destructive hover:bg-muted transition-colors border-t border-border"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function StudyBrowsePage() {
  const studies = useLoaderData() as StudyResponse[];
  const [openEditStudyModal, setOpenEditStudyModal] = useState(false);
  const [editedStudy, setEditedStudy] = useState<StudyResponse | null>(null);
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
  
  return (
    <PageLayout
      title="Browse Studies"
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
                  validatorRefresher={refresh}
                  isSelected={selectedStudyId === study.id}
                  onSelect={setSelectedStudyId}
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
        />
      )}
    </PageLayout>
  );
}
