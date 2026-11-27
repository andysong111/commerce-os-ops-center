"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ForwarderInvoice } from "@/lib/internalChinaForwarderInvoice";

export function ForwarderInvoiceEntry({ draftId, cycleMonth, evidenceHash, invoice }: {
  draftId: string; cycleMonth: string; evidenceHash: string; invoice: ForwarderInvoice | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(invoice?.amountKrw ?? ""));
  const [saved, setSaved] = useState(invoice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amount = Number(value);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/china-order-manager/forwarder-invoice", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId, cycleMonth, evidenceHash, amountKrw: amount, previousRevision: saved?.revision ?? null }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || result.invoice?.amountKrw !== amount) throw new Error(result.message || "저장 여부를 확인하세요.");
      setSaved(result.invoice);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장 여부를 확인하세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-900">
      <label htmlFor="forwarder-invoice-amount" className="font-bold">온돌패스 최종 청구 총액 (원)</label>
      <p className="my-2 text-xs text-slate-600">국제운송·관부가세·작업비 등 온돌패스가 청구한 금액을 입력하세요.</p>
      <div className="flex flex-wrap gap-2">
        <input id="forwarder-invoice-amount" required type="number" min={1} max={1_000_000_000} step={1}
          value={value} onChange={event => setValue(event.target.value)} disabled={saving}
          className="w-36 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2" />
        <button disabled={saving || !value || amount === saved?.amountKrw}
          className="rounded-lg bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">
          {saving ? "저장 중…" : "청구액 저장"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-rose-700">{error}</p> : null}
      {saved ? <p role="status" className="mt-2 text-emerald-800">저장된 청구액 {saved.amountKrw.toLocaleString("ko-KR")}원</p> : null}
    </form>
  );
}
