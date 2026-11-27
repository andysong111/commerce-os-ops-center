import {
  applyShoplingOptionStatus,
  inspectShoplingBcodeOnGoodsKey,
  readShoplingStockVariants,
} from "@/lib/shopling/shoplingOptionStatus";
import { applyShoplingProductStatus } from "@/lib/shopling/shoplingProductStatus";
import { prepareShoplingStockBatch, resolveShoplingStockItem } from "@/lib/shopling/shoplingStockBatchService";
import { validateStockProductStep } from "@/lib/shopling/shoplingStockBatchPlan";
import {
  planShoplingGoodsKeyTransmission,
  shoplingProductStatusDisposition,
} from "@/lib/shopling/shoplingGoodsKeyTransmission";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { buildShoplingBlockedTransitionDetail } from "@/lib/shoplingStockFailureDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw === "SHOPLING_STOCK_PARENT_EXTENSION_REQUIRED") return "상품 판매상태까지 전송하려면 Shopling 확장을 v0.6.62 이상으로 업데이트해 주세요. 전송을 시작하기 전에 중단했습니다.";
  if (raw.startsWith("SHOPLING_STOCK_BATCH_PLAN_") || raw.startsWith("SHOPLING_STOCK_BATCH_INDEX_CHANGED:")) return `상품 또는 옵션 정보가 전송 계획과 다르거나 계획이 만료되었습니다. 현재 상태를 다시 조회해 새 작업을 시작해 주세요. (${raw})`;
  if (raw.startsWith("SHOPLING_STOCK_BATCH_PRODUCT_MISSING:")) return `Shopling에서 상품 전체 옵션을 조회할 수 없습니다. 상품과 B코드 연결을 확인해 주세요. (${raw})`;
  if (raw.startsWith("SHOPLING_STOCK_BATCH_PRODUCT_KIND_MISMATCH:")) return `단품으로 지정한 상품에서 여러 옵션이 확인되었습니다. 상품 형태를 확인해 주세요. (${raw})`;
  if (raw.startsWith("SHOPLING_CREDENTIAL_REQUIRED:")) {
    return "Shopling API 인증 환경변수가 설정되지 않았습니다. Commerce OS 서버 설정을 확인해야 합니다.";
  }
  if (raw.startsWith("SHOPLING_OPTION_EXACT_MATCH_REQUIRED:")) {
    const [, code, count] = raw.split(":");
    return `${code || "B코드"}와 정확히 일치하는 Shopling 옵션이 ${count || "0"}건이라 안전상 변경하지 않았습니다.`;
  }
  if (raw.startsWith("SHOPLING_BCODE_INDEX_")) {
    return `B코드 서버 인덱스를 사용할 수 없습니다. 인덱스 갱신 상태를 확인하세요. (${raw.split(":", 1)[0]})`;
  }
  if (raw.startsWith("SHOPLING_OPTION_COMBINATION_COUNT_MISMATCH:") || raw.startsWith("SHOPLING_OPTION_ARRAY_COUNT_MISMATCH:")) {
    return "Shopling 옵션 조합 배열을 안전하게 대응시킬 수 없어 변경하지 않았습니다.";
  }
  if (raw.startsWith("SHOPLING_OPTION_READBACK_") || raw.startsWith("SHOPLING_PRODUCT_READBACK_")) {
    return "Shopling API 수정 후 상태·재고수량 재조회 검증이 일치하지 않아 A21 전송을 차단했습니다.";
  }
  if (raw.startsWith("SHOPLING_OPTION_MODIFY_REJECTED:")) {
    return `Shopling 옵션상태 수정 API가 작업을 거절했습니다: ${raw.split(":").slice(1, 3).join(" · ")}`;
  }
  if (raw.startsWith("SHOPLING_OPTION_HTTP_")) {
    return `Shopling API 통신에 실패했습니다: ${raw}`;
  }
  return raw || "Shopling 옵션상태 API 처리에 실패했습니다.";
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_OPTION_STATUS_UNAUTHORIZED",
        message: "Commerce OS 동일 출처에서만 실행할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  let requestContext: { barcode: string; desiredStatus: string } = {
    barcode: "",
    desiredStatus: "",
  };
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.mode === "PREFLIGHT_BATCH") {
      const result = await prepareShoplingStockBatch(body.items);
      return Response.json({ok: true, result}, {headers: {"cache-control": "no-store"}});
    }
    const normalizedBarcode = barcode(body.barcode);
    const desiredStatus = text(body.desiredStatus).toUpperCase();
    const productKind = text(body.productKind).toUpperCase();
    requestContext = {
      barcode: normalizedBarcode,
      desiredStatus,
    };

    if (!/^B[A-Z]{2}\d+-\d+$/.test(normalizedBarcode)) {
      throw new Error("B코드 형식이 올바르지 않습니다.");
    }
    if (desiredStatus !== "SOLD_OUT" && desiredStatus !== "ON_SALE") {
      throw new Error("목표상태는 SOLD_OUT 또는 ON_SALE이어야 합니다.");
    }
    if (productKind !== "OPTION" && productKind !== "SINGLE") {
      throw new Error("상품형태는 OPTION 또는 SINGLE이어야 합니다.");
    }
    const upgradedClient = body.planVersion === 2;
    if (upgradedClient !== (typeof body.stockBatchPlan === "string") ||
        (body.planVersion != null && !upgradedClient) ||
        (body.stockBatchPlan != null && typeof body.stockBatchPlan !== "string")) {
      throw new Error("SHOPLING_STOCK_BATCH_PLAN_AND_VERSION_REQUIRED");
    }
    const { plan: itemPlan, indexedGoodsKeys } = await resolveShoplingStockItem(
      {barcode: normalizedBarcode, productKind, desiredStatus, goodsKeys: body.goodsKeys},
      body.stockBatchPlan, upgradedClient,
    );
    const receipts = [];
    const transmissions = [];
    const skippedEndedGoodsKeys: Array<{
      goodsKey: string;
      partnerGoodsCode: string;
      productSaleStatus: "E";
      reason: "SHOPLING_PRODUCT_ENDED";
    }> = [];
    for (const step of itemPlan.steps) {
      const {goodsKey} = step;
      const inspection = await inspectShoplingBcodeOnGoodsKey({barcode: normalizedBarcode, goodsKey});
      validateStockProductStep(step, inspection.siblings, "BEFORE");
      if (shoplingProductStatusDisposition(inspection.productSaleStatus) === "SKIP_ENDED") {
        skippedEndedGoodsKeys.push({
          goodsKey, partnerGoodsCode: inspection.partnerGoodsCode, productSaleStatus: "E", reason: "SHOPLING_PRODUCT_ENDED",
        });
        continue;
      }
      const plan = planShoplingGoodsKeyTransmission(productKind, {goodsKey, optionCount: inspection.goodsOptionCount});
      const optionReceipt = plan.applyExactOptionStatus
        ? await applyShoplingOptionStatus({
          barcode: normalizedBarcode, desiredStatus, goodsKeys: [goodsKey],
          validateBeforeWrite: (rows) => validateStockProductStep(step, rows, "BEFORE"),
        }) : null;
      if (plan.applyProductSaleStatus && !step.parentDesiredStatus) throw new Error(`SHOPLING_STOCK_BATCH_PLAN_STALE:${goodsKey}`);
      const productReceipt = step.parentDesiredStatus
        ? await applyShoplingProductStatus({
          barcode: normalizedBarcode, desiredStatus: step.parentDesiredStatus, goodsKey,
          validateBeforeWrite: (rows) => validateStockProductStep(step, rows, "OPTIONS_APPLIED"),
        }) : null;
      const primaryReceipt = productReceipt || optionReceipt;
      if (!primaryReceipt) throw new Error(`SHOPLING_GOODS_KEY_EXECUTION_PLAN_EMPTY:${goodsKey}`);
      receipts.push({
        matchedGoodsKey: goodsKey, barcode: normalizedBarcode, desiredStatus, goodsOptionCount: plan.optionCount,
        transmissionKind: plan.transmissionKind, effectiveProductKind: plan.effectiveProductKind,
        mutated: Boolean(optionReceipt?.mutated || productReceipt?.mutated), optionReceipt, productReceipt,
        optionQuantity: primaryReceipt.optionQuantity, optionQuantityAfter: primaryReceipt.optionQuantityAfter,
        verifiedAt: new Date().toISOString(),
      });
      transmissions.push({
        goodsKey, optionCount: plan.optionCount, transmissionKind: plan.transmissionKind,
        effectiveProductKind: plan.effectiveProductKind, desiredStatus,
      });
      if (plan.transmissionKind === "OPTION_SEND" && step.parentDesiredStatus) {
        transmissions.push({
          goodsKey, optionCount: plan.optionCount, transmissionKind: "PRODUCT_SALE_STATUS_SEND" as const,
          effectiveProductKind: "SINGLE" as const, desiredStatus: step.parentDesiredStatus,
        });
      }
    }
    const finalRows = await readShoplingStockVariants(itemPlan.steps.map((step) => step.goodsKey));
    for (const step of itemPlan.steps) {
      validateStockProductStep(step, finalRows.filter((row) => row.goodsKey === step.goodsKey), "COMPLETE");
    }
    transmissions.sort((a, b) => Number(a.transmissionKind !== "OPTION_SEND") - Number(b.transmissionKind !== "OPTION_SEND"));
    if (!receipts.length && !skippedEndedGoodsKeys.length) {
      throw new Error(`SHOPLING_BCODE_INDEX_STALE_NO_LIVE_MATCH:${normalizedBarcode}`);
    }
    const resolvedGoodsKeys = [...new Set(receipts.map((row) => row.matchedGoodsKey))];
    const result = {
      barcode: normalizedBarcode,
      productKind,
      desiredStatus,
      goodsKeys: resolvedGoodsKeys,
      transmissions,
      optionGoodsKeys: transmissions
        .filter((row) => row.transmissionKind === "OPTION_SEND")
        .map((row) => row.goodsKey),
      productStatusGoodsKeys: transmissions
        .filter((row) => row.transmissionKind === "PRODUCT_SALE_STATUS_SEND")
        .map((row) => row.goodsKey),
      planVersion: 2,
      indexedGoodsKeys,
      receipts,
      skippedEndedGoodsKeys,
      skippedEndedCount: skippedEndedGoodsKeys.length,
      noActionableGoodsKeys: receipts.length === 0,
      mutatedCount: receipts.filter((row) => row.mutated).length,
      verifiedCount: receipts.length,
      verifiedAt: new Date().toISOString(),
    };

    return Response.json(
      {
        ok: true,
        result,
        message: result.noActionableGoodsKeys
          ? `${result.barcode}는 판매종료(E) 상품만 있어 변경하거나 전송하지 않았습니다.`
          : `${result.mutatedCount
              ? `${result.barcode} Shopling 상태를 API로 변경하고 ${result.verifiedCount}건 모두 상태·수량 재조회 검증했습니다.`
              : `${result.barcode} Shopling 상태가 이미 목표상태라 ${result.verifiedCount}건 모두 변경 없이 검증했습니다.`}${result.skippedEndedCount
              ? ` 판매종료(E) ${result.skippedEndedCount}건은 변경·전송 대상에서 제외했습니다.`
              : ""}`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const blockedTransition = buildShoplingBlockedTransitionDetail(
      error,
      requestContext,
    );
    return Response.json(
      {
        ok: false,
        code:
          blockedTransition?.errorCode ||
          "SHOPLING_OPTION_STATUS_APPLY_FAILED",
        message: blockedTransition?.message || safeError(error),
        ...(blockedTransition
          ? { failureDetail: blockedTransition }
          : {}),
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
}
