"use client";

import { useEffect, useMemo, useState } from "react";
import { applyShoplingCategoryReviewDecisions } from "@/lib/shoplingCategoryReview";

const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const OPTIMIZED_ENDPOINT = "/api/product-launch-tracker/optimized";
const AI_ENDPOINT = "/api/product-launch-tracker/ai-category";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const AI_BATCH_SIZE = 5;

type TrackerItem = Record<string, unknown> & {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  archivedAt?: unknown;
  orderOptions?: unknown;
  shoplingCategory?: unknown;
  chinaProductLinks?: unknown;
  categoryAiStatus?: unknown;
  categoryAiSuggestion?: unknown;
  categoryAiAlternatives?: unknown;
  categoryAiCandidateChoices?: unknown;
  categoryAiCandidatePaths?: unknown;
  categoryAiReason?: unknown;
  categoryAiConfidence?: unknown;
  categoryAiMarketEvidence?: unknown;
};

type TrackerState = Record<string, unknown> & { items: TrackerItem[] };

type ReviewItem = {
  itemId: string;
  modelNumber: string;
  productName: string;
  confidence: number;
  reason: string;
  candidates: string[];
  marketEvidence: MarketEvidence | null;
};

type MarketEvidence = {
  status: "web" | "model_fallback";
  confidence: number;
  summary: string;
  categoryPaths: string[];
  sourceDomains: string[];
};

type AiResult = {
  itemId?: unknown;
  selectedPath?: unknown;
  confidence?: unknown;
  reason?: unknown;
  alternatives?: unknown;
  candidateChoices?: unknown;
  candidatePaths?: unknown;
  autoApply?: unknown;
  skippedExisting?: unknown;
  marketEvidence?: unknown;
};

type AiResponseBatch = {
  results: AiResult[];
  snapshotHash: string;
};

type CandidateSelections = Record<string, string>;

export function ShoplingCategoryCoreNounReview() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [candidateSelections, setCandidateSelections] =
    useState<CandidateSelections>({});
  const [bulkProgress, setBulkProgress] = useState("");

  useEffect(() => {
    void loadStateWithRetry();
  }, []);

  const reviews = useMemo(() => buildReviews(state), [state]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedReviews = useMemo(
    () => reviews.filter((item) => selectedIdSet.has(item.itemId)),
    [reviews, selectedIdSet],
  );
  const selectedCandidateCount = Object.keys(candidateSelections).length;
  const allSelected =
    reviews.length > 0 && reviews.every((item) => selectedIdSet.has(item.itemId));

  useEffect(() => {
    const visible = new Set(reviews.map((item) => item.itemId));
    setSelectedIds((current) => current.filter((itemId) => visible.has(itemId)));
    setCandidateSelections((current) => {
      const next: CandidateSelections = {};
      let changed = false;
      for (const [itemId, category] of Object.entries(current)) {
        const review = reviews.find((item) => item.itemId === itemId);
        if (review?.candidates.includes(category)) {
          next[itemId] = category;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [reviews]);

  async function loadStateWithRetry() {
    setLoading(true);
    setLoadError("");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const next = await readServerState();
      if (next) {
        setState(next);
        setLoading(false);
        return;
      }
      if (attempt < 3) await delay(500 * attempt);
    }
    setLoadError("검토 데이터를 불러오지 못했습니다. 다시 불러오기를 눌러주세요.");
    setLoading(false);
  }

  function toggleSelected(itemId: string) {
    if (busyKey) return;
    setSelectedIds((current) =>
      current.includes(itemId)
        ? current.filter((value) => value !== itemId)
        : [...current, itemId],
    );
  }

  function toggleAll() {
    if (busyKey) return;
    setSelectedIds(allSelected ? [] : reviews.map((item) => item.itemId));
  }

  function toggleCandidateSelection(itemId: string, category: string) {
    if (busyKey) return;
    setCandidateSelections((current) => {
      if (current[itemId] === category) {
        const { [itemId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [itemId]: category,
      };
    });
  }

  function clearCandidateSelectionsFor(itemIds: string[]) {
    if (!itemIds.length) return;
    const targets = new Set(itemIds);
    setCandidateSelections((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([itemId]) => !targets.has(itemId)),
      );
      return next;
    });
  }

  async function approve(item: ReviewItem, category: string) {
    if (busyKey) return;
    setBusyKey(`approve:${item.itemId}`);
    setNotice("");
    try {
      const latest = await requireServerState();
      const result = applyShoplingCategoryReviewDecisions(
        latest,
        [{ itemId: item.itemId, action: "approve", category }],
        { reviewer: "AI 카테고리 검토함" },
      );
      await persistState(result.state as TrackerState);
      clearCandidateSelectionsFor([item.itemId]);
      setNotice(`${item.modelNumber || item.productName} · 선택한 후보를 승인했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "후보 승인에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  }

  async function bulkApproveSelectedCandidates() {
    if (busyKey || !selectedCandidateCount) return;
    setBusyKey("bulk:approve-selected");
    setNotice("");
    setBulkProgress("");
    try {
      const latest = await requireServerState();
      const latestReviews = new Map(
        buildReviews(latest).map((item) => [item.itemId, item] as const),
      );
      const decisions: Array<{
        itemId: string;
        action: "approve";
        category: string;
      }> = [];
      const staleIds: string[] = [];

      for (const [itemId, category] of Object.entries(candidateSelections)) {
        const review = latestReviews.get(itemId);
        if (!review?.candidates.includes(category)) {
          staleIds.push(itemId);
          continue;
        }
        decisions.push({ itemId, action: "approve", category });
      }

      if (!decisions.length) {
        throw new Error(
          "선택한 후보가 최신 검토 데이터와 일치하지 않습니다. 화면을 새로고침하거나 후보를 다시 선택하세요.",
        );
      }

      const confirmed = window.confirm(
        `직접 선택한 후보 ${decisions.length}건을 일괄 승인합니다.${
          staleIds.length ? ` 변경된 후보 ${staleIds.length}건은 제외됩니다.` : ""
        } 계속하시겠습니까?`,
      );
      if (!confirmed) return;

      const result = applyShoplingCategoryReviewDecisions(latest, decisions, {
        reviewer: "AI 카테고리 검토함 · 직접 선택 일괄 승인",
      });
      await persistState(result.state as TrackerState);
      setCandidateSelections(
        Object.fromEntries(
          Object.entries(candidateSelections).filter(([itemId]) =>
            staleIds.includes(itemId),
          ),
        ),
      );
      setNotice(
        `직접 선택한 후보 ${decisions.length}건을 일괄 승인했습니다.${
          staleIds.length
            ? ` 후보가 바뀐 ${staleIds.length}건은 승인하지 않고 선택 상태로 남겼습니다.`
            : ""
        }`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "선택 후보 일괄 승인에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  }

  async function clearReviewQueue() {
    if (busyKey || !reviews.length || !state) return;

    const confirmed = window.confirm(
      `카테고리 검토함 ${reviews.length}건을 모두 비웁니다.\n\nAI 후보·신뢰도·검토 이력만 삭제되고, 이미 확정된 샵플링 표준 카테고리는 유지됩니다.\n계속하시겠습니까?`,
    );
    if (!confirmed) return;

    setBusyKey("clear:review-queue");
    setNotice("");
    setBulkProgress("");
    try {
      const response = await fetch(OPTIMIZED_ENDPOINT, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          operation: "clear_category_ai_review",
          updatedBy: "승준 · AI 카테고리 검토함 비우기",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.message || "카테고리 검토함을 비우지 못했습니다.");
      }

      const next = clearCategoryAiMetadataFromState(
        state,
        text(body?.updatedAt) || new Date().toISOString(),
      );
      setState(next);
      setSelectedIds([]);
      setCandidateSelections({});
      window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "카테고리 검토함을 비우지 못했습니다.",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function reanalyze(item: ReviewItem) {
    if (busyKey) return;
    setBusyKey(`reanalyze:${item.itemId}`);
    setNotice("");
    try {
      const latest = await requireServerState();
      const source = latest.items.find(
        (candidate) => text(candidate?.id) === item.itemId,
      );
      if (!source) throw new Error("재분석할 상품을 찾지 못했습니다.");

      const aiBatch = await requestAiCandidates([source]);
      const next = applyAiResultsToState(latest, aiBatch.results, aiBatch.snapshotHash);
      await persistState(next);
      clearCandidateSelectionsFor([item.itemId]);
      const ai = aiBatch.results[0];
      const selectedPath = text(ai?.selectedPath);
      const autoApply = ai?.autoApply === true && Boolean(selectedPath);
      const newCandidates = stringArray(ai?.candidateChoices).filter(Boolean);
      setNotice(
        autoApply
          ? `${item.modelNumber} · 고신뢰도 카테고리가 자동입력됐습니다.`
          : newCandidates.length
            ? `${item.modelNumber} · 모델명 핵심명사 기준 후보를 다시 생성했습니다.`
            : `${item.modelNumber} · 관련 카테고리를 찾지 못해 검토 상태로 유지했습니다.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "후보 재생성에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  }

  async function bulkReanalyze() {
    if (busyKey || !selectedIds.length) return;
    setBusyKey("bulk:reanalyze");
    setNotice("");
    setBulkProgress("");
    const failedIds: string[] = [];
    try {
      let working = await requireServerState();
      const selected = new Set(selectedIds);
      const sources = working.items.filter((item) => selected.has(text(item?.id)));
      if (!sources.length) {
        throw new Error("재생성할 선택 상품을 최신 진행관리에서 찾지 못했습니다.");
      }

      clearCandidateSelectionsFor(sources.map((source) => text(source.id)).filter(Boolean));
      let completed = 0;
      for (let offset = 0; offset < sources.length; offset += AI_BATCH_SIZE) {
        const batch = sources.slice(offset, offset + AI_BATCH_SIZE);
        setBulkProgress(`선택 후보 재생성 중 · ${completed}/${sources.length}`);
        let successfulResults: AiResult[] = [];
        let snapshotHash = "";
        try {
          const result = await requestAiCandidates(batch);
          successfulResults = result.results;
          snapshotHash = result.snapshotHash;
        } catch {
          for (const source of batch) {
            try {
              const result = await requestAiCandidates([source]);
              successfulResults.push(...result.results);
              snapshotHash = result.snapshotHash || snapshotHash;
            } catch {
              failedIds.push(text(source.id));
            }
          }
        }

        if (successfulResults.length) {
          working = applyAiResultsToState(
            working,
            successfulResults,
            snapshotHash,
          );
          await persistState(working);
        }
        completed += batch.length;
        setBulkProgress(`선택 후보 재생성 중 · ${completed}/${sources.length}`);
      }

      const failedSet = new Set(failedIds.filter(Boolean));
      setSelectedIds([...failedSet]);
      const successCount = sources.length - failedSet.size;
      setNotice(
        `${successCount}건의 후보를 새 샵플링 카탈로그 기준으로 다시 생성했습니다.${
          failedSet.size
            ? ` 실패한 ${failedSet.size}건만 선택 상태로 남겼습니다.`
            : ""
        }`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "일괄 후보 재생성에 실패했습니다.");
    } finally {
      setBulkProgress("");
      setBusyKey("");
    }
  }

  async function requestAiCandidates(sources: TrackerItem[]): Promise<AiResponseBatch> {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ items: sources.map(aiInputFromSource) }),
    });
    const body = await response.json().catch(() => ({}));
    const rawResults = Array.isArray(body?.results) ? (body.results as AiResult[]) : [];
    if (!response.ok || body?.ok !== true || !rawResults.length) {
      throw new Error(body?.message || "새 카테고리 후보를 생성하지 못했습니다.");
    }
    const results = rawResults.map((ai, index) => ({
      ...ai,
      itemId: text(ai.itemId) || text(sources[index]?.id),
    }));
    return {
      results,
      snapshotHash: text(body?.snapshot?.hash),
    };
  }

  async function persistState(next: TrackerState) {
    const response = await fetch(STATE_ENDPOINT, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ state: next }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "카테고리 결과를 저장하지 못했습니다.");
    }
    setState(next);
    window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(next));
  }

  if (loading) {
    return (
      <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-900 shadow-sm">
        AI 검토 상품과 후보를 불러오고 있습니다.
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <p className="text-sm font-bold text-rose-800">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadStateWithRetry()}
          className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white"
        >
          다시 불러오기
        </button>
      </section>
    );
  }

  if (!reviews.length) return null;

  return (
    <section className="mb-5 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            핵심명사 후보 검토
          </p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            모델명에서 실제 제품명사를 먼저 찾습니다
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            상품 체크박스는 재생성 대상을, 후보 체크박스는 실제 승인할 카테고리를 선택합니다. 한 상품에서는 후보 하나만 선택됩니다.
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">
          {reviews.length}건 검토 필요
        </span>
      </div>

      {notice ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-900">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-black text-slate-900">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={Boolean(busyKey)}
                className="h-4 w-4 rounded border-slate-300"
              />
              재생성 대상 전체 선택 · {reviews.length}건
            </label>
            <p className="mt-1 text-xs text-slate-500">
              재생성 상품 {selectedReviews.length}건 선택 · 승인 후보 {selectedCandidateCount}건 선택
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={Boolean(busyKey) || !selectedIds.length}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-40"
            >
              재생성 선택 해제
            </button>
            <button
              type="button"
              onClick={() => void bulkReanalyze()}
              disabled={Boolean(busyKey) || !selectedIds.length}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-40"
            >
              {busyKey === "bulk:reanalyze"
                ? "일괄 재생성 중…"
                : `선택 상품 후보 일괄 재생성${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => setCandidateSelections({})}
              disabled={Boolean(busyKey) || !selectedCandidateCount}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-40"
            >
              후보 선택 해제
            </button>
            <button
              type="button"
              onClick={() => void bulkApproveSelectedCandidates()}
              disabled={Boolean(busyKey) || !selectedCandidateCount}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300"
            >
              {busyKey === "bulk:approve-selected"
                ? "선택 후보 승인 중…"
                : `선택 후보 일괄 승인${selectedCandidateCount ? ` (${selectedCandidateCount})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => void clearReviewQueue()}
              disabled={Boolean(busyKey) || !reviews.length}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-40"
            >
              {busyKey === "clear:review-queue"
                ? "검토함 비우는 중…"
                : `검토함 모두 비우기 (${reviews.length})`}
            </button>
          </div>
        </div>
        {bulkProgress ? (
          <div className="mt-3 rounded-lg bg-blue-100 px-3 py-2 text-xs font-black text-blue-900">
            {bulkProgress}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {reviews.map((item) => {
          const reanalyzing = busyKey === `reanalyze:${item.itemId}`;
          const selected = selectedIdSet.has(item.itemId);
          const selectedCandidate = candidateSelections[item.itemId] || "";
          return (
            <article
              key={item.itemId}
              className={`rounded-xl border p-4 ${
                selected
                  ? "border-blue-300 bg-blue-50/40"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(item.itemId)}
                    disabled={Boolean(busyKey)}
                    aria-label={`${item.modelNumber || item.productName} 재생성 대상 선택`}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <div className="min-w-0">
                    <p className="font-black text-slate-950">
                      {item.modelNumber || "모델번호 없음"} · {item.productName || "모델명 없음"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{item.reason}</p>
                    {item.marketEvidence ? (
                      <div className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] leading-5 text-cyan-950">
                        <p className="font-black">
                          {item.marketEvidence.status === "web"
                            ? "외부 검색 근거"
                            : "OpenAI 모델명 의미 분석"} · 근거 신뢰도 {item.marketEvidence.confidence}%
                        </p>
                        {item.marketEvidence.summary ? (
                          <p>{item.marketEvidence.summary}</p>
                        ) : null}
                        {item.marketEvidence.categoryPaths.length ? (
                          <p>참고 분류: {item.marketEvidence.categoryPaths.join(" / ")}</p>
                        ) : null}
                        {item.marketEvidence.sourceDomains.length ? (
                          <p>출처: {item.marketEvidence.sourceDomains.join(", ")}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void reanalyze(item)}
                  disabled={Boolean(busyKey)}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-40"
                >
                  {reanalyzing ? "재분석 중…" : "후보 다시 생성"}
                </button>
              </div>

              {item.candidates.length ? (
                <div className="mt-3 space-y-2">
                  {item.candidates.map((candidate, index) => {
                    const candidateSelected = selectedCandidate === candidate;
                    return (
                      <div
                        key={candidate}
                        className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                          candidateSelected
                            ? "border-blue-400 bg-blue-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={candidateSelected}
                            onChange={() =>
                              toggleCandidateSelection(item.itemId, candidate)
                            }
                            disabled={Boolean(busyKey)}
                            aria-label={`${item.modelNumber || item.productName} 후보 ${index + 1} 선택`}
                            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                          />
                          <span className="min-w-0">
                            <span className="block text-[10px] font-black text-slate-400">
                              후보 {index + 1}{index === 0 ? " · AI 1순위" : ""}
                              {candidateSelected ? " · 승인 선택됨" : ""}
                            </span>
                            <span className="mt-0.5 block break-words text-xs font-bold leading-5 text-slate-800">
                              {candidate}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void approve(item, candidate)}
                          disabled={Boolean(busyKey)}
                          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300"
                        >
                          {busyKey === `approve:${item.itemId}`
                            ? "저장 중…"
                            : "이 후보 승인"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-800">
                  기존 후보가 모델명의 핵심 제품명사와 맞지 않아 숨겼습니다. 위의 ‘후보 다시 생성’을 눌러 이 상품만 다시 분석하세요.
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function aiInputFromSource(source: TrackerItem) {
  return {
    itemId: source.id,
    modelNumber: source.modelNumber,
    productName: source.productName,
    optionLabels: Array.isArray(source.orderOptions)
      ? source.orderOptions
          .map((option) =>
            option && typeof option === "object"
              ? text((option as { saleOption?: unknown }).saleOption)
              : "",
          )
          .filter(Boolean)
      : [],
    currentCategory: text(source.shoplingCategory),
    chinaProductLinks: Array.isArray(source.chinaProductLinks)
      ? source.chinaProductLinks
      : [],
  };
}

function applyAiResultsToState(
  state: TrackerState,
  results: AiResult[],
  snapshotHash: string,
): TrackerState {
  const byItemId = new Map(
    results
      .map((ai) => [text(ai.itemId), ai] as const)
      .filter(([itemId]) => Boolean(itemId)),
  );
  const now = new Date().toISOString();
  return {
    ...state,
    savedAt: now,
    items: state.items.map((candidate) => {
      const ai = byItemId.get(text(candidate?.id));
      if (!ai) return candidate;
      const selectedPath = text(ai.selectedPath);
      const autoApply = ai.autoApply === true && Boolean(selectedPath);
      const skippedExisting = ai.skippedExisting === true;
      return {
        ...candidate,
        shoplingCategory: autoApply ? selectedPath : candidate.shoplingCategory,
        categoryAiSuggestion: selectedPath,
        categoryAiConfidence: Math.max(
          0,
          Math.min(100, Number(ai.confidence) || 0),
        ),
        categoryAiReason: normalizeReason(text(ai.reason)),
        categoryAiAlternatives: stringArray(ai.alternatives).slice(0, 3),
        categoryAiCandidateChoices: stringArray(ai.candidateChoices).slice(0, 3),
        categoryAiCandidatePaths: stringArray(ai.candidatePaths),
        categoryAiMarketEvidence: normalizeMarketEvidence(ai.marketEvidence),
        categoryAiStatus: autoApply
          ? "auto_applied"
          : skippedExisting
            ? "existing_preserved"
            : "review_required",
        categoryAiSnapshotHash: snapshotHash,
        categoryAiUpdatedAt: now,
        updatedAt: now,
        updatedBy: autoApply ? "AI 카테고리 자동설정" : candidate.updatedBy,
      };
    }),
  };
}

function clearCategoryAiMetadataFromState(
  state: TrackerState,
  savedAt: string,
): TrackerState {
  return {
    ...state,
    savedAt,
    items: state.items.map((item) => {
      const next: TrackerItem = { ...item };
      for (const key of Object.keys(next)) {
        if (key.startsWith("categoryAi")) delete next[key];
      }
      return next;
    }),
  };
}

function buildReviews(state: TrackerState | null): ReviewItem[] {
  if (!state || !Array.isArray(state.items)) return [];
  return state.items
    .filter((item) => {
      if (!item || item.archivedAt) return false;
      const status = text(item.categoryAiStatus);
      return status === "review_required" || status === "review_held";
    })
    .map((item) => ({
      itemId: text(item.id),
      modelNumber: text(item.modelNumber),
      productName: text(item.productName),
      confidence: Math.max(0, Math.min(100, Number(item.categoryAiConfidence) || 0)),
      reason: normalizeReason(
        text(item.categoryAiReason) ||
          "모델명과 옵션정보 기준으로 검토가 필요합니다.",
      ),
      candidates: candidateChoices(item),
      marketEvidence: normalizeMarketEvidence(item.categoryAiMarketEvidence),
    }))
    .filter((item) => item.itemId)
    .sort(
      (left, right) =>
        left.confidence - right.confidence ||
        left.modelNumber.localeCompare(right.modelNumber, "ko-KR"),
    );
}

function candidateChoices(item: TrackerItem) {
  const sources = [
    ...(Array.isArray(item.categoryAiCandidateChoices)
      ? item.categoryAiCandidateChoices
      : []),
    item.categoryAiSuggestion,
    ...(Array.isArray(item.categoryAiAlternatives)
      ? item.categoryAiAlternatives
      : []),
    ...(Array.isArray(item.categoryAiCandidatePaths)
      ? item.categoryAiCandidatePaths
      : []),
  ];
  const unique: string[] = [];
  for (const source of sources) {
    const value = text(source);
    if (!value || unique.includes(value)) continue;
    unique.push(value);
  }

  if (compact(item.productName).includes("골무")) {
    const positive = [
      "골무",
      "바느질",
      "재봉",
      "수예",
      "봉제",
      "손가락보호",
      "보호대",
      "공예",
    ];
    const blocked = [
      "타이즈",
      "스타킹",
      "내의",
      "레깅스",
      "양말",
      "속옷",
      "의류",
      "축구",
      "야구",
      "골프",
      "헬멧",
      "투구",
    ];
    return unique
      .filter((candidate) => {
        const value = compact(candidate);
        return (
          positive.some((term) => value.includes(compact(term))) &&
          !blocked.some((term) => value.includes(compact(term)))
        );
      })
      .slice(0, 3);
  }

  return unique.slice(0, 3);
}

function normalizeReason(value: string) {
  return value
    .replaceAll("상품명이", "모델명이")
    .replaceAll("상품명은", "모델명은")
    .replaceAll("상품명에", "모델명에")
    .replaceAll("상품명", "모델명");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizeMarketEvidence(value: unknown): MarketEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const status = row.status === "web" ? "web" : "model_fallback";
  const summary = text(row.summary).slice(0, 240);
  const categoryPaths = stringArray(row.categoryPaths).slice(0, 4);
  const sourceDomains = stringArray(row.sourceDomains).slice(0, 8);
  const confidence = Math.max(
    0,
    Math.min(100, Math.round(Number(row.confidence) || 0)),
  );
  if (!summary && !categoryPaths.length && !sourceDomains.length) return null;
  return { status, confidence, summary, categoryPaths, sourceDomains };
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

async function requireServerState() {
  const state = await readServerState();
  if (!state) throw new Error("최신 진행관리 데이터를 불러오지 못했습니다.");
  return state;
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

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
