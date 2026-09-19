"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildShoplingCategoryReviewRows,
  countShoplingCategoryReviews,
  isShoplingCategoryReviewStale,
  type ShoplingCategoryReviewAction,
  type ShoplingCategoryReviewDecision,
  type ShoplingCategoryReviewRow,
  type ShoplingCategoryReviewStatus,
} from "@/lib/shoplingCategoryReview";

const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const OPTIMIZED_ENDPOINT = "/api/product-launch-tracker/optimized";
const PRODUCT_MASTER_SYNC_ENDPOINT =
  "/api/product-launch-tracker/product-master-sync";
const CATEGORY_STATUS_ENDPOINT = "/api/shopling-categories/status";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";

type TrackerState = Record<string, unknown> & { items: unknown[] };
type ViewFilter = "required" | "held" | "approved" | "excluded" | "all";
type SortMode = "confidence_asc" | "latest" | "model";

type Notice = { tone: "success" | "error"; message: string } | null;

const STATUS_LABEL: Record<ShoplingCategoryReviewStatus, string> = {
  review_required: "검토 필요",
  review_held: "보류",
  review_approved: "승인 완료",
  review_excluded: "제외",
};

const STATUS_CLASS: Record<ShoplingCategoryReviewStatus, string> = {
  review_required: "border-amber-200 bg-amber-50 text-amber-800",
  review_held: "border-slate-200 bg-slate-100 text-slate-700",
  review_approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  review_excluded: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ShoplingCategoryReviewQueue() {
  const [trackerState, setTrackerState] = useState<TrackerState | null>(null);
  const [currentSnapshotHash, setCurrentSnapshotHash] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewFilter>("required");
  const [batch, setBatch] = useState("all");
  const [sort, setSort] = useState<SortMode>("confidence_asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const rows = useMemo(
    () => buildShoplingCategoryReviewRows(trackerState),
    [trackerState],
  );
  const counts = useMemo(() => countShoplingCategoryReviews(rows), [rows]);
  const batches = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.batchId, row.batchLabel);
    return [...map.entries()].sort((left, right) => right[0].localeCompare(left[0]));
  }, [rows]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (!(row.itemId in next)) {
          next[row.itemId] = row.approvedValue || row.suggestion;
        }
      }
      return next;
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    const statusForView: Partial<Record<ViewFilter, ShoplingCategoryReviewStatus>> = {
      required: "review_required",
      held: "review_held",
      approved: "review_approved",
      excluded: "review_excluded",
    };
    const requiredStatus = statusForView[view];
    const filtered = rows.filter((row) => {
      if (requiredStatus && row.status !== requiredStatus) return false;
      if (batch !== "all" && row.batchId !== batch) return false;
      if (!normalizedQuery) return true;
      return [
        row.modelNumber,
        row.productName,
        row.suggestion,
        row.currentCategory,
        row.reason,
      ]
        .join(" ")
        .replace(/\s+/g, "")
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery);
    });
    return filtered.sort((left, right) => {
      if (sort === "latest") {
        return (
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.modelNumber.localeCompare(right.modelNumber, "ko-KR")
        );
      }
      if (sort === "model") {
        return left.modelNumber.localeCompare(right.modelNumber, "ko-KR");
      }
      return (
        left.confidence - right.confidence ||
        right.updatedAt.localeCompare(left.updatedAt)
      );
    });
  }, [batch, query, rows, sort, view]);

  const visibleIds = filteredRows.map((row) => row.itemId);
  const selectedRows = rows.filter((row) => selected.has(row.itemId));
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((itemId) => selected.has(itemId));

  async function loadWorkspace() {
    setLoading(true);
    setNotice(null);
    try {
      const [stateResult, categoryResult] = await Promise.allSettled([
        readServerState(),
        fetch(CATEGORY_STATUS_ENDPOINT, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "same-origin",
        }).then(async (response) => {
          const body = await response.json().catch(() => ({}));
          return response.ok && body?.ok === true ? body : null;
        }),
      ]);
      if (stateResult.status === "rejected") throw stateResult.reason;
      setTrackerState(stateResult.value);
      if (categoryResult.status === "fulfilled") {
        setCurrentSnapshotHash(
          String(
            categoryResult.value?.snapshot?.hash ||
              categoryResult.value?.status?.hash ||
              "",
          ),
        );
      }
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "AI 카테고리 검토 데이터를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const itemId of visibleIds) next.delete(itemId);
      } else {
        for (const itemId of visibleIds) next.add(itemId);
      }
      return next;
    });
  }

  function toggleOne(itemId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function decisionsFor(action: ShoplingCategoryReviewAction) {
    return selectedRows.map<ShoplingCategoryReviewDecision>((row) => ({
      itemId: row.itemId,
      action,
      category: action === "approve" ? drafts[row.itemId] : undefined,
    }));
  }

  async function applySelected(action: ShoplingCategoryReviewAction) {
    if (!selectedRows.length) {
      setNotice({ tone: "error", message: "처리할 상품을 먼저 선택하세요." });
      return;
    }
    const label =
      action === "approve"
        ? "승인"
        : action === "hold"
          ? "보류"
          : action === "exclude"
            ? "제외"
            : "재검토";
    if (
      (action === "exclude" || action === "approve") &&
      !window.confirm(`선택한 ${selectedRows.length}건을 ${label} 처리할까요?`)
    ) {
      return;
    }
    await saveDecisions(decisionsFor(action), `${selectedRows.length}건 ${label}`);
  }

  async function applyOne(
    row: ShoplingCategoryReviewRow,
    action: ShoplingCategoryReviewAction,
  ) {
    await saveDecisions(
      [
        {
          itemId: row.itemId,
          action,
          category: action === "approve" ? drafts[row.itemId] : undefined,
        },
      ],
      `${row.modelNumber || row.productName || "상품"} ${
        action === "approve"
          ? "승인"
          : action === "hold"
            ? "보류"
            : action === "exclude"
              ? "제외"
              : "재검토"
      }`,
    );
  }

  async function saveDecisions(
    decisions: ShoplingCategoryReviewDecision[],
    label: string,
  ) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const approvals = decisions.filter((decision) => decision.action === "approve");
      const statusChanges = decisions.filter(
        (decision) => decision.action !== "approve",
      );

      if (approvals.length && statusChanges.length) {
        throw new Error("승인과 상태 변경은 한 번에 함께 처리할 수 없습니다.");
      }

      const requestBody = approvals.length
        ? {
            operation: "approve_category_ai_reviews",
            decisions: approvals.map((decision) => ({
              itemId: decision.itemId,
              category: decision.category,
            })),
            updatedBy: "승준 · AI 카테고리 검토 승인",
          }
        : {
            operation: "update_category_ai_review_status",
            decisions: statusChanges.map((decision) => ({
              itemId: decision.itemId,
              action: decision.action,
            })),
            updatedBy: "AI 카테고리 검토함",
          };

      const response = await fetch(OPTIMIZED_ENDPOINT, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.message || "검토 결과를 서버에 저장하지 못했습니다.");
      }

      const latest = await readServerState();
      setTrackerState(latest);
      window.localStorage.setItem(
        TRACKER_STORAGE_KEY,
        JSON.stringify(latest),
      );
      setSelected((current) => {
        const next = new Set(current);
        for (const decision of decisions) next.delete(decision.itemId);
        return next;
      });

      if (approvals.length) {
        const masterResponse = await fetch(PRODUCT_MASTER_SYNC_ENDPOINT, {
          method: "POST",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        const masterBody = await masterResponse.json().catch(() => ({}));
        if (!masterResponse.ok || masterBody?.ok !== true) {
          setNotice({
            tone: "error",
            message:
              `${label}은 상품출시 진행관리에 저장되어 검토함에서 제거됐습니다. 상품원장 동기화만 다시 확인하세요: ${String(
                masterBody?.message ||
                  `HTTP ${masterResponse.status}`,
              )}`,
          });
          return;
        }
        setNotice({
          tone: "success",
          message:
            `${label} 처리가 완료됐습니다. 승인 항목은 검토함에서 제거됐고 상품출시 진행관리·상품원장에 저장됐습니다.`,
        });
        return;
      }

      setNotice({
        tone: "success",
        message: `${label} 처리가 완료됐습니다.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "카테고리 검토 결과 저장에 실패했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="전체 이력" value={counts.total} tone="slate" />
        <SummaryCard label="검토 필요" value={counts.required} tone="amber" />
        <SummaryCard label="보류" value={counts.held} tone="slate" />
        <SummaryCard label="승인 완료" value={counts.approved} tone="emerald" />
        <SummaryCard label="제외" value={counts.excluded} tone="rose" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-bold text-slate-600">
              상품 검색
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="모델번호, 모델명, 추천 경로"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              검토 상태
              <select
                value={view}
                onChange={(event) => setView(event.target.value as ViewFilter)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="required">검토 필요</option>
                <option value="held">보류</option>
                <option value="approved">승인 완료</option>
                <option value="excluded">제외</option>
                <option value="all">전체 이력</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              AI 작업 회차
              <select
                value={batch}
                onChange={(event) => setBatch(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="all">전체 작업 회차</option>
                {batches.map(([batchId, label]) => (
                  <option key={batchId} value={batchId}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              정렬
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="confidence_asc">신뢰도 낮은 순</option>
                <option value="latest">최근 AI 작업 순</option>
                <option value="model">모델번호 순</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void applySelected("approve")}
              disabled={busy || selectedRows.length === 0}
              className="rounded-lg bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              선택 추천값 승인 ({selectedRows.length})
            </button>
            <button
              type="button"
              onClick={() => void applySelected("hold")}
              disabled={busy || selectedRows.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-40"
            >
              선택 보류
            </button>
            <button
              type="button"
              onClick={() => void applySelected("exclude")}
              disabled={busy || selectedRows.length === 0}
              className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700 disabled:opacity-40"
            >
              선택 제외
            </button>
          </div>
        </div>

        {notice ? (
          <div
            className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
              notice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {notice.message}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisible}
                disabled={filteredRows.length === 0}
                className="size-4 rounded border-slate-300"
              />
              화면 전체 선택
            </label>
            <span className="text-xs text-slate-400">
              {filteredRows.length.toLocaleString("ko-KR")}건 표시
            </span>
          </div>
          <p className="text-xs text-slate-500">
            추천 경로를 직접 고친 뒤 승인하면 수정된 값이 진행관리에 저장됩니다.
          </p>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm font-semibold text-slate-500">
            검토 대기열을 불러오고 있습니다.
          </div>
        ) : filteredRows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-12 px-3 py-3">선택</th>
                  <th className="w-28 px-3 py-3">모델번호</th>
                  <th className="w-52 px-3 py-3">모델명</th>
                  <th className="w-52 px-3 py-3">현재 카테고리</th>
                  <th className="min-w-[360px] px-3 py-3">AI 추천·승인값</th>
                  <th className="w-20 px-3 py-3">신뢰도</th>
                  <th className="min-w-[260px] px-3 py-3">추천 이유·대안</th>
                  <th className="w-36 px-3 py-3">작업 회차</th>
                  <th className="w-28 px-3 py-3">상태</th>
                  <th className="w-64 px-3 py-3">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => (
                  <ReviewRow
                    key={row.itemId}
                    row={row}
                    selected={selected.has(row.itemId)}
                    draft={drafts[row.itemId] ?? row.suggestion}
                    currentSnapshotHash={currentSnapshotHash}
                    busy={busy}
                    onSelect={() => toggleOne(row.itemId)}
                    onDraft={(value) =>
                      setDrafts((current) => ({ ...current, [row.itemId]: value }))
                    }
                    onAction={(action) => void applyOne(row, action)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center">
            <p className="font-bold text-slate-800">조건에 맞는 검토 항목이 없습니다.</p>
            <p className="mt-1 text-sm text-slate-500">
              신규 상품 출시 진행관리에서 상품을 선택해 AI 카테고리 자동설정을 실행하면 이곳에 누적됩니다.
            </p>
            <Link
              href="/product-launch-tracker"
              className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white"
            >
              신규 상품 출시 진행관리 열기
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewRow({
  row,
  selected,
  draft,
  currentSnapshotHash,
  busy,
  onSelect,
  onDraft,
  onAction,
}: {
  row: ShoplingCategoryReviewRow;
  selected: boolean;
  draft: string;
  currentSnapshotHash: string;
  busy: boolean;
  onSelect: () => void;
  onDraft: (value: string) => void;
  onAction: (action: ShoplingCategoryReviewAction) => void;
}) {
  const stale = isShoplingCategoryReviewStale(row, currentSnapshotHash);
  return (
    <tr className={selected ? "bg-blue-50/60" : "bg-white"}>
      <td className="px-3 py-3 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="size-4 rounded border-slate-300"
        />
      </td>
      <td className="px-3 py-3 align-top">
        <Link
          href={`/product-launch-tracker?q=${encodeURIComponent(row.modelNumber)}`}
          className="font-black text-blue-700 hover:underline"
        >
          {row.modelNumber || "모델번호 없음"}
        </Link>
      </td>
      <td className="px-3 py-3 align-top font-bold text-slate-900">
        {row.productName || "모델명 없음"}
      </td>
      <td className="px-3 py-3 align-top text-slate-500">
        {row.currentCategory || "미입력"}
      </td>
      <td className="px-3 py-3 align-top">
        <input
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          disabled={busy}
          aria-label={`${row.modelNumber} 승인 카테고리`}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          최초 추천: {row.suggestion}
        </p>
      </td>
      <td className="px-3 py-3 align-top">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 font-black ${
            row.confidence >= 90
              ? "bg-emerald-50 text-emerald-700"
              : row.confidence >= 70
                ? "bg-amber-50 text-amber-700"
                : "bg-rose-50 text-rose-700"
          }`}
        >
          {row.confidence}%
        </span>
      </td>
      <td className="px-3 py-3 align-top">
        <p className="leading-5 text-slate-700">{row.reason || "추천 이유 없음"}</p>
        {row.alternatives.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.alternatives.map((alternative) => (
              <button
                key={alternative}
                type="button"
                onClick={() => onDraft(alternative)}
                disabled={busy}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700"
                title={alternative}
              >
                대안 적용
              </button>
            ))}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 align-top text-slate-500">
        <p>{row.batchLabel}</p>
        {stale ? (
          <span className="mt-1 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">
            카탈로그 변경됨
          </span>
        ) : null}
      </td>
      <td className="px-3 py-3 align-top">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 font-bold ${STATUS_CLASS[row.status]}`}
        >
          {STATUS_LABEL[row.status]}
        </span>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-wrap gap-1.5">
          {row.status === "review_required" || row.status === "review_held" ? (
            <>
              <button
                type="button"
                onClick={() => onAction("approve")}
                disabled={busy || !draft.trim()}
                className="rounded-md bg-blue-600 px-2.5 py-1.5 font-bold text-white disabled:bg-slate-300"
              >
                승인
              </button>
              <button
                type="button"
                onClick={() => onAction("hold")}
                disabled={busy}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 font-bold text-slate-700"
              >
                보류
              </button>
              <button
                type="button"
                onClick={() => onAction("exclude")}
                disabled={busy}
                className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-bold text-rose-700"
              >
                제외
              </button>
            </>
          ) : row.status === "review_excluded" ? (
            <button
              type="button"
              onClick={() => onAction("restore")}
              disabled={busy}
              className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-bold text-blue-700"
            >
              재검토로 복원
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-emerald-700">
              진행관리 반영 완료
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "emerald" | "rose";
}) {
  const classes = {
    slate: "border-slate-200 bg-white text-slate-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    rose: "border-rose-200 bg-rose-50 text-rose-950",
  };
  return (
    <article className={`rounded-2xl border p-4 shadow-sm ${classes[tone]}`}>
      <p className="text-xs font-bold opacity-65">{label}</p>
      <p className="mt-1 text-2xl font-black">{value.toLocaleString("ko-KR")}</p>
    </article>
  );
}

async function readServerState(): Promise<TrackerState> {
  const response = await fetch(STATE_ENDPOINT, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body.state) {
    throw new Error(body?.message || "신규 상품 출시 진행관리 데이터를 불러오지 못했습니다.");
  }
  if (!Array.isArray(body.state.items)) {
    throw new Error("진행관리 상품 목록 형식이 올바르지 않습니다.");
  }
  return body.state as TrackerState;
}
