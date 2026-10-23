import { queueFastPurchaseDraftForChina } from "@/lib/fastPurchaseDraftHandoff";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "FAST_PURCHASE_HANDOFF_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 중국 주문초안 전달을 시작할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      draftId?: unknown;
    };
    const draftId = String(body.draftId ?? "").trim();
    const state = await loadFastPurchaseInternalDrafts();
    if (state.error) {
      throw new Error(`FAST_PURCHASE_HANDOFF_LEDGER_UNAVAILABLE:${state.error}`);
    }
    const draft = state.drafts.find((candidate) => candidate.draftId === draftId);
    if (!draft) throw new Error("FAST_PURCHASE_HANDOFF_DRAFT_NOT_FOUND");

    const handoff = await queueFastPurchaseDraftForChina(draftId);
    return Response.json(
      {
        ok: true,
        handoff,
        message: handoff.alreadyImported
          ? "이미 중국 주문초안으로 반영된 내부 Draft입니다."
          : handoff.alreadyQueued
            ? "이미 중국 주문초안 전달 대기열에 있습니다."
            : "중국 주문초안 전달 대기열에 저장했습니다. 실제 1688 주문·결제는 실행하지 않았습니다.",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.split(":", 1)[0]
        : "FAST_PURCHASE_HANDOFF_FAILED";
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "FAST_PURCHASE_HANDOFF_NO_OPEN_QUANTITY"
            ? "현재 미입고 수량이 없어 중국 주문초안으로 전달할 항목이 없습니다."
            : code === "FAST_PURCHASE_HANDOFF_ALREADY_PROGRESSING"
              ? "이미 주문 또는 입고가 진행 중인 내부 Draft라 새 주문초안으로 전달하지 않습니다."
              : code === "FAST_PURCHASE_HANDOFF_DRAFT_NOT_FOUND"
                  ? "전달할 내부 발주 Draft를 찾지 못했습니다. 원장을 새로고침하세요."
                  : code === "FAST_PURCHASE_HANDOFF_LEDGER_UNAVAILABLE"
                    ? "발주 원장을 확인하지 못해 중국 주문초안 전달을 안전하게 중단했습니다."
                    : "중국 주문초안 전달 조건을 확인하지 못했습니다.",
      },
      {
        status: 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
