export type PurchaseCycleCalculationPhase = "ready" | "pending" | "complete" | "changed";

export type PurchaseCycleCalculationButtonState = {
  phase: PurchaseCycleCalculationPhase;
  label: string;
  disabled: boolean;
};

export function resolvePurchaseCycleCalculationButtonState({
  pending,
  calculationComplete,
  configurationChanged,
}: {
  pending: boolean;
  calculationComplete: boolean;
  configurationChanged: boolean;
}): PurchaseCycleCalculationButtonState {
  if (pending) return { phase: "pending", label: "발주안 계산 중...", disabled: true };
  if (calculationComplete && configurationChanged) {
    return { phase: "changed", label: "변경사항으로 다시 계산", disabled: false };
  }
  if (calculationComplete) return { phase: "complete", label: "발주안 계산 완료", disabled: true };
  return { phase: "ready", label: "2. 준비된 후보로 발주안 계산", disabled: false };
}

function nonNegativeInteger(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function buildPurchaseCycleCandidateSummary({
  manualProductCount,
  manualOptionCount,
  automaticCandidateCount,
  includedAutomaticCount,
}: {
  manualProductCount: number;
  manualOptionCount: number;
  automaticCandidateCount: number;
  includedAutomaticCount: number;
}) {
  const products = nonNegativeInteger(manualProductCount);
  const options = nonNegativeInteger(manualOptionCount);
  const automatic = nonNegativeInteger(automaticCandidateCount);
  const included = Math.min(automatic, nonNegativeInteger(includedAutomaticCount));
  return `수동 추가 ${products}상품·${options}옵션 유지 · 자동소싱 ${automatic}개 중 포함 ${included}개·제외 ${automatic - included}개`;
}

export function resolvePurchaseCycleNextAction({
  pending,
  calculationComplete,
  remainingActionCount,
  draftReady,
}: {
  pending: boolean;
  calculationComplete: boolean;
  remainingActionCount: number;
  draftReady: boolean;
}) {
  if (pending) {
    return {
      current: "저장한 후보와 수납 위치를 반영해 발주안을 계산하고 있습니다.",
      next: "계산이 끝나면 남은 확인 항목을 처리합니다.",
    };
  }
  if (!calculationComplete) {
    return {
      current: "수동상품과 자동소싱 포함 여부를 마지막으로 확인합니다.",
      next: "‘2. 준비된 후보로 발주안 계산’을 누릅니다.",
    };
  }
  if (remainingActionCount > 0) {
    return {
      current: `계산은 끝났고 확인할 항목이 ${nonNegativeInteger(remainingActionCount)}건 남았습니다.`,
      next: "화면의 확인 항목을 처리한 뒤 내부 Draft를 저장합니다.",
    };
  }
  if (!draftReady) {
    return {
      current: "계산과 확인이 끝났습니다.",
      next: "내부 Draft 저장 버튼으로 발주초안을 확정합니다.",
    };
  }
  return {
    current: "발주초안 준비가 완료되었습니다.",
    next: "중국 주문초안에서 재고·수량을 확인하고 5-1 원가·운임 기록을 진행합니다.",
  };
}
