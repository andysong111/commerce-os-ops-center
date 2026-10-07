"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { formatBrowserLocalDateTime } from "@/lib/browserTime";
import {
  KEYWORD_OPPORTUNITY_UPDATED_EVENT,
  keywordOpportunityCsv,
  readKeywordOpportunities,
  sortKeywordOpportunities,
  updateKeywordOpportunity,
  type KeywordOpportunityRecord,
  type KeywordOpportunityStatus,
} from "@/lib/keywordOpportunityLibrary";

type Filter = "active" | "favorites" | KeywordOpportunityStatus | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "활용 가능" },
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

export default function KeywordOpportunityLibraryPage() {
  const [records, setRecords] = useState<KeywordOpportunityRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState("");

  useEffect(() => {
    const load = () =>
      setRecords(sortKeywordOpportunities(readKeywordOpportunities(window.localStorage)));
    load();
    window.addEventListener(KEYWORD_OPPORTUNITY_UPDATED_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(KEYWORD_OPPORTUNITY_UPDATED_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase("ko-KR").trim();
    return records.filter((record) => {
      const filterMatches =
        filter === "all" ||
        (filter === "active" && record.status !== "excluded") ||
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

  const activeRecords = records.filter((record) => record.status !== "excluded");
  const stats = {
    active: activeRecords.length,
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
        description="상품출시 키워드 엔진 이력에서 경쟁강도가 낮고 품질이 확인된 키워드를 자동으로 모아, 다음 소싱 후보로 관리합니다."
        actions={
          <button
            type="button"
            onClick={exportCsv}
            disabled={visibleRecords.length === 0}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            현재 목록 CSV
          </button>
        }
      />

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-900">
        <p className="font-black">자동 기록 기준</p>
        <p className="mt-1">
          경쟁강도 <strong>낮음(LOW)</strong>이면서 엔진 품질이 <strong>최적 또는 추천</strong>인 키워드만 저장합니다. 같은 키워드는 한 줄로 합치고 발견 횟수와 상품번호를 누적합니다.
        </p>
        <p className="mt-1 text-xs font-semibold text-blue-700">
          현재 보관함은 이 브라우저에 저장됩니다. 검색량과 경쟁강도는 소싱 단서이며 실제 판매량이나 수익성을 보장하지 않습니다.
        </p>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="활용 가능" value={stats.active} detail="제외 후보를 뺀 전체" />
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
              상품출시 진행관리에서 키워드 엔진 결과를 가져오면 경쟁강도 낮음 후보가 여기에 자동 누적됩니다.
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
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
              경쟁 {record.competitionIndex}
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
