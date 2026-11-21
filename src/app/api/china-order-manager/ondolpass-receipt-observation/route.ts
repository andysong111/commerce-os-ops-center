import {
  loadInternalChinaOndolpassReceiptContext,
  recordInternalChinaOndolpassReceiptObservation,
  saveInternalChinaOndolpassOrderNumberCorrection,
} from "@/lib/internalChinaOndolpassReceiptObservation";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "ONDOLPASS_RECEIPT_UNAUTHORIZED",
      message: "로그인된 Ops Center 업무센터에서만 입고현황을 확인할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "ONDOLPASS_RECEIPT_FAILED";
  const code = raw.split(":", 1)[0] || "ONDOLPASS_RECEIPT_FAILED";
  const messages: Record<string, string> = {
    ONDOLPASS_RECEIPT_DRAFT_INVALID: "발주차시 번호가 올바르지 않습니다.",
    ONDOLPASS_RECEIPT_BARCODE_COMPLETION_REQUIRED:
      "3단계 바코드 업무 완료 근거가 없습니다.",
    ONDOLPASS_RECEIPT_EVIDENCE_CONFLICT:
      "업무센터가 읽은 완료 근거와 현재 서버 근거가 다릅니다. 새로고침 후 다시 확인하세요.",
    ONDOLPASS_RECEIPT_OBSERVED_AT_INVALID:
      "온돌패스 확인시각이 올바르지 않습니다.",
    ONDOLPASS_RECEIPT_APPLICATIONS_REQUIRED:
      "온돌패스 신청현황을 읽지 못했습니다.",
    ONDOLPASS_RECEIPT_APPLICATION_IDENTITY_INVALID:
      "온돌패스 신청번호가 누락되거나 중복되었습니다.",
    ONDOLPASS_RECEIPT_ROWS_REQUIRED:
      "온돌패스 신청서 품목 행을 읽지 못했습니다.",
    ONDOLPASS_RECEIPT_ROW_INVALID:
      "온돌패스 품목 행의 번호·수량·상태가 올바르지 않습니다.",
    ONDOLPASS_RECEIPT_ROW_SET_MISMATCH:
      "완료 근거의 신청번호·행번호와 온돌패스 화면이 정확히 일치하지 않습니다.",
    ONDOLPASS_RECEIPT_STATUS_REGRESSION:
      "이전에 입고로 확인한 품목이 대기로 되돌아가 저장을 차단했습니다.",
    ONDOLPASS_RECEIPT_STORE_READBACK_FAILED:
      "입고현황 저장 결과를 다시 확인하지 못했습니다. 반복 클릭하지 말고 잠시 뒤 새로고침하세요.",
    ONDOLPASS_ORDER_CORRECTION_DRAFT_INVALID:
      "주문번호를 수정할 발주차시가 올바르지 않습니다.",
    ONDOLPASS_ORDER_CORRECTION_ROW_INVALID:
      "주문번호를 수정할 온돌패스 신청행이 올바르지 않습니다.",
    ONDOLPASS_ORDER_CORRECTION_ORDER_NO_INVALID:
      "1688 주문번호 19자리를 입력하세요.",
    ONDOLPASS_ORDER_CORRECTION_ROW_NOT_FOUND:
      "최근 온돌패스 확인결과에서 해당 품목행을 찾지 못했습니다. 11-2 입고현황을 다시 확인하세요.",
    ONDOLPASS_ORDER_CORRECTION_OBSERVED_ORDER_CONFLICT:
      "입력한 주문번호가 온돌패스에서 현재 감지된 번호와 다릅니다. 11-2 입고현황을 다시 확인하세요.",
    ONDOLPASS_ORDER_CORRECTION_ALREADY_MATCHED:
      "이미 같은 주문번호로 정상 매칭된 품목입니다.",
    ONDOLPASS_ORDER_CORRECTION_STORE_FAILED:
      "주문번호 수정 이력을 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.",
  };
  const status =
    code === "SUPABASE_ADMIN_NOT_CONFIGURED" ||
    code === "ONDOLPASS_RECEIPT_READ_FAILED" ||
    code === "ONDOLPASS_RECEIPT_STORE_FAILED" ||
    code === "ONDOLPASS_ORDER_CORRECTION_STORE_FAILED" ||
    code === "ONDOLPASS_RECEIPT_STORE_READBACK_FAILED"
      ? 503
      : code === "ONDOLPASS_RECEIPT_BARCODE_COMPLETION_REQUIRED"
        ? 409
        : 400;
  return Response.json(
    { ok: false, code, message: messages[code] ?? raw },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const draftId = new URL(request.url).searchParams.get("draftId");
    const loaded = await loadInternalChinaOndolpassReceiptContext(draftId);
    const context = {
      draftId: loaded.draftId,
      cycleMonth: loaded.cycleMonth,
      historyRecordId: loaded.historyRecordId,
      evidenceHash: loaded.evidenceHash,
      applications: loaded.applications,
      expectedRows: loaded.expectedRows,
      observation: loaded.observation,
    };
    return Response.json(
      { ok: true, context },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const input = await request.json().catch(() => ({}));
    const result = await saveInternalChinaOndolpassOrderNumberCorrection(input);
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.observation
          ? "주문번호를 수정하고 최근 온돌패스 입고현황을 다시 매칭했습니다."
          : "주문번호 수정 이력을 저장했습니다. 11-2 입고현황을 다시 확인하세요.",
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const input = await request.json().catch(() => ({}));
    const result = await recordInternalChinaOndolpassReceiptObservation(input);
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.alreadyRecorded
          ? "같은 온돌패스 입고현황이라 기존 관찰 근거를 유지했습니다."
          : result.observation.complete
            ? "모든 완료 근거 품목의 입고를 확인했습니다. 반복 예약을 자동 종료할 수 있습니다."
            : `온돌패스 입고현황을 저장했습니다. ${result.observation.receivedRowCount}/${result.observation.rowCount}행 입고 확인.`,
      },
      {
        status: result.alreadyRecorded ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
