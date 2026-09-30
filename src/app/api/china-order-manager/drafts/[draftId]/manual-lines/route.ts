import {
  addInternalChinaManualDraftLine,
  searchInternalChinaManualDraftCandidates,
} from "@/lib/internalChinaPurchaseDraftManualAdd";
import { assertInternalChinaMonthlyPurchaseOpen } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type RouteContext = {
  params: Promise<{ draftId: string }>;
};

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INTERNAL_CHINA_DRAFT_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 수동 발주품목을 추가할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : "INTERNAL_CHINA_MANUAL_ADD_FAILED";
  const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_MANUAL_ADD_FAILED";
  let message = raw;
  if (code === "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED") {
    message = "이 발주월은 이미 마감했습니다. 신규 품목 추가는 차단하고 기존 입고·원가 마감만 계속합니다.";
  } else if (code === "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED") {
    message = "이미 실제 주문 기록이 시작된 Draft에는 품목을 추가할 수 없습니다.";
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_AFTER_ORDER_STARTED") {
    message = "이 Draft에서 실제 주문 기록이 이미 시작되어 추가 품목을 넣을 수 없습니다.";
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_QUANTITY_INVALID") {
    message = "추가수량은 1개 이상 9,999개 이하로 입력하세요.";
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_QUANTITY_EXCEEDED") {
    message = "기존 수량과 추가수량의 합계는 B-code당 9,999개를 넘을 수 없습니다.";
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_BARCODE_NOT_ACTIVE") {
    message = `상품마스터에서 활성 B-code를 찾지 못했습니다: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_BARCODE_INVALID") {
    message = `B-code 형식을 확인하세요: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_CANCELLED_LINE") {
    message = `이 Draft에서 이미 취소된 B-code는 같은 Draft에 다시 추가하지 않습니다: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "INTERNAL_CHINA_MANUAL_ADD_REQUEST_ID_INVALID") {
    message = "수동 추가 요청 식별값이 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 시도하세요.";
  } else if (code === "CHINA_ORDER_LEDGER_UNAVAILABLE") {
    message = "발주·입고 원장을 불러오지 못해 안전하게 추가를 중단했습니다.";
  }
  const notFound = code === "INTERNAL_CHINA_MANUAL_ADD_BARCODE_NOT_ACTIVE";
  const conflict = [
    "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED",
    "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED",
    "INTERNAL_CHINA_MANUAL_ADD_AFTER_ORDER_STARTED",
    "INTERNAL_CHINA_MANUAL_ADD_CANCELLED_LINE",
  ].includes(code);
  return Response.json(
    { ok: false, code, message, externalOrderExecuted: false },
    {
      status: notFound ? 404 : conflict ? 409 : 400,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function GET(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  const url = new URL(request.url);
  try {
    const candidates = await searchInternalChinaManualDraftCandidates(
      decodeURIComponent(draftId),
      url.searchParams.get("q") ?? "",
    );
    return Response.json(
      {
        ok: true,
        candidates,
        message: candidates.length
          ? `${candidates.length}개 B-code를 찾았습니다.`
          : "조건에 맞는 활성 B-code가 없습니다.",
        externalOrderExecuted: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  const decodedDraftId = decodeURIComponent(draftId);
  try {
    const draft = await loadInternalChinaPurchaseDraft(decodedDraftId);
    await assertInternalChinaMonthlyPurchaseOpen(draft.cycleMonth);
    const body = (await request.json().catch(() => ({}))) as {
      barcode?: unknown;
      addQuantity?: unknown;
      requestId?: unknown;
    };
    const result = await addInternalChinaManualDraftLine({
      draftId: decodedDraftId,
      barcode: body.barcode,
      addQuantity: body.addQuantity,
      requestId: body.requestId,
    });
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.duplicate
          ? "같은 추가 요청이 이미 반영되어 중복으로 늘리지 않았습니다."
          : `${result.line?.barcode ?? String(body.barcode ?? "")}를 현재 월간 Draft에 +${result.addedQuantity.toLocaleString("ko-KR")}개 추가했습니다. 현재 RESERVED 수량은 ${result.targetQuantity.toLocaleString("ko-KR")}개입니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
