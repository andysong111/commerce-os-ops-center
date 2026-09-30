import {
  applyInternalChinaQuantityOverrides,
  loadInternalChinaQuantityOverrides,
  saveInternalChinaQuantityOverride,
} from "@/lib/internalChinaDraftQuantityOverride";
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
      message: "Ops Center 동일 출처 화면에서만 주문수량을 변경할 수 있습니다.",
      externalOrderExecuted: false,
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "INTERNAL_CHINA_QUANTITY_FAILED";
  const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_QUANTITY_FAILED";
  let message = raw;
  if (code === "INTERNAL_CHINA_DRAFT_NOT_FOUND") {
    message = "해당 내부 발주 Draft를 찾지 못했습니다.";
  } else if (code === "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED") {
    message = "이 발주월은 이미 마감했습니다. 주문수량 변경은 차단하고 기존 입고·원가 마감만 계속합니다.";
  } else if (code === "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED") {
    message = "이미 실제 주문완료로 기록된 Draft라 수량을 변경할 수 없습니다.";
  } else if (code === "INTERNAL_CHINA_QUANTITY_INVALID") {
    message = "주문수량은 1개 이상 9,999개 이하로 입력하세요.";
  } else if (code === "INTERNAL_CHINA_QUANTITY_BARCODE_INVALID") {
    message = `B-code 형식을 확인하세요: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "INTERNAL_CHINA_QUANTITY_BARCODE_NOT_IN_DRAFT") {
    message = `현재 Draft에 없는 B-code입니다: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  }
  const notFound = [
    "INTERNAL_CHINA_DRAFT_NOT_FOUND",
    "INTERNAL_CHINA_QUANTITY_BARCODE_NOT_IN_DRAFT",
  ].includes(code);
  const conflict = [
    "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED",
    "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED",
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
  const decodedDraftId = decodeURIComponent(draftId);
  try {
    const base = await loadInternalChinaPurchaseDraft(decodedDraftId);
    const overrides = await loadInternalChinaQuantityOverrides(decodedDraftId);
    const draft = applyInternalChinaQuantityOverrides(base, overrides);
    return Response.json(
      {
        ok: true,
        draft,
        overrides: [...overrides.values()],
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
    const base = await loadInternalChinaPurchaseDraft(decodedDraftId);
    await assertInternalChinaMonthlyPurchaseOpen(base.cycleMonth);
    if (base.status !== "DRAFT") {
      throw new Error("INTERNAL_CHINA_DRAFT_ALREADY_ORDERED");
    }
    const body = (await request.json().catch(() => ({}))) as {
      barcode?: unknown;
      targetQuantity?: unknown;
    };
    const barcode = String(body.barcode ?? "")
      .normalize("NFKC")
      .trim()
      .toUpperCase();
    if (!base.lines.some((line) => line.barcode === barcode)) {
      throw new Error(
        `INTERNAL_CHINA_QUANTITY_BARCODE_NOT_IN_DRAFT:${barcode}`,
      );
    }
    const saved = await saveInternalChinaQuantityOverride({
      draftId: decodedDraftId,
      barcode,
      targetQuantity: body.targetQuantity,
    });
    return Response.json(
      {
        ok: true,
        saved,
        message: `${barcode} 주문수량을 ${saved.targetQuantity.toLocaleString("ko-KR")}개로 즉시 저장했습니다. 실제 주문완료 기록 시 ORDERED·입고 원장에도 이 수량을 반영합니다.`,
        externalOrderExecuted: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
