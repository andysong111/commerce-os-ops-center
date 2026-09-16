import type { CommerceModule } from "@/lib/moduleRegistry";

export const purchaseCyclePreflightModule: CommerceModule = {
  id: "purchase-cycle-preflight",
  title: "발주 사전점검 · 소량 검증 준비",
  navigationLabel: "발주 사전점검",
  description: "판매원장 검증부터 원가·재고·예산 내 소량 발주안까지 5~10구간의 준비 상태를 확인합니다. 실제 주문·결제·승인은 실행하지 않습니다.",
  status: "available",
  route: "/purchase-cycle-preflight",
  category: "발주·입고 관리",
  inputType: "발주 예정일, 이번 소량 검증에 쓸 현금 상한, SKU·수량 제한",
  outputType: "구간별 실제 검증상태, 차단 사유, 원본 지문이 고정된 소량 발주 미리보기",
  historySupport: false,
  externalProject: false,
  note: "개발 완료와 실운영 검증을 구분합니다. 지정일에도 자동 실행되지 않으며, 실제 발주는 기존 승인 경로에서 최신 근거를 다시 확인해야 합니다.",
  helperNote: "읽기 전용 · 예약 실행 없음",
  actionLabel: "발주 사전점검 열기",
  safetyBadge: "주문·결제·공식원장 변경 없음",
};
