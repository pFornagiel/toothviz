import { useCallback, useState } from "react";
import { useNavigate, useLoaderData, useRevalidator } from "react-router";
import { listStudies, renameStudy, deleteStudy } from "@/api/studies";
import type { StudyResponse } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { FromPage } from "../pipeline";

export async function browseLoader() {
  return await listStudies();
}

export function StudyBrowsePage() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const studies = useLoaderData() as StudyResponse[];

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    revalidator.revalidate();
  }, [revalidator]);

  const handleDeleteStudy = async (id: string) => {
    if (!confirm("Delete this study?")) {
      return;
    }
    setActiveDropdown(null);
    await deleteStudy(id);
    refresh();
  };

  const handleRename = async (study: StudyResponse) => {
    const newName = prompt("New study name:", study.name ?? "");
    if (!newName || newName === study.name) {
      return;
    }
    setActiveDropdown(null);
    await renameStudy(study.id, newName);
    refresh();
  };

  const handleClick = (study: StudyResponse) => {
    if (study.status === "processing" && study.job_id) {
      navigate(`/pipeline/${study.id}`, {
        state: { from: FromPage.Browse },
      });
    } else {
      navigate(`/visualize/${study.id}`, { state: { from: FromPage.Browse } });
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <PageLayout title="Browse Studies" showBackButton mainClassName="p-8">
      {studies.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No studies found. Create one from the start page.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
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
                <tr
                  key={study.id}
                  className="hover:bg-muted/50 cursor-pointer transition-colors border-l-2 border-transparent hover:border-primary"
                  onClick={() => handleClick(study)}
                >
                  <td className="px-6 py-4 text-sm text-foreground font-medium">
                    {study.name ?? "-"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={
                        study.status === "ready"
                          ? "text-emerald-600 font-medium"
                          : study.status === "processing"
                            ? "text-amber-600 font-medium"
                            : study.status === "failed"
                              ? "text-destructive font-medium"
                              : study.status === "cancelled"
                                ? "text-orange-500 font-medium"
                                : "text-muted-foreground"
                      }
                    >
                      {study.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                    {formatDate(study.created_at)}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDropdown(activeDropdown === study.id ? null : study.id);
                        }}
                        className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                      >
                        &#x22EE;
                      </button>

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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-sm text-muted-foreground text-center">
        Double-click to open study
      </div>
    </PageLayout>
  );
}
