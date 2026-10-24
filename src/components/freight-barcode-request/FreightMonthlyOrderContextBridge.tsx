"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  persistFreightMonthlyOrderContext,
  type FreightMonthlyOrderContext,
} from "@/lib/freightMonthlyOrderContext";

export function FreightMonthlyOrderContextBridge({
  context,
}: {
  context: FreightMonthlyOrderContext;
}) {
  const router = useRouter();

  useEffect(() => {
    persistFreightMonthlyOrderContext({ ...context, savedAt: Date.now() });
    router.replace(
      `/freight-barcode-request?month=${encodeURIComponent(context.cycleMonth)}&source=purchase-run`,
    );
  }, [context, router]);

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
      <strong>선택한 발주차시를 배대지 바코드 출력기로 전달 중입니다.</strong>
      <p className="mt-1">
        {context.lineCount.toLocaleString("ko-KR")}개 주문 품목의 주문번호·B-code·모델·옵션 정보를 연결합니다.
      </p>
    </section>
  );
}
