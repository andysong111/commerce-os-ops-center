"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { parseCandidateImportText } from "@/lib/sourcingCandidateImport";
import { getServerFallbackMessage, saveCardWithServerFallback, saveFeedbackToLocalStorage } from "@/lib/sourcingClientStorage";
import {
  buildRecommendationCard,
  generateChineseSearchTerms,
  type HumanOrderDecision,
  type RecommendationCard,
  type SourcingCostSettings,
  type SourcingFeedback,
  type SourcingInput,
} from "@/lib/sourcingEngine";

const DEFAULT_INPUT: SourcingInput = {
  mode: "FOLLOW_PROVEN",
  koreanQuery: "",
  competitorUrl: "",
  targetPriceKrw: 9900,
  testBudgetKrw: 200000,
  forbiddenCategories: [
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
  ],
};

const DEFAULT_SETTINGS: SourcingCostSettings = {
  exchangeRateKrwPerCny: 190,
  testQuantity: 60,
  internationalShippingFeeKrw: 45000,
  agentFeeRate: 5,
};

const krwFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

export default function SourcingEngineCockpitPage() {
  const [rawText, setRawText] = useState("");
  const [input, setInput] = useState<SourcingInput>(DEFAULT_INPUT);
  const [settings, setSettings] = useState<SourcingCostSettings>(DEFAULT_SETTINGS);
  const [card, setCard] = useState<RecommendationCard | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusByCard, setStatusByCard] = useState<Record<string, HumanOrderDecision>>({});

  const searchTerms = useMemo(() => generateChineseSearchTerms(input.koreanQuery), [input.koreanQuery]);

  async function createCard() {
    setIsLoading(true);
    setMessage("");
    try {
      const parsed = parseCandidateImportText(rawText);
      if (parsed.candidates.length === 0) {
        setCard(null);
        setMessage(parsed.warnings.join(" / ") || "1688 후보 링크를 찾지 못했습니다.");
        return;
      }

      const firstCandidate = parsed.candidates[0];
      const nextInput = {
        ...input,
        koreanQuery: input.koreanQuery.trim() || firstCandidate.titleKr || firstCandidate.titleCn || "붙여넣은 소싱 후보",
      };
      setInput(nextInput);

      const nextCard = buildRecommendationCard({ input: nextInput, settings, candidates: parsed.candidates });
      setCard(nextCard);
      const result = await saveCardWithServerFallback(nextCard);
      const warningText = parsed.warnings.length ? ` 파싱 참고: ${parsed.warnings.join(" / ")}` : "";
      setMessage(`${getServerFallbackMessage(result.server)} Saved cards: ${result.localCards.length}.${warningText}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveStatus(humanOrderDecision: HumanOrderDecision) {
    if (!card) return;
    const feedback: SourcingFeedback = {
      cardId: card.id,
      mode: card.mode,
      categoryHint: card.koreanProductName,
      humanOrderDecision,
      salesResult: "UNKNOWN",
      reordered: false,
      failureReasons: [],
      memo: "One-button cockpit quick status",
      createdAt: new Date().toISOString(),
    };
    saveFeedbackToLocalStorage(feedback);
    setStatusByCard((current) => ({ ...current, [card.id]: humanOrderDecision }));

    try {
      const response = await fetch("/api/sourcing/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(feedback),
      });
      setMessage(response.ok ? "상태를 서버와 로컬에 저장했습니다." : "상태를 로컬에 저장했습니다. 서버 저장은 건너뛰었습니다.");
    } catch {
      setMessage("상태를 로컬에 저장했습니다. 네트워크 연결 시 서버 저장을 다시 시도하세요.");
    }
  }

  return (
    <>
      <PageHeader
        title="1688 소싱엔진"
        description="상품 텍스트, 경쟁 URL, 1688 후보 링크를 붙여넣고 한 번에 주문추천 카드를 만듭니다."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">One-button cockpit</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">붙여넣고 바로 판단</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">FOLLOW_PROVEN</span>
          </div>

          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={18}
            placeholder={`상품 설명, 경쟁 URL, 1688 링크를 그대로 붙여넣으세요.\n\n예)\n경쟁상품: https://smartstore.naver.com/...\n타깃 키워드: 차량용 틈새 수납함\nhttps://detail.1688.com/offer/100.html\nprice: 8.6\nmoq: 2\nshipping: 10`}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />

          <button
            type="button"
            onClick={createCard}
            disabled={isLoading || rawText.trim().length === 0}
            className="mt-4 w-full rounded-2xl bg-blue-600 px-5 py-4 text-base font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isLoading ? "카드 생성 및 저장 중..." : "주문추천 카드 만들기"}
          </button>

          <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-700">고급 설정</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="상품/키워드" value={input.koreanQuery} onChange={(value) => setInput((current) => ({ ...current, koreanQuery: value }))} />
              <Field label="경쟁 URL" value={input.competitorUrl} onChange={(value) => setInput((current) => ({ ...current, competitorUrl: value }))} />
              <Field label="목표 판매가" type="number" value={String(input.targetPriceKrw)} onChange={(value) => setInput((current) => ({ ...current, targetPriceKrw: Number(value || 0) }))} />
              <Field label="테스트 예산" type="number" value={String(input.testBudgetKrw)} onChange={(value) => setInput((current) => ({ ...current, testBudgetKrw: Number(value || 0) }))} />
              <Field label="환율(CNY→KRW)" type="number" value={String(settings.exchangeRateKrwPerCny)} onChange={(value) => setSettings((current) => ({ ...current, exchangeRateKrwPerCny: Number(value || 0) }))} />
              <Field label="테스트 수량" type="number" value={String(settings.testQuantity)} onChange={(value) => setSettings((current) => ({ ...current, testQuantity: Number(value || 0) }))} />
              <Field label="국제배송비" type="number" value={String(settings.internationalShippingFeeKrw)} onChange={(value) => setSettings((current) => ({ ...current, internationalShippingFeeKrw: Number(value || 0) }))} />
              <Field label="구매대행 수수료(%)" type="number" value={String(settings.agentFeeRate)} onChange={(value) => setSettings((current) => ({ ...current, agentFeeRate: Number(value || 0) }))} />
            </div>
          </details>
        </section>

        <section className="space-y-4">
          <ResultCard card={card} status={card ? statusByCard[card.id] : undefined} onStatus={saveStatus} />
          {message ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</p> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-950">검색어 힌트</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(searchTerms.length ? searchTerms : ["고급 설정에서 상품/키워드를 입력하면 1688 검색어가 표시됩니다."]).map((term) => (
                <span key={term} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{term}</span>
              ))}
            </div>
          </section>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-950">고급 도구</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ToolLink href="/sourcing-engine/importer">고급 파서</ToolLink>
          <ToolLink href="/sourcing-engine/market-snapshot">시장 스냅샷</ToolLink>
          <ToolLink href="/sourcing-engine/cards">카드 이력</ToolLink>
          <ToolLink href="/sourcing-engine/feedback">피드백 기록</ToolLink>
          <ToolLink href="/sourcing-engine/tools">전체 도구</ToolLink>
        </div>
      </section>
    </>
  );
}

function ResultCard({ card, status, onStatus }: { card: RecommendationCard | null; status?: HumanOrderDecision; onStatus: (status: HumanOrderDecision) => void }) {
  if (!card) {
    return <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">주문추천 카드가 여기에 표시됩니다.</section>;
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap gap-2">
        <Badge>{card.decisionLabel}</Badge>
        <Badge tone="red">Risk {card.riskLevel}</Badge>
        {status ? <Badge tone="slate">상태 저장됨: {status}</Badge> : null}
      </div>
      <h2 className="mt-4 text-2xl font-black text-slate-950">{card.koreanProductName}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{card.shortDescription}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="예상 총 테스트 원가" value={formatKrw(card.estimatedTotalTestCostKrw)} />
        <Metric label="예상 개당 원가" value={formatKrw(card.estimatedUnitCostKrw)} />
        <Metric label="예상 마진율" value={`${percentFormatter.format(card.estimatedMarginRate * 100)}%`} />
      </div>

      <LinkBlock title="1순위 1688 링크" url={card.primary?.candidate.url} />
      <div className="mt-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">백업 링크</h3>
        <div className="mt-2 space-y-2">
          {card.backups.length ? card.backups.map((backup, index) => <LinkBlock key={backup.candidate.id} title={`백업 ${index + 1}`} url={backup.candidate.url} compact />) : <p className="text-sm text-slate-500">백업 후보가 없습니다.</p>}
        </div>
      </div>

      <List title="리스크 노트" items={card.riskNotes} />
      <List title="공급처 질문" items={card.supplierQuestionsCn} />

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onStatus("ORDERED")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">주문함</button>
        <button type="button" onClick={() => onStatus("HOLD")} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600">보류</button>
        <button type="button" onClick={() => onStatus("REJECTED")} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-950">폐기</button>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: "text" | "number" }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-950">{value}</p></div>;
}

function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "red" | "slate" }) {
  const className = tone === "red" ? "bg-red-50 text-red-700" : tone === "slate" ? "bg-slate-100 text-slate-700" : "bg-blue-50 text-blue-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>{children}</span>;
}

function LinkBlock({ title, url, compact = false }: { title: string; url?: string; compact?: boolean }) {
  return <div className={compact ? "rounded-xl bg-slate-50 p-3" : "mt-5 rounded-2xl bg-blue-50 p-4"}><p className="text-xs font-bold text-slate-500">{title}</p>{url ? <a href={url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm font-bold text-blue-700 hover:underline">{url}</a> : <p className="mt-1 text-sm text-slate-500">추천 링크가 없습니다.</p>}</div>;
}

function List({ title, items }: { title: string; items: string[] }) {
  return <div className="mt-5"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700">{items.map((item) => <li key={item}>• {item}</li>)}</ul></div>;
}

function ToolLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">{children}</Link>;
}

function formatKrw(value: number) {
  return `${krwFormatter.format(Math.max(0, Math.round(value)))}원`;
}
