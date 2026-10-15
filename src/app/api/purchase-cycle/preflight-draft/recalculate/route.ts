import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  recalculatePurchaseCycleDraftInline,
  type InlinePurchaseCycleDraftRecalculationRequest,
} from "@/lib/purchaseCyclePreflightDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 600;

function errorMessage(code: string) {
  if (code === "FAST_PURCHASE_MONTHLY_CYCLE_CLOSED") {
    return "이번 달 발주 사이클이 이미 마감되어 초안을 바꿀 수 없습니다.";
  }
  if (
    code === "PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED" ||
    code === "PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING"
  ) {
    return "현재 Draft의 주문·입고 상태가 바뀌었습니다. 화면을 새로고침한 뒤 다시 확인하세요.";
  }
  if (code === "PURCHASE_CYCLE_DRAFT_NOT_READY") {
    return "최신 판매·재고 자료에서 발주 가능한 다음 순위를 만들지 못했습니다. 현재 Draft는 그대로 유지했습니다.";
  }
  if (code === "OPERATOR_QUANTITY_OVERRIDES_INVALID") {
    return "수량은 5개 단위로, SKU당 5개 이상 9,995개 이하로 입력하세요.";
  }
  if (code === "REPLACEMENT_DRAFT_SNAPSHOT_INVALID") {
    return "현재 Draft의 일부 수량을 검증하지 못했습니다. 입력은 유지했으므로 잠시 후 다시 계산하세요.";
  }
  return "발주안 재계산을 완료하지 못했습니다. 현재 Draft는 그대로 유지했습니다.";
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "PURCHASE_CYCLE_DRAFT_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const input = (await request.json()) as InlinePurchaseCycleDraftRecalculationRequest;
    const result = await recalculatePurchaseCycleDraftInline(input);
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.manualFallbackUsed
          ? `현재 화면에서 요청한 변경을 반영했습니다. 제거 ${result.removedCount}종 · 수량변경 ${result.changedCount}종입니다. 최신 검증자료에서 다음 우선순위 상품을 확보하지 못해 추가는 0종이며, 실제 1688 주문·결제는 실행하지 않았습니다.`
          : `현재 화면에서 변경을 반영했습니다. 제거 ${result.removedCount}종 · 추가 ${result.addedCount}종 · 수량변경 ${result.changedCount}종이며 남은 예산은 다음 우선순위에 다시 배정했습니다. 실제 1688 주문·결제는 실행하지 않았습니다.`,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "PURCHASE_CYCLE_INLINE_RECALCULATION_FAILED";
    const code = raw.split(":", 1)[0] || "PURCHASE_CYCLE_INLINE_RECALCULATION_FAILED";
    const conflict = [
      "FAST_PURCHASE_MONTHLY_CYCLE_CLOSED",
      "PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED",
      "PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING",
    ].includes(code);
    return Response.json(
      {
        ok: false,
        code,
        message: errorMessage(code),
        externalOrderExecuted: false,
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
