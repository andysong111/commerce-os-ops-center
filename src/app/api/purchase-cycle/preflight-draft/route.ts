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
    const result = await createPurchaseCyclePreflightDraft(input);
    const sourcingMessage = result.sourcing
      ? result.sourcing.ok
        ? ` 신규상품 ${result.sourcing.confirmedCount}종도 창고 B코드·모델번호를 배정해 같은 월간 Draft에 추가했습니다.`
        : ` 기존상품 Draft는 저장됐지만 신규상품은 ${result.sourcing.confirmedCount}/${result.sourcing.selectedCount}종까지만 반영됐습니다. 새 사전점검으로 남은 품목을 다시 확인하세요.`
      : "";
    return Response.json(
      {
        ok: result.complete,
        ...result,
        message: (result.draft.duplicate
          ? result.regenerated
            ? "최신 계산과 같은 월간 Draft가 이미 적용되어 중복 저장하지 않았습니다."
            : "같은 10월 월간 Draft가 이미 있어 중복 저장하지 않았습니다."
          : result.regenerated
            ? "기존 RESERVED Draft를 감사 기록으로 종료하고 최신 계산 Draft로 교체했습니다."
            : "10월 월간 Draft를 RESERVED로 저장했습니다.") + sourcingMessage + " 실제 중국 주문·결제는 실행하지 않았습니다.",
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
      "FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED",
      "FAST_PURCHASE_MONTHLY_CYCLE_CLOSED",
      "PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED",
      "PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING",
      "PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY",
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
                  : code === "PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED"
                    ? "기존 Draft 상태가 바뀌었습니다. 최신 화면에서 다시 점검하세요."
                  : code === "PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING"
                      ? "기존 Draft의 주문 또는 입고가 시작되어 자동 재생성을 중단했습니다."
                  : code === "PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY"
                    ? "신규상품 후보·창고·월 소싱 예산 정책이 아직 최종 확정 조건을 충족하지 않습니다. 읽기 전용 사전점검을 다시 확인하세요."
                  : "월간 발주 Draft 저장 조건을 확인하지 못했습니다.",
      },
      {
        status: conflict ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
