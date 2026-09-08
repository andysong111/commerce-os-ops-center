import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  DEFAULT_SHOPLING_READ_URLS,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

const PRODUCT_LOOKUP_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "site_srch",
  "cate_all_nm",
  "model_no",
  "model_nm",
  "sale_status",
].join(",");
const MAX_GOODS_PER_REQUEST = 40;
const MAX_EVIDENCE_TITLES = 32;
const MAX_EVIDENCE_KEYWORDS = 120;
const MAX_EVIDENCE_CATEGORIES = 12;
const MAX_EVIDENCE_OPTIONS = 60;
const MAX_GOODS_KEYS_PER_MODEL = 120;

type UnknownRecord = Record<string, unknown>;

export type LegacySeoGoodsKeyOverrides =
  | ReadonlyMap<string, readonly string[]>
  | Record<string, readonly string[]>;

export type LegacySeoShoplingOption = {
  optionName: string;
  optionId: string;
  bCode: string;
  optionBarcode: string;
  status: string;
  quantity: string;
  amount: string;
};

export type LegacySeoShoplingOptionGroup = {
  goodsKey: string;
  ptnGoodsCd: string;
  productName: string;
  saleStatus: string;
  options: LegacySeoShoplingOption[];
};

export type LegacySeoShoplingEvidence = {
  modelNumber: string;
  goodsKeys: string[];
  titles: string[];
  searchKeywords: string[];
  categories: string[];
  optionNames: string[];
  optionGroups: LegacySeoShoplingOptionGroup[];
  fetchedRowCount: number;
  source: "shopling_live_api";
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  }
  const row = record(value);
  return scalar(row["#text"] ?? row.__cdata ?? row.cdata);
}

function unique(values: unknown[], limit = 200) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = scalar(value);
    const key = normalized.replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeModel(value: unknown) {
  return scalar(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeGoodsKey(value: unknown) {
  const normalized = scalar(value);
  return /^\d{5,12}$/.test(normalized) ? normalized : "";
}

function splitSearchKeywords(value: unknown) {
  return scalar(value)
    .split(/[,，\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function xmlCdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function compactXml(parts: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>${parts.join("")}`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

export function buildLegacyShoplingProductLookupXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  goodsKeys: string[],
) {
  const normalized = unique(goodsKeys.map(normalizeGoodsKey), MAX_GOODS_PER_REQUEST);
  if (!normalized.length) throw new Error("LEGACY_SEO_SHOPLING_GOODS_KEYS_REQUIRED");
  const today = todayYmd();
  return compactXml([
    "<reqst><apiProdGather>",
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
    "</apiProdGather></reqst>",
  ]);
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

async function fetchExactShoplingProducts(
  config: ShoplingReadConfig,
  goodsKeys: string[],
) {
  const result: UnknownRecord[] = [];
  for (let index = 0; index < goodsKeys.length; index += MAX_GOODS_PER_REQUEST) {
    const chunk = goodsKeys.slice(index, index + MAX_GOODS_PER_REQUEST);
    const xml = buildLegacyShoplingProductLookupXml(config, chunk);
    const response = await postShoplingXml(config.productsUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-legacy-seo-shopling-read/1.0",
      },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`LEGACY_SEO_SHOPLING_PRODUCTS_HTTP_${response.status}`);
    }
    const rows = parseShoplingReadResponse("products", body);
    for (const row of rows) result.push(record(row));
  }
  return result;
}

function goodsKeysByModelFromPlanning(
  snapshot: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
) {
  const result = new Map<string, Set<string>>();
  for (const product of snapshot.products ?? []) {
    const model = normalizeModel(product.modelNo);
    if (!model) continue;
    const keys = result.get(model) ?? new Set<string>();
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const goodsKey = normalizeGoodsKey(listing.goodsKey);
      if (goodsKey) keys.add(goodsKey);
    }
    if (keys.size) result.set(model, keys);
  }
  return result;
}

function overrideEntries(overrides?: LegacySeoGoodsKeyOverrides) {
  if (!overrides) return [] as Array<[string, readonly string[]]>;
  return overrides instanceof Map
    ? [...overrides.entries()]
    : Object.entries(overrides);
}

function mergeGoodsKeyOverrides(
  mapping: Map<string, Set<string>>,
  overrides?: LegacySeoGoodsKeyOverrides,
) {
  for (const [rawModel, rawKeys] of overrideEntries(overrides)) {
    const model = normalizeModel(rawModel);
    if (!model) continue;
    const existing = mapping.get(model) ?? new Set<string>();
    const normalized = unique(
      Array.isArray(rawKeys) ? rawKeys.map(normalizeGoodsKey) : [],
      MAX_GOODS_KEYS_PER_MODEL,
    );
    // Tracker evidence is newest/closest to the actual legacy card, so add it
    // before the Product Master history and cap the total request fan-out.
    const merged = new Set<string>(normalized);
    for (const key of existing) {
      if (merged.size >= MAX_GOODS_KEYS_PER_MODEL) break;
      merged.add(key);
    }
    if (merged.size) mapping.set(model, merged);
  }
  return mapping;
}

function optionGroupsFromRows(
  goodsKeys: string[],
  rowsByGoodsKey: Map<string, UnknownRecord[]>,
): LegacySeoShoplingOptionGroup[] {
  return goodsKeys
    .map((goodsKey) => {
      const rows = rowsByGoodsKey.get(goodsKey) ?? [];
      if (!rows.length) return null;
      const first = rows[0] ?? {};
      const options = rows.map((row) => ({
        optionName: scalar(row.optionName) || "단품",
        optionId: scalar(row.optId),
        bCode: scalar(row.optPtnOptCd),
        optionBarcode: scalar(row.optBarcode),
        status: scalar(row.optStatus),
        quantity: scalar(row.optQty),
        amount: scalar(row.optAmt),
      }));
      return {
        goodsKey,
        ptnGoodsCd: scalar(first.ptn_goods_cd),
        productName: scalar(first.prod_nm),
        saleStatus: scalar(first.sale_status),
        options,
      } satisfies LegacySeoShoplingOptionGroup;
    })
    .filter((value): value is LegacySeoShoplingOptionGroup => Boolean(value));
}

export async function loadLegacySeoShoplingEvidence(
  modelNumbers: string[],
  goodsKeyOverrides?: LegacySeoGoodsKeyOverrides,
): Promise<Map<string, LegacySeoShoplingEvidence>> {
  const requestedModels = unique(modelNumbers.map(normalizeModel), 250);
  if (!requestedModels.length) return new Map();

  const snapshot = await loadProductPlanningSnapshot();
  const mapping = mergeGoodsKeyOverrides(
    goodsKeysByModelFromPlanning(snapshot),
    goodsKeyOverrides,
  );
  const requestedGoodsKeys = unique(
    requestedModels.flatMap((model) => [...(mapping.get(model) ?? [])]),
    2500,
  );
  if (!requestedGoodsKeys.length) return new Map();

  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const rows = await fetchExactShoplingProducts(config, requestedGoodsKeys);
  const rowsByGoodsKey = new Map<string, UnknownRecord[]>();
  for (const row of rows) {
    const goodsKey = normalizeGoodsKey(row.goods_key);
    if (!goodsKey) continue;
    const current = rowsByGoodsKey.get(goodsKey) ?? [];
    current.push(row);
    rowsByGoodsKey.set(goodsKey, current);
  }

  const result = new Map<string, LegacySeoShoplingEvidence>();
  for (const model of requestedModels) {
    const goodsKeys = unique(
      [...(mapping.get(model) ?? [])].map(normalizeGoodsKey),
      MAX_GOODS_KEYS_PER_MODEL,
    );
    const modelRows = goodsKeys.flatMap((goodsKey) => rowsByGoodsKey.get(goodsKey) ?? []);
    const titles = unique(modelRows.map((row) => row.prod_nm), MAX_EVIDENCE_TITLES);
    const searchKeywords = unique(
      modelRows.flatMap((row) => splitSearchKeywords(row.site_srch)),
      MAX_EVIDENCE_KEYWORDS,
    );
    const categories = unique(
      modelRows.map((row) => row.cate_all_nm),
      MAX_EVIDENCE_CATEGORIES,
    );
    const optionNames = unique(
      modelRows.map((row) => row.optionName),
      MAX_EVIDENCE_OPTIONS,
    );
    const optionGroups = optionGroupsFromRows(goodsKeys, rowsByGoodsKey);
    if (!titles.length && !searchKeywords.length && !optionGroups.length) continue;
    result.set(model, {
      modelNumber: model,
      goodsKeys,
      titles,
      searchKeywords,
      categories,
      optionNames,
      optionGroups,
      fetchedRowCount: modelRows.length,
      source: "shopling_live_api",
    });
  }
  return result;
}

export function buildLegacySeoSupportingText(input: {
  productName: string;
  modelNumber: string;
  launchCategory?: string;
  evidence: LegacySeoShoplingEvidence;
}) {
  const category = scalar(input.launchCategory) || input.evidence.categories[0] || "";
  const sections = [
    input.productName ? `기존 모델명: ${scalar(input.productName)}` : "",
    input.modelNumber ? `모델번호: ${normalizeModel(input.modelNumber)}` : "",
    category ? `Shopling 카테고리: ${category}` : "",
    input.evidence.titles.length
      ? `기존 Shopling 상품명: ${input.evidence.titles.slice(0, 24).join(" | ")}`
      : "",
    input.evidence.searchKeywords.length
      ? `기존 Shopling 검색어: ${input.evidence.searchKeywords.slice(0, 80).join(", ")}`
      : "",
  ].filter(Boolean);
  return sections.join(" · ").slice(0, 12_000);
}
