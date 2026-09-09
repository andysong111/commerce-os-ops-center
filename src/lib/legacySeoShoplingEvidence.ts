import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { isConfirmedLegacyInventoryModel } from "@/lib/legacySeoInventoryCatalog";
import {
  DEFAULT_SHOPLING_READ_URLS,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

const SHOPLING_PRODUCT_IMAGE_FIELDS = Array.from(
  { length: 32 },
  (_, index) => `img_${index}`,
);
const PRODUCT_LOOKUP_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "site_srch",
  "cate_all_nm",
  "model_no",
  "model_nm",
  "sale_status",
  "org_price",
  "sale_price",
  "list_price",
  "origin_nm",
  "dtl_desc",
  ...SHOPLING_PRODUCT_IMAGE_FIELDS,
].join(",");
const MODEL_DISCOVERY_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
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
const DISCOVERY_EARLIEST = new Date("2021-01-01T00:00:00.000Z");
const DISCOVERY_WINDOW_DAYS = 89;
const MAX_DISCOVERY_WINDOWS = 28;

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
  originalPrice: string;
  salePrice: string;
  listPrice: string;
  originName: string;
  detailHtml: string;
  imageUrls: string[];
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

function formatYmd(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function todayYmd() {
  return formatYmd(new Date());
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

export function buildLegacyShoplingModelDiscoveryXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  startDate: Date,
  endDate: Date,
) {
  return compactXml([
    "<reqst><apiProdGather>",
    `<login_id>${xmlCdata(config.loginId)}</login_id>`,
    `<company_id>${xmlCdata(config.companyId)}</company_id>`,
    `<api_auth_key>${xmlCdata(config.authKey)}</api_auth_key>`,
    `<search_tp>${xmlCdata("등록일")}</search_tp>`,
    `<start_dt>${formatYmd(startDate)}</start_dt>`,
    `<end_dt>${formatYmd(endDate)}</end_dt>`,
    `<prod_fields>${xmlCdata(MODEL_DISCOVERY_FIELDS)}</prod_fields>`,
    "<opt_yn>N</opt_yn><attri_yn>N</attri_yn>",
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

async function postProductGather(config: ShoplingReadConfig, xml: string) {
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
  return parseShoplingReadResponse("products", body).map(record);
}

async function fetchExactShoplingProducts(
  config: ShoplingReadConfig,
  goodsKeys: string[],
) {
  const result: UnknownRecord[] = [];
  for (let index = 0; index < goodsKeys.length; index += MAX_GOODS_PER_REQUEST) {
    const chunk = goodsKeys.slice(index, index + MAX_GOODS_PER_REQUEST);
    const rows = await postProductGather(
      config,
      buildLegacyShoplingProductLookupXml(config, chunk),
    );
    result.push(...rows);
  }
  return result;
}

function discoveryWindows(now = new Date()) {
  const windows: Array<{ start: Date; end: Date }> = [];
  let end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let index = 0; index < MAX_DISCOVERY_WINDOWS; index += 1) {
    if (end < DISCOVERY_EARLIEST) break;
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - DISCOVERY_WINDOW_DAYS);
    if (start < DISCOVERY_EARLIEST) start.setTime(DISCOVERY_EARLIEST.getTime());
    windows.push({ start: new Date(start), end: new Date(end) });
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() - 1);
  }
  return windows;
}

async function discoverGoodsKeysByModel(
  config: ShoplingReadConfig,
  modelNumbers: string[],
) {
  const wanted = new Set(modelNumbers.map(normalizeModel).filter(Boolean));
  const result = new Map<string, Set<string>>();
  if (!wanted.size) return result;

  for (const window of discoveryWindows()) {
    const rows = await postProductGather(
      config,
      buildLegacyShoplingModelDiscoveryXml(config, window.start, window.end),
    );
    for (const row of rows) {
      const model = normalizeModel(row.model_no);
      if (!wanted.has(model)) continue;
      const goodsKey = normalizeGoodsKey(row.goods_key);
      if (!goodsKey) continue;
      const keys = result.get(model) ?? new Set<string>();
      keys.add(goodsKey);
      result.set(model, keys);
    }
    if ([...wanted].every((model) => (result.get(model)?.size ?? 0) > 0)) break;
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
    const merged = new Set<string>(normalized);
    for (const key of existing) {
      if (merged.size >= MAX_GOODS_KEYS_PER_MODEL) break;
      merged.add(key);
    }
    if (merged.size) mapping.set(model, merged);
  }
  return mapping;
}

function mergeDiscoveredGoodsKeys(
  mapping: Map<string, Set<string>>,
  discovered: Map<string, Set<string>>,
) {
  for (const [model, keys] of discovered.entries()) {
    const current = mapping.get(model) ?? new Set<string>();
    for (const key of keys) {
      if (current.size >= MAX_GOODS_KEYS_PER_MODEL) break;
      current.add(key);
    }
    if (current.size) mapping.set(model, current);
  }
  return mapping;
}

function rowMatchesModel(row: UnknownRecord, model: string) {
  const rowModel = normalizeModel(row.model_no);
  return !rowModel || rowModel === model;
}

function modelRowsFromMapping(
  model: string,
  mapping: Map<string, Set<string>>,
  rowsByGoodsKey: Map<string, UnknownRecord[]>,
) {
  const goodsKeys = unique(
    [...(mapping.get(model) ?? [])].map(normalizeGoodsKey),
    MAX_GOODS_KEYS_PER_MODEL,
  );
  return goodsKeys.flatMap((goodsKey) =>
    (rowsByGoodsKey.get(goodsKey) ?? []).filter((row) => rowMatchesModel(row, model)),
  );
}

function hasActiveManagedOption(
  model: string,
  mapping: Map<string, Set<string>>,
  rowsByGoodsKey: Map<string, UnknownRecord[]>,
) {
  return modelRowsFromMapping(model, mapping, rowsByGoodsKey).some(
    (row) =>
      scalar(row.optStatus).toUpperCase() !== "X" &&
      Boolean(scalar(row.optPtnOptCd)),
  );
}

function addRowsByGoodsKey(
  rowsByGoodsKey: Map<string, UnknownRecord[]>,
  rows: UnknownRecord[],
) {
  for (const row of rows) {
    const goodsKey = normalizeGoodsKey(row.goods_key);
    if (!goodsKey) continue;
    const current = rowsByGoodsKey.get(goodsKey) ?? [];
    current.push(row);
    rowsByGoodsKey.set(goodsKey, current);
  }
}

function compatibleGoodsKeys(
  model: string,
  mapping: Map<string, Set<string>>,
  rowsByGoodsKey: Map<string, UnknownRecord[]>,
) {
  return unique(
    [...(mapping.get(model) ?? [])]
      .map(normalizeGoodsKey)
      .filter((goodsKey) =>
        (rowsByGoodsKey.get(goodsKey) ?? []).some((row) => rowMatchesModel(row, model)),
      ),
    MAX_GOODS_KEYS_PER_MODEL,
  );
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
        originalPrice: scalar(first.org_price),
        salePrice: scalar(first.sale_price),
        listPrice: scalar(first.list_price),
        originName: scalar(first.origin_nm),
        detailHtml: scalar(first.dtl_desc),
        imageUrls: unique(
          [
            ...SHOPLING_PRODUCT_IMAGE_FIELDS.map((field) => first[field]),
            ...rows.map((row) => row.optImgUrl),
          ],
          32,
        ),
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

  const [snapshot, config] = await Promise.all([
    loadProductPlanningSnapshot(),
    Promise.resolve(shoplingReadConfigFromEnv(shoplingEnvironment())),
  ]);
  const mapping = mergeGoodsKeyOverrides(
    goodsKeysByModelFromPlanning(snapshot),
    goodsKeyOverrides,
  );

  const initialDiscoveryModels = requestedModels.filter(
    (model) =>
      isConfirmedLegacyInventoryModel(model) &&
      (mapping.get(model)?.size ?? 0) === 0,
  );
  if (initialDiscoveryModels.length) {
    const discovered = await discoverGoodsKeysByModel(config, initialDiscoveryModels);
    mergeDiscoveredGoodsKeys(mapping, discovered);
  }

  const initialGoodsKeys = unique(
    requestedModels.flatMap((model) => [...(mapping.get(model) ?? [])]),
    2500,
  );
  const initialRows = initialGoodsKeys.length
    ? await fetchExactShoplingProducts(config, initialGoodsKeys)
    : [];
  const rowsByGoodsKey = new Map<string, UnknownRecord[]>();
  addRowsByGoodsKey(rowsByGoodsKey, initialRows);

  // A stored goods_key is only a hint. Legacy tracker rows can contain many stale
  // Shopling keys from older channel registrations. If those keys no longer yield
  // a current option carrying a managed B-code, rediscover by model_no even though
  // a mapping already exists. This is the AAA116 class of failure: 49 historical
  // goods keys existed, so the old code never ran model discovery and preserved an
  // empty option list forever.
  const staleMappedModels = requestedModels.filter(
    (model) =>
      isConfirmedLegacyInventoryModel(model) &&
      !hasActiveManagedOption(model, mapping, rowsByGoodsKey),
  );
  if (staleMappedModels.length) {
    const discovered = await discoverGoodsKeysByModel(config, staleMappedModels);
    const alreadyFetched = new Set(initialGoodsKeys);
    const rediscoveredGoodsKeys = unique(
      [...discovered.values()].flatMap((keys) => [...keys]),
      2500,
    ).filter((goodsKey) => !alreadyFetched.has(goodsKey));
    mergeDiscoveredGoodsKeys(mapping, discovered);
    if (rediscoveredGoodsKeys.length) {
      const rediscoveredRows = await fetchExactShoplingProducts(
        config,
        rediscoveredGoodsKeys,
      );
      addRowsByGoodsKey(rowsByGoodsKey, rediscoveredRows);
    }
  }

  const result = new Map<string, LegacySeoShoplingEvidence>();
  for (const model of requestedModels) {
    // Reject stale goods keys that resolve to a different model number. Historical
    // tracker source metadata is intentionally broad; Shopling's current model_no
    // is the identity check for option parity.
    const goodsKeys = compatibleGoodsKeys(model, mapping, rowsByGoodsKey);
    const modelRows = goodsKeys.flatMap((goodsKey) =>
      (rowsByGoodsKey.get(goodsKey) ?? []).filter((row) => rowMatchesModel(row, model)),
    );
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
