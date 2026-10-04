"use client";

import { useState } from "react";

type DraftResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  draft?: {
    draftId?: string;
    duplicate?: boolean;
    lineCount?: number;
    totalQuantity?: number;
  };
};

export function PurchaseCycleDraftActions({
  targetDate,
  targetCycleMonth,
  cashLimitKrw,
  sourcingBudgetPercent,
  sourcingBudgetKrw,
  allowOpenBudgetPreview,
  expectedSourceFingerprint,
  expectedPlanFingerprint,
  confirmation,
  selectedCount,
  totalQuantity,
  estimatedSpendKrw,
  ready,
  replaceDraftId,
  replacementAddedCount = 0,
  replacementRemovedCount = 0,
  replacementChangedCount = 0,
}: {
  targetDate: string;
  targetCycleMonth: string;
  cashLimitKrw: number | null;
  sourcingBudgetPercent: number;
  sourcingBudgetKrw: number;
  allowOpenBudgetPreview: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  confirmation: string;
  selectedCount: number;
  totalQuantity: number;
  estimatedSpendKrw: number;
  ready: boolean;
  replaceDraftId?: string | null;
  replacementAddedCount?: number;
  replacementRemovedCount?: number;
  replacementChangedCount?: number;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async () => {
    setNotice("");
    if (!ready) return;
    const cashSummary = cashLimitKrw === null
      ? "자동 현금 한도"
      : `입력 총현금 ${cashLimitKrw.toLocaleString("ko-KR")}원`;
    const sourcingSummary = `신규상품 소싱 ${sourcingBudgetPercent}% · ${sourcingBudgetKrw.toLocaleString("ko-KR")}원 별도 확보`;
    const summary = replaceDraftId
      ? `${targetCycleMonth} 기존 Draft를 최신 계산 ${selectedCount}개 SKU · 상품대금 ${estimatedSpendKrw.toLocaleString("ko-KR")}원으로 교체할까요?\n\n${cashSummary} · ${sourcingSummary} · 새로 포함 ${replacementAddedCount}종 · 기존에서 제거 ${replacementRemovedCount}종 · 수량변경 ${replacementChangedCount}종을 확인했습니다. 기존 Draft가 RESERVED 상태일 때만 감사 기록으로 종료하고 새 Draft를 기록합니다. 1688 주문·결제는 실행하지 않습니다.`
      : `${targetCycleMonth} 월간 발주 Draft를 ${selectedCount}개 SKU · 상품대금 ${estimatedSpendKrw.toLocaleString("ko-KR")}원으로 저장할까요?\n\n${cashSummary} · ${sourcingSummary}을 적용했습니다. 미입고 약정만 RESERVED로 기록합니다. 1688 주문·결제는 실행하지 않습니다.`;
    if (!window.confirm(summary)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/purchase-cycle/preflight-draft", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          targetDate,
          cashLimitKrw,
          sourcingBudgetPercent,
          allowOpenBudgetPreview,
          expectedSourceFingerprint,
          expectedPlanFingerprint,
          confirmation,
          replaceDraftId: replaceDraftId ?? null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as DraftResponse;
      if (!response.ok || !payload.ok) {
        setNotice(payload.message || `저장 실패 · ${payload.code || response.status}`);
        return;
      }
      setNotice(
        `${payload.message} ${payload.draft?.lineCount ?? selectedCount}개 SKU · 총 ${payload.draft?.totalQuantity ?? totalQuantity}개 · ${payload.draft?.draftId ?? ""}`,
      );
    } catch {
      setNotice("월간 Draft 저장 요청이 실패했습니다. 실제 주문·결제는 실행되지 않았습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-blue-200 bg-blue-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-bold">월간 발주 Draft로 고정</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            화면의 전체 후보·수량·상품대금 지문을 다시 확인한 뒤 미입고 약정만 저장합니다. 이후 같은 달 중복발주 계산에서 차감되며 실제 중국 주문과 결제는 별도입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!ready || saving}
          className="bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving
            ? replaceDraftId
              ? "Draft 재생성 중..."
              : "Draft 저장 중..."
            : replaceDraftId
              ? `${targetCycleMonth} 최신 로직으로 재생성`
              : `${targetCycleMonth} Draft 저장`}
        </button>
      </div>
      {notice ? <p className="mt-4 border border-blue-300 bg-white p-3 text-sm font-bold">{notice}</p> : null}
    </section>
  );
}
