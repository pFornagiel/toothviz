import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  listStudies,
  renameStudy,
  deleteStudy,
} from "@/api/studies";
import type { StudyResponse } from "@/api/types";

export function StudyBrowsePage() {
  const navigate = useNavigate();
  const [studies, setStudies] = useState<StudyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStudies(await listStudies());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDeleteStudy = async (id: string) => {
    if (!confirm("Delete this study?")) return;
    setActiveDropdown(null);
    await deleteStudy(id);
    await refresh();
  };

  const handleRename = async (study: StudyResponse) => {
    const newName = prompt("New study name:", study.name ?? "");
    if (!newName || newName === study.name) return;
    setActiveDropdown(null);
    await renameStudy(study.id, newName);
    await refresh();
  };

  const handleDoubleClick = (id: string) => {
    navigate(`/visualize/${id}`);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <header className="border-b border-gray-700 px-6 py-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-gray-400 hover:text-gray-200">
            &larr;
          </button>
          <h1 className="text-lg text-gray-200">Browse Studies</h1>
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="text-center text-gray-500 py-12">Loading...</div>
          ) : studies.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              No studies found. Create one from the start page.
            </div>
          ) : (
            <div className="bg-gray-800 border border-gray-700 rounded overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-gray-700">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs text-gray-400 uppercase">Name</th>
                    <th className="text-left px-6 py-3 text-xs text-gray-400 uppercase">Status</th>
                    <th className="text-left px-6 py-3 text-xs text-gray-400 uppercase">Created</th>
                    <th className="text-left px-6 py-3 text-xs text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {studies.map((study) => (
                    <tr
                      key={study.id}
                      className="hover:bg-gray-750 cursor-pointer"
                      onDoubleClick={() => handleDoubleClick(study.id)}
                    >
                      <td className="px-6 py-4 text-sm text-gray-200">{study.name ?? "—"}</td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={
                            study.status === "ready"
                              ? "text-green-400"
                              : study.status === "processing"
                                ? "text-yellow-400"
                                : "text-gray-400"
                          }
                        >
                          {study.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-400">{formatDate(study.created_at)}</td>
                      <td className="px-6 py-4 text-sm text-gray-400">
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(activeDropdown === study.id ? null : study.id);
                            }}
                            className="p-1 hover:bg-gray-700 rounded"
                          >
                            &#x22EE;
                          </button>

                          {activeDropdown === study.id && (
                            <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded z-10">
                              <button
                                onClick={() => handleRename(study)}
                                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                              >
                                Edit Name
                              </button>
                              <button
                                onClick={() => handleDeleteStudy(study.id)}
                                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 border-t border-gray-700"
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

          <div className="mt-4 text-sm text-gray-500 text-center">
            Double-click to open study
          </div>
        </div>
      </main>
    </div>
  );
}
