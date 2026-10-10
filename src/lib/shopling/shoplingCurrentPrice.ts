import { parseShoplingReadResponse, shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import {
  SHOPLING_CURRENT_PRICE_LOOKUP_BATCH_SIZE,
  buildShoplingProductIdLookupXml,
  currentPriceGoodsKeys,
  resolveShoplingCurrentPrices,
  type ShoplingCurrentPriceSnapshot,
} from "@/lib/shopling/shoplingCurrentPriceResolver";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import type { PlanningProduct } from "@/lib/shopling/shoplingLiveAggregation";

export {
  buildShoplingProductIdLookupXml,
  resolveShoplingCurrentPrices,
  type ShoplingCurrentPriceListing,
  type ShoplingCurrentPriceRow,
  type ShoplingCurrentPriceSnapshot,
  type ShoplingCurrentPriceState,
} from "@/lib/shopling/shoplingCurrentPriceResolver";

const PRODUCT_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "org_price",
  "sale_price",
  "list_price",
  "model_no",
  "sale_status",
].join(",");

type RawRow = Record<string, unknown>;

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

function batches(values: string[]) {
  const output: string[][] = [];
  for (
    let index = 0;
    index < values.length;
    index += SHOPLING_CURRENT_PRICE_LOOKUP_BATCH_SIZE
  ) {
    output.push(
      values.slice(index, index + SHOPLING_CURRENT_PRICE_LOOKUP_BATCH_SIZE),
    );
  }
  return output;
}

export async function loadShoplingCurrentPriceSnapshot(
  products: PlanningProduct[],
  options: { requestTimeoutMs?: number } = {},
): Promise<ShoplingCurrentPriceSnapshot> {
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const goodsKeys = currentPriceGoodsKeys(products);
  if (!goodsKeys.length) {
    return resolveShoplingCurrentPrices(products, []);
  }

  const requestTimeoutMs = Math.max(
    1_000,
    Math.min(45_000, Math.trunc(options.requestTimeoutMs ?? 45_000)),
  );
  const sourceRows: RawRow[] = [];
  for (const batch of batches(goodsKeys)) {
    const xml = buildShoplingProductIdLookupXml(config, batch, PRODUCT_FIELDS);
    const response = await postShoplingXml(config.productsUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-ops-center-shopling-current-price/1.0",
      },
      timeoutMs: requestTimeoutMs,
    });
    if (!response.ok) {
      throw new Error(`SHOPLING_CURRENT_PRICE_HTTP_${response.status}`);
    }
    const body = await response.text();
    sourceRows.push(
      ...(parseShoplingReadResponse("products", body) as RawRow[]),
    );
  }
  return resolveShoplingCurrentPrices(products, sourceRows);
}
