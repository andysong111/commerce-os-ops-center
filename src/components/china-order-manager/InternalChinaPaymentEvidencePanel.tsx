"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { worldFirstFeeLabel } from "@/lib/productDecisionEngine/purchaseCostPolicy";

export function InternalChinaPaymentEvidencePanel({
  draftId, barcodeEvidenceHash, goodsEstimateCny, orderCount, orderTemplate,
}: {
  draftId: string;
  barcodeEvidenceHash: string;
  goodsEstimateCny: number | null;
  orderCount: number;
  orderTemplate: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(orderTemplate);
  const [grandTotalCny, setGrandTotalCny] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !window.confirm("입력한 1688 결제 자료를 이 발주차시에 확정할까요?")) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/payment-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, barcodeEvidenceHash, rows, grandTotalCny }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message);
      setNotice("1688 결제 자료를 저장하고 다시 조회했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "실결제 자료 저장 상태를 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-slate-900">
      <h3 className="font-black">1688 실결제 원본 확인</h3>
      <p className="mt-2 leading-6">
        바코드 원본 주문번호 {orderCount.toLocaleString("ko-KR")}건의 결제 자료를 넣으면 입고 원가와 예산에 반영합니다.
        {goodsEstimateCny === null ? null : ` 온돌패스 단가 기준 상품 참고액은 ${goodsEstimateCny.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}위안입니다.`}
      </p>
      <p className="mt-1 text-xs text-slate-700">{worldFirstFeeLabel()} · 1688 실결제 원화 환산액 기준</p>
      <details className="mt-3">
        <summary className="cursor-pointer font-bold text-blue-800">실결제 자료 등록</summary>
        <form onSubmit={save} className="mt-3 space-y-3">
          <label className="block">
            바코드 원본에서 불러온 주문번호·B-code·수량 뒤에 상품대금·중국내운임·1688 서비스비를 입력하세요 (위안).
            <textarea required maxLength={100_000} value={rows} onChange={event => setRows(event.target.value)}
              placeholder="123456789012345678,BBA1-1,20,100.00,3.00,0.20"
              className="mt-1 block min-h-24 w-full rounded-lg border border-amber-300 bg-white p-2 font-mono text-xs" />
          </label>
          <p className="text-xs">운임과 서비스비가 없으면 0을 적어주세요. 같은 주문번호의 같은 B-code는 한 줄로 합칩니다.</p>
          <label className="block">
            영수증 기준 1688 총액 (위안)
            <input required inputMode="decimal" maxLength={12} value={grandTotalCny} onChange={event => setGrandTotalCny(event.target.value)}
              className="ml-2 rounded-lg border border-amber-300 bg-white p-2" />
          </label>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">
            {saving ? "대조 중…" : "대조 후 저장"}
          </button>
          {notice ? <p role="status" className="font-semibold">{notice}</p> : null}
        </form>
      </details>
    </section>
  );
}
