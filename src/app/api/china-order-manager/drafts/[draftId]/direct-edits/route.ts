import { assertInternalChinaMonthlyPurchaseOpen } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { applyInternalChinaPurchaseDraftDirectEdit } from "@/lib/internalChinaPurchaseDraftDirectEdit";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type RouteContext = {
  params: Promise<{ draftId: string }>;
};

function errorResponse(error: unknown) {
  const raw = error instanceof Error ? error.message : "PURCHASE_DRAFT_DIRECT_EDIT_FAILED";
  const code = raw.split(":", 1)[0] || "PURCHASE_DRAFT_DIRECT_EDIT_FAILED";
  const detail = raw.split(":").slice(1).join(":");
  const messages: Record<string, string> = {
    INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED:
      "이미 마감한 발주월이라 상품 추가·제거·수량 변경을 저장할 수 없습니다.",
    INTERNAL_CHINA_DRAFT_ALREADY_ORDERED:
      "이미 실제 주문 기록이 시작된 발주안이라 상품 구성을 변경할 수 없습니다.",
    PURCHASE_DRAFT_DIRECT_EDIT_AFTER_ORDER_STARTED:
      "일부 상품의 실제 주문 기록이 시작되어 현재 발주안 전체 편집을 중단했습니다.",
    PURCHASE_DRAFT_DIRECT_EDIT_QUANTITY_INVALID:
      "수량은 5개 이상 9,995개 이하의 5개 단위로 입력하세요.",
    PURCHASE_DRAFT_DIRECT_EDIT_EMPTY:
      "저장할 상품 추가·제거·수량 변경이 없습니다.",
    PURCHASE_DRAFT_DIRECT_EDIT_READBACK_MISMATCH:
      `저장 후 다시 읽은 결과가 요청과 다릅니다. 화면을 새로고침해 ${detail || "변경 상품"}을 확인하세요.`,
    PURCHASE_DRAFT_DIRECT_EDIT_LINE_NOT_FOUND:
      `현재 발주안에서 ${detail || "변경 상품"}을 찾지 못했습니다. 화면을 새로고침하세요.`,
    INTERNAL_CHINA_MANUAL_ADD_BARCODE_NOT_ACTIVE:
      `상품마스터에서 활성 B-code를 찾지 못했습니다: ${detail}`,
    INTERNAL_CHINA_MANUAL_ADD_CANCELLED_LINE:
      `이 발주안에서 이미 취소된 B-code는 다시 추가하지 않습니다: ${detail}`,
    CHINA_ORDER_LEDGER_UNAVAILABLE:
      "발주·입고 원장을 불러오지 못해 변경사항을 저장하지 않았습니다.",
  };
  const conflict = [
    "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED",
    "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED",
    "PURCHASE_DRAFT_DIRECT_EDIT_AFTER_ORDER_STARTED",
    "PURCHASE_DRAFT_DIRECT_EDIT_LINE_NOT_FOUND",
    "INTERNAL_CHINA_MANUAL_ADD_CANCELLED_LINE",
  ].includes(code);
  return Response.json(
    {
      ok: false,
      code,
      message: messages[code] || "발주안 변경사항 저장에 실패했습니다. 현재 화면을 새로고침한 뒤 다시 확인하세요.",
      externalOrderExecuted: false,
    },
    { status: conflict ? 409 : 400, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "PURCHASE_DRAFT_DIRECT_EDIT_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 발주안을 편집할 수 있습니다.",
        externalOrderExecuted: false,
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const { draftId } = await context.params;
  const decodedDraftId = decodeURIComponent(draftId);
  try {
    const draft = await loadInternalChinaPurchaseDraft(decodedDraftId);
    await assertInternalChinaMonthlyPurchaseOpen(draft.cycleMonth);
    const result = await applyInternalChinaPurchaseDraftDirectEdit(
      decodedDraftId,
      await request.json().catch(() => ({})),
    );
    return Response.json(
      {
        ok: true,
        ...result,
        message: `재계산 없이 현재 발주안에 상품 추가 ${result.addedCount}종 · 제거 ${result.removedCount}종 · 수량 변경 ${result.changedCount}종을 저장했습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
