"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReceiptSeoResult } from "@/lib/receiptSeoPortfolio";
import {
  advanceReceiptSeo,
  fetchReceiptSeo,
  hasReceiptSeoIntent,
} from "@/lib/receiptSeoClient";

export function ReceiptSeoPanel({ draftId }: { draftId: string }) {
  const [rows, setRows] = useState<ReceiptSeoResult[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(
    async (start = false) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        const current = await fetchReceiptSeo(draftId);
        if (!mounted.current) return;
        setRows(current);
        if (start || hasReceiptSeoIntent(draftId)) {
          const result = await advanceReceiptSeo(draftId, current, start);
          if (mounted.current) setMessage(result);
        } else setMessage("");
      } catch (e) {
        if (mounted.current)
          setMessage(
            e instanceof Error ? e.message : "입고 SEO 원장 확인 필요",
          );
      } finally {
        running.current = false;
        if (mounted.current) {
          setBusy(false);
          setPending(hasReceiptSeoIntent(draftId));
        }
      }
    },
    [draftId],
  );
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      void refresh();
    };
    const timer = window.setTimeout(check, 0);
    window.addEventListener("focus", check);
    window.addEventListener("commerce-receipt-step-changed", check);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("commerce-receipt-step-changed", check);
    };
  }, [refresh]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [pending, refresh]);
  const ready = new Set(
    rows
      .filter((r) => ["NEW", "READY", "RESUME"].includes(r.state))
      .map((r) => r.itemId),
  ).size;
  const labels = {
    HOLD: "보류",
    NEW: "등록 가능",
    READY: "SEO 준비 완료",
    RESUME: "마켓전송 재개 가능",
    ACTIVE: "처리 중",
    DONE: "등록 확인",
  };
  return (
    <section
      aria-label="입고건 SEO 대량등록·물갈이"
      className="mt-4 border-t border-slate-600 pt-3 text-xs text-slate-200"
    >
      <h4 className="text-sm font-bold text-white">
        ③ 입고건 SEO 대량등록·물갈이
      </h4>
      <p className="my-2">
        {rows.length
          ? `물갈이 대상 B코드 ${rows.length}개 · 등록 가능 상품 ${ready}개 · 보류 B코드 ${rows.filter((r) => r.state === "HOLD").length}개`
          : busy
            ? "입고 원장 확인 중"
            : message
              ? ""
              : "입고확정 후 대상 B코드가 여기에 표시됩니다."}
      </p>
      {!!rows.length && (
        <details className="mb-3">
          <summary className="cursor-pointer">
            B코드별 등록 결과와 물갈이 이력
          </summary>
          <ul className="mt-2 space-y-2">
            {rows.map((r) => (
              <li key={r.barcode}>
                <b>{r.barcode}</b> · 입고 {r.quantity}개 · {labels[r.state]}
                <br />
                {r.reason}
                <br />
                {r.rotation}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || (!ready && !pending)}
          className="rounded bg-cyan-300 px-3 py-2 font-bold text-slate-950 disabled:opacity-40"
          onClick={() => void refresh(true)}
        >
          {pending ? "기존 등록 작업 이어가기" : "입고건 SEO 대량등록"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-slate-500 px-3 py-2"
          onClick={() => void refresh()}
        >
          결과 새로고침
        </button>
      </div>
      {!!message && (
        <p aria-live="polite" className="mt-2">
          {message}
        </p>
      )}
    </section>
  );
}
