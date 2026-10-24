import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { startPurchaseRun } from "@/lib/purchaseRunStart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 600;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "PURCHASE_RUN_START_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await startPurchaseRun();
    return Response.json(
      {
        ok: true,
        ...result,
        draftUrl: `/china-order-manager/drafts/${encodeURIComponent(result.draft.draftId)}`,
        message: result.created
          ? "새 발주차시와 중국 주문초안을 만들었습니다. 실제 주문·결제는 실행하지 않았습니다."
          : "오늘 이미 계산한 중국 주문초안을 다시 엽니다.",
      },
      { status: result.created ? 201 : 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "PURCHASE_RUN_START_FAILED";
    const code = raw.split(":", 1)[0] || "PURCHASE_RUN_START_FAILED";
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "PURCHASE_CYCLE_DRAFT_NOT_READY"
            ? "최신 판매·재고 근거에 확인할 항목이 있어 새 발주차시를 만들지 않았습니다. 발주 사전점검에서 남은 항목을 확인하세요."
            : code === "PURCHASE_RUN_LEDGER_UNAVAILABLE"
              ? "기존 발주차시를 확인하지 못해 중복 생성을 막았습니다. 잠시 뒤 다시 시도하세요."
              : "새 발주차시를 만들지 못했습니다. 발주 사전점검에서 최신 자료를 확인하세요.",
        actionHref: "/purchase-cycle-preflight?check=1&sourcing=0",
        externalOrderExecuted: false,
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
}

