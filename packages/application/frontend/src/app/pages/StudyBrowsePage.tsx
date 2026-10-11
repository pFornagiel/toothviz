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
import {
  DEFAULT_STUDY_SORT,
  StudySortField,
  StudySortOrder,
  type StudyListResponse,
  type StudyResponse,
  type StudySort,
} from "@/api/types";
import { PageLayout } from "../components/layout/page-layout";
import { canCancelStudy, canRetryStudy, FromPage, isProcessingStudy } from "../pipeline";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarRange,
  Dot,
  EllipsisVertical,
  Folder,
  Search,
  X,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { CancelPipelineDialog } from "../components/CancelPipelineDialog";
import { DeleteStudyDialog } from "../components/DeleteStudyDialog";
import { Button } from "../components/ui/button";
import { Calendar } from "../components/ui/calendar";
import { Input } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
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
import { cn } from "../components/ui/utils";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;
const STUDY_SORT_FIELDS = new Set<string>(Object.values(StudySortField));
const STUDY_SORT_ORDERS = new Set<string>(Object.values(StudySortOrder));
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

function canonicalPageParam(page: number): string | null {
  return page <= 1 ? null : String(page);
}

function isDefaultSort(sort: StudySort): boolean {
  return sort[0] === DEFAULT_STUDY_SORT[0] && sort[1] === DEFAULT_STUDY_SORT[1];
}

function parseSortParams(sortByRaw: string | null, orderRaw: string | null): StudySort {
  const field =
    sortByRaw && STUDY_SORT_FIELDS.has(sortByRaw)
      ? (sortByRaw as StudySortField)
      : DEFAULT_STUDY_SORT[0];
  const order =
    orderRaw && STUDY_SORT_ORDERS.has(orderRaw)
      ? (orderRaw as StudySortOrder)
      : field === DEFAULT_STUDY_SORT[0]
        ? DEFAULT_STUDY_SORT[1]
        : StudySortOrder.Asc;
  return [field, order];
}

function parseDateParam(raw: string | null): string | undefined {
  if (!raw || !DATE_PARAM_RE.test(raw)) {
    return undefined;
  }
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  if (dt.getFullYear() !== y || dt.getMonth() !== m! - 1 || dt.getDate() !== d) {
    return undefined;
  }
  return raw;
}

function dateParamToLocalDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function localDateToParam(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sortForColumn(sort: StudySort, column: StudySortField): StudySort {
  if (sort[0] === column) {
    const nextOrder =
      sort[1] === StudySortOrder.Asc ? StudySortOrder.Desc : StudySortOrder.Asc;
    return [column, nextOrder];
  }
  if (column === StudySortField.Created) {
    return [column, StudySortOrder.Desc];
  }
  return [column, StudySortOrder.Asc];
}

function SortableHeaderButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 bg-transparent p-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground",
        active && "text-foreground",
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="size-3.5" aria-hidden />
        ) : (
          <ArrowDown className="size-3.5" aria-hidden />
        )
      ) : (
        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
      )}
    </button>
  );
}

export async function browseLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const name = url.searchParams.get("q")?.trim() || undefined;
  const rawPageParam = url.searchParams.get("page");
  const rawPage = Number(rawPageParam ?? "1");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const rawSortByParam = url.searchParams.get("sort_by");
  const rawOrderParam = url.searchParams.get("order");
  const sort = parseSortParams(rawSortByParam, rawOrderParam);
  const rawFromParam = url.searchParams.get("from");
  const rawToParam = url.searchParams.get("to");
  const createdFrom = parseDateParam(rawFromParam);
  const createdTo = parseDateParam(rawToParam);

  // Keep the address bar in sync with the page/sort/dates we actually fetch.
  const expectedPageParam = canonicalPageParam(page);
  const expectedSortBy = isDefaultSort(sort) ? null : sort[0];
  const expectedOrder = isDefaultSort(sort) ? null : sort[1];
  const expectedFrom = createdFrom ?? null;
  const expectedTo = createdTo ?? null;
  if (
    rawPageParam !== expectedPageParam ||
    rawSortByParam !== expectedSortBy ||
    rawOrderParam !== expectedOrder ||
    rawFromParam !== expectedFrom ||
    rawToParam !== expectedTo
  ) {
    const next = new URL(url);
    if (expectedPageParam == null) {
      next.searchParams.delete("page");
    } else {
      next.searchParams.set("page", expectedPageParam);
    }
    if (expectedSortBy == null) {
      next.searchParams.delete("sort_by");
      next.searchParams.delete("order");
    } else {
      next.searchParams.set("sort_by", expectedSortBy);
      next.searchParams.set("order", expectedOrder!);
    }
    if (expectedFrom == null) {
      next.searchParams.delete("from");
    } else {
      next.searchParams.set("from", expectedFrom);
    }
    if (expectedTo == null) {
      next.searchParams.delete("to");
    } else {
      next.searchParams.set("to", expectedTo);
    }
    throw redirect(`${next.pathname}${next.search}`);
  }

  const result = await listStudies({
    name,
    page,
    pageSize: PAGE_SIZE,
    createdFrom,
    createdTo,
    sort,
  });

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
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const urlSort = parseSortParams(searchParams.get("sort_by"), searchParams.get("order"));
  const urlSortKey = `${urlSort[0]}:${urlSort[1]}`;
  const hasActiveFilters = Boolean(activeQuery || urlFrom || urlTo);

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
  }, [urlQuery, urlPage, urlFrom, urlTo, urlSortKey]);

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

  const setSort = (next: StudySort) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (isDefaultSort(next)) {
        params.delete("sort_by");
        params.delete("order");
      } else {
        params.set("sort_by", next[0]);
        params.set("order", next[1]);
      }
      params.delete("page");
      return params;
    });
  };

  const dateRange: DateRange | undefined =
    urlFrom || urlTo
      ? {
          from: urlFrom ? dateParamToLocalDate(urlFrom) : undefined,
          to: urlTo ? dateParamToLocalDate(urlTo) : undefined,
        }
      : undefined;

  const applyDateRange = (range: DateRange | undefined) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (range?.from) {
        params.set("from", localDateToParam(range.from));
      } else {
        params.delete("from");
      }
      if (range?.to) {
        params.set("to", localDateToParam(range.to));
      } else {
        params.delete("to");
      }
      params.delete("page");
      return params;
    });
  };

  const clearDates = () => applyDateRange(undefined);

  const emptyFilterMessage = () => {
    const parts: string[] = [];
    if (activeQuery) {
      parts.push(`name \u201c${activeQuery}\u201d`);
    }
    if (urlFrom && urlTo) {
      parts.push(`dates ${urlFrom}\u2013${urlTo}`);
    } else if (urlFrom) {
      parts.push(`from ${urlFrom}`);
    } else if (urlTo) {
      parts.push(`until ${urlTo}`);
    }
    if (parts.length === 0) {
      return "No scans match the current filters.";
    }
    return `No scans match ${parts.join(" and ")}.`;
  };

  const nameSortActive = urlSort[0] === StudySortField.Name;
  const statusSortActive = urlSort[0] === StudySortField.Status;
  const createdSortActive = urlSort[0] === StudySortField.Created;
  const dateFilterActive = Boolean(urlFrom || urlTo);

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
          {(total > 0 || hasActiveFilters) && (
            <p className="text-sm text-muted-foreground shrink-0">
              {total === 0
                ? "No matches"
                : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
            </p>
          )}
        </div>

        {total === 0 && !hasActiveFilters ? (
          <div className="text-center text-muted-foreground py-12">
            No studies found. Create one from the start page.
          </div>
        ) : (
          <>
            <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/30">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground">
                      <SortableHeaderButton
                        label="Name"
                        active={nameSortActive}
                        direction={urlSort[1] === StudySortOrder.Desc ? "desc" : "asc"}
                        onClick={() => setSort(sortForColumn(urlSort, StudySortField.Name))}
                      />
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground">
                      <SortableHeaderButton
                        label="Status"
                        active={statusSortActive}
                        direction={urlSort[1] === StudySortOrder.Desc ? "desc" : "asc"}
                        onClick={() => setSort(sortForColumn(urlSort, StudySortField.Status))}
                      />
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground">
                      <div className="inline-flex items-center gap-0.5">
                        <SortableHeaderButton
                          label="Created"
                          active={createdSortActive}
                          direction={urlSort[1] === StudySortOrder.Asc ? "asc" : "desc"}
                          onClick={() => setSort(sortForColumn(urlSort, StudySortField.Created))}
                        />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex size-6 items-center justify-center rounded-sm transition-colors",
                                dateFilterActive
                                  ? "text-foreground"
                                  : "text-muted-foreground opacity-40 hover:opacity-100 hover:text-foreground",
                              )}
                              aria-label="Filter by date range"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <CalendarRange className="size-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-auto p-0">
                            <Calendar
                              mode="range"
                              numberOfMonths={1}
                              selected={dateRange}
                              defaultMonth={dateRange?.from ?? dateRange?.to}
                              onSelect={(range) => applyDateRange(range)}
                            />
                            {dateFilterActive && (
                              <div className="border-t border-border px-3 py-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-muted-foreground"
                                  onClick={clearDates}
                                >
                                  Clear dates
                                </Button>
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {studies.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-12 text-center text-muted-foreground"
                      >
                        {emptyFilterMessage()}
                      </td>
                    </tr>
                  ) : (
                    studies.map((study) => (
                      <StudyItem
                        key={study.id}
                        study={study}
                        onEdit={onEdit}
                        isSelected={selectedStudyId === study.id}
                        onSelect={setSelectedStudyId}
                        onRefresh={refresh}
                      />
                    ))
                  )}
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
