import { recordInternalChinaFundingClose } from "@/lib/internalChinaFundingClose";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function errorResponse(error: unknown) {
  const raw = error instanceof Error ? error.message : "CHINA_FUNDING_CLOSE_FAILED";
  const code = raw.split(":", 1)[0] || "CHINA_FUNDING_CLOSE_FAILED";
  let message = raw;

  if (code === "CHINA_FUNDING_CLOSE_DRAFT_INVALID") {
    message = "자금 마감할 발주 Draft 번호를 확인하세요.";
  } else if (code === "CHINA_FUNDING_CLOSE_CYCLE_MONTH_INVALID") {
    message = "자금 마감 대상 발주월을 확인하세요.";
  } else if (code === "CHINA_FUNDING_CLOSE_WORLDFIRST_TRANSFER_REQUIRED") {
    message = "이번 달 WorldFirst로 실제 송금한 원화 금액을 입력하세요.";
  } else if (code === "CHINA_FUNDING_CLOSE_WORLDFIRST_TRANSFER_EXCEEDED") {
    message = "WorldFirst 송금액이 이번 달 전체 지출가능금액보다 큽니다.";
  } else if (code === "CHINA_FUNDING_CLOSE_KOREA_SPEND_EXCEEDED") {
    message = "한국계좌 실제 지출액이 한국계좌 배정 가능액보다 큽니다.";
  } else if (code === "CHINA_FUNDING_CLOSE_KOREA_SPEND_BELOW_FORWARDER") {
    const minimum = Number(raw.split(":")[1] ?? 0);
    message = `한국계좌 실제 지출액은 이미 확정된 배송대행지 비용 ${minimum.toLocaleString("ko-KR")}원보다 작을 수 없습니다.`;
  } else if (code === "CHINA_FUNDING_CLOSE_FORWARDER_REQUIRED") {
    message = "입고확정과 배송대행지 실제 원가 마감을 먼저 완료한 뒤 자금을 마감하세요.";
  } else if (code === "CHINA_FUNDING_CLOSE_FORWARDER_CONFLICT") {
    message = "선택한 발주월과 실제 원가 마감 원장의 월이 다릅니다. 새로고침 후 다시 시도하세요.";
  } else if (code === "CHINA_FUNDING_CLOSE_BUDGET_UNAVAILABLE") {
    message = "직전 달 정상매출을 불러오지 못해 전체 지출가능금액을 확정할 수 없습니다.";
  } else if (
    code === "CHINA_FUNDING_CLOSE_AMOUNT_EXCEEDED" ||
    code === "CHINA_FUNDING_CLOSE_BALANCE_EXCEEDED"
  ) {
    message = "입력 금액 범위를 확인하세요.";
  }

  return Response.json(
    { ok: false, code, message },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_FUNDING_CLOSE_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 자금 마감을 저장할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await recordInternalChinaFundingClose(
      await request.json().catch(() => ({})),
    );
    const message =
      result.trackingMode === "SIMPLIFIED_NO_WORLDFIRST"
        ? `월 자금 마감을 완료했습니다. WorldFirst 송금액·기말잔고·지갑별 잔액은 현재 운영에서 제외하고, 입고·실제 원가 마감 완료 상태만 기록했습니다.`
        : `월 자금 마감을 저장했습니다. 전체 지출가능금액 ${result.totalSpendingBudgetKrw.toLocaleString("ko-KR")}원 중 WorldFirst ${result.worldFirstTransferKrw.toLocaleString("ko-KR")}원 배정, 한국계좌 ${result.koreaAccountSpentKrw.toLocaleString("ko-KR")}원 지출, 비상금 ${result.emergencyReserveTransferKrw.toLocaleString("ko-KR")}원 적립으로 마감했습니다. WorldFirst 기말잔액은 USD ${result.worldFirstEndingUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} / CNH ${result.worldFirstEndingCnh.toLocaleString("en-US", { maximumFractionDigits: 2 })}로 기록했습니다.`;
    return Response.json(
      {
        ok: true,
        result,
        message,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
