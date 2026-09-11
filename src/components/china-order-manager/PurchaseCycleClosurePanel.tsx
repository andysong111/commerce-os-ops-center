"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PurchaseCycleClosureReport } from "@/lib/purchaseCycleClosureCore";

const links = {
  OPEN_WORKSPACE: "#purchase-cycle-workspace",
  OPEN_STOCK_CONTROL: "/china-order-manager/stock-control",
  OPEN_PRICE_REVIEW: "#purchase-cycle-workspace",
  OPEN_NEXT_CALCULATION: "/china-order-manager/cash-envelope",
} as const;
type View = { month: string; report: PurchaseCycleClosureReport | null; error: string };
export function PurchaseCycleClosurePanel({ refreshKey }: { refreshKey: number }) {
  const active = usePathname() === "/china-order-manager";
  const month = useSearchParams().get("month") || "";
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const current = view?.month === month ? view : null;
  const report = current?.report ?? null;
  const error = current?.error ?? "";

  const load = useCallback(async (signal: AbortSignal, generation: number) => {
    const response = await fetch(`/api/china-order-manager/cycle-status${month ? `?month=${encodeURIComponent(month)}` : ""}`, { cache: "no-store", signal });
    const body = await response.json() as { ok: boolean; report?: PurchaseCycleClosureReport; message?: string };
    if (!response.ok || !body.ok || !body.report || (month && body.report.cycleMonth !== month)) throw new Error(body.message || "발주사이클 원장을 확인하지 못했습니다.");
    if (!signal.aborted && generationRef.current === generation) setView({ month, report: body.report, error: "" });
  }, [month]);

  const recheck = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    busyRef.current = true; setBusy(true);
    try { await load(controller.signal, generation); }
    catch (cause) {
      if (!controller.signal.aborted && generationRef.current === generation) setView({ month, report: null, error: cause instanceof Error ? cause.message : "조회 실패" });
    } finally {
      if (generationRef.current === generation) { busyRef.current = false; setBusy(false); }
    }
  }, [load, month]);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) return recheck(); });
    return () => { mounted = false; ++generationRef.current; controllerRef.current?.abort(); busyRef.current = false; };
  }, [active, recheck, refreshKey]);

  async function act() {
    if (busyRef.current) return;
    // A failed/stale status read never replays the previous write action.
    if (error || !report || !["RETRY_RECEIPT_FOLLOWUP", "REFRESH_STOCK_EVIDENCE"].includes(report.nextAction)) return recheck();
    busyRef.current = true; setBusy(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    try {
      const receipt = report.nextAction === "RETRY_RECEIPT_FOLLOWUP";
      if (receipt && !report.receiptId) throw new Error("재시도할 입고번호를 다시 확인하세요.");
      const response = await fetch(receipt ? "/api/china-order-manager/receipts/followup" : "/api/china-order-manager/cycle-status", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(receipt ? { receiptId: report.receiptId } : { month: report.cycleMonth, action: "REFRESH_STOCK_EVIDENCE" }),
      });
      const body = await response.json() as { ok: boolean; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || "후속 확인을 완료하지 못했습니다. 입고수량은 다시 추가하지 않았습니다.");
      await load(controller.signal, generation);
    } catch (cause) {
      if (!controller.signal.aborted && generationRef.current === generation) setView({ month, report: null, error: cause instanceof Error ? cause.message : "후속 확인 실패" });
    } finally {
      if (generationRef.current === generation) { busyRef.current = false; setBusy(false); }
    }
  }
  if (!active) return null;
  const href = report && report.nextAction in links ? links[report.nextAction as keyof typeof links] : null;
  return (
    <section id="purchase-cycle-panel" aria-label="발주사이클 최종 확인" aria-busy={busy} className="mb-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-blue-700">{report?.cycleMonth || month || "이번 달"} · 발주사이클</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">{report?.state === "READY_FOR_NEXT_CALCULATION" ? "다음 발주계산 준비 완료" : report?.state === "NO_ORDER_CLOSED" ? "무발주 마감 확인" : "현재 단계와 다음 할 일"}</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{error ? "원장 확인을 완료하지 못했습니다. 이전 완료 표시는 현재 근거로 사용하지 마세요." : report?.message || "입고 원장·상품마스터·정확재고·판매상태를 확인하는 중입니다…"}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void recheck()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">상태 새로고침</button>
      </div>
      {report ? <>
        <div className="mt-4 grid gap-2 sm:grid-cols-4 xl:grid-cols-8">{report.stages.map((stage, index) => (
          <div key={stage.id} className={`rounded-xl border p-3 text-xs ${stage.state === "VERIFIED" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            <p className="font-black">{index + 1}. {stage.label}</p><p className="mt-1">{stage.state === "VERIFIED" ? "재조회 확인" : stage.state === "NOT_STARTED" ? "미실행" : "확인 필요"}</p>
          </div>
        ))}</div>
        <p className="mt-3 text-xs leading-5 text-slate-500">입고확정 {report.receivedQuantity.toLocaleString("ko-KR")}개 · 미입고 {report.openQuantity.toLocaleString("ko-KR")}개 · 상품마스터 검증 {report.verifiedReceiptCount}건 / 재확인 {report.pendingReceiptCount}건</p>
        <div className="mt-4">{href ? <Link prefetch={false} href={href} className="inline-block rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">{report.actionLabel}</Link> : <button type="button" disabled={busy} onClick={() => void act()} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy ? "확인 중…" : report.actionLabel}</button>}</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">입고 후속 재시도는 저장된 입고번호만 사용합니다. 수량을 재입력하거나 중복 입고하지 않습니다. 다음 발주계산도 실제 주문·결제와 별도입니다.</p>
        {report.warnings.length ? <details className="mt-3 text-xs text-amber-800"><summary className="cursor-pointer font-bold">확인 필요 사유</summary>{report.warnings.map((warning, i) => <p key={i} className="mt-1">{warning}</p>)}</details> : null}
      </> : null}
      {error ? <div className="mt-3"><p role="alert" className="text-sm font-bold text-rose-700">{error}</p><button type="button" disabled={busy} onClick={() => void recheck()} className="mt-2 rounded-xl border px-4 py-2 text-sm font-bold">다시 확인</button></div> : null}
    </section>
  );
}
