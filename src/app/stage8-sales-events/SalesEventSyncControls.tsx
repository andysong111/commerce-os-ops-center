"use client";

import { useRef, useState } from "react";
import { canRefreshSalesEventCandidate, SALES_EVENT_REFRESH_CONFIRMATION } from "@/lib/salesEventRefreshPolicy";

type Props = {
  state: string;
  requestId: string | null;
  planFingerprint: string | null;
};

export function SalesEventSyncControls({ state, requestId, planFingerprint }: Props) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: string) {
    if (inFlight.current) return;
    if (action === "refresh" && !window.confirm("기존 후보와 검증 기록은 보존하고 현재 시점으로 새 후보를 수집합니다. 원장 반영·발주·결제는 실행하지 않습니다. 계속할까요?")) return;
    if (action === "canary" && !window.confirm("Product Master 판매 이벤트 원장에 1건 카나리 적재합니다. 계속할까요?")) return;
    if (action === "full" && !window.confirm("카나리 검증된 같은 계획으로 최근 360일 판매 이벤트를 전수 적재합니다. 계속할까요?")) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = { action };
      if (action === "refresh") {
        body.expectedRequestId = requestId;
        body.expectedPlanFingerprint = planFingerprint;
        body.confirmation = SALES_EVENT_REFRESH_CONFIRMATION;
      }
      if (action === "canary" || action === "full") {
        body.planFingerprint = planFingerprint;
        body.confirmation = action === "canary" ? "CANARY" : "FULL";
      }
      const response = await fetch("/api/product-master/shopling-sales-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || payload.code || `HTTP ${response.status}`);
      }
      setMessage(payload.message || payload.result?.message || "완료했습니다.");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "실행 실패");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRefreshSalesEventCandidate(state) && requestId && planFingerprint ? (
        <button disabled={busy} onClick={() => act("refresh")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50">
          최신 판매 후보 다시 수집
        </button>
      ) : null}
      {state === "IDLE" || state === "FAILED" ? (
        <button disabled={busy} onClick={() => act("start")} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          360일 수집 시작
        </button>
      ) : null}
      {state === "QUEUED" || state === "RUNNING" ? (
        <button disabled={busy} onClick={() => act("run-next")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50">
          다음 구간 1회 처리
        </button>
      ) : null}
      {state === "READY_CANARY" && planFingerprint ? (
        <button disabled={busy} onClick={() => act("canary")} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          1건 카나리 적재
        </button>
      ) : null}
      {state === "READY_FULL" && planFingerprint ? (
        <button disabled={busy} onClick={() => act("full")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          검증된 전수 적재
        </button>
      ) : null}
      {message ? <span role="status" className="text-sm font-semibold text-slate-600">{message}</span> : null}
    </div>
  );
}
