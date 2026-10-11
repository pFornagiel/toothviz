import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNavigate,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  redirect,
  type LoaderFunctionArgs,
} from "react-router";
import {
  cancelStudyPipeline,
  deleteStudy,
  listStudies,
  retryStudyPipeline,
} from "@/api/studies";
import type { StudyListResponse, StudyResponse } from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { canCancelStudy, canRetryStudy, FromPage, isProcessingStudy } from "../pipeline";
import { Folder, EllipsisVertical, Dot, Search, X } from "lucide-react";
import { CancelPipelineDialog } from "../components/CancelPipelineDialog";
import { DeleteStudyDialog } from "../components/DeleteStudyDialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";
import { EditStudyModal } from "../components/EditStudyModal";
import { StudyStatusIndicator } from "../components/StudyStatusIndicator";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

function canonicalPageParam(page: number): string | null {
  return page <= 1 ? null : String(page);
}

export async function browseLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const name = url.searchParams.get("q")?.trim() || undefined;
  const rawPageParam = url.searchParams.get("page");
  const rawPage = Number(rawPageParam ?? "1");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  // Keep the address bar in sync with the page we actually fetch (e.g. page=0 → /, page=2.5 → ?page=2).
  const expectedPageParam = canonicalPageParam(page);
  if (rawPageParam !== expectedPageParam) {
    const next = new URL(url);
    if (expectedPageParam == null) {
      next.searchParams.delete("page");
    } else {
      next.searchParams.set("page", expectedPageParam);
    }
    throw redirect(`${next.pathname}${next.search}`);
  }

  const result = await listStudies({ name, page, pageSize: PAGE_SIZE });

  // After deletes (or stale URLs), clamp to the last page that still has items.
  if (result.items.length === 0 && result.total > 0 && page > 1) {
    const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
    const next = new URL(url);
    const lastParam = canonicalPageParam(lastPage);
    if (lastParam == null) {
      next.searchParams.delete("page");
    } else {
      next.searchParams.set("page", lastParam);
    }
    throw redirect(`${next.pathname}${next.search}`);
  }

  return result;
}

function buildPageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) {
      items.push("ellipsis");
    }
    items.push(sorted[i]!);
  }
  return items;
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
  const data = useLoaderData() as StudyListResponse;
  const [searchParams, setSearchParams] = useSearchParams();
  const [openEditStudyModal, setOpenEditStudyModal] = useState(false);
  const [editedStudy, setEditedStudy] = useState<StudyResponse | null>(null);
  const [studyToDelete, setStudyToDelete] = useState<StudyResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [draftQuery, setDraftQuery] = useState(() => searchParams.get("q") ?? "");
  // Ignore the next URL→input sync when we ourselves just wrote that `q` (debounce / clear).
  const pendingUrlQueryRef = useRef<string | null>(null);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const studies = data.items;
  const total = data.total;
  const currentPage = data.page;
  const totalPages = Math.max(1, Math.ceil(total / data.page_size));
  const urlQuery = searchParams.get("q") ?? "";
  const activeQuery = urlQuery.trim();
  const urlPage = searchParams.get("page") ?? "";

  // Sync input from URL for back/forward (and other external navigations) only.
  // Our own debounce commits set pendingUrlQueryRef so they do not clobber newer keystrokes.
  useEffect(() => {
    const committed = urlQuery.trim();
    if (pendingUrlQueryRef.current !== null && pendingUrlQueryRef.current === committed) {
      pendingUrlQueryRef.current = null;
      return;
    }
    pendingUrlQueryRef.current = null;
    setDraftQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    setSelectedStudyId(null);
  }, [urlQuery, urlPage]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = draftQuery.trim();
      const current = (searchParamsRef.current.get("q") ?? "").trim();
      if (next === current) {
        return;
      }
      pendingUrlQueryRef.current = next;
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next) {
          params.set("q", next);
        } else {
          params.delete("q");
        }
        params.delete("page");
        return params;
      }, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draftQuery, setSearchParams]);

  useEffect(() => {
    const handleDocumentClick = () => setSelectedStudyId(null);
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  const revalidator = useRevalidator();
  const refresh = useCallback(async () => {
    revalidator.revalidate();
  }, [revalidator]);

  const pageItems = useMemo(
    () => buildPageItems(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * data.page_size + 1;
  const rangeEnd = Math.min(currentPage * data.page_size, total);

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

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (clamped <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(clamped));
      }
      return params;
    });
  };

  const clearSearch = () => {
    setDraftQuery("");
    pendingUrlQueryRef.current = "";
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("q");
      params.delete("page");
      return params;
    }, { replace: true });
  };

  return (
    <PageLayout
      showBackButton
      mainClassName="p-8 flex items-center flex-col"
    >
      <div className="w-full max-w-5xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="Search scans by name…"
              aria-label="Search scans by name"
              autoComplete="off"
              className="pl-9 pr-9"
            />
            {draftQuery && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          {(total > 0 || activeQuery) && (
            <p className="text-sm text-muted-foreground shrink-0">
              {total === 0
                ? "No matches"
                : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
            </p>
          )}
        </div>

        {total === 0 && !activeQuery ? (
          <div className="text-center text-muted-foreground py-12">
            No studies found. Create one from the start page.
          </div>
        ) : total === 0 ? (
          <div className="bg-card border border-border rounded-lg shadow-sm px-6 py-12 text-center text-muted-foreground">
            No scans match &ldquo;{activeQuery}&rdquo;.
          </div>
        ) : (
          <>
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

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      aria-disabled={currentPage <= 1}
                      className={
                        currentPage <= 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        goToPage(currentPage - 1);
                      }}
                    />
                  </PaginationItem>
                  {pageItems.map((item, index) =>
                    item === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${index}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationLink
                          href="#"
                          isActive={item === currentPage}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault();
                            goToPage(item);
                          }}
                        >
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      aria-disabled={currentPage >= totalPages}
                      className={
                        currentPage >= totalPages
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        goToPage(currentPage + 1);
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}

        <div className="text-sm text-muted-foreground text-right">
          Click to select <Dot className="inline" /> Double-click to open
        </div>
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
