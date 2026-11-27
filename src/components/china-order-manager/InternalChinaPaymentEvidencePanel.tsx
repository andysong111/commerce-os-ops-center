"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function InternalChinaPaymentEvidencePanel({
  draftId, orderCount,
}: {
  draftId: string;
  orderCount: number;
}) {
  const router = useRouter();
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

  return (
    <section id="purchase-run-payment-check" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-slate-900">
      <h3 className="font-black">1688 결제 대조</h3>
      <p className="mt-2">주문 {orderCount}건의 결제·환불 증빙은 업무센터 5-5에서 확인합니다.</p>
      <a
        href={workCenterUrl}
        onClick={() => { openedWorkCenter.current = true; }}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-block text-sm font-bold text-blue-800 underline"
      >
        업무센터 발주·입고 열기
      </a>
    </section>
  );
}
