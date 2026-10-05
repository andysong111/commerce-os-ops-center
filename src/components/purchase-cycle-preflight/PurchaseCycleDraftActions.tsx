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
  sourcing?: {
    ok?: boolean;
    selectedCount?: number;
    confirmedCount?: number;
    failure?: { code?: string; message?: string } | null;
  } | null;
};

export function PurchaseCycleDraftActions({
  targetDate,
  targetCycleMonth,
  cashLimitKrw,
  sourcingBudgetPercent,
  sourcingBudgetKrw,
  preferredSourcingConceptIds,
  sourcingStorageSizeByConceptId,
  allowOpenBudgetPreview,
  expectedSourceFingerprint,
  expectedPlanFingerprint,
  expectedSourcingSourceFingerprint,
  expectedSourcingPlanFingerprint,
  sourcingSelectedCount,
  sourcingEstimatedSpendKrw,
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
  preferredSourcingConceptIds: string[];
  sourcingStorageSizeByConceptId: Record<string, "S" | "L">;
  allowOpenBudgetPreview: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  expectedSourcingSourceFingerprint: string | null;
  expectedSourcingPlanFingerprint: string | null;
  sourcingSelectedCount: number;
  sourcingEstimatedSpendKrw: number;
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
    const sourcingSummary = sourcingBudgetPercent > 0
      ? `신규상품 소싱 ${sourcingBudgetPercent}% · 예산 ${sourcingBudgetKrw.toLocaleString("ko-KR")}원 · ${sourcingSelectedCount}종 예상 ${sourcingEstimatedSpendKrw.toLocaleString("ko-KR")}원`
      : "신규상품 소싱 0%";
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
          preferredSourcingConceptIds,
          sourcingStorageSizeByConceptId,
          allowOpenBudgetPreview,
          expectedSourceFingerprint,
          expectedPlanFingerprint,
          expectedSourcingSourceFingerprint,
          expectedSourcingPlanFingerprint,
          confirmation,
          replaceDraftId: replaceDraftId ?? null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as DraftResponse;
      if (!response.ok || !payload.ok) {
        const sourcingProgress = payload.sourcing
          ? ` 신규상품 ${payload.sourcing.confirmedCount ?? 0}/${payload.sourcing.selectedCount ?? sourcingSelectedCount}종 반영.`
          : "";
        setNotice((payload.message || `저장 실패 · ${payload.code || response.status}`) + sourcingProgress);
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
    <section className="border-y border-slate-200 bg-white py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-black text-blue-700">4단계 · 내부 기록</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">월간 발주 Draft로 저장</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            검토한 품목·수량·금액과 미입고 약정만 기록합니다. 이후 같은 달 중복발주 계산에서 차감되며 실제 중국 주문과 결제는 별도입니다.
          </p>
          <p className={`mt-3 text-sm font-bold ${ready ? "text-emerald-800" : "text-amber-800"}`}>
            {ready ? "저장 준비 완료 · 버튼을 누르면 마지막 확인창이 열립니다." : "저장 대기 · 위 확인 항목을 먼저 해결하세요."}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!ready || saving}
          className="min-h-11 rounded-lg bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
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
      {notice ? <p className="mt-4 border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-sm font-bold">{notice}</p> : null}
    </section>
  );
}
