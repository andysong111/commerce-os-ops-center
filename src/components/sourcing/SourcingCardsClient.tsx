"use client";

import { useEffect, useState } from "react";
import { deleteCardFromLocalStorage, removeCardById, type SourcingHistoryCard } from "@/lib/sourcingCardsHistory";
import { SOURCING_CARD_STORAGE_KEY } from "@/lib/sourcingCardStorage";

const krwFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

export function SourcingCardsClient() {
  const [cards, setCards] = useState<SourcingHistoryCard[]>([]);
  const [source, setSource] = useState<"Server" | "Local fallback">("Local fallback");
  const [status, setStatus] = useState("Loading cards...");
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCards() {
      const localCards = readLocalCards();
      try {
        const response = await fetch("/api/sourcing/cards");
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean; cards?: SourcingHistoryCard[]; code?: string; message?: string };
        if (!cancelled && response.ok && Array.isArray(body.cards)) {
          setCards(body.cards);
          setSource("Server");
          setStatus(`Loaded ${body.cards.length} server cards.`);
          return;
        }
        if (!cancelled) {
          setCards(localCards);
          setSource("Local fallback");
          setStatus(body.code === "AUTH_REQUIRED" ? "Sign in to load server cards. Showing local fallback." : `Server cards unavailable. Showing local fallback.${body.message ? ` ${body.message}` : ""}`);
        }
      } catch {
        if (!cancelled) {
          setCards(localCards);
          setSource("Local fallback");
          setStatus("Server cards unavailable. Showing local fallback.");
        }
      }
    }
    loadCards();
    return () => { cancelled = true; };
  }, []);

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(cards, null, 2));
  }

  async function deleteCard(card: SourcingHistoryCard) {
    setDeletingCardId(card.id);
    try {
      if (source === "Local fallback") {
        deleteCardFromLocalStorage(card.id);
        setCards((current) => removeCardById(current, card.id));
        setStatus("로컬 카드 삭제 완료");
        return;
      }

      if (!card.serverId) {
        throw new Error("서버 카드 ID가 없습니다.");
      }

      const response = await fetch(`/api/sourcing/cards?id=${encodeURIComponent(card.serverId)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? `HTTP ${response.status}`);
      }

      setCards((current) => removeCardById(current, card.id));
      setStatus("서버 카드 삭제 완료");
    } catch (error) {
      setStatus(`삭제 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally {
      setDeletingCardId(null);
    }
  }

  if (cards.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="mb-3 text-xs font-semibold text-slate-500">Source: {source} · {status}</p>
        <p className="text-sm font-semibold text-slate-700">저장된 카드가 없습니다.</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          다음 단계에서 카드 생성 화면의 저장 버튼과 연결됩니다.
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-600">Source: {source} · {status}</p>
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                {card.decisionLabel}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {card.modeLabel}
              </span>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                위험 {card.riskLevel}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {source === "Server" && card.serverId ? "서버 저장" : "로컬 저장"}
              </span>
              <button
                type="button"
                onClick={() => deleteCard(card)}
                disabled={deletingCardId === card.id}
                className="ml-auto rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingCardId === card.id ? "삭제 중..." : "삭제"}
              </button>
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


function readLocalCards(): SourcingHistoryCard[] {
  try {
    const stored = window.localStorage.getItem(SOURCING_CARD_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SourcingHistoryCard[]) : [];
  } catch {
    return [];
  }
}
