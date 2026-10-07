"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  captureKeywordOpportunities,
} from "@/lib/keywordOpportunityLibrary";
import {
  isKeywordResearchSaveable,
  type KeywordResearchCompetition,
  type KeywordResearchRow,
  type KeywordResearchSummary,
} from "@/lib/keywordResearch";

type ResearchResponse = {
  ok: true;
  requestId: string;
  keyword: string;
  generatedAt: string;
  summary: KeywordResearchSummary;
  rows: KeywordResearchRow[];
  engine: {
    searchAdConfigured: boolean;
    semanticModel: string;
    semanticScoringApplied: boolean;
    shoppingSupplyApplied: boolean;
    explorationDepth: number;
    expansionSeeds: string[];
  };
  warnings: string[];
};

type SortKey = "opportunity" | "search" | "competition" | "products";
type CompetitionFilter = "all" | KeywordResearchCompetition;
type QualityFilter = "all" | "engine" | "최적" | "추천" | "검토";

const HISTORY_KEY = "opsCenter.keywordResearchHistory.v1";
const SAMPLE_KEYWORDS = ["샤워기 필터", "차량용 수납함", "캠핑 파우치", "주방 선반"];
const numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function readHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function persistHistory(keyword: string, current: string[]) {
  const next = [keyword, ...current.filter((item) => item !== keyword)].slice(0, 8);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function KeywordResearchClient() {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>(readHistory);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expandedKeyword, setExpandedKeyword] = useState("");
  const [competitionFilter, setCompetitionFilter] = useState<CompetitionFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [minimumSearch, setMinimumSearch] = useState("0");
  const [sortKey, setSortKey] = useState<SortKey>("opportunity");

  const visibleRows = useMemo(() => {
    const minimum = Math.max(0, Number(minimumSearch) || 0);
    const rows = (result?.rows ?? []).filter((row) => {
      if (competitionFilter !== "all" && row.competition !== competitionFilter) return false;
      if (qualityFilter === "engine" && !row.enginePass) return false;
      if (
        qualityFilter !== "all" &&
        qualityFilter !== "engine" &&
        row.quality !== qualityFilter
      ) return false;
      return (row.totalSearch ?? 0) >= minimum;
    });
    return [...rows].sort((left, right) => {
      if (sortKey === "search") return (right.totalSearch ?? -1) - (left.totalSearch ?? -1);
      if (sortKey === "competition") {
        return right.competitionOpportunity - left.competitionOpportunity;
      }
      if (sortKey === "products") return (left.productCount ?? Infinity) - (right.productCount ?? Infinity);
      return right.opportunityScore - left.opportunityScore;
    });
  }, [competitionFilter, minimumSearch, qualityFilter, result, sortKey]);

  const saveableVisibleRows = visibleRows.filter(isKeywordResearchSaveable);
  const allSaveableSelected =
    saveableVisibleRows.length > 0 &&
    saveableVisibleRows.every((row) => selected.has(row.keyword));

  async function runResearch(event?: FormEvent) {
    event?.preventDefault();
    const keyword = query.trim();
    if (keyword.length < 2) {
      setErrorMessage("두 글자 이상의 키워드를 입력해 주세요.");
      return;
    }
    setLoading(true);
    setErrorMessage("");
    setSaveMessage("");
    setSelected(new Set());
    setExpandedKeyword("");
    try {
      const response = await fetch("/api/keyword-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      const payload = (await response.json()) as ResearchResponse | { ok: false; message?: string };
      if (!response.ok || !payload.ok) {
        throw new Error("message" in payload ? payload.message : "키워드 조회에 실패했습니다.");
      }
      setResult(payload);
      setHistory((current) => persistHistory(payload.keyword, current));
      setExpandedKeyword(payload.rows[0]?.keyword ?? "");
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : "키워드 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function chooseKeyword(keyword: string) {
    setQuery(keyword);
  }

  function toggleSelected(keyword: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  function toggleAllSaveable() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of saveableVisibleRows) {
        if (allSaveableSelected) next.delete(row.keyword);
        else next.add(row.keyword);
      }
      return next;
    });
  }

  function saveRows(rows: KeywordResearchRow[]) {
    if (!result || rows.length === 0) return;
    const saved = captureKeywordOpportunities(window.localStorage, {
      requestId: result.requestId,
      capturedAt: result.generatedAt,
      groups: [
        {
          goodsKey: "",
          optimizedKeywords: rows.map((row) => row.keyword),
          items: rows.map((row) => ({
            keyword: row.keyword,
            score: row.opportunityScore,
            quality: row.quality,
            source: `키워드 직접 조회 · ${result.keyword}`,
            selectedByEngine: true,
            safeAutoApply: true,
            totalSearch: row.totalSearch,
            competitionIndex: row.competitionIndex,
            reason: `기회점수 ${row.opportunityScore} · ${row.rationale}`,
          })),
          qualityStatus: "PASS",
          confidenceStatus: "PASS",
          engineStatus: "success",
          warnings: result.warnings,
        },
      ],
    });
    setSaveMessage(`소싱 후보에 ${saved.added}개 추가, ${saved.updated}개 갱신했습니다.`);
    setSelected(new Set());
  }

  function exportCsv() {
    if (!result) return;
    const header = [
      "keyword",
      "monthly_search",
      "pc_search",
      "mobile_search",
      "product_count",
      "competition",
      "opportunity_score",
      "quality",
      "relevance",
      "shopping_intent",
    ];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = visibleRows.map((row) =>
      [
        row.keyword,
        row.totalSearch,
        row.pcSearch,
        row.mobileSearch,
        row.productCount,
        row.competitionLabel,
        row.opportunityScore,
        row.quality,
        row.relevance,
        row.shoppingIntent,
      ].map(escape).join(","),
    );
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${header.join(",")}\n${lines.join("\n")}`], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `keyword-research-${result.keyword}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-slate-950 p-5 text-white shadow-sm sm:p-7">
        <form onSubmit={runResearch} className="flex flex-col gap-3 lg:flex-row">
          <label className="flex-1">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-blue-300">
              분석할 상품 키워드
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="예: 샤워기 필터, 차량용 수납함"
              className="h-14 w-full rounded-xl border border-white/15 bg-white px-4 text-base font-semibold text-slate-950 outline-none ring-blue-400 placeholder:text-slate-400 focus:ring-4"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="h-14 self-end rounded-xl bg-blue-600 px-7 text-sm font-black text-white hover:bg-blue-500 disabled:cursor-wait disabled:bg-slate-600"
          >
            {loading ? "엔진 분석 중…" : "키워드 분석"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-slate-400">빠른 조회</span>
          {[...new Set([...history, ...SAMPLE_KEYWORDS])].slice(0, 8).map((keyword) => (
            <button
              key={keyword}
              type="button"
              onClick={() => chooseKeyword(keyword)}
              className="rounded-full border border-white/15 px-3 py-1.5 font-semibold text-slate-200 hover:border-blue-400 hover:text-white"
            >
              {keyword}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          SearchAd 연관어와 수요·경쟁 데이터를 수집한 뒤 AI 의미 적합성 Gate와 상품 수를 함께 계산합니다. 분석에는 최대 약 1분이 걸릴 수 있습니다.
        </p>
      </section>

      {errorMessage ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="기준 키워드 검색량" value={formatNumber(result.summary.seedSearchVolume)} detail={result.keyword} />
            <StatCard label="연관 키워드" value={`${result.summary.keywordCount}개`} detail={`탐색 ${result.engine.explorationDepth}단계`} />
            <StatCard label="경쟁 낮음" value={`${result.summary.lowCompetitionCount}개`} detail="SearchAd 경쟁지수" tone="emerald" />
            <StatCard label="엔진 통과" value={`${result.summary.enginePassCount}개`} detail="의미·쇼핑의도 Gate" tone="blue" />
            <StatCard label="최고 기회점수" value={`${result.summary.bestOpportunityScore}점`} detail="수요·경쟁·적합성 종합" tone="violet" />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <FilterSelect label="경쟁강도" value={competitionFilter} onChange={(value) => setCompetitionFilter(value as CompetitionFilter)} options={[['all','전체'],['low','낮음'],['medium','보통'],['high','높음'],['unknown','미확인']]} />
                <FilterSelect label="엔진 품질" value={qualityFilter} onChange={(value) => setQualityFilter(value as QualityFilter)} options={[['all','전체'],['engine','엔진 통과'],['최적','최적'],['추천','추천'],['검토','검토']]} />
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold text-slate-500">최소 월 검색량</span>
                  <input type="number" min="0" value={minimumSearch} onChange={(event) => setMinimumSearch(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" />
                </label>
                <FilterSelect label="정렬" value={sortKey} onChange={(value) => setSortKey(value as SortKey)} options={[['opportunity','기회점수순'],['search','검색량순'],['competition','경쟁기회순'],['products','상품수 적은순']]} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={exportCsv} className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">CSV</button>
                <button type="button" disabled={selected.size === 0} onClick={() => saveRows(result.rows.filter((row) => selected.has(row.keyword) && isKeywordResearchSaveable(row)))} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                  선택 후보 저장 {selected.size ? `${selected.size}개` : ""}
                </button>
                <Link href="/keyword-opportunity-library" className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">소싱 후보 보관함</Link>
              </div>
            </div>

            {saveMessage ? <p className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">{saveMessage}</p> : null}
            {result.warnings.length ? <p className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">{result.warnings.join(" · ")}</p> : null}

            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-12 px-4 py-3"><input type="checkbox" aria-label="저장 가능한 키워드 전체 선택" checked={allSaveableSelected} onChange={toggleAllSaveable} /></th>
                    <th className="w-12 px-2 py-3">순위</th>
                    <th className="min-w-56 px-3 py-3">키워드</th>
                    <th className="px-3 py-3 text-right">월 검색량</th>
                    <th className="px-3 py-3 text-right">PC / 모바일</th>
                    <th className="px-3 py-3 text-right">상품 수</th>
                    <th className="px-3 py-3">경쟁강도</th>
                    <th className="px-3 py-3 text-right">기회점수</th>
                    <th className="px-3 py-3">엔진 품질</th>
                    <th className="px-4 py-3 text-right">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((row, index) => {
                    const saveable = isKeywordResearchSaveable(row);
                    return (
                      <KeywordRow
                        key={row.keyword}
                        row={row}
                        rank={index + 1}
                        checked={selected.has(row.keyword)}
                        expanded={expandedKeyword === row.keyword}
                        saveable={saveable}
                        onToggle={() => toggleSelected(row.keyword)}
                        onExpand={() => setExpandedKeyword((current) => current === row.keyword ? "" : row.keyword)}
                        onSave={() => saveRows([row])}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            {visibleRows.length === 0 ? <p className="p-10 text-center text-sm font-semibold text-slate-500">현재 필터에 맞는 키워드가 없습니다.</p> : null}
            <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p>상품 수는 상위 {result.engine.shoppingSupplyApplied ? "12개 후보" : "후보에 미적용"} 기준이며, 판매량이 아닌 네이버 쇼핑 검색결과 수입니다.</p>
              <p>LOW + 엔진 통과 후보만 소싱 보관함에 저장됩니다.</p>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-lg font-black text-slate-900">키워드를 입력하면 시장 수요와 경쟁도를 한 번에 비교합니다.</p>
          <p className="mt-2 text-sm text-slate-500">검색량만 높은 넓은 단어보다, 경쟁이 낮고 상품 의미가 정확한 소싱 후보를 우선 보여줍니다.</p>
        </section>
      )}
    </div>
  );
}

function KeywordRow({ row, rank, checked, expanded, saveable, onToggle, onExpand, onSave }: { row: KeywordResearchRow; rank: number; checked: boolean; expanded: boolean; saveable: boolean; onToggle: () => void; onExpand: () => void; onSave: () => void }) {
  const competitionTone = row.competition === "low" ? "bg-emerald-50 text-emerald-700" : row.competition === "medium" ? "bg-amber-50 text-amber-700" : row.competition === "high" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500";
  const qualityTone = row.quality === "최적" ? "bg-violet-50 text-violet-700" : row.quality === "추천" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500";
  return (
    <>
      <tr className={expanded ? "bg-blue-50/40" : "hover:bg-slate-50/80"}>
        <td className="px-4 py-3"><input type="checkbox" aria-label={`${row.keyword} 선택`} checked={checked} onChange={onToggle} disabled={!saveable} /></td>
        <td className="px-2 py-3 font-black text-slate-400">{rank}</td>
        <td className="px-3 py-3"><button type="button" onClick={onExpand} className="text-left font-black text-slate-950 hover:text-blue-700">{row.keyword}</button><p className="mt-1 text-[11px] text-slate-400">관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)}</p></td>
        <td className="px-3 py-3 text-right font-black text-slate-900">{formatNumber(row.totalSearch)}</td>
        <td className="px-3 py-3 text-right text-xs text-slate-500">{formatNumber(row.pcSearch)} / {formatNumber(row.mobileSearch)}</td>
        <td className="px-3 py-3 text-right font-bold text-slate-700">{formatNumber(row.productCount)}</td>
        <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${competitionTone}`}>{row.competitionLabel}</span></td>
        <td className="px-3 py-3 text-right"><span className="text-lg font-black text-blue-700">{row.opportunityScore}</span></td>
        <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${qualityTone}`}>{row.quality}</span></td>
        <td className="px-4 py-3 text-right"><button type="button" onClick={onSave} disabled={!saveable} title={saveable ? "소싱 후보에 저장" : "경쟁 낮음 + 엔진 통과 후보만 저장 가능"} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-300">후보 저장</button></td>
      </tr>
      {expanded ? (
        <tr className="bg-blue-50/40">
          <td colSpan={10} className="px-5 pb-5 pt-1">
            <div className="grid gap-3 rounded-xl border border-blue-100 bg-white p-4 lg:grid-cols-[1.4fr_1fr_auto]">
              <div><p className="text-[11px] font-bold text-slate-400">엔진 판정 근거</p><p className="mt-1 text-xs leading-5 text-slate-700">{row.rationale}</p><div className="mt-2 flex flex-wrap gap-1.5">{row.sourceTags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{tag}</span>)}</div></div>
              <dl className="grid grid-cols-2 gap-3 text-xs"><Metric label="수요점수" value={row.demandScore.toFixed(1)} /><Metric label="경쟁기회" value={row.competitionOpportunity.toFixed(1)} /><Metric label="월 클릭" value={formatNumber(row.monthlyClicks)} /><Metric label="평균 CTR" value={row.clickThroughRate === null ? "미확인" : `${row.clickThroughRate}%`} /></dl>
              <div className="flex flex-wrap content-start gap-2"><Link href={`/sourcing-engine/market-snapshot?keyword=${encodeURIComponent(row.keyword)}`} className="rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-black text-white">시장 스냅샷</Link><Link href={`/sourcing-engine?keyword=${encodeURIComponent(row.keyword)}`} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-black text-blue-700">1688 준비</Link></div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatCard({ label, value, detail, tone = "slate" }: { label: string; value: string; detail: string; tone?: "slate" | "emerald" | "blue" | "violet" }) {
  const tones = { slate: "text-slate-950", emerald: "text-emerald-700", blue: "text-blue-700", violet: "text-violet-700" };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className={`mt-1 text-2xl font-black ${tones[tone]}`}>{value}</p><p className="mt-1 truncate text-[11px] text-slate-400">{detail}</p></div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] font-bold text-slate-400">{label}</dt><dd className="mt-0.5 font-black text-slate-800">{value}</dd></div>;
}

function formatNumber(value: number | null) {
  return value === null ? "미확인" : numberFormatter.format(value);
}
