"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PurchaseRunStartButton() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionHref, setActionHref] = useState("");

  const start = async () => {
    setStarting(true);
    setNotice("");
    setActionHref("");
    try {
      const response = await fetch("/api/china-order-manager/purchase-runs/start", {
        method: "POST",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        draftUrl?: string;
        actionHref?: string;
      };
      if (!response.ok || !payload.ok || !payload.draftUrl) {
        setNotice(payload.message || "발주차시를 시작하지 못했습니다.");
        setActionHref(payload.actionHref || "");
        return;
      }
      router.push(payload.draftUrl);
    } catch {
      setNotice("발주차시 시작 요청이 일시적으로 실패했습니다. 새 목록은 생성되지 않았습니다.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-wait disabled:bg-slate-400"
      >
        {starting ? "발주목록 계산 중..." : "이번 발주 시작하기"}
      </button>
      {notice ? (
        <p className="max-w-md text-right text-xs font-bold leading-5 text-amber-800">
          {notice}
          {actionHref ? (
            <a href={actionHref} className="ml-2 text-blue-700 underline">
              발주 사전점검 열기
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

