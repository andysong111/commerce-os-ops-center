"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SourcingVariantSelectionInput } from "@/lib/sourcingBudgetPlan";
import { MANUAL_SOURCING_DRAFT_COMMITTED_EVENT } from "@/lib/manualSourcingDraftStorage";

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
  sourcingVariantSelections,
  allowOpenBudgetPreview,
  expectedSourceFingerprint,
  expectedPlanFingerprint,
  expectedSourcingSourceFingerprint,
  expectedSourcingPlanFingerprint,
  expectedSourcingDecisionFingerprint,
  sourcingSelectedCount,
  sourcingEstimatedSpendKrw,
  sourcingAlreadyReservedKrw,
  confirmation,
  selectedCount,
  totalQuantity,
  existingReorderCount,
  existingReorderQuantity,
  preservedSourcingCount,
  preservedSourcingQuantity,
  newSourcingQuantity,
  estimatedSpendKrw,
  ready,
  replaceDraftId,
  excludedBarcodes = [],
  replacementAddedCount = 0,
  replacementRemovedCount = 0,
  replacementChangedCount = 0,
  variant = "full",
}: {
  targetDate: string;
  targetCycleMonth: string;
  cashLimitKrw: number | null;
  sourcingBudgetPercent: number;
  sourcingBudgetKrw: number;
  preferredSourcingConceptIds: string[];
  sourcingStorageSizeByConceptId: Record<string, "S" | "L">;
  sourcingVariantSelections: SourcingVariantSelectionInput[];
  allowOpenBudgetPreview: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  expectedSourcingSourceFingerprint: string | null;
  expectedSourcingPlanFingerprint: string | null;
  expectedSourcingDecisionFingerprint: string | null;
  sourcingSelectedCount: number;
  sourcingEstimatedSpendKrw: number;
  sourcingAlreadyReservedKrw: number;
  confirmation: string;
  selectedCount: number;
  totalQuantity: number;
  existingReorderCount: number;
  existingReorderQuantity: number;
  preservedSourcingCount: number;
  preservedSourcingQuantity: number;
  newSourcingQuantity: number;
  estimatedSpendKrw: number;
  ready: boolean;
  replaceDraftId?: string | null;
  excludedBarcodes?: string[];
  replacementAddedCount?: number;
  replacementRemovedCount?: number;
  replacementChangedCount?: number;
  variant?: "full" | "quick-open";
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async () => {
    setNotice("");
    if (!ready) return;
    const cashSummary = cashLimitKrw === null
      ? "자동 현금 한도"
      : `입력 총현금 ${cashLimitKrw.toLocaleString("ko-KR")}원`;
    const sourcingSummary = sourcingBudgetPercent > 0
      ? `신규상품 소싱 ${sourcingBudgetPercent}% · 최대 예산 ${sourcingBudgetKrw.toLocaleString("ko-KR")}원 · 기존 예약 ${preservedSourcingCount}종 ${sourcingAlreadyReservedKrw.toLocaleString("ko-KR")}원 + 새 후보 ${sourcingSelectedCount}종 ${sourcingEstimatedSpendKrw.toLocaleString("ko-KR")}원 (저장 시 최신 환율로 한도 안에서 재계산)`
      : "신규상품 소싱 0%";
    const lineSummary = `기존상품 ${existingReorderCount}종·${existingReorderQuantity.toLocaleString("ko-KR")}개 + 유지 신규소싱 ${preservedSourcingCount}종·${preservedSourcingQuantity.toLocaleString("ko-KR")}개 + 새 신규소싱 ${sourcingSelectedCount}종·${newSourcingQuantity.toLocaleString("ko-KR")}개 = 최종 ${selectedCount}종·${totalQuantity.toLocaleString("ko-KR")}개`;
    const exclusionSummary = excludedBarcodes.length > 0
      ? ` · 사용자 제외 ${excludedBarcodes.length}종`
      : "";
    const summary = replaceDraftId
      ? `${targetCycleMonth} 기존 Draft를 최신 계산으로 교체할까요?\n\n${lineSummary}\n기존상품 상품대금 ${estimatedSpendKrw.toLocaleString("ko-KR")}원 · ${cashSummary} · ${sourcingSummary}${exclusionSummary} · 새로 포함 ${replacementAddedCount}종 · 기존에서 제거 ${replacementRemovedCount}종 · 수량변경 ${replacementChangedCount}종을 확인했습니다. 기존 Draft가 RESERVED 상태일 때만 감사 기록으로 종료하고 새 Draft를 기록합니다. 1688 주문·결제는 실행하지 않습니다.`
      : `${targetCycleMonth} 월간 발주 Draft를 저장할까요?\n\n${lineSummary}\n기존상품 상품대금 ${estimatedSpendKrw.toLocaleString("ko-KR")}원 · ${cashSummary} · ${sourcingSummary}을 적용했습니다. 미입고 약정만 RESERVED로 기록합니다. 1688 주문·결제는 실행하지 않습니다.`;
    const quickOpenNotice = variant === "quick-open"
      ? "\n\n저장 후 상품별 주문수량·1688 링크·옵션·위안단가 입력과 장바구니 준비가 있는 중국 발주초안을 엽니다. 실제 주문·결제는 실행하지 않습니다."
      : "";
    if (!window.confirm(summary + quickOpenNotice)) return;
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
          sourcingVariantSelections,
          allowOpenBudgetPreview,
          expectedSourceFingerprint,
          expectedPlanFingerprint,
          expectedSourcingSourceFingerprint,
          expectedSourcingPlanFingerprint,
          expectedSourcingDecisionFingerprint,
          confirmation,
          replaceDraftId: replaceDraftId ?? null,
          excludedBarcodes,
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
      window.dispatchEvent(new Event(MANUAL_SOURCING_DRAFT_COMMITTED_EVENT));
      const savedDraftId = payload.draft?.draftId?.trim() ?? "";
      if (variant === "quick-open") {
        if (!savedDraftId) {
          setNotice("발주 Draft는 저장됐지만 주문 준비 화면 주소를 확인하지 못했습니다. 아래 Draft 저장 결과를 확인하세요.");
          return;
        }
        router.push(`/china-order-manager/drafts/${encodeURIComponent(savedDraftId)}`);
        return;
      }
      setNotice(
        `${payload.message} ${payload.draft?.lineCount ?? selectedCount}개 SKU · 총 ${payload.draft?.totalQuantity ?? totalQuantity}개 · ${savedDraftId}`,
      );
    } catch {
      setNotice("월간 Draft 저장 요청이 실패했습니다. 실제 주문·결제는 실행되지 않았습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (variant === "quick-open") {
    return (
      <section data-testid="preflight-plan-jump" className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-blue-600 bg-blue-50 px-5 py-4">
        <div className="max-w-3xl">
          <strong className="text-sm text-blue-950">중국 발주초안으로 이동</strong>
          <p className="mt-1 text-xs leading-5 text-blue-900">
            {ready
              ? `기존상품 ${existingReorderCount}종 + 유지 신규소싱 ${preservedSourcingCount}종 + 새 신규소싱 ${sourcingSelectedCount}종 = 최종 ${selectedCount}종 · 총 ${totalQuantity.toLocaleString("ko-KR")}개를 내부 Draft로 저장하고, 원가 입력과 1688 장바구니 준비 화면을 엽니다.`
              : "계산 결과에 남은 필수 조건이 있어 아직 발주초안을 만들 수 없습니다. 아래에서 남은 조건을 확인하세요."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!ready ? <a href="#preflight-result-title" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-black text-blue-800 hover:bg-blue-100">남은 확인 항목 보기</a> : null}
          <button type="button" onClick={save} disabled={!ready || saving} className="min-h-11 rounded-lg bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
            {saving ? "발주안 여는 중..." : "발주안 바로 보기"}
          </button>
        </div>
        {notice ? <p className="w-full border-l-4 border-blue-500 bg-white px-3 py-2 text-sm font-bold">{notice}</p> : null}
      </section>
    );
  }

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
