"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { statusLabels } from "@/lib/restockAlertCore";
export function ReceiptRestockAlerts({ draftId }: { draftId: string }) {
  const [info, setInfo] = useState("신청 내역 확인 중");
  useEffect(() => {
    const ctrl = new AbortController();
    async function read() {
      try {
        const res = await fetch(
          "/api/restock-alerts?summary=1&draft=" + encodeURIComponent(draftId),
          { cache: "no-store", signal: ctrl.signal },
        );
        const result = await res.json();
        if (!res.ok) throw new Error();
        setInfo(
          result.counts
            .map(
              (r: { state: string; total: number }) =>
                statusLabels[r.state] + " " + r.total + "건",
            )
            .join(" · ") || "이번 차시 입고 상품에 연결된 신청이 없습니다.",
        );
      } catch {
        if (!ctrl.signal.aborted)
          setInfo("신청 현황은 운영 계정으로 입고알림 페이지에서 확인하세요.");
      }
    }
    void read();
    const interval = setInterval(() => {
      if (!document.hidden) void read();
    }, 60000);
    return () => {
      ctrl.abort();
      clearInterval(interval);
    };
  }, [draftId]);
  return (
    <div className="mt-3 rounded-lg border border-slate-600 p-3 text-sm">
      <p className="font-bold">고객 입고알림 문자</p>
      <p className="mt-1">{info}</p>
      <Link
        className="mt-2 inline-block underline"
        href={"/restock-alerts?draft=" + encodeURIComponent(draftId)}
      >
        입고알림 신청·발송 내역
      </Link>
    </div>
  );
}
