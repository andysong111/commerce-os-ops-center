"use client";

import { useEffect, useMemo, useState } from "react";
import { computeShoplingCategoryAccuracyMetrics } from "@/lib/shoplingCategoryLearning";

const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const OPTIMIZED_ENDPOINT = "/api/product-launch-tracker/optimized";
const CATALOG_ENDPOINT = "/api/shopling-categories/catalog";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const MANUAL_DRAFTS_STORAGE_KEY =
  "commerce-os:shopling-category-manual-drafts:v1";
const SEARCH_RESULT_LIMIT = 8;
const BULK_BUSY_KEY = "__manual-category-bulk__";

type RecordLike = Record<string, unknown>;
type TrackerState = RecordLike & { items: RecordLike[] };
type CatalogEntry = {
  path: string;
  names: string[];
  codes: string[];
  depth: number;
};

type PickerSelection = {
  large: string;
  middle: string;
  small: string;
  detail: string;
};

type ManualDraft = {
  selection: PickerSelection;
  query: string;
  manualPath: string;
  notice: string;
};

type ManualDrafts = Record<string, ManualDraft>;

type ManualApprovalSelection = {
  itemId: string;
  item: RecordLike;
  path: string;
};

const EMPTY_SELECTION: PickerSelection = {
  large: "",
  middle: "",
  small: "",
  detail: "",
};

function emptyDraft(): ManualDraft {
  return {
    selection: { ...EMPTY_SELECTION },
    query: "",
    manualPath: "",
    notice: "",
  };
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pathKey(value: unknown) {
  return text(value)
    .replace(/[＞→]/g, ">")
    .replace(/\t+/g, ">")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}

function normalizePastedPath(value: unknown) {
  return text(value)
    .replace(/[＞→]/g, ">")
    .replace(/\t+/g, ">")
    .replace(/\s*>\s*/g, ">");
}

function compactSearch(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function searchTokens(value: unknown) {
  return (
    text(value)
      .toLocaleLowerCase("ko-KR")
      .match(/[0-9a-z가-힣]{2,}/g) ?? []
  ).filter((token, index, array) => array.indexOf(token) === index);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "ko-KR"),
  );
}

function isReviewItem(item: RecordLike) {
  if (item.archivedAt) return false;
  const status = text(item.categoryAiStatus);
  return status === "review_required" || status === "review_held";
}

function reviewLabel(item: RecordLike) {
  return `${text(item.modelNumber) || "모델번호 없음"} · ${
    text(item.productName) || "모델명 없음"
  }`;
}

function selectionFromEntry(entry: CatalogEntry): PickerSelection {
  return {
    large: entry.names[0] ?? "",
    middle: entry.names[1] ?? "",
    small: entry.names[2] ?? "",
    detail: entry.names[3] ?? "",
  };
}

function resolveCascadePath(
  catalog: CatalogEntry[],
  selection: PickerSelection,
) {
  const names = [
    selection.large,
    selection.middle,
    selection.small,
    selection.detail,
  ].filter(Boolean);
  if (!names.length) return "";
  const exact = catalog.find(
    (entry) =>
      entry.names.length === names.length &&
      entry.names.every((name, index) => name === names[index]),
  );
  return exact?.path ?? "";
}

function searchCatalog(
  catalog: CatalogEntry[],
  rawQuery: string,
  limit = SEARCH_RESULT_LIMIT,
) {
  const query = text(rawQuery);
  if (query.length < 2) return [];
  const exactKey = pathKey(normalizePastedPath(query));
  const exact = catalog.find((entry) => pathKey(entry.path) === exactKey);
  if (exact) return [exact];

  const tokens = searchTokens(query);
  const compactQuery = compactSearch(query);
  if (!tokens.length && !compactQuery) return [];

  return catalog
    .map((entry) => {
      const nameCompacts = entry.names.map(compactSearch);
      const leaf = nameCompacts.at(-1) ?? "";
      const compactPath = compactSearch(entry.path);
      let score = 0;
      let matched = 0;

      for (const token of tokens) {
        const compactToken = compactSearch(token);
        if (!compactToken) continue;
        if (leaf === compactToken) {
          score += 120;
          matched += 1;
          continue;
        }
        if (leaf.includes(compactToken)) {
          score += 80;
          matched += 1;
          continue;
        }
        if (nameCompacts.some((name) => name === compactToken)) {
          score += 60;
          matched += 1;
          continue;
        }
        if (nameCompacts.some((name) => name.includes(compactToken))) {
          score += 42;
          matched += 1;
          continue;
        }
        if (compactPath.includes(compactToken)) {
          score += 24;
          matched += 1;
        }
      }

      if (compactQuery && leaf === compactQuery) score += 140;
      else if (compactQuery && leaf.includes(compactQuery)) score += 90;
      else if (compactQuery && compactPath.includes(compactQuery)) score += 35;
      if (tokens.length && matched === tokens.length) score += 50;

      return { entry, score, matched };
    })
    .filter((row) => row.score > 0 && (!tokens.length || row.matched > 0))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.depth - right.entry.depth ||
        left.entry.path.localeCompare(right.entry.path, "ko-KR"),
    )
    .slice(0, Math.max(1, limit))
    .map((row) => row.entry);
}

function cascadeOptions(
  catalog: CatalogEntry[],
  selection: PickerSelection,
) {
  return {
    large: unique(catalog.map((entry) => entry.names[0]).filter(Boolean)),
    middle: selection.large
      ? unique(
          catalog
            .filter((entry) => entry.names[0] === selection.large)
            .map((entry) => entry.names[1])
            .filter(Boolean),
        )
      : [],
    small: selection.large && selection.middle
      ? unique(
          catalog
            .filter(
              (entry) =>
                entry.names[0] === selection.large &&
                entry.names[1] === selection.middle,
            )
            .map((entry) => entry.names[2])
            .filter(Boolean),
        )
      : [],
    detail: selection.large && selection.middle && selection.small
      ? unique(
          catalog
            .filter(
              (entry) =>
                entry.names[0] === selection.large &&
                entry.names[1] === selection.middle &&
                entry.names[2] === selection.small,
            )
            .map((entry) => entry.names[3])
            .filter(Boolean),
        )
      : [],
  };
}

function normalizeStoredDraft(value: unknown): ManualDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as RecordLike;
  const rawSelection =
    row.selection && typeof row.selection === "object" && !Array.isArray(row.selection)
      ? (row.selection as RecordLike)
      : {};
  return {
    selection: {
      large: text(rawSelection.large),
      middle: text(rawSelection.middle),
      small: text(rawSelection.small),
      detail: text(rawSelection.detail),
    },
    query: text(row.query),
    manualPath: text(row.manualPath),
    notice: text(row.notice),
  };
}

function readStoredDrafts(): ManualDrafts {
  try {
    const raw = window.sessionStorage.getItem(MANUAL_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: ManualDrafts = {};
    for (const [itemId, value] of Object.entries(parsed)) {
      const normalized = normalizeStoredDraft(value);
      if (itemId && normalized) next[itemId] = normalized;
    }
    return next;
  } catch {
    return {};
  }
}

function writeStoredDrafts(drafts: ManualDrafts) {
  try {
    window.sessionStorage.setItem(
      MANUAL_DRAFTS_STORAGE_KEY,
      JSON.stringify(drafts),
    );
  } catch {
    // 브라우저 저장이 막혀도 현재 탭의 React state는 계속 사용합니다.
  }
}

export function ShoplingCategoryManualPicker() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogHash, setCatalogHash] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyItemId, setBusyItemId] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<ManualDrafts>({});

  useEffect(() => {
    setDrafts(readStoredDrafts());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readServerState(), readCatalog()])
      .then(([nextState, nextCatalog]) => {
        if (cancelled) return;
        if (nextState) setState(nextState);
        if (nextCatalog) {
          setCatalog(nextCatalog.categories);
          setCatalogHash(nextCatalog.hash);
        }
        if (!nextState || !nextCatalog) {
          setLoadError(
            !nextState
              ? "검토 상품 데이터를 불러오지 못했습니다."
              : "샵플링 카탈로그를 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewItems = useMemo(
    () =>
      (state?.items ?? [])
        .filter(isReviewItem)
        .sort((left, right) =>
          reviewLabel(left).localeCompare(reviewLabel(right), "ko-KR"),
        ),
    [state],
  );
  const metrics = useMemo(
    () => computeShoplingCategoryAccuracyMetrics(state),
    [state],
  );
  const catalogPathByKey = useMemo(
    () => new Map(catalog.map((entry) => [pathKey(entry.path), entry.path])),
    [catalog],
  );
  const catalogEntryByPath = useMemo(
    () => new Map(catalog.map((entry) => [entry.path, entry])),
    [catalog],
  );
  const manualSelections = useMemo<ManualApprovalSelection[]>(() => {
    return reviewItems.flatMap((item) => {
      const itemId = text(item.id);
      const rawPath = drafts[itemId]?.manualPath;
      if (!itemId || !rawPath) return [];
      const canonical = catalogPathByKey.get(pathKey(rawPath));
      return canonical ? [{ itemId, item, path: canonical }] : [];
    });
  }, [reviewItems, drafts, catalogPathByKey]);

  useEffect(() => {
    const visible = new Set(reviewItems.map((item) => text(item.id)));
    setDrafts((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([itemId]) => visible.has(itemId)),
      ) as ManualDrafts;
      if (Object.keys(next).length === Object.keys(current).length) return current;
      writeStoredDrafts(next);
      return next;
    });
  }, [reviewItems]);

  function draftFor(itemId: string) {
    return drafts[itemId] ?? emptyDraft();
  }

  function replaceDrafts(next: ManualDrafts) {
    writeStoredDrafts(next);
    setDrafts(next);
  }

  function updateDraft(
    itemId: string,
    updater: (current: ManualDraft) => ManualDraft,
  ) {
    setDrafts((current) => {
      const next = {
        ...current,
        [itemId]: updater(current[itemId] ?? emptyDraft()),
      };
      writeStoredDrafts(next);
      return next;
    });
  }

  function clearDraft(itemId: string) {
    setDrafts((current) => {
      const { [itemId]: _removed, ...rest } = current;
      const next = rest as ManualDrafts;
      writeStoredDrafts(next);
      return next;
    });
  }

  function clearAllManualSelections() {
    if (busyItemId || !manualSelections.length) return;
    setDrafts((current) => {
      const selectedIds = new Set(manualSelections.map((entry) => entry.itemId));
      const next = Object.fromEntries(
        Object.entries(current).filter(([itemId]) => !selectedIds.has(itemId)),
      ) as ManualDrafts;
      writeStoredDrafts(next);
      return next;
    });
    setNotice("수동 승인용으로 선택해 둔 경로를 모두 해제했습니다.");
  }

  function chooseEntry(itemId: string, entry: CatalogEntry, message = "") {
    updateDraft(itemId, (current) => ({
      ...current,
      selection: selectionFromEntry(entry),
      query: entry.path,
      manualPath: entry.path,
      notice:
        message ||
        "실제 샵플링 카탈로그 경로를 선택했습니다. 상단에서 일괄 승인할 수 있습니다.",
    }));
  }

  function changeCascade(
    itemId: string,
    level: keyof PickerSelection,
    value: string,
  ) {
    updateDraft(itemId, (current) => {
      const nextSelection = { ...current.selection };
      if (level === "large") {
        nextSelection.large = value;
        nextSelection.middle = "";
        nextSelection.small = "";
        nextSelection.detail = "";
      } else if (level === "middle") {
        nextSelection.middle = value;
        nextSelection.small = "";
        nextSelection.detail = "";
      } else if (level === "small") {
        nextSelection.small = value;
        nextSelection.detail = "";
      } else {
        nextSelection.detail = value;
      }
      const nextPath = resolveCascadePath(catalog, nextSelection);
      return {
        ...current,
        selection: nextSelection,
        query: nextPath || current.query,
        manualPath: nextPath,
        notice: nextPath
          ? "드롭다운에서 실제 경로를 선택했습니다. 상단에서 일괄 승인할 수 있습니다."
          : "",
      };
    });
  }

  function changeQuery(itemId: string, value: string) {
    updateDraft(itemId, (current) => ({
      ...current,
      query: value,
      manualPath: "",
      notice: "",
    }));
  }

  function confirmTypedPath(itemId: string) {
    const draft = draftFor(itemId);
    const normalized = normalizePastedPath(draft.query);
    const matched = catalogPathByKey.get(pathKey(normalized));
    if (!matched) {
      updateDraft(itemId, (current) => ({
        ...current,
        manualPath: "",
        notice:
          "전체 경로가 정확히 일치하지 않습니다. 아래 검색 결과를 선택하거나 대→중→소→세로 고르세요.",
      }));
      return;
    }
    const entry = catalogEntryByPath.get(matched);
    if (entry) {
      chooseEntry(
        itemId,
        entry,
        "붙여넣은 전체 경로가 현재 샵플링 카탈로그와 정확히 일치합니다. 상단에서 일괄 승인할 수 있습니다.",
      );
    }
  }

  async function approveManualPath(item: RecordLike, manualPath: string) {
    const itemId = text(item.id);
    if (busyItemId || !itemId || !manualPath) return;
    const canonical = catalogPathByKey.get(pathKey(manualPath));
    if (!canonical) {
      updateDraft(itemId, (current) => ({
        ...current,
        notice: "현재 샵플링 카탈로그에 없는 경로는 승인할 수 없습니다.",
      }));
      return;
    }
    const confirmed = window.confirm(
      `${reviewLabel(item)}\n\n${canonical}\n\n이 샵플링 카테고리만 지금 개별 승인하시겠습니까?\n다른 수동 선택값은 그대로 보존됩니다.`,
    );
    if (!confirmed) return;

    setBusyItemId(itemId);
    setNotice("");
    try {
      const latest = await readServerState();
      if (!latest) throw new Error("최신 진행관리 데이터를 불러오지 못했습니다.");
      const current = latest.items.find((candidate) => text(candidate.id) === itemId);
      if (!current || !isReviewItem(current)) {
        throw new Error("이 상품은 이미 다른 곳에서 처리되었거나 검토 대상이 아닙니다.");
      }
      await persistManualCategoryApprovals(
        latest,
        [{ itemId, category: canonical }],
        "AI 카테고리 검토함 · 상품별 수동 지정",
      );
      clearDraft(itemId);
      setNotice(
        `${reviewLabel(item)} · 개별 승인했습니다. 다른 상품의 수동 선택값은 유지됩니다.`,
      );
    } catch (error) {
      updateDraft(itemId, (currentDraft) => ({
        ...currentDraft,
        notice:
          error instanceof Error
            ? error.message
            : "수동 카테고리 승인에 실패했습니다.",
      }));
    } finally {
      setBusyItemId("");
    }
  }

  async function bulkApproveManualPaths() {
    if (busyItemId || !manualSelections.length) return;
    const confirmed = window.confirm(
      `상품별로 선택해 둔 수동 샵플링 카테고리 ${manualSelections.length}건을 한 번에 승인합니다.\n\n승인 직전에 최신 진행관리 상태와 실제 카탈로그 경로를 다시 확인합니다. 계속하시겠습니까?`,
    );
    if (!confirmed) return;

    setBusyItemId(BULK_BUSY_KEY);
    setNotice("");
    try {
      const latest = await readServerState();
      if (!latest) throw new Error("최신 진행관리 데이터를 불러오지 못했습니다.");
      const latestById = new Map(
        latest.items.map((item) => [text(item.id), item] as const),
      );
      const decisions: Array<{
        itemId: string;
        action: "approve";
        category: string;
      }> = [];
      const skippedIds: string[] = [];

      for (const selection of manualSelections) {
        const current = latestById.get(selection.itemId);
        const canonical = catalogPathByKey.get(pathKey(selection.path));
        if (!current || !isReviewItem(current) || !canonical) {
          skippedIds.push(selection.itemId);
          continue;
        }
        decisions.push({
          itemId: selection.itemId,
          action: "approve",
          category: canonical,
        });
      }

      if (!decisions.length) {
        throw new Error(
          "일괄 승인 가능한 최신 수동 선택값이 없습니다. 이미 처리된 상품인지 확인하세요.",
        );
      }

      await persistManualCategoryApprovals(
        latest,
        decisions,
        "AI 카테고리 검토함 · 수동 선택 일괄 승인",
      );

      const approvedIds = new Set(decisions.map((decision) => decision.itemId));
      const nextDrafts = Object.fromEntries(
        Object.entries(drafts).filter(([itemId]) => !approvedIds.has(itemId)),
      ) as ManualDrafts;
      replaceDrafts(nextDrafts);
      setNotice(
        `수동 선택 ${decisions.length}건을 한 번에 승인했습니다.${
          skippedIds.length
            ? ` 최신 상태가 달라진 ${skippedIds.length}건은 승인하지 않고 선택값을 남겼습니다.`
            : ""
        }`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "수동 선택 일괄 승인에 실패했습니다.",
      );
    } finally {
      setBusyItemId("");
    }
  }

  async function persistManualCategoryApprovals(
    latest: TrackerState,
    decisions: Array<{ itemId: string; category: string }>,
    reviewer: string,
  ) {
    const latestById = new Map(
      latest.items.map((item) => [text(item.id), item] as const),
    );
    const reviewedAt = new Date().toISOString();
    const patches = decisions.map((decision) => {
      const current = latestById.get(decision.itemId);
      if (!current) throw new Error("승인할 상품의 최신 상태를 찾지 못했습니다.");
      const suggestion = text(current.categoryAiSuggestion);
      return {
        itemId: decision.itemId,
        expectedUpdatedAt: text(current.updatedAt),
        updatedBy: reviewer,
        patch: {
          shoplingCategory: decision.category,
          categoryAiApprovedValue: decision.category,
          categoryAiStatus: "review_approved",
          categoryAiDecision:
            suggestion && suggestion === decision.category ? "suggestion" : "edited",
          categoryAiReviewedAt: reviewedAt,
          categoryAiReviewedBy: reviewer,
        },
      };
    });

    const response = await fetch(OPTIMIZED_ENDPOINT, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        operation: "bulk_patch_items",
        patches,
        updatedBy: reviewer,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "카테고리 결과를 저장하지 못했습니다.");
    }

    const next = await readServerState();
    if (!next) throw new Error("저장된 최신 진행관리 데이터를 확인하지 못했습니다.");
    setState(next);
    window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(next));
  }

  if (loading) {
    return (
      <section className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600 shadow-sm">
        상품별 수동 카테고리 도구를 불러오고 있습니다.
      </section>
    );
  }

  if (!reviewItems.length) return null;

  const bulkSaving = busyItemId === BULK_BUSY_KEY;

  return (
    <section className="mb-4 rounded-2xl border border-emerald-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-black text-emerald-700">상품별 수동 카테고리 지정</p>
          <p className="mt-0.5 text-xs text-slate-500">
            상품별로 경로를 먼저 골라두고, 선택이 끝나면 한 번에 일괄 승인합니다. 선택값은 같은 탭에서 새로고침해도 보존됩니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className="rounded-lg bg-slate-50 px-2 py-1 text-slate-700">
            정답 {metrics.approvedCount}
          </span>
          <span className="rounded-lg bg-blue-50 px-2 py-1 text-blue-800">
            Top-1 {metrics.top1Rate}%
          </span>
          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-800">
            Top-3 {metrics.top3Rate}%
          </span>
          <span className="rounded-lg bg-emerald-100 px-2 py-1 text-emerald-900">
            수동 선택 {manualSelections.length}건
          </span>
          <button
            type="button"
            onClick={clearAllManualSelections}
            disabled={Boolean(busyItemId) || !manualSelections.length}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 disabled:opacity-40"
          >
            수동 선택 해제
          </button>
          <button
            type="button"
            onClick={() => void bulkApproveManualPaths()}
            disabled={Boolean(busyItemId) || !manualSelections.length}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-white disabled:bg-slate-300"
          >
            {bulkSaving
              ? "수동 선택 일괄 승인 중…"
              : `수동 선택 일괄 승인${manualSelections.length ? ` (${manualSelections.length})` : ""}`}
          </button>
          <span className="rounded-lg bg-slate-50 px-2 py-1 text-slate-500">
            카탈로그 {catalog.length.toLocaleString("ko-KR")} · {catalogHash.slice(0, 8) || "확인 중"}
          </span>
        </div>
      </div>

      {notice ? (
        <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900">
          {notice}
        </p>
      ) : null}
      {loadError ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
          {loadError}
        </p>
      ) : null}

      <div className="mt-2 grid gap-2 xl:grid-cols-2">
        {reviewItems.map((item) => {
          const itemId = text(item.id);
          const draft = draftFor(itemId);
          const options = cascadeOptions(catalog, draft.selection);
          const searchResults = searchCatalog(catalog, draft.query);
          const saving = busyItemId === itemId;
          const selectedForBulk = Boolean(
            draft.manualPath && catalogPathByKey.get(pathKey(draft.manualPath)),
          );
          return (
            <details
              key={itemId}
              className={`group rounded-lg border bg-slate-50 open:bg-white ${
                selectedForBulk ? "border-emerald-300" : "border-slate-200"
              }`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs marker:hidden">
                <span className="min-w-0 truncate font-black text-slate-900">
                  {reviewLabel(item)}
                </span>
                <span
                  className={`shrink-0 font-black ${
                    selectedForBulk ? "text-emerald-800" : "text-emerald-700"
                  }`}
                >
                  {selectedForBulk ? "수동 선택됨 ✓ · 수정 ▾" : "수동 지정 · 검색 ▾"}
                </span>
              </summary>

              <div className="border-t border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <CompactCategorySelect
                    label="대"
                    value={draft.selection.large}
                    options={options.large}
                    onChange={(value) => changeCascade(itemId, "large", value)}
                  />
                  <CompactCategorySelect
                    label="중"
                    value={draft.selection.middle}
                    options={options.middle}
                    onChange={(value) => changeCascade(itemId, "middle", value)}
                    disabled={!draft.selection.large}
                  />
                  <CompactCategorySelect
                    label="소"
                    value={draft.selection.small}
                    options={options.small}
                    onChange={(value) => changeCascade(itemId, "small", value)}
                    disabled={!draft.selection.middle}
                  />
                  <CompactCategorySelect
                    label="세"
                    value={draft.selection.detail}
                    options={options.detail}
                    onChange={(value) => changeCascade(itemId, "detail", value)}
                    disabled={!draft.selection.small || !options.detail.length}
                    optional={!options.detail.length}
                  />
                </div>

                <div className="mt-2">
                  <label className="text-[10px] font-black text-slate-500">
                    카테고리 검색 / 전체 경로 복붙
                  </label>
                  <div className="mt-1 flex flex-col gap-1.5 sm:flex-row">
                    <input
                      value={draft.query}
                      onChange={(event) => changeQuery(itemId, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          confirmTypedPath(itemId);
                        }
                      }}
                      placeholder="예: 세안 브러쉬 / 골무 / 생활>..."
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => confirmTypedPath(itemId)}
                      disabled={Boolean(busyItemId)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 disabled:opacity-40"
                    >
                      경로 확인
                    </button>
                    <button
                      type="button"
                      onClick={() => clearDraft(itemId)}
                      disabled={!draft.manualPath || Boolean(busyItemId)}
                      className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-emerald-800 disabled:opacity-40"
                    >
                      선택 취소
                    </button>
                    <button
                      type="button"
                      onClick={() => void approveManualPath(item, draft.manualPath)}
                      disabled={!draft.manualPath || saving || Boolean(busyItemId && !saving)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 disabled:opacity-40"
                    >
                      {saving ? "저장 중…" : "개별 수동 승인"}
                    </button>
                  </div>

                  {draft.query.trim().length >= 2 && !draft.manualPath && searchResults.length ? (
                    <div className="mt-1.5 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-sm">
                      {searchResults.map((entry, index) => (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() =>
                            chooseEntry(
                              itemId,
                              entry,
                              `검색 결과 ${index + 1}번 실제 경로를 선택했습니다. 상단에서 일괄 승인할 수 있습니다.`,
                            )
                          }
                          disabled={Boolean(busyItemId)}
                          className="block w-full rounded px-2 py-1.5 text-left hover:bg-emerald-50 disabled:opacity-40"
                        >
                          <span className="block text-[10px] font-black text-emerald-700">
                            검색 결과 {index + 1} · {entry.names.at(-1) || "카테고리"}
                          </span>
                          <span className="block break-words text-[11px] font-bold leading-4 text-slate-700">
                            {entry.path}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div
                  className={`mt-2 rounded-md px-2 py-1.5 text-[11px] ${
                    selectedForBulk
                      ? "bg-emerald-100 text-emerald-950"
                      : "bg-emerald-50 text-emerald-950"
                  }`}
                >
                  <span className="font-black">
                    {selectedForBulk ? "일괄 승인 대기 · " : "선택 경로 · "}
                  </span>
                  <span className="font-bold">
                    {draft.manualPath || "아직 선택하지 않음"}
                  </span>
                </div>
                {draft.notice ? (
                  <p className="mt-1.5 text-[11px] font-bold text-blue-800">
                    {draft.notice}
                  </p>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function CompactCategorySelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  optional = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] font-black text-slate-500">
      <span className="w-3 shrink-0">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <option value="">{optional ? "없음/선택" : "선택"}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

async function readServerState(): Promise<TrackerState | null> {
  try {
    const response = await fetch(STATE_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.state?.items)) {
      return null;
    }
    return body.state as TrackerState;
  } catch {
    return null;
  }
}

async function readCatalog(): Promise<{
  categories: CatalogEntry[];
  hash: string;
} | null> {
  try {
    const response = await fetch(CATALOG_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.categories)) {
      return null;
    }
    const categories = body.categories
      .map((raw: unknown) => {
        const row =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as RecordLike)
            : null;
        if (!row) return null;
        const path = text(row.path);
        const names = Array.isArray(row.names)
          ? row.names.map(text).filter(Boolean).slice(0, 4)
          : path
              .split(/\s*>\s*/g)
              .map(text)
              .filter(Boolean)
              .slice(0, 4);
        const codes = Array.isArray(row.codes)
          ? row.codes.map(text).filter(Boolean).slice(0, 4)
          : [];
        return path && names.length
          ? { path, names, codes, depth: Number(row.depth) || names.length }
          : null;
      })
      .filter(
        (entry: CatalogEntry | null): entry is CatalogEntry => Boolean(entry),
      );
    return { categories, hash: text(body.hash) };
  } catch {
    return null;
  }
}
