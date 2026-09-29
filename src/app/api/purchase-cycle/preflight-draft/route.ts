import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { createPurchaseCyclePreflightDraft } from "@/lib/purchaseCyclePreflightDraft";
import type { PurchaseCycleDraftRequest } from "@/lib/purchaseCyclePreflightDraftCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "PURCHASE_CYCLE_DRAFT_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const input = (await request.json()) as PurchaseCycleDraftRequest;
    const result = await createPurchaseCyclePreflightDraft(input);
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.draft.duplicate
          ? "같은 10월 월간 Draft가 이미 있어 중복 저장하지 않았습니다."
          : "10월 월간 Draft를 RESERVED로 저장했습니다. 실제 중국 주문·결제는 실행하지 않았습니다.",
      },
      {
        status: result.draft.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PURCHASE_CYCLE_DRAFT_FAILED";
    const code = message.split(":", 1)[0] || "PURCHASE_CYCLE_DRAFT_FAILED";
    const conflict = [
      "PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED",
      "FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED",
      "FAST_PURCHASE_MONTHLY_CYCLE_CLOSED",
    ].includes(code);
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED"
            ? "발주 자료가 바뀌었습니다. 전체 사전점검을 다시 실행하세요."
            : code === "PURCHASE_CYCLE_DRAFT_CONFIRMATION_REQUIRED"
              ? "화면에 표시된 품목 수와 상품대금을 다시 확인하세요."
              : code === "FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED"
                ? "10월 발주차시가 이미 주문 또는 입고 단계로 진행됐습니다."
                : code === "FAST_PURCHASE_MONTHLY_CYCLE_CLOSED"
                  ? "10월 발주 사이클이 이미 마감됐습니다."
                  : "월간 발주 Draft 저장 조건을 확인하지 못했습니다.",
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
