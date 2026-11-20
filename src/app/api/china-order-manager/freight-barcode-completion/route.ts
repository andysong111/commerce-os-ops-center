import {
  completeInternalChinaFreightBarcode,
  loadInternalChinaFreightBarcodeCompletion,
} from "@/lib/internalChinaFreightBarcodeCompletion";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : "FREIGHT_BARCODE_COMPLETION_FAILED";
  const code = raw.split(":", 1)[0] || "FREIGHT_BARCODE_COMPLETION_FAILED";
  const messages: Record<string, string> = {
    FREIGHT_BARCODE_COMPLETION_DRAFT_INVALID:
      "바코드 업무를 완료할 발주차시 번호가 올바르지 않습니다.",
    FREIGHT_BARCODE_COMPLETION_CYCLE_MONTH_INVALID:
      "바코드 업무를 완료할 발주월이 올바르지 않습니다.",
    FREIGHT_BARCODE_COMPLETION_HISTORY_REQUIRED:
      "서버 문서 보관함에서 완료 근거 파일 한 건을 선택하세요.",
    FREIGHT_BARCODE_COMPLETION_PURCHASE_NOT_FOUND:
      "선택한 발주차시의 실제 주문 원장을 찾지 못했습니다.",
    FREIGHT_BARCODE_COMPLETION_CYCLE_MONTH_CONFLICT:
      "화면의 발주월과 실제 주문 원장의 발주월이 다릅니다. 발주차시 화면에서 다시 들어오세요.",
    FREIGHT_BARCODE_COMPLETION_ORDER_REQUIRED:
      "실제 1688 주문이 기록된 뒤 바코드 업무를 완료할 수 있습니다.",
    FREIGHT_BARCODE_COMPLETION_ASSIGNED_ORDER_REQUIRED:
      "B-code가 연결된 실제 주문 품목이 없어 바코드 업무를 완료할 수 없습니다.",
    FREIGHT_BARCODE_COMPLETION_HISTORY_NOT_FOUND:
      "선택한 서버 문서를 찾지 못했습니다. 서버 목록을 새로고침하세요.",
    FREIGHT_BARCODE_COMPLETION_HISTORY_EMPTY:
      "선택한 서버 문서에 완료 근거로 사용할 품목이 없습니다.",
    FREIGHT_BARCODE_COMPLETION_HISTORY_MATCH_INCOMPLETE:
      "선택한 서버 문서의 모든 품목이 B-code에 연결되지 않았습니다. 매칭을 완료한 파일을 선택하세요.",
    FREIGHT_BARCODE_COMPLETION_APPLICATION_REQUIRED:
      "선택한 서버 문서에 신청번호가 없습니다. 신청번호가 저장된 최종 파일을 선택하세요.",
    FREIGHT_BARCODE_COMPLETION_HISTORY_TIMESTAMP_INVALID:
      "선택한 서버 문서의 저장시각을 확인할 수 없습니다.",
    FREIGHT_BARCODE_COMPLETION_ALREADY_COMPLETED:
      "이 발주차시는 이미 다른 서버 문서로 바코드 업무가 완료되었습니다. 기존 완료 근거를 유지합니다.",
    FREIGHT_BARCODE_COMPLETION_STORE_READBACK_FAILED:
      "완료 원장 저장 결과를 다시 확인하지 못했습니다. 다시 누르지 말고 잠시 뒤 발주차시 화면을 새로고침하세요.",
  };
  const status =
    code === "SUPABASE_ADMIN_NOT_CONFIGURED" ||
    code === "FREIGHT_BARCODE_COMPLETION_READ_FAILED" ||
    code === "FREIGHT_BARCODE_COMPLETION_STORE_FAILED" ||
    code === "FREIGHT_BARCODE_COMPLETION_STORE_READBACK_FAILED"
      ? 503
      : code === "FREIGHT_BARCODE_COMPLETION_PURCHASE_NOT_FOUND" ||
          code === "FREIGHT_BARCODE_COMPLETION_HISTORY_NOT_FOUND"
        ? 404
        : code === "FREIGHT_BARCODE_COMPLETION_ALREADY_COMPLETED"
          ? 409
          : 400;
  return Response.json(
    { ok: false, code, message: messages[code] ?? raw },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    const draftId = new URL(request.url).searchParams.get("draftId");
    const completion = await loadInternalChinaFreightBarcodeCompletion(draftId);
    return Response.json(
      { ok: true, completion },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "FREIGHT_BARCODE_COMPLETION_UNAUTHORIZED",
        message:
          "Ops Center의 발주차시 바코드 화면에서만 업무를 완료할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const input = (await request.json().catch(() => ({}))) as {
      draftId?: unknown;
      cycleMonth?: unknown;
      historyRecordId?: unknown;
    };
    const result = await completeInternalChinaFreightBarcode(input);
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.alreadyCompleted
          ? "이미 같은 서버 문서로 바코드 업무가 완료되어 기존 완료 원장을 유지했습니다."
          : "선택한 서버 문서를 완료 근거로 확정했습니다. 발주차시 3단계가 완료되고 4단계 입고가 활성화됩니다.",
      },
      {
        status: result.alreadyCompleted ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
