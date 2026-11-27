"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const openedWorkCenter = useRef(false);
  const workCenterUrl = `http://127.0.0.1:43121/?draftId=${encodeURIComponent(draftId)}&workspace=purchase`;

  useEffect(() => {
    openedWorkCenter.current = false;
    function refreshOnReturn() {
      if (openedWorkCenter.current && document.visibilityState === "visible") router.refresh();
    }
    window.addEventListener("focus", refreshOnReturn);
    return () => window.removeEventListener("focus", refreshOnReturn);
  }, [draftId, router]);

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
        주문 {orderCount.toLocaleString("ko-KR")}건의 1688 결제 자료를 저장하면 입고 수량을 입력할 수 있습니다.
      </p>
      <p className="mt-2 text-sm font-bold">
        업무센터에서 5-5번 업무를 실행해 이 차시의 실결제·환불 증빙을 확인해 주세요.
      </p>
      <a
        href={workCenterUrl}
        onClick={() => { openedWorkCenter.current = true; }}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-block text-sm font-bold text-blue-800 underline"
      >
        업무센터 발주·입고 열기
      </a>
      {goodsEstimateCny === null ? null : (
        <p className="mt-1 text-xs text-slate-700">
          온돌패스 상품 참고액 {goodsEstimateCny.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}위안
        </p>
      )}
      <p className="mt-1 text-xs text-slate-700">{worldFirstFeeLabel()} · 1688 실결제 원화 환산액 기준</p>
      <details className="mt-3">
        <summary className="cursor-pointer font-bold text-blue-800">실결제 자료 등록</summary>
        <form onSubmit={save} className="mt-3 space-y-3">
          <label className="block">
            주문번호·B-code·수량 뒤에 해당 수량의 상품대금·중국 내 운임·1688 서비스비를 위안으로 입력하세요.
            <textarea id="purchase-run-payment-evidence-rows" required maxLength={100_000} value={rows} onChange={event => setRows(event.target.value)}
              placeholder="123456789012345678,BBA1-1,20,100.00,3.00,0.20"
              className="mt-1 block min-h-24 w-full scroll-mt-20 rounded-lg border border-amber-300 bg-white p-2 font-mono text-xs" />
          </label>
          <p className="text-xs leading-5">
            운임과 서비스비가 없으면 0을 적어주세요. 같은 주문번호의 같은 B-code는 한 줄로 합치고, 주문 공통 비용은 중복 없이 반영하세요.
          </p>
          <label className="block">
            1688 실결제 합계 (위안)
            <input required inputMode="decimal" maxLength={12} value={grandTotalCny} onChange={event => setGrandTotalCny(event.target.value)}
              aria-describedby="purchase-run-payment-total-help"
              className="ml-2 rounded-lg border border-amber-300 bg-white p-2" />
          </label>
          <p id="purchase-run-payment-total-help" className="text-xs leading-5 text-slate-700">
            이 차시 주문의 1688 영수증에 표시된 실제 결제액을 모두 더해 입력하세요. 상품대금·중국 내 운임·1688 서비스비가 포함된 위안 금액입니다. 월드퍼스트 수수료와 배송대행비는 별도 항목입니다.
          </p>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">
            {saving ? "대조 중…" : "대조 후 저장"}
          </button>
          {notice ? <p role="status" className="font-semibold">{notice}</p> : null}
        </form>
      </details>
    </section>
  );
}
