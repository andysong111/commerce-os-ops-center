"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { formatBrowserLocalDateTime } from "@/lib/browserTime";
import {
  KEYWORD_OPPORTUNITY_UPDATED_EVENT,
  KEYWORD_OPPORTUNITY_HISTORY_BACKFILL_KEY,
  captureHistoricalKeywordOpportunities,
  keywordOpportunityCsv,
  readKeywordOpportunities,
  sortKeywordOpportunities,
  updateKeywordOpportunity,
  type KeywordOpportunityRecord,
  type KeywordOpportunityStatus,
  type KeywordOpportunityHistoryObservation,
} from "@/lib/keywordOpportunityLibrary";

type Filter =
  | "active"
  | "history_unverified"
  | "favorites"
  | KeywordOpportunityStatus
  | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "활용 가능" },
  { value: "history_unverified", label: "과거·재확인" },
  { value: "favorites", label: "즐겨찾기" },
  { value: "new", label: "새 후보" },
  { value: "reviewing", label: "검토 중" },
  { value: "sourced", label: "소싱 완료" },
  { value: "excluded", label: "제외" },
  { value: "all", label: "전체" },
];

const STATUS_LABELS: Record<KeywordOpportunityStatus, string> = {
  new: "새 후보",
  reviewing: "검토 중",
  sourced: "소싱 완료",
  excluded: "제외",
};

type BackfillResponse = {
  ok: boolean;
  message?: string;
  observations?: KeywordOpportunityHistoryObservation[];
  stats?: {
    successfulRunsChecked: number;
    artifactsFound: number;
    artifactsImported: number;
    artifactsFailed: number;
    goodsKeysRecovered: number;
    keywordObservationsRecovered: number;
  };
};

export default function KeywordOpportunityLibraryPage() {
  const [records, setRecords] = useState<KeywordOpportunityRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState("");
  const automaticBackfillStarted = useRef(false);

  const backfillHistory = useCallback(async () => {
    if (automaticBackfillStarted.current) return;
    automaticBackfillStarted.current = true;
    setBackfillBusy(true);
    setBackfillMessage("과거 키워드 엔진 산출물을 확인하고 있습니다.");
    try {
      const response = await fetch(
        "/api/keyword-opportunity-library/backfill",
        { method: "POST" },
      );
      const payload = (await response.json()) as BackfillResponse;
      if (!response.ok || !payload.ok || !payload.observations) {
        throw new Error(payload.message || "과거 키워드 이력을 불러오지 못했습니다.");
      }
      const captured = captureHistoricalKeywordOpportunities(
        window.localStorage,
        payload.observations,
      );
      setRecords(captured.records);
      window.localStorage.setItem(
        KEYWORD_OPPORTUNITY_HISTORY_BACKFILL_KEY,
        JSON.stringify({ completedAt: new Date().toISOString(), stats: payload.stats }),
      );
      const stats = payload.stats;
      setBackfillMessage(
        stats
          ? `과거 산출물 ${stats.artifactsImported}건·상품 ${stats.goodsKeysRecovered}개의 키워드를 복원했습니다. 새 후보 ${captured.added}개, 기존 후보 보강 ${captured.updated}개입니다.`
          : `과거 키워드 ${captured.added}개를 복원했습니다.`,
      );
    } catch (error) {
      setBackfillMessage(
        error instanceof Error
          ? error.message
          : "과거 키워드 이력을 불러오지 못했습니다.",
      );
    } finally {
      setBackfillBusy(false);
      automaticBackfillStarted.current = false;
    }
  }, []);

  useEffect(() => {
    const load = () =>
      setRecords(sortKeywordOpportunities(readKeywordOpportunities(window.localStorage)));
    load();
    let backfillTimer: number | undefined;
    if (!window.localStorage.getItem(KEYWORD_OPPORTUNITY_HISTORY_BACKFILL_KEY)) {
      backfillTimer = window.setTimeout(() => void backfillHistory(), 0);
    }
    window.addEventListener(KEYWORD_OPPORTUNITY_UPDATED_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      if (backfillTimer !== undefined) window.clearTimeout(backfillTimer);
      window.removeEventListener(KEYWORD_OPPORTUNITY_UPDATED_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [backfillHistory]);

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase("ko-KR").trim();
    return records.filter((record) => {
      const filterMatches =
        filter === "all" ||
        (filter === "active" &&
          record.competitionEvidence === "verified_low" &&
          record.status !== "excluded") ||
        (filter === "history_unverified" &&
          record.competitionEvidence === "history_unverified") ||
        (filter === "favorites" && record.favorite) ||
        record.status === filter;
      const queryMatches =
        !normalizedQuery ||
        [record.keyword, record.note, record.goodsKeys.join(" ")]
          .join(" ")
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      return filterMatches && queryMatches;
    });
  }, [filter, query, records]);

  const activeRecords = records.filter(
    (record) =>
      record.competitionEvidence === "verified_low" &&
      record.status !== "excluded",
  );
  const stats = {
    active: activeRecords.length,
    unverified: records.filter(
      (record) => record.competitionEvidence === "history_unverified",
    ).length,
    favorites: records.filter((record) => record.favorite).length,
    reviewing: records.filter((record) => record.status === "reviewing").length,
    sourced: records.filter((record) => record.status === "sourced").length,
  };

  function patchRecord(
    record: KeywordOpportunityRecord,
    patch: Partial<Pick<KeywordOpportunityRecord, "favorite" | "status" | "note">>,
  ) {
    setRecords(updateKeywordOpportunity(window.localStorage, record.id, patch));
  }

  async function copyKeyword(record: KeywordOpportunityRecord) {
    await navigator.clipboard.writeText(record.keyword);
    setCopiedId(record.id);
    window.setTimeout(() => setCopiedId(""), 1500);
  }

  function exportCsv() {
    const csv = `\uFEFF${keywordOpportunityCsv(visibleRecords)}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `keyword-opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        eyebrow="SOURCING SIGNALS"
        title="키워드 소싱 후보"
        description="상품출시 키워드 엔진의 과거·현재 결과를 모아, 경쟁강도가 좋은 후보와 재확인이 필요한 후보를 함께 관리합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void backfillHistory()}
              disabled={backfillBusy}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-400"
            >
              {backfillBusy ? "이전 이력 확인 중" : "이전 이력 가져오기"}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={visibleRecords.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              현재 목록 CSV
            </button>
          </div>
        }
      />

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-900">
        <p className="font-black">자동 기록 기준</p>
        <p className="mt-1">
          경쟁강도 <strong>낮음(LOW)</strong>이면서 엔진 품질이 <strong>최적 또는 추천</strong>인 키워드만 저장합니다. 같은 키워드는 한 줄로 합치고 발견 횟수와 상품번호를 누적합니다.
        </p>
        <p className="mt-1">
          이전 상품출시 산출물도 자동 복원합니다. 당시 경쟁강도가 수집되지 않은 키워드는 버리지 않고 <strong>과거·재확인</strong>으로 분리해 표시합니다.
        </p>
        <p className="mt-1 text-xs font-semibold text-blue-700">
          현재 보관함은 이 브라우저에 저장됩니다. 검색량과 경쟁강도는 소싱 단서이며 실제 판매량이나 수익성을 보장하지 않습니다.
        </p>
      </section>

      {backfillMessage ? (
        <section className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
          {backfillMessage}
        </section>
      ) : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="활용 가능" value={stats.active} detail="LOW 확인 후보" />
        <Stat label="과거·재확인" value={stats.unverified} detail="경쟁강도 미수집" />
        <Stat label="즐겨찾기" value={stats.favorites} detail="우선 확인할 후보" />
        <Stat label="검토 중" value={stats.reviewing} detail="시장·공급처 확인 중" />
        <Stat label="소싱 완료" value={stats.sourced} detail="후보 탐색을 마친 키워드" />
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  filter === item.value
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="키워드·goods_key·메모 검색"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 xl:max-w-sm"
          />
        </div>

        {visibleRecords.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
            <p className="font-black text-slate-800">아직 조건에 맞는 키워드가 없습니다.</p>
            <p className="mt-2 text-sm text-slate-500">
              이전 이력 가져오기를 누르거나 상품출시 진행관리에서 새 키워드 결과를 가져오면 후보가 누적됩니다.
            </p>
            <Link
              href="/product-launch-flow"
              className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              상품 출시 플로우 열기
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {visibleRecords.map((record) => (
              <OpportunityCard
                key={record.id}
                record={record}
                copied={copiedId === record.id}
                onCopy={() => void copyKeyword(record)}
                onPatch={(patch) => patchRecord(record, patch)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function OpportunityCard({
  record,
  copied,
  onCopy,
  onPatch,
}: {
  record: KeywordOpportunityRecord;
  copied: boolean;
  onCopy: () => void;
  onPatch: (
    patch: Partial<Pick<KeywordOpportunityRecord, "favorite" | "status" | "note">>,
  ) => void;
}) {
  const encoded = encodeURIComponent(record.keyword);
  return (
    <article className={`rounded-2xl border p-5 ${record.status === "excluded" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${record.competitionEvidence === "verified_low" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {record.competitionEvidence === "verified_low"
                ? `경쟁 ${record.competitionIndex}`
                : "경쟁강도 재확인"}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">
              {record.quality}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {STATUS_LABELS[record.status]}
            </span>
          </div>
          <h2 className="mt-3 break-words text-xl font-black text-slate-950">
            {record.keyword}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => onPatch({ favorite: !record.favorite })}
          aria-label={record.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          className={`grid size-10 shrink-0 place-items-center rounded-xl border text-xl ${record.favorite ? "border-amber-300 bg-amber-50 text-amber-500" : "border-slate-200 text-slate-300 hover:text-amber-500"}`}
        >
          {record.favorite ? "★" : "☆"}
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="월 검색량" value={record.totalSearch === null ? "미확인" : record.totalSearch.toLocaleString("ko-KR")} />
        <Metric label="발견 횟수" value={`${record.occurrenceCount}회`} />
        <Metric label="연결 상품" value={`${record.goodsKeys.length}개`} />
        <Metric label="최근 발견" value={formatBrowserLocalDateTime(record.lastSeenAt)} />
      </dl>

      {record.goodsKeys.length ? (
        <p className="mt-3 break-all text-xs font-semibold text-slate-500">
          goods_key {record.goodsKeys.join(", ")}
        </p>
      ) : null}

      <textarea
        key={`${record.id}:${record.note}`}
        defaultValue={record.note}
        onBlur={(event) => onPatch({ note: event.currentTarget.value })}
        rows={2}
        placeholder="소싱 아이디어, 카테고리, 확인할 내용을 메모하세요."
        className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/sourcing-engine/market-snapshot?keyword=${encoded}`}
          className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-black text-white hover:bg-blue-700"
        >
          시장 확인
        </Link>
        <Link
          href={`/sourcing-engine?keyword=${encoded}`}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
        >
          1688 소싱 준비
        </Link>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          {copied ? "복사됨" : "키워드 복사"}
        </button>
        <select
          value={record.status}
          onChange={(event) => onPatch({ status: event.target.value as KeywordOpportunityStatus })}
          aria-label={`${record.keyword} 소싱 상태`}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </article>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words font-black text-slate-800">{value}</dd>
    </div>
  );
}
