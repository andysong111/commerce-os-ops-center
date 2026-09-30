import {
  loadInternalChinaDraftWithQuantityOverrides,
  recordOrderedQuantityOverrideCorrections,
  stripDraftInputQuantities,
} from "@/lib/internalChinaDraftQuantityOverride";
import { assertInternalChinaMonthlyPurchaseOpen } from "@/lib/internalChinaMonthlyPurchaseClose";
import {
  loadInternalChinaPurchaseDraft,
  markInternalChinaPurchaseDraftOrdered,
  saveInternalChinaPurchaseDraft,
  type InternalChinaPurchaseDraftInput,
} from "@/lib/internalChinaPurchaseDraft";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import { updateModelFixedSupplierLink } from "@/lib/productLaunchPurchaseMetadataWrite";

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
      message: "Ops Center 동일 출처 화면에서만 중국 발주초안을 사용할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "INTERNAL_CHINA_DRAFT_FAILED";
  const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_DRAFT_FAILED";
  let message = raw;
  if (code === "INTERNAL_CHINA_DRAFT_NOT_FOUND") {
    message = "해당 내부 발주 Draft를 찾지 못했습니다.";
  } else if (code === "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED") {
    message = "이미 실제 주문완료로 기록된 Draft입니다.";
  } else if (code === "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED") {
    message = `이 발주월은 이미 마감했습니다. 추가 발주·수량·주문완료 변경은 차단하고 기존 입고·원가 마감만 계속합니다: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "INTERNAL_CHINA_EXCHANGE_RATE_INVALID") {
    message = "적용 환율을 확인하세요.";
  } else if (code === "INTERNAL_CHINA_QUANTITY_LOCKED") {
    message = "주문수량은 상단 `현재 Draft 수량 조정`에서 변경한 뒤 다시 저장하세요.";
  } else if (code === "INTERNAL_CHINA_ORDER_REQUIRED") {
    message = `실제 주문완료 기록 전에 필수값을 확인하세요. ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "PRODUCT_LAUNCH_SUPPLIER_LINK_REQUIRED") {
    message = "모델 고정 1번 1688 링크를 입력하세요.";
  } else if (code === "PRODUCT_LAUNCH_SUPPLIER_LINK_INVALID") {
    message = "올바른 http/https 1688 링크를 입력하세요.";
  } else if (code === "PRODUCT_LAUNCH_SUPPLIER_LINK_TOO_LONG") {
    message = "중국 주문링크는 4,000자 이하로 입력하세요.";
  } else if (code === "PRODUCT_LAUNCH_MODEL_NOT_FOUND") {
    message = `상품출시진행관리에서 해당 모델번호를 찾지 못했습니다: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "PRODUCT_LAUNCH_MODEL_CONFLICT") {
    message = `상품출시진행관리에 같은 모델번호가 여러 건 있어 자동 역저장을 중단했습니다: ${raw
      .split(":")
      .slice(1)
      .join(":")}`;
  } else if (code === "PRODUCT_LAUNCH_CONCURRENT_UPDATE") {
    message = "상품출시진행관리 데이터가 동시에 변경됐습니다. 화면을 새로고침한 뒤 다시 저장하세요.";
  }
  const notFound = [
    "INTERNAL_CHINA_DRAFT_NOT_FOUND",
    "PRODUCT_LAUNCH_MODEL_NOT_FOUND",
  ].includes(code);
  const conflict = [
    "INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED",
    "PRODUCT_LAUNCH_MODEL_CONFLICT",
    "PRODUCT_LAUNCH_CONCURRENT_UPDATE",
  ].includes(code);
  return Response.json(
    { ok: false, code, message, externalOrderExecuted: false },
    {
      status: notFound ? 404 : conflict ? 409 : 400,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function assertDraftPurchaseCycleOpen(draftId: string) {
  const draft = await loadInternalChinaPurchaseDraft(draftId);
  await assertInternalChinaMonthlyPurchaseOpen(draft.cycleMonth);
  return draft;
}

export async function GET(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  try {
    const base = await loadInternalChinaPurchaseDraft(
      decodeURIComponent(draftId),
    );
    const draft = await loadInternalChinaDraftWithQuantityOverrides(base);
    return Response.json(
      { ok: true, draft, externalOrderExecuted: false },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  const decodedDraftId = decodeURIComponent(draftId);
  try {
    await assertDraftPurchaseCycleOpen(decodedDraftId);
    const input = (await request.json()) as InternalChinaPurchaseDraftInput;
    const saved = await saveInternalChinaPurchaseDraft(
      decodedDraftId,
      stripDraftInputQuantities(input),
    );
    const draft = await loadInternalChinaDraftWithQuantityOverrides(saved);
    return Response.json(
      {
        ok: true,
        draft,
        message:
          "Ops Center 중국 발주초안을 저장했습니다. 수량 조정값도 유지하며 실제 1688 주문·결제는 실행하지 않았습니다.",
        externalOrderExecuted: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, {
      status: identity.status,
      headers: { "cache-control": "no-store" },
    });
  }
  const { draftId } = await context.params;
  const decodedDraftId = decodeURIComponent(draftId);
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      modelNo?: unknown;
      supplierLink?: unknown;
    };
    if (String(body.action ?? "") !== "UPDATE_MODEL_SUPPLIER_LINK") {
      return Response.json(
        {
          ok: false,
          code: "INTERNAL_CHINA_ACTION_INVALID",
          message: "지원하지 않는 중국 발주초안 변경 작업입니다.",
          externalOrderExecuted: false,
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const write = await updateModelFixedSupplierLink({
      identity: identity.value,
      modelNumber: body.modelNo,
      supplierLink: body.supplierLink,
      source: "CHINA_ORDER_DRAFT",
      draftId: decodedDraftId,
    });
    const base = await loadInternalChinaPurchaseDraft(decodedDraftId);
    const draft = await loadInternalChinaDraftWithQuantityOverrides(base);
    return Response.json(
      {
        ok: true,
        draft,
        modelNo: write.modelNumber,
        supplierLink: write.supplierLink,
        savedAt: write.savedAt,
        productMasterSynced: write.productMaster.ok,
        productMasterError: write.productMaster.error ?? null,
        message: write.productMaster.ok
          ? "Draft에서 입력한 링크를 상품출시진행관리의 모델 고정 1번 링크로 역저장하고 상품마스터 최신 원장에도 반영했습니다."
          : `상품출시진행관리에는 역저장했지만 상품마스터 최신 원장 동기화를 다시 확인해야 합니다: ${write.productMaster.error}`,
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
    await assertDraftPurchaseCycleOpen(decodedDraftId);
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      prep?: InternalChinaPurchaseDraftInput;
    };
    if (String(body.action ?? "") !== "MARK_ORDERED") {
      return Response.json(
        {
          ok: false,
          code: "INTERNAL_CHINA_ACTION_INVALID",
          message: "지원하지 않는 중국 발주초안 작업입니다.",
          externalOrderExecuted: false,
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const result = await markInternalChinaPurchaseDraftOrdered(
      decodedDraftId,
      stripDraftInputQuantities(body.prep ?? {}),
    );
    const quantityCorrections =
      await recordOrderedQuantityOverrideCorrections(decodedDraftId);
    const reloaded = await loadInternalChinaPurchaseDraft(decodedDraftId);
    const draft = await loadInternalChinaDraftWithQuantityOverrides(reloaded);
    return Response.json(
      {
        ok: true,
        ...result,
        draft,
        quantityCorrections: quantityCorrections.correctedCount,
        message: result.duplicate
          ? "이미 실제 1688 주문완료로 기록된 Draft입니다. 수량 조정 원장도 다시 확인했습니다."
          : `실제 1688 주문을 완료한 것으로 Ops Center 원장에 기록했습니다. 수량 조정 ${quantityCorrections.correctedCount.toLocaleString("ko-KR")}건도 ORDERED·입고 기준에 반영했습니다. 이 버튼 자체가 1688 주문·결제를 실행한 것은 아닙니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
