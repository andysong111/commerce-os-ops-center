"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { parseCandidateImportText } from "@/lib/sourcingCandidateImport";
import { getServerFallbackMessage, saveCardWithServerFallback } from "@/lib/sourcingClientStorage";
import {
  buildRecommendationCard,
  generateChineseSearchTerms,
  type RecommendationCard,
  type SourcingCandidate,
  type SourcingCostSettings,
  type SourcingInput,
} from "@/lib/sourcingEngine";

const sample = `https://detail.1688.com/offer/100.html
汽车缝隙收纳盒
price: 8.6
moq: 2
shipping: 10
option: black, gray
shop: A factory

https://detail.1688.com/offer/101.html
车载缝隙储物盒
price: 9.2
moq: 2
shipping: 10
option: black
shop: B factory

https://detail.1688.com/offer/102.html
汽车座椅缝隙收纳
price: 9.5
moq: 2
shipping: 10
option: gray
shop: C factory`;

const forbidden = [
  "어린이",
  "유아",
  "의료",
  "건강효능",
  "산업용 안전",
  "보호구",
  "유리",
  "도자기",
  "전기",
  "배터리",
  "충전",
  "발열",
  "화학",
  "식품",
  "화장품",
  "상표",
  "캐릭터",
];

const krwFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

export default function SourcingQuickSavePage() {
  const [input, setInput] = useState<SourcingInput>({
    mode: "FOLLOW_PROVEN",
    koreanQuery: "차량용 틈새 수납함",
    competitorUrl: "",
    targetPriceKrw: 9900,
    testBudgetKrw: 200000,
    forbiddenCategories: forbidden,
  });
  const [settings, setSettings] = useState<SourcingCostSettings>({
    exchangeRateKrwPerCny: 190,
    testQuantity: 60,
    internationalShippingFeeKrw: 45000,
    agentFeeRate: 5,
  });
  const [rawText, setRawText] = useState(sample);
  const [candidates, setCandidates] = useState<SourcingCandidate[]>([]);
  const [card, setCard] = useState<RecommendationCard | null>(null);
  const [message, setMessage] = useState("");
  const searchTerms = useMemo(() => generateChineseSearchTerms(input.koreanQuery), [input.koreanQuery]);

  function parse() {
    const result = parseCandidateImportText(rawText);
    setCandidates(result.candidates);
    setCard(null);
    setMessage(result.warnings.join(" / "));
  }

  function generate() {
    const nextCard = buildRecommendationCard({ input, settings, candidates });
    setCard(nextCard);
    setMessage("");
  }

  async function save() {
    if (!card) return;
    const result = await saveCardWithServerFallback(card);
    setMessage(`${getServerFallbackMessage(result.server)} Saved cards: ${result.localCards.length}`);
  }

  return (
    <>
      <PageHeader
        title="Sourcing Quick Save"
        description="Generate a 1688 recommendation card and save it into the card history list."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/sourcing-engine/cards" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Card history
            </Link>
            <button type="button" onClick={parse} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
              Parse
            </button>
            <button type="button" onClick={generate} disabled={candidates.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              Generate
            </button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="space-y-4">
          <Panel title="Input">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Keyword" value={input.koreanQuery} onChange={(value) => setInput((current) => ({ ...current, koreanQuery: value }))} />
              <Field label="Target price" type="number" value={String(input.targetPriceKrw)} onChange={(value) => setInput((current) => ({ ...current, targetPriceKrw: Number(value || 0) }))} />
              <Field label="Budget" type="number" value={String(input.testBudgetKrw)} onChange={(value) => setInput((current) => ({ ...current, testBudgetKrw: Number(value || 0) }))} />
              <Field label="Qty" type="number" value={String(settings.testQuantity)} onChange={(value) => setSettings((current) => ({ ...current, testQuantity: Number(value || 0) }))} />
              <Field label="CNY rate" type="number" value={String(settings.exchangeRateKrwPerCny)} onChange={(value) => setSettings((current) => ({ ...current, exchangeRateKrwPerCny: Number(value || 0) }))} />
              <Field label="Int shipping KRW" type="number" value={String(settings.internationalShippingFeeKrw)} onChange={(value) => setSettings((current) => ({ ...current, internationalShippingFeeKrw: Number(value || 0) }))} />
            </div>
          </Panel>
          <Panel title="Candidate text">
            <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} rows={18} className="w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-xs leading-5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </Panel>
        </section>

        <section className="space-y-4">
          <Panel title="1688 search terms">
            <div className="flex flex-wrap gap-2">
              {searchTerms.map((term) => (
                <span key={term} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{term}</span>
              ))}
            </div>
          </Panel>
          <Panel title={`Parsed candidates ${candidates.length}`}>
            <div className="space-y-2">
              {candidates.map((candidate, index) => (
                <div key={candidate.id} className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">{index + 1}. {candidate.titleKr || candidate.titleCn || "candidate"}</p>
                  <p className="truncate text-xs text-slate-500">{candidate.url}</p>
                  <p className="mt-1 text-xs">{candidate.unitPriceCny} CNY / MOQ {candidate.moq}</p>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Card">
            {card ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{card.decisionLabel}</span>
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">Risk {card.riskLevel}</span>
                </div>
                <h2 className="text-lg font-bold text-slate-950">{card.koreanProductName}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.shortDescription}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <Metric label="Total" value={formatKrw(card.estimatedTotalTestCostKrw)} />
                  <Metric label="Unit" value={formatKrw(card.estimatedUnitCostKrw)} />
                  <Metric label="Price" value={formatKrw(card.targetPriceKrw)} />
                  <Metric label="Margin" value={`${percentFormatter.format(card.estimatedMarginRate * 100)}%`} />
                </div>
                {card.primary ? (
                  <a href={card.primary.candidate.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Open 1688</a>
                ) : null}
                <button type="button" onClick={save} className="ml-2 mt-4 inline-flex rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">Save card</button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Parse candidates and generate a card.</p>
            )}
            {message ? <p className="mt-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
          </Panel>
        </section>
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-sm font-bold text-slate-950">{title}</h2>{children}</section>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: "text" | "number" }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-base font-bold text-slate-950">{value}</p></div>;
}

function formatKrw(value: number) {
  return `${krwFormatter.format(Math.max(0, Math.round(value)))}원`;
}
