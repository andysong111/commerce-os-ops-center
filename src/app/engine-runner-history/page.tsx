"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { readEngineRunnerHistory, type EngineRunnerHistoryItem } from "@/lib/engineRunnerHistory";
import type { EngineRunnerKind } from "@/lib/engineRunnerTypes";

type Filter = "all" | EngineRunnerKind;

const filters: { label: string; value: Filter }[] = [
  { label: "전체", value: "all" },
  { label: "키워드 엔진", value: "keyword_engine" },
  { label: "상세페이지 엔진", value: "detail_page_engine" },
];
const typeLabels = { dispatch_requested: "실행 요청", artifact_imported: "결과물 가져오기" } as const;
const statusLabels = { requested: "요청됨", imported: "가져오기 완료", failed: "실패" } as const;

export default function EngineRunnerHistoryPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<EngineRunnerHistoryItem[]>([]);

  useEffect(() => {
    const load = () => setItems(readEngineRunnerHistory());
    load();
    window.addEventListener("engine-runner-history-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("engine-runner-history-updated", load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const visibleItems = useMemo(() => filter === "all" ? items : items.filter((item) => item.kind === filter), [filter, items]);

  return (
    <>
      <PageHeader title="엔진 실행 이력" description="키워드/상세페이지 엔진 실행 요청과 결과물 가져오기 이력을 확인합니다." />
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
        이 이력은 OPS CENTER 브라우저에 임시 저장됩니다. 샵플링 자동 반영이나 상세페이지 자동 게시 이력이 아닙니다. 현재 이력은 이 브라우저에 저장됩니다.
      </section>
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {filters.map((option) => (
            <button key={option.value} type="button" onClick={() => setFilter(option.value)} className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === option.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>{option.label}</button>
          ))}
        </div>
        {visibleItems.length === 0 ? <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">아직 엔진 실행 이력이 없습니다. 키워드 엔진 실행기 또는 상세페이지 엔진 실행기에서 작업을 시작해 주세요.</p> : null}
        <div className="mt-5 space-y-4">
          {visibleItems.map((item) => <HistoryCard key={item.id} item={item} />)}
        </div>
      </section>
    </>
  );
}

function HistoryCard({ item }: { item: EngineRunnerHistoryItem }) {
  return (
    <article className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{typeLabels[item.type]}</span>
          <h2 className="mt-2 font-semibold text-slate-950">{item.title}</h2>
          <p className="mt-1">{item.summary}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{item.status ? statusLabels[item.status] : "기록됨"}</span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div><dt className="font-semibold">시간</dt><dd>{new Date(item.createdAt).toLocaleString("ko-KR")}</dd></div>
        {item.input.goodsKey ? <div><dt className="font-semibold">goods_key</dt><dd>{item.input.goodsKey}</dd></div> : null}
        {item.input.sourceLink ? <div><dt className="font-semibold">source_link</dt><dd className="break-all">{item.input.sourceLink}</dd></div> : null}
        {item.input.productCode ? <div><dt className="font-semibold">product_code</dt><dd>{item.input.productCode}</dd></div> : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-3">
        {item.github?.actionsUrl ? <Link href={item.github.actionsUrl} className="font-semibold text-blue-700 underline">Actions log link</Link> : null}
        {item.reviewRoute ? <Link href={item.reviewRoute} className="font-semibold text-blue-700 underline">review page link</Link> : null}
      </div>
    </article>
  );
}
