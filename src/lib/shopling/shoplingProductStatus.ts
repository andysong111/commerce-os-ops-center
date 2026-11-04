import {
  assertMonthlyWriteAcknowledgement,
  buildMonthlySaleStatusWriteXml,
} from "@/lib/monthlyPriceShopling";
import {
  inspectShoplingBcodeOnGoodsKey,
  type ShoplingOptionDesiredStatus,
} from "@/lib/shopling/shoplingOptionStatus";
import { shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

const DEFAULT_MODIFY_URL =
  "https://api.shopling.co.kr/prod/prod_modify_api.phtml?mode=2";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type ShoplingProductStatusApplyResult = {
  matchedGoodsKey: string;
  barcode: string;
  desiredStatus: ShoplingOptionDesiredStatus;
  targetStatusCode: "B" | "C";
  statusBefore: "B" | "C";
  statusAfter: "B" | "C";
  optionQuantity: string;
  optionQuantityAfter: string;
  optionId: string;
  mutated: boolean;
  modifyCode: string;
  successCount: number;
  failCount: number;
  verifiedAt: string;
};

export async function applyShoplingProductStatus(input: {
  barcode: string;
  desiredStatus: ShoplingOptionDesiredStatus;
  goodsKey: string;
  env?: Record<string, string | undefined>;
}): Promise<ShoplingProductStatusApplyResult> {
  const env = input.env ?? process.env;
  const target = input.desiredStatus === "SOLD_OUT" ? "C" : "B";
  const before = await inspectShoplingBcodeOnGoodsKey({
    barcode: input.barcode,
    goodsKey: input.goodsKey,
    env,
  });
  if (before.productSaleStatus !== "B" && before.productSaleStatus !== "C") {
    throw new Error(
      `SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED:${before.productSaleStatus || "EMPTY"}`,
    );
  }
  if (before.productSaleStatus === target) {
    return {
      matchedGoodsKey: before.goodsKey,
      barcode: input.barcode,
      desiredStatus: input.desiredStatus,
      targetStatusCode: target,
      statusBefore: target,
      statusAfter: target,
      optionQuantity: before.optionQuantity,
      optionQuantityAfter: before.optionQuantity,
      optionId: before.optionId,
      mutated: false,
      modifyCode: "NOOP_ALREADY_DESIRED",
      successCount: 0,
      failCount: 0,
      verifiedAt: new Date().toISOString(),
    };
  }

  const config = shoplingReadConfigFromEnv(env);
  const xml = buildMonthlySaleStatusWriteXml(before.goodsKey, target, config);
  const response = await postShoplingXml(
    env.SHOPLING_PRODUCTS_MODIFY_API_URL?.trim() || DEFAULT_MODIFY_URL,
    xml,
    {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-shopling-product-status/1.0",
      },
      timeoutMs: 45_000,
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`SHOPLING_PRODUCT_STATUS_HTTP_${response.status}`);
  assertMonthlyWriteAcknowledgement(body, before.goodsKey);

  let after = before;
  for (const delay of [0, 400, 1_200]) {
    if (delay) await sleep(delay);
    after = await inspectShoplingBcodeOnGoodsKey({
      barcode: input.barcode,
      goodsKey: before.goodsKey,
      env,
    });
    if (
      after.productSaleStatus === target &&
      after.optionQuantity === before.optionQuantity
    ) {
      return {
        matchedGoodsKey: before.goodsKey,
        barcode: input.barcode,
        desiredStatus: input.desiredStatus,
        targetStatusCode: target,
        statusBefore: before.productSaleStatus as "B" | "C",
        statusAfter: after.productSaleStatus as "B" | "C",
        optionQuantity: before.optionQuantity,
        optionQuantityAfter: after.optionQuantity,
        optionId: before.optionId,
        mutated: true,
        modifyCode: "000",
        successCount: 1,
        failCount: 0,
        verifiedAt: new Date().toISOString(),
      };
    }
  }
  if (after.optionQuantity !== before.optionQuantity) {
    throw new Error(
      `SHOPLING_PRODUCT_READBACK_QTY_MISMATCH:${before.optionQuantity}:${after.optionQuantity || "EMPTY"}`,
    );
  }
  throw new Error(
    `SHOPLING_PRODUCT_READBACK_STATUS_MISMATCH:${target}:${after.productSaleStatus || "EMPTY"}`,
  );
}
