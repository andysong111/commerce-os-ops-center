import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { seoulCalendarDate } from "@/lib/monthlyPurchasePolicy";
import {
  advancePurchaseRunPreparation,
  normalizePurchaseRunPreparationInput,
  purchaseRunPreparationErrorStage,
  type PurchaseRunPreparationStage,
} from "@/lib/purchaseRunPreparation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 600;

function transientSourceReadFailure(error: unknown, raw: string) {
  const evidence = [raw];
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    evidence.push(current.name, current.message);
    current = current.cause;
  }
  return evidence.includes("AbortError") || evidence.includes("TimeoutError") ||
    /abort|timeout|timed out|fetch failed|econnreset|econnrefused|planning_failed:5\d\d/i.test(
      evidence.join(" "),
    );
}

function transientStageResponse(stage: PurchaseRunPreparationStage | null) {
  const normalized = stage ?? "DEMAND";
  const progressByStage: Record<PurchaseRunPreparationStage, number> = {
    DEMAND: 0,
    SALES: 35,
    CANARY: 72,
    FULL: 80,
    RECONCILIATION: 90,
    INVENTORY: 95,
  };
  const labelByStage: Record<PurchaseRunPreparationStage, string> = {
    DEMAND: "상품 기준정보와 주문·클레임",
    SALES: "최신 판매자료",
    CANARY: "판매자료 1건 안전 대조",
    FULL: "전체 판매자료 반영",
    RECONCILIATION: "판매 원장 대조",
    INVENTORY: "재고·미입고 대조",
  };
  return {
    stage: normalized,
    progress: progressByStage[normalized],
    message: `${labelByStage[normalized]} 연결이 지연되어 자동으로 다시 시도합니다.`,
  };
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "PURCHASE_RUN_START_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = await request.json().catch(() => ({}));
    const input = normalizePurchaseRunPreparationInput(body, seoulCalendarDate());
    const result = await advancePurchaseRunPreparation(input);
    const status = result.state === "BLOCKED" ? 409 : result.state === "PENDING" ? 202 : 200;
    return Response.json(
      {
        ok: result.state !== "BLOCKED",
        pending: result.state === "PENDING",
        ...result,
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "PURCHASE_RUN_START_FAILED";
    const code = raw.split(":", 1)[0] || "PURCHASE_RUN_START_FAILED";
    const validationError = code === "PURCHASE_RUN_CASH_INVALID" ||
      code === "PURCHASE_RUN_SOURCING_PERCENT_INVALID";
    const retryable = !validationError && transientSourceReadFailure(error, raw);
    const transientStage = transientStageResponse(purchaseRunPreparationErrorStage(error));
    console.error("[purchase-run-start] preparation failed", {
      code,
      retryable,
      stage: transientStage.stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: raw.slice(0, 500),
    });
    if (retryable) {
      return Response.json(
        {
          ok: true,
          pending: true,
          state: "PENDING",
          stage: transientStage.stage,
          progress: transientStage.progress,
          code,
          retryableFailure: true,
          message: transientStage.message,
          externalOrderExecuted: false,
        },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      {
        ok: false,
        code,
        message:
          code === "PURCHASE_RUN_CASH_INVALID"
            ? "이번 발주에 사용할 현금은 0원 이상의 정수로 입력하세요. 비우면 누적 가용예산을 사용합니다."
            : code === "PURCHASE_RUN_SOURCING_PERCENT_INVALID"
              ? "신규상품 소싱 비율은 0~100 사이의 정수로 입력하세요."
              : "자료 준비가 일시적으로 중단되었습니다. 같은 버튼으로 다시 시도하면 완료한 단계부터 이어갑니다.",
        externalOrderExecuted: false,
      },
      { status: validationError ? 400 : 503, headers: { "cache-control": "no-store" } },
    );
  }
}

