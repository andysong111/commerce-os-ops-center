"use client";

import { useEffect, useState } from "react";
import type { RecommendationCard } from "@/lib/sourcingEngine";
import { SOURCING_CARD_STORAGE_KEY } from "@/lib/sourcingCardStorage";

const krwFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

export function SourcingCardsClient() {
  const [cards, setCards] = useState<RecommendationCard[]>([]);
  const [source, setSource] = useState<"Server" | "Local fallback">("Local fallback");

  useEffect(() => {
    async function loadCards() {
      try {
        const response = await fetch("/api/sourcing/cards", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { cards?: RecommendationCard[] };
        if (response.ok && Array.isArray(payload.cards)) {
          setCards(payload.cards);
          setSource("Server");
          return;
        }
      } catch {
        // Fall back to localStorage below.
      }

      try {
        const stored = window.localStorage.getItem(SOURCING_CARD_STORAGE_KEY);
        setCards(stored ? (JSON.parse(stored) as RecommendationCard[]) : []);
      } catch {
        setCards([]);
      }
      setSource("Local fallback");
    }
    loadCards();
  }, []);

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(cards, null, 2));
  }

  if (cards.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <span className="mb-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Source: {source}</span>
        <p className="text-sm font-semibold text-slate-700">저장된 카드가 없습니다.</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          다음 단계에서 카드 생성 화면의 저장 버튼과 연결됩니다.
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Source: {source}</span>
        <button
          type="button"
          onClick={copyJson}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          JSON 복사
        </button>
      </div>
      <section className="space-y-3">
        {cards.map((card) => (
          <article key={card.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                {card.decisionLabel}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {card.modeLabel}
              </span>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                위험 {card.riskLevel}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-950">{card.koreanProductName}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{card.shortDescription}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Metric label="총비용" value={formatKrw(card.estimatedTotalTestCostKrw)} />
              <Metric label="개당원가" value={formatKrw(card.estimatedUnitCostKrw)} />
              <Metric label="판매가" value={formatKrw(card.targetPriceKrw)} />
              <Metric label="마진율" value={`${percentFormatter.format(card.estimatedMarginRate * 100)}%`} />
            </div>
            {card.primary?.candidate.url ? (
              <a
                href={card.primary.candidate.url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                1688 열기
              </a>
            ) : null}
          </article>
        ))}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-950">{value}</p>
    </div>
  );
}

function formatKrw(value: number) {
  return `${krwFormatter.format(Math.max(0, Math.round(value)))}원`;
}
