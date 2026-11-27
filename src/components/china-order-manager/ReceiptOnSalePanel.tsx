"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { holdDetachedReceipt, readInboundOnSale, runInboundReceiptOnSaleSync, watchReceiptOnSaleRecovery } from "@/lib/inboundReceiptOnSaleSync";
import type { ReceiptOnSaleRow } from "@/lib/receiptOnSaleCore";

const labels = { ACCEPTED: "접수 완료", HELD: "보류", STARTED: "결과 대기", PENDING: "전송 대기" } as const;

export function ReceiptOnSalePanel({ draftId }: { draftId: string }) {
  const [rows, setRows] = useState<ReceiptOnSaleRow[] | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    return () => abort.abort();
  }, [draftId]);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    try {
      const data = await readInboundOnSale(draftId);
      if (seq === generation.current && !controller.current?.signal.aborted) setRows(data);
    } catch (e) {
      if (seq === generation.current && !controller.current?.signal.aborted) { setRows(null); setNotice(e instanceof Error ? e.message : "전송 원장 조회 실패"); }
    }
  }, [draftId]);
  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (!rows || busy) return;
    const off = watchReceiptOnSaleRecovery(draftId, rows, refresh, setNotice);
    const timer = rows.some(r => r.state === "STARTED") ? window.setInterval(refresh, 15000) : undefined;
    return () => { off(); window.clearInterval(timer); };
  }, [draftId, rows, busy, refresh]);
  async function hold(row: ReceiptOnSaleRow) {
    setBusy(true);
    try { await holdDetachedReceipt(draftId, row); }
    catch (e) { setNotice(e instanceof Error ? e.message : "확장 작업 확인 필요"); }
    finally { await refresh(); setBusy(false); }
  }
  async function run() {
    if (running.current) return;
    running.current = true; setBusy(true);
    try {
      const result = await runInboundReceiptOnSaleSync(draftId, setNotice, undefined, controller.current?.signal);
      setRows(result.rows); setNotice(result.message);
    } catch (e) { setNotice(e instanceof Error ? e.message : "전송 확인 필요"); }
    finally { await refresh(); running.current = false; setBusy(false); }
  }
  return <section aria-label="이번 차시 입고 B코드 판매중 전송" className="mt-4 border-t border-slate-600 pt-3 text-xs text-slate-200">
    <h4 className="text-sm font-bold text-white">입고 B코드 판매중 전송</h4>
    {rows && (rows.length ? <p className="my-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(k => labels[k] + " " + rows.filter(r => r.state === k).length + "건").join(" · ")}</p> : <p className="my-2">이번 차시에 확정된 입고 B코드가 없습니다.</p>)}
    {!!rows?.length && <details className="my-2"><summary className="cursor-pointer">B코드별 결과와 보류 사유</summary>
      <ul className="mt-2 space-y-2">{rows.map(r => <li key={r.jobId}><strong>{r.barcode}</strong> · 입고 {r.quantity}개 · {labels[r.state]}<br/>{r.message}{r.canHold && <button type="button" disabled={busy} className="ml-2 underline" onClick={() => void hold(r)}>접수 미확인으로 보류</button>}</li>)}</ul>
    </details>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded bg-cyan-300 px-3 py-2 font-bold text-slate-950 disabled:opacity-40" onClick={run}
        disabled={busy || !rows?.length || rows.some(r => r.state === "STARTED") || rows.every(r => r.state === "ACCEPTED")}>판매중 전송 이어가기</button>
      <button type="button" className="rounded border border-slate-500 px-3 py-2" disabled={busy} onClick={() => { setNotice(""); void refresh(); }}>결과 새로고침</button>
    </div>
    <p aria-live="polite" className="mt-2">{notice || (rows === null ? "입고 전송 원장 조회 중" : "")}</p>
  </section>;
}
