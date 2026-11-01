import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { createPurchaseCyclePreflightDraft } from "@/lib/purchaseCyclePreflightDraft";
import type { PurchaseCycleDraftRequest } from "@/lib/purchaseCyclePreflightDraftCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 600;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "PURCHASE_CYCLE_DRAFT_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const input = (await request.json()) as PurchaseCycleDraftRequest;
    const result = await createPurchaseCyclePreflightDraft(input, {
      startNewRun: input.startNewRun === true,
    });
    const sourcingMessage = result.sourcing
      ? ` 신규상품 ${result.sourcing.confirmedCount}종의 창고 B코드·모델번호를 먼저 확정하고 같은 발주차시 Draft에 포함했습니다.`
      : "";
    return Response.json(
      {
        ok: result.complete,
        ...result,
        message: (result.draft.duplicate
          ? result.regenerated
            ? "최신 계산과 같은 발주차시 Draft가 이미 적용되어 중복 저장하지 않았습니다."
            : "같은 발주차시 Draft가 이미 있어 중복 저장하지 않았습니다."
          : result.regenerated
            ? "기존 RESERVED Draft를 감사 기록으로 종료하고 최신 계산 Draft로 교체했습니다."
            : "발주차시 Draft를 RESERVED로 저장했습니다.") + sourcingMessage + " 실제 중국 주문·결제는 실행하지 않았습니다.",
      },
      {
        status: result.complete ? result.draft.duplicate ? 200 : 201 : 207,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PURCHASE_CYCLE_DRAFT_FAILED";
    const code = message.split(":", 1)[0] || "PURCHASE_CYCLE_DRAFT_FAILED";
    const conflict = [
      "PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED",
      "FAST_PURCHASE_CYCLE_ALREADY_USED",
      "PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED",
      "PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING",
      "PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY",
      "PURCHASE_CYCLE_SOURCING_REUSE_SCOPE_MISMATCH",
      "PURCHASE_CYCLE_SOURCING_CONFIRMATION_INCOMPLETE",
      "PURCHASE_CYCLE_DRAFT_PLAN_PARITY_MISMATCH",
    ].includes(code);
    console.warn("[purchase-cycle-preflight-draft] save failed", {
      code,
      cause: message.slice(0, 300),
    });
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED"
            ? "발주 자료가 바뀌었습니다. 전체 사전점검을 다시 실행하세요."
            : code === "PURCHASE_CYCLE_DRAFT_CONFIRMATION_REQUIRED"
              ? "화면에 표시된 품목 수와 상품대금을 다시 확인하세요."
              : code === "FAST_PURCHASE_CYCLE_ALREADY_USED"
                ? "같은 시작일의 발주차시가 이미 주문 또는 입고 단계로 진행됐습니다."
                  : code === "PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED"
                    ? "기존 Draft 상태가 바뀌었습니다. 최신 화면에서 다시 점검하세요."
                  : code === "PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING"
                      ? "기존 Draft의 주문 또는 입고가 시작되어 자동 재생성을 중단했습니다."
                  : code === "PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY"
                    ? "신규상품 후보·창고·월 소싱 예산 정책이 아직 최종 확정 조건을 충족하지 않습니다. 읽기 전용 사전점검을 다시 확인하세요."
                  : code === "PURCHASE_CYCLE_SOURCING_REUSE_SCOPE_MISMATCH"
                    ? "이번에 선택한 기존 신규상품 B코드와 발주초안 구성이 일치하지 않아 저장을 중단했습니다. 사전점검을 다시 실행하세요."
                  : code === "PURCHASE_CYCLE_SOURCING_CONFIRMATION_INCOMPLETE"
                    ? "신규소싱 상품의 B코드 확정이 모두 끝나지 않아 기존 발주초안을 바꾸지 않았습니다. 최신 사전점검을 다시 실행하세요."
                  : code === "PURCHASE_CYCLE_DRAFT_PLAN_PARITY_MISMATCH"
                    ? "화면에서 확인한 품목·수량과 실제 저장할 발주초안이 달라 저장을 중단했습니다. 최신 사전점검을 다시 실행하세요."
                  : code.startsWith("PURCHASE_SOURCING_IDENTITY_")
                    ? "신규소싱 상품의 B코드·옵션·1688 링크를 안전하게 복원하지 못해 저장을 중단했습니다. 화면을 새로고침한 뒤 다시 확인하세요."
                  : "발주차시 Draft 저장 조건을 확인하지 못했습니다.",
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
