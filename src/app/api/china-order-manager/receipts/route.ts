import { recordInternalChinaReceipt } from "@/lib/internalChinaReceipt";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function errorResponse(error: unknown) {
  const raw = error instanceof Error ? error.message : "CHINA_RECEIPT_FAILED";
  const code = raw.split(":", 1)[0] || "CHINA_RECEIPT_FAILED";
  let message = raw;
  if (code === "CHINA_RECEIPT_REQUEST_ID_INVALID") {
    message = "입고확정 요청 식별자가 올바르지 않습니다. 화면을 새로고침 후 다시 시도하세요.";
  } else if (code === "CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT") {
    message = "같은 입고확정 요청번호에 다른 품목·수량이 들어왔습니다. 중복 반영을 막기 위해 차단했습니다.";
  } else if (code === "CHINA_RECEIPT_REPLAY_LOOKUP_FAILED") {
    message = "기존 입고확정 원장을 확인하지 못했습니다. 수량을 다시 반영하지 않고 중단했습니다.";
  } else if (code === "CHINA_RECEIPT_DRAFT_INVALID") {
    message = "입고 처리할 발주 Draft 번호가 올바르지 않습니다.";
  } else if (code === "CHINA_RECEIPT_CYCLE_MONTH_INVALID") {
    message = "발주·입고 사이클 월을 확인하세요.";
  } else if (code === "CHINA_RECEIPT_LINES_REQUIRED") {
    message = "입고 처리할 품목을 선택하세요.";
  } else if (code === "CHINA_RECEIPT_POSITIVE_QUANTITY_REQUIRED") {
    message = "이번 입고수량을 1개 이상 입력한 품목이 필요합니다.";
  } else if (code === "CHINA_RECEIPT_DRAFT_NOT_FOUND") {
    message = "해당 발주 Draft의 원장을 찾지 못했습니다.";
  } else if (code === "CHINA_RECEIPT_ALREADY_CLOSED") {
    message = `이미 입고 완료된 품목입니다: ${raw.split(":")[1] ?? ""}`;
  } else if (code === "CHINA_RECEIPT_QUANTITY_EXCEEDED") {
    const [, barcode, requested, remaining] = raw.split(":");
    message = `${barcode}의 이번 입고수량 ${requested}개가 남은 미입고 ${remaining}개를 초과합니다.`;
  } else if (code === "CHINA_RECEIPT_BARCODE_NOT_IN_DRAFT") {
    message = `현재 발주 Draft에 없는 B-code입니다: ${raw.split(":")[1] ?? ""}`;
  } else if (code === "CHINA_RECEIPT_CYCLE_MONTH_CONFLICT") {
    message = "화면의 발주월과 실제 발주 Draft의 월이 다릅니다. 새로고침 후 다시 시도하세요.";
  }
  return Response.json(
    { ok: false, code, message },
    {
      status:
        code === "CHINA_RECEIPT_DRAFT_NOT_FOUND"
          ? 404
          : code === "CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT"
            ? 409
            : code === "CHINA_RECEIPT_REPLAY_LOOKUP_FAILED" || code === "CHINA_RECEIPT_STORE_FAILED"
              ? 503
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
        code: "CHINA_RECEIPT_UNAUTHORIZED",
        message: "Ops Center 동일 출처 화면에서만 입고확정할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await recordInternalChinaReceipt(
      await request.json().catch(() => ({})),
    );
    return Response.json(
      {
        ok: true,
        result,
        message: result.productMasterSynced
          ? `${result.lineCount.toLocaleString("ko-KR")} SKU · ${result.receivedNow.toLocaleString("ko-KR")}개 입고를 확정하고 중국 상품대금·중국내 운임 기준 상품 매입원가까지 Product Master에 반영했습니다.`
          : `${result.lineCount.toLocaleString("ko-KR")} SKU · ${result.receivedNow.toLocaleString("ko-KR")}개 입고는 원장에 확정했습니다. Product Master 상품 매입원가 후속 동기화는 다시 확인이 필요합니다: ${result.productMasterError}`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
