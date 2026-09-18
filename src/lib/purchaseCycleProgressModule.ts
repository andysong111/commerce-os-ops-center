import type { CommerceModule } from "@/lib/moduleRegistry";

export const purchaseCycleProgressModule: CommerceModule = {
  id: "purchase-cycle-progress",
  title: "발주사이클 진행상황",
  navigationLabel: "발주사이클 진행상황",
  description:
    "판매근거 수집부터 canonical 검증, 원가·재고·발주 Shadow와 소량 발주 미리보기까지 현재 위치와 사람 개입 지점을 한 화면에서 확인합니다.",
  status: "available",
  route: "/purchase-cycle-progress",
  category: "발주·입고 관리",
  inputType: "자동 수집·검증 상태와 현재 canonical 원본",
  outputType: "구간별 상태, 현재 자동 진행 여부, 다음 소유자 승인 지점",
  historySupport: false,
  externalProject: false,
  note: "상태 확인 전용입니다. CANARY·FULL·실제 발주·결제는 각각 별도 명시적 승인이 필요합니다.",
  helperNote: "자동진행 / 사람개입 지점",
  actionLabel: "발주사이클 현황 열기",
  safetyBadge: "상태 확인만 · 업무 쓰기 없음",
};
