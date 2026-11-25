import { recordInternalChinaForwarderCost } from "@/lib/internalChinaForwarderCost";
import { loadStoredInternalChinaForwarderClose } from "@/lib/internalChinaForwarderStoredClose";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "CHINA_FORWARDER_COST_FAILED";
  const code = raw.split(":", 1)[0] || "CHINA_FORWARDER_COST_FAILED";
  let message = raw;
  if (code === "CHINA_FORWARDER_COST_DRAFT_INVALID") {
    message = "배송대행 비용을 마감할 발주 Draft 번호가 올바르지 않습니다.";
  } else if (code === "CHINA_FORWARDER_COST_CYCLE_MONTH_INVALID") {
    message = "발주·입고 사이클 월을 확인하세요.";
  } else if (code === "CHINA_FORWARDER_COST_AMOUNT_REQUIRED") {
    message = "배송대행지에서 실제로 청구된 총비용을 원 단위로 입력하세요.";
  } else if (code === "CHINA_FORWARDER_COST_AMOUNT_EXCEEDED") {
    message = "배송대행지 실제비용이 허용 범위를 초과했습니다.";
  } else if (code === "CHINA_FORWARDER_COST_DRAFT_NOT_FOUND") {
    message = "해당 발주 Draft의 주문·입고 원장을 찾지 못했습니다.";
  } else if (code === "CHINA_FORWARDER_COST_RECEIPT_OPEN") {
    message = `남은 미입고 ${Number(raw.split(":")[1] ?? 0).toLocaleString("ko-KR")}개를 먼저 입고확정한 뒤 배송대행 비용을 마감하세요.`;
  } else if (code === "CHINA_FORWARDER_COST_CYCLE_MONTH_CONFLICT") {
    message = "화면의 발주월과 실제 발주 Draft의 월이 다릅니다. 새로고침 후 다시 시도하세요.";
  } else if (code === "CHINA_FORWARDER_COST_ALREADY_CLOSED") {
    const storedAmount = Number(raw.split(":")[1] ?? 0);
    message = storedAmount > 0
      ? `이미 배송대행 비용이 ${storedAmount.toLocaleString("ko-KR")}원으로 마감된 Draft입니다. 기존 마감값을 유지합니다.`
      : "이미 배송대행 비용이 마감된 Draft입니다. 기존 마감값을 유지합니다.";
  }
  return Response.json(
    { ok: false, code, message },
    {
      status:
        code === "CHINA_FORWARDER_COST_DRAFT_NOT_FOUND"
          ? 404
          : code === "CHINA_FORWARDER_COST_ALREADY_CLOSED"
            ? 409
            : 400,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_FORWARDER_COST_UNAUTHORIZED",
        message:
          "Ops Center 동일 출처 화면에서만 배송대행 비용을 마감할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const input = (await request.json().catch(() => ({}))) as {
      draftId?: unknown;
      cycleMonth?: unknown;
      actualCostKrw?: unknown;
    };
    const stored = await loadStoredInternalChinaForwarderClose(input.draftId);
    if (stored?.actualCostKrw) {
      throw new Error(
        `CHINA_FORWARDER_COST_ALREADY_CLOSED:${stored.actualCostKrw}`,
      );
    }

    const result = await recordInternalChinaForwarderCost(input);
    const reconciliation = result.receiptCostReconciliation;
    const multiplier = result.actualMultiplier?.toFixed(4) ?? "-";
    const receiptMessage = reconciliation?.productMasterSynced
      ? ` 같은 월의 입고원가 ${reconciliation.updatedRows.toLocaleString("ko-KR")}행도 실제 원가배수 ${multiplier} 기준으로 Product Master에 재동기화했습니다.`
      : reconciliation?.productMasterError
        ? ` 배송대행 비용과 실제 원가배수는 저장했지만 Product Master 입고원가 재동기화는 확인이 필요합니다: ${reconciliation.productMasterError}`
        : "";
    return Response.json(
      {
        ok: true,
        result,
        message: `배송대행지 실제비용 ${result.actualCostKrw?.toLocaleString("ko-KR")}원을 반영해 실제 도착 원가배수 ${multiplier}를 확정했습니다. 결제원가에는 월드퍼스트 콰징바오 수수료를 포함하고, 최종 SKU 매입원가는 SKU별 결제원가 × 실제 도착 원가배수로 계산해 이후 가격조정 판단에 사용합니다.${receiptMessage}`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
