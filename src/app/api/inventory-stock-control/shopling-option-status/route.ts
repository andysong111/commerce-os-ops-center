import {
  applyShoplingOptionStatus,
  inspectShoplingBcodeOnGoodsKey,
} from "@/lib/shopling/shoplingOptionStatus";
import { applyShoplingProductStatus } from "@/lib/shopling/shoplingProductStatus";
import { loadIndexedShoplingGoodsKeys } from "@/lib/shopling/shoplingBcodeIndex";
import { planShoplingGoodsKeyTransmission } from "@/lib/shopling/shoplingGoodsKeyTransmission";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

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

function goodsKeys(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [
    ...new Set(
      value
        .map((item) => text(item))
        .filter((item) => /^\d+$/.test(item)),
    ),
  ];
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.startsWith("SHOPLING_CREDENTIAL_REQUIRED:")) {
    return "Shopling API 인증 환경변수가 설정되지 않았습니다. Commerce OS 서버 설정을 확인해야 합니다.";
  }
  if (raw.startsWith("SHOPLING_OPTION_EXACT_MATCH_REQUIRED:")) {
    const [, code, count] = raw.split(":");
    return `${code || "B코드"}와 정확히 일치하는 Shopling 옵션이 ${count || "0"}건이라 안전상 변경하지 않았습니다.`;
  }
  if (raw.startsWith("SHOPLING_OPTION_STATUS_TRANSITION_BLOCKED:")) {
    return "대상 옵션이 판매/품절(B/C) 상태가 아니어서 자동 전환을 차단했습니다.";
  }
  if (raw.startsWith("SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED:")) {
    return "대상 상품이 판매/품절(B/C) 상태가 아니어서 자동 전환을 차단했습니다.";
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

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const normalizedBarcode = barcode(body.barcode);
    const desiredStatus = text(body.desiredStatus).toUpperCase();
    const requestedGoodsKeys = goodsKeys(body.goodsKeys);
    const productKind = text(body.productKind).toUpperCase();

    if (!/^B[A-Z]{2}\d+-\d+$/.test(normalizedBarcode)) {
      throw new Error("B코드 형식이 올바르지 않습니다.");
    }
    if (desiredStatus !== "SOLD_OUT" && desiredStatus !== "ON_SALE") {
      throw new Error("목표상태는 SOLD_OUT 또는 ON_SALE이어야 합니다.");
    }
    if (productKind !== "OPTION" && productKind !== "SINGLE") {
      throw new Error("상품형태는 OPTION 또는 SINGLE이어야 합니다.");
    }
    const indexedGoodsKeys = await loadIndexedShoplingGoodsKeys(normalizedBarcode);
    if (!indexedGoodsKeys.length) {
      throw new Error(`SHOPLING_BCODE_INDEX_MISSING:${normalizedBarcode}`);
    }
    const candidateGoodsKeys = [...new Set([...indexedGoodsKeys, ...requestedGoodsKeys])];
    const receipts = [];
    const transmissions = [];
    for (const goodsKey of candidateGoodsKeys) {
      try {
        const inspection = await inspectShoplingBcodeOnGoodsKey({
          barcode: normalizedBarcode,
          goodsKey,
        });
        const plan = planShoplingGoodsKeyTransmission(
          productKind as "OPTION" | "SINGLE",
          { goodsKey, optionCount: inspection.goodsOptionCount },
        );
        const optionReceipt = plan.applyExactOptionStatus
          ? await applyShoplingOptionStatus({
              barcode: normalizedBarcode,
              desiredStatus,
              goodsKeys: [goodsKey],
            })
          : null;
        const productReceipt = plan.applyProductSaleStatus
          ? await applyShoplingProductStatus({
              barcode: normalizedBarcode,
              desiredStatus,
              goodsKey,
            })
          : null;
        const primaryReceipt = productReceipt || optionReceipt;
        if (!primaryReceipt) {
          throw new Error(`SHOPLING_GOODS_KEY_EXECUTION_PLAN_EMPTY:${goodsKey}`);
        }
        const receipt = {
          matchedGoodsKey: primaryReceipt.matchedGoodsKey,
          barcode: normalizedBarcode,
          desiredStatus,
          goodsOptionCount: plan.optionCount,
          transmissionKind: plan.transmissionKind,
          effectiveProductKind: plan.effectiveProductKind,
          mutated: Boolean(optionReceipt?.mutated || productReceipt?.mutated),
          optionReceipt,
          productReceipt,
          optionQuantity: primaryReceipt.optionQuantity,
          optionQuantityAfter: primaryReceipt.optionQuantityAfter,
          verifiedAt: new Date().toISOString(),
        };
        receipts.push(receipt);
        transmissions.push({
          goodsKey: receipt.matchedGoodsKey,
          optionCount: plan.optionCount,
          transmissionKind: plan.transmissionKind,
          effectiveProductKind: plan.effectiveProductKind,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error ?? "");
        if (raw === `SHOPLING_OPTION_EXACT_MATCH_REQUIRED:${normalizedBarcode}:0`) {
          continue;
        }
        throw error;
      }
    }
    if (!receipts.length) {
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
      indexedGoodsKeys,
      receipts,
      mutatedCount: receipts.filter((row) => row.mutated).length,
      verifiedCount: receipts.length,
      verifiedAt: new Date().toISOString(),
    };

    return Response.json(
      {
        ok: true,
        result,
        message: result.mutatedCount
          ? `${result.barcode} Shopling 상태를 API로 변경하고 ${result.verifiedCount}건 모두 상태·수량 재조회 검증했습니다.`
          : `${result.barcode} Shopling 상태가 이미 목표상태라 ${result.verifiedCount}건 모두 변경 없이 검증했습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_OPTION_STATUS_APPLY_FAILED",
        message: safeError(error),
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
}
