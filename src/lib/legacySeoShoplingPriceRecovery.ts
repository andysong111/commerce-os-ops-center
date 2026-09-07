import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  DEFAULT_SHOPLING_READ_URLS,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import { resolveLegacyShoplingOptionSalePrice } from "@/lib/legacySeoShoplingPriceMath";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { isLegacySeoRegistrationExcluded } from "@/lib/legacySeoRegistrationPolicy";

type UnknownRecord = Record<string, unknown>;

type RecoveryIssue = {
  modelNumber: string;
  saleOption: string;
  reason: string;
};

const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const MAX_MODELS = 100;
const MAX_GOODS_PER_REQUEST = 40;
const PATCH_CONCURRENCY = 10;
const PRODUCT_LOOKUP_FIELDS = [
  "goods_key",
  "sale_price",
  "ptn_goods_cd",
  "sale_status",
].join(",");

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return text(value);
  const row = record(value);
  return scalar(row["#text"] ?? row.__cdata ?? row.cdata);
}

function normalizeModel(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeGoodsKey(value: unknown) {
  const normalized = text(value);
  return /^\d{5,12}$/.test(normalized) ? normalized : "";
}

function normalizeCode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function valueKey(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/[\s,，/|:：()\[\]{}._-]+/g, "");
}

function unique(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function optionValue(optionName: unknown) {
  const normalized = text(optionName);
  if (!normalized || normalized === "단품") return "단품";
  return (
    normalized
      .split(/\s*\/\s*/)
      .map((part) => {
        const index = part.search(/[:：]/);
        return index >= 0 ? part.slice(index + 1).trim() : part.trim();
      })
      .filter(Boolean)
      .join(" ") || normalized
  );
}

function xmlCdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function buildProductLookupXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  goodsKeys: string[],
) {
  const normalized = unique(goodsKeys.map(normalizeGoodsKey)).slice(0, MAX_GOODS_PER_REQUEST);
  if (!normalized.length) throw new Error("LEGACY_SEO_PRICE_GOODS_KEYS_REQUIRED");
  const today = todayYmd();
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdGather>${[
    `<login_id>${xmlCdata(config.loginId)}</login_id>`,
    `<company_id>${xmlCdata(config.companyId)}</company_id>`,
    `<api_auth_key>${xmlCdata(config.authKey)}</api_auth_key>`,
    `<search_tp>${xmlCdata("수정일")}</search_tp>`,
    `<start_dt>${today}</start_dt>`,
    `<end_dt>${today}</end_dt>`,
    `<key_search_tp>${xmlCdata("상품코드")}</key_search_tp>`,
    `<prod_id>${xmlCdata(normalized.join(","))}</prod_id>`,
    `<prod_fields>${xmlCdata(PRODUCT_LOOKUP_FIELDS)}</prod_fields>`,
    "<opt_yn>Y</opt_yn><attri_yn>N</attri_yn>",
  ].join("")}</apiProdGather></reqst>`;
}

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL:
      process.env.SHOPLING_PRODUCTS_API_URL || DEFAULT_SHOPLING_READ_URLS.products,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

async function fetchShoplingPriceRows(goodsKeys: string[]) {
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const rows: UnknownRecord[] = [];
  for (let index = 0; index < goodsKeys.length; index += MAX_GOODS_PER_REQUEST) {
    const chunk = goodsKeys.slice(index, index + MAX_GOODS_PER_REQUEST);
    const response = await postShoplingXml(config.productsUrl, buildProductLookupXml(config, chunk), {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-legacy-seo-price-recovery/1.0",
      },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`LEGACY_SEO_PRICE_SHOPLING_HTTP_${response.status}`);
    }
    for (const row of parseShoplingReadResponse("products", body)) rows.push(record(row));
  }
  return rows;
}

function findShoplingOptionRow(option: UnknownRecord, rows: UnknownRecord[]) {
  const payload = record(option.option_payload);
  const sync = record(payload.shoplingOptionSync);
  const optId = text(sync.optId);
  if (optId) {
    const exact = rows.find((row) => text(row.optId) === optId);
    if (exact) return exact;
  }
  const barcode = normalizeCode(payload.barcode || option.barcode);
  if (barcode) {
    const exact = rows.find((row) => normalizeCode(row.optPtnOptCd) === barcode);
    if (exact) return exact;
  }
  const saleOption = valueKey(payload.saleOption ?? option.sale_option);
  if (saleOption) {
    const matches = rows.filter((row) => valueKey(optionValue(row.optionName)) === saleOption);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

async function patchRecoveredOption(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  option: UnknownRecord,
  price: number,
  shoplingRow: UnknownRecord,
  goodsKey: string,
) {
  const payload = { ...record(option.option_payload) };
  const recoveredAt = new Date().toISOString();
  payload.baseSalePriceKrw = price;
  payload.shoplingPriceRecovery = {
    version: "shopling-live-sale-v1",
    source: "shopling_live_sale_price_plus_opt_amt",
    goodsKey,
    optId: text(shoplingRow.optId),
    salePrice: scalar(shoplingRow.sale_price),
    optAmt: scalar(shoplingRow.optAmt),
    recoveredBaseSalePriceKrw: price,
    recoveredAt,
  };
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${text(option.item_id)}`,
    option_id: `eq.${text(option.option_id)}`,
  });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base_sale_price_krw: price,
        option_payload: payload,
        updated_at: recoveredAt,
      }),
      cache: "no-store",
    },
  );
}

async function runInChunks(tasks: Array<() => Promise<void>>) {
  for (let index = 0; index < tasks.length; index += PATCH_CONCURRENCY) {
    await Promise.all(tasks.slice(index, index + PATCH_CONCURRENCY).map((task) => task()));
  }
}

export async function recoverLegacySeoShoplingPrices(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  modelNumbers: string[];
}) {
  const requested = unique(input.modelNumbers.map(normalizeModel)).slice(0, MAX_MODELS);
  if (!requested.length) {
    return {
      requestedCount: 0,
      itemCount: 0,
      candidateCount: 0,
      recoveredCount: 0,
      unresolvedCount: 0,
      unresolved: [] as RecoveryIssue[],
    };
  }

  const itemParams = new URLSearchParams({
    select: "item_id,model_number,item_payload",
    owner_id: `eq.${input.identity.userId}`,
    work_batch: "eq.등록완료건",
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    model_number: `in.(${postgrestIn(requested)})`,
    limit: "500",
  });
  const { body: itemBody } = await readProductLaunchStorageJson(
    `${input.config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${itemParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(input.config.secretKey),
      cache: "no-store",
    },
  );
  const items = (Array.isArray(itemBody) ? itemBody : [])
    .map(record)
    .filter((item) => !isLegacySeoRegistrationExcluded(record(item.item_payload)));
  const itemIds = items.map((item) => text(item.item_id)).filter(Boolean);
  if (!itemIds.length) {
    return {
      requestedCount: requested.length,
      itemCount: 0,
      candidateCount: 0,
      recoveredCount: 0,
      unresolvedCount: 0,
      unresolved: [] as RecoveryIssue[],
    };
  }

  const optionParams = new URLSearchParams({
    select: "item_id,option_id,option_index,sale_option,barcode,base_sale_price_krw,option_payload",
    owner_id: `eq.${input.identity.userId}`,
    item_id: `in.(${postgrestIn(itemIds)})`,
    base_sale_price_krw: "eq.0",
    order: "item_id.asc,option_index.asc",
    limit: "5000",
  });
  const { body: optionBody } = await readProductLaunchStorageJson(
    `${input.config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${optionParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(input.config.secretKey),
      cache: "no-store",
    },
  );
  const options = (Array.isArray(optionBody) ? optionBody : []).map(record);
  if (!options.length) {
    return {
      requestedCount: requested.length,
      itemCount: items.length,
      candidateCount: 0,
      recoveredCount: 0,
      unresolvedCount: 0,
      unresolved: [] as RecoveryIssue[],
    };
  }

  const itemById = new Map(items.map((item) => [text(item.item_id), item]));
  const goodsKeys = unique(
    options.map((option) => {
      const item = itemById.get(text(option.item_id)) ?? {};
      const payload = record(option.option_payload);
      return normalizeGoodsKey(
        record(payload.shoplingOptionSync).goodsKey ||
          record(record(item.item_payload).shoplingOptionSync).goodsKey,
      );
    }),
  );
  const shoplingRows = goodsKeys.length ? await fetchShoplingPriceRows(goodsKeys) : [];
  const rowsByGoodsKey = new Map<string, UnknownRecord[]>();
  for (const row of shoplingRows) {
    const goodsKey = normalizeGoodsKey(row.goods_key);
    if (!goodsKey) continue;
    const list = rowsByGoodsKey.get(goodsKey) ?? [];
    list.push(row);
    rowsByGoodsKey.set(goodsKey, list);
  }

  const unresolved: RecoveryIssue[] = [];
  const tasks: Array<() => Promise<void>> = [];
  let recoveredCount = 0;
  for (const option of options) {
    const item = itemById.get(text(option.item_id)) ?? {};
    const itemPayload = record(item.item_payload);
    const payload = record(option.option_payload);
    const modelNumber = normalizeModel(item.model_number);
    const saleOption = text(payload.saleOption ?? option.sale_option);
    const goodsKey = normalizeGoodsKey(
      record(payload.shoplingOptionSync).goodsKey ||
        record(itemPayload.shoplingOptionSync).goodsKey,
    );
    if (!goodsKey) {
      unresolved.push({ modelNumber, saleOption, reason: "Shopling goods_key 없음" });
      continue;
    }
    const rows = rowsByGoodsKey.get(goodsKey) ?? [];
    const shoplingRow = findShoplingOptionRow(option, rows);
    if (!shoplingRow) {
      unresolved.push({ modelNumber, saleOption, reason: "Shopling 옵션 매칭 실패" });
      continue;
    }
    const price = resolveLegacyShoplingOptionSalePrice(
      shoplingRow.sale_price,
      shoplingRow.optAmt,
    );
    if (price <= 0) {
      unresolved.push({ modelNumber, saleOption, reason: "Shopling 판매가 없음" });
      continue;
    }
    recoveredCount += 1;
    tasks.push(() =>
      patchRecoveredOption(
        input.config,
        input.identity.userId,
        option,
        price,
        shoplingRow,
        goodsKey,
      ),
    );
  }
  await runInChunks(tasks);

  return {
    requestedCount: requested.length,
    itemCount: items.length,
    candidateCount: options.length,
    recoveredCount,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 100),
  };
}
