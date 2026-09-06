import { NextRequest } from "next/server";
import {
  DEFAULT_SHOPLING_READ_URLS,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
  type ShoplingDateRange,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TARGET_BATCH = "등록완료건";
const MAX_GOODS_PER_REQUEST = 40;
const MAX_ADDITIONAL_IMAGES = 10;
const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const LEGACY_CATALOG_START = process.env.SHOPLING_LEGACY_CATALOG_START_DATE?.trim() || "2020-01-01";
const PRODUCT_FIELDS = [
  "goods_key",
  "prod_nm",
  "cate_all_nm",
  "dtl_desc",
  "img_0",
  ...Array.from({ length: 18 }, (_, index) => `img_${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `img_${index + 22}`),
].join(",");
const LEGACY_SCAN_FIELDS = "goods_key,model_no";

const SHIPPING_NOTICE_URLS = [
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%801%EB%B2%88111.jpg",
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%802%EB%B2%88%20222.jpg",
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%803%EB%B2%88111.jpg",
  "https://ai.esmplus.com/andy80101/%EC%83%88%ED%8F%B4%EB%8D%9458/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%803%EB%B2%8831.jpg",
];

type UnknownRecord = Record<string, unknown>;
type GoodsEvidence = {
  goodsKey: string;
  category: string;
  detailHtml: string;
  mainImageUrl: string;
  additionalImageUrls: string[];
};
type ModelEvidence = { modelNumber: string; goodsKeys: string[]; goods: GoodsEvidence[] };
type ListingMapPayload = {
  ok?: boolean;
  rows?: Array<{ modelNumber?: unknown; goodsKeys?: unknown }>;
  error?: string;
  message?: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function normalizeModel(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}
function normalizeGoodsKey(value: unknown) {
  const normalized = text(value);
  return /^\d{5,12}$/.test(normalized) ? normalized : "";
}
function unique(values: string[], limit = Number.MAX_SAFE_INTEGER) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}
function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
function ymd(value: string) {
  return value.replaceAll("-", "");
}
function buildProductLookupXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  goodsKeys: string[],
) {
  const today = ymd(new Date().toISOString().slice(0, 10));
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdGather>` +
    `<login_id>${cdata(config.loginId)}</login_id>` +
    `<company_id>${cdata(config.companyId)}</company_id>` +
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>` +
    `<search_tp>${cdata("수정일")}</search_tp>` +
    `<start_dt>${today}</start_dt><end_dt>${today}</end_dt>` +
    `<key_search_tp>${cdata("상품코드")}</key_search_tp>` +
    `<prod_id>${cdata(goodsKeys.join(","))}</prod_id>` +
    `<prod_fields>${cdata(PRODUCT_FIELDS)}</prod_fields>` +
    `<opt_yn>N</opt_yn><attri_yn>N</attri_yn>` +
    `</apiProdGather></reqst>`;
}
function buildLegacyScanXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  range: ShoplingDateRange,
) {
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdGather>` +
    `<login_id>${cdata(config.loginId)}</login_id>` +
    `<company_id>${cdata(config.companyId)}</company_id>` +
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>` +
    `<search_tp>${cdata("수정일")}</search_tp>` +
    `<start_dt>${ymd(range.start)}</start_dt><end_dt>${ymd(range.end)}</end_dt>` +
    `<prod_fields>${cdata(LEGACY_SCAN_FIELDS)}</prod_fields>` +
    `<opt_yn>N</opt_yn><attri_yn>N</attri_yn>` +
    `</apiProdGather></reqst>`;
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
function normalizedUrlKey(value: string) {
  const trimmed = text(value).replace(/^http:/i, "https:");
  try {
    return decodeURIComponent(trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
const SHIPPING_NOTICE_KEYS = new Set(SHIPPING_NOTICE_URLS.map(normalizedUrlKey));
function stripShippingNoticeHtml(htmlInput: unknown) {
  const html = text(htmlInput);
  if (!html) return { html: "", removedCount: 0 };
  let removedCount = 0;
  const cleaned = html.replace(
    /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*\/?\s*>/gi,
    (tag, _quote: string, src: string) => {
      if (!SHIPPING_NOTICE_KEYS.has(normalizedUrlKey(src))) return tag;
      removedCount += 1;
      return "";
    },
  );
  return { html: cleaned.trim(), removedCount };
}
function isGifUrl(value: string) {
  const normalized = text(value);
  if (!normalized) return false;
  try {
    return new URL(normalized).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return /\.gif(?:$|[?#])/i.test(normalized);
  }
}
function imageValues(row: UnknownRecord) {
  const values: string[] = [];
  for (let index = 1; index <= 18; index += 1) values.push(text(row[`img_${index}`]));
  for (let index = 22; index <= 31; index += 1) values.push(text(row[`img_${index}`]));
  return values.filter(Boolean);
}
function mostFrequentValue(values: string[]) {
  const counts = new Map<string, { value: string; count: number; first: number }>();
  values.forEach((value, index) => {
    const normalized = text(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { value: normalized, count: 1, first: index });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0] ?? null;
}
function chooseCategory(goods: GoodsEvidence[], currentCategory: string) {
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of goods) {
    const category = text(row.category);
    if (!category) continue;
    const key = category.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { value: category, count: 1 });
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ko"));
  if (!ranked.length) return { value: "", tied: false, choices: [] as string[] };
  const topCount = ranked[0].count;
  const top = ranked.filter((row) => row.count === topCount);
  if (top.length === 1) return { value: top[0].value, tied: false, choices: [top[0].value] };
  const currentKey = text(currentCategory).toLowerCase();
  const currentMatch = top.find((row) => row.value.toLowerCase() === currentKey);
  return { value: currentMatch?.value || "", tied: true, choices: top.map((row) => row.value) };
}
function chooseDetailHtml(goods: GoodsEvidence[]) {
  const values = goods.map((row) => row.detailHtml).filter(Boolean);
  if (!values.length) return "";
  const counts = new Map<string, { value: string; count: number; length: number }>();
  for (const value of values) {
    const key = value.replace(/\s+/g, " ").trim();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { value, count: 1, length: value.length });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.length - a.length)[0]?.value || "";
}
function chooseMainImage(goods: GoodsEvidence[]) {
  return mostFrequentValue(goods.map((row) => row.mainImageUrl).filter(Boolean))?.value || "";
}
function chooseAdditionalImages(goods: GoodsEvidence[], mainImageUrl: string) {
  const counts = new Map<string, { value: string; count: number; first: number }>();
  let first = 0;
  let gifExcluded = 0;
  const mainKey = normalizedUrlKey(mainImageUrl);
  for (const row of goods) {
    const seenInGoods = new Set<string>();
    for (const raw of row.additionalImageUrls) {
      const value = text(raw);
      if (!value) continue;
      if (isGifUrl(value)) {
        gifExcluded += 1;
        continue;
      }
      const key = normalizedUrlKey(value);
      if (!key || key === mainKey || seenInGoods.has(key)) continue;
      seenInGoods.add(key);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { value, count: 1, first: first++ });
    }
  }
  return {
    images: [...counts.values()]
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .map((row) => row.value)
      .slice(0, MAX_ADDITIONAL_IMAGES),
    gifExcluded,
  };
}
async function loadCompleteProductMasterListingMap(modelNumbers: string[]) {
  const models = unique(modelNumbers.map(normalizeModel), 500);
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  const baseUrl = (process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL).replace(/\/$/, "");
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const url = new URL(`${baseUrl}/api/integrations/listing-map`);
  url.searchParams.set("models", models.join(","));
  const response = await fetch(url, {
    headers: { accept: "application/json", "x-commerce-os-integration-secret": secret },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json().catch(() => ({}))) as ListingMapPayload;
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.rows)) {
    throw new Error(payload.message || payload.error || `PRODUCT_MASTER_LISTING_MAP_FAILED:${response.status}`);
  }
  const result = new Map<string, Set<string>>();
  for (const row of payload.rows) {
    const model = normalizeModel(row.modelNumber);
    const goodsKeys = Array.isArray(row.goodsKeys) ? row.goodsKeys.map(normalizeGoodsKey).filter(Boolean) : [];
    if (model && goodsKeys.length) result.set(model, new Set(goodsKeys));
  }
  return result;
}
async function recoverHistoricalShoplingModels(
  requestedModels: string[],
  existing: Map<string, Set<string>>,
  config: ShoplingReadConfig,
) {
  const missing = new Set(requestedModels.filter((model) => !existing.has(model)));
  const recovered = new Map<string, Set<string>>();
  if (!missing.size) return { recovered, rangeCount: 0, rowCount: 0 };
  const end = new Date().toISOString().slice(0, 10);
  const ranges = splitShoplingDateRange(LEGACY_CATALOG_START, end, 90);
  let rowCount = 0;
  for (const range of ranges) {
    const response = await postShoplingXml(config.productsUrl, buildLegacyScanXml(config, range), {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-legacy-model-scan/1.0",
      },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`LEGACY_SHOPLING_SCAN_HTTP_${response.status}`);
    const rows = parseShoplingReadResponse("products", body).map(record);
    rowCount += rows.length;
    for (const row of rows) {
      const model = normalizeModel(row.model_no);
      const goodsKey = normalizeGoodsKey(row.goods_key);
      if (!missing.has(model) || !goodsKey) continue;
      const set = recovered.get(model) ?? new Set<string>();
      set.add(goodsKey);
      recovered.set(model, set);
    }
  }
  return { recovered, rangeCount: ranges.length, rowCount };
}
async function fetchShoplingEvidence(modelNumbers: string[]) {
  const requestedModels = unique(modelNumbers.map(normalizeModel), 500);
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const goodsByModel = await loadCompleteProductMasterListingMap(requestedModels);
  const historical = await recoverHistoricalShoplingModels(requestedModels, goodsByModel, config);
  for (const [model, recoveredKeys] of historical.recovered) {
    const set = goodsByModel.get(model) ?? new Set<string>();
    for (const key of recoveredKeys) set.add(key);
    goodsByModel.set(model, set);
  }
  const allGoodsKeys = unique(
    requestedModels.flatMap((model) => [...(goodsByModel.get(model) ?? [])]),
    12000,
  );
  const productByGoodsKey = new Map<string, GoodsEvidence>();
  let shippingNoticeRemovedCount = 0;
  let fetchedRowCount = 0;
  for (let index = 0; index < allGoodsKeys.length; index += MAX_GOODS_PER_REQUEST) {
    const chunk = allGoodsKeys.slice(index, index + MAX_GOODS_PER_REQUEST);
    const response = await postShoplingXml(config.productsUrl, buildProductLookupXml(config, chunk), {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-legacy-launch-backfill/1.2",
      },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`LEGACY_SHOPLING_BACKFILL_HTTP_${response.status}`);
    const rows = parseShoplingReadResponse("products", body).map(record);
    fetchedRowCount += rows.length;
    for (const row of rows) {
      const goodsKey = normalizeGoodsKey(row.goods_key);
      if (!goodsKey || productByGoodsKey.has(goodsKey)) continue;
      const stripped = stripShippingNoticeHtml(row.dtl_desc);
      shippingNoticeRemovedCount += stripped.removedCount;
      productByGoodsKey.set(goodsKey, {
        goodsKey,
        category: text(row.cate_all_nm),
        detailHtml: stripped.html,
        mainImageUrl: text(row.img_0),
        additionalImageUrls: imageValues(row),
      });
    }
  }
  const result = new Map<string, ModelEvidence>();
  for (const model of requestedModels) {
    const goodsKeys = [...(goodsByModel.get(model) ?? [])];
    const goods = goodsKeys.map((key) => productByGoodsKey.get(key)).filter(Boolean) as GoodsEvidence[];
    if (goods.length) result.set(model, { modelNumber: model, goodsKeys, goods });
  }
  return {
    evidenceByModel: result,
    mappedModelCount: goodsByModel.size,
    productMasterMappedModelCount: goodsByModel.size - historical.recovered.size,
    historicalRecoveredModelCount: historical.recovered.size,
    historicalCatalogRangeCount: historical.rangeCount,
    historicalCatalogRowCount: historical.rowCount,
    requestedGoodsKeyCount: allGoodsKeys.length,
    fetchedProductCount: productByGoodsKey.size,
    fetchedRowCount,
    shippingNoticeRemovedCount,
  };
}

export async function POST(request: NextRequest) {
  const identityResult = await resolveProductLaunchIdentity(request);
  if (!identityResult.ok) return Response.json(identityResult.body, { status: identityResult.status });
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) return Response.json(configResult.body, { status: configResult.status });
  const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "dry-run";
  const identity = identityResult.value;
  const config = configResult.value;
  const stateRow = await readProductLaunchState(config, identity.userId);
  const state = record(stateRow?.state_payload);
  const items = Array.isArray(state.items) ? state.items.map(record) : [];
  const targetIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => text(item.workBatch) === TARGET_BATCH && !text(item.archivedAt));
  const modelNumbers = targetIndexes.map(({ item }) => normalizeModel(item.modelNumber)).filter(Boolean);
  const loaded = await fetchShoplingEvidence(modelNumbers);
  const stats = {
    targetCount: targetIndexes.length,
    mappedModelCount: loaded.mappedModelCount,
    productMasterMappedModelCount: loaded.productMasterMappedModelCount,
    historicalRecoveredModelCount: loaded.historicalRecoveredModelCount,
    historicalCatalogRangeCount: loaded.historicalCatalogRangeCount,
    historicalCatalogRowCount: loaded.historicalCatalogRowCount,
    requestedGoodsKeyCount: loaded.requestedGoodsKeyCount,
    fetchedProductCount: loaded.fetchedProductCount,
    fetchedRowCount: loaded.fetchedRowCount,
    evidenceModelCount: loaded.evidenceByModel.size,
    categoryChangedCount: 0,
    categoryAlreadySameCount: 0,
    categoryMissingCount: 0,
    categoryTieSkippedCount: 0,
    htmlFilledCount: 0,
    htmlPreservedCount: 0,
    htmlMissingCount: 0,
    mainImageFilledCount: 0,
    mainImagePreservedCount: 0,
    mainImageMissingCount: 0,
    additionalImagesFilledCount: 0,
    additionalImagesPreservedCount: 0,
    additionalImagesMissingCount: 0,
    gifExcludedCount: 0,
    shippingNoticeRemovedCount: loaded.shippingNoticeRemovedCount,
    unmatchedModelCount: 0,
  };
  const changedIds: string[] = [];
  const samples: UnknownRecord[] = [];
  const unmatchedModels: string[] = [];
  for (const { item, index } of targetIndexes) {
    const modelNumber = normalizeModel(item.modelNumber);
    const evidence = loaded.evidenceByModel.get(modelNumber);
    if (!evidence) {
      stats.unmatchedModelCount += 1;
      unmatchedModels.push(modelNumber || text(item.id));
      continue;
    }
    const currentCategory = text(item.shoplingCategory);
    const categoryChoice = chooseCategory(evidence.goods, currentCategory);
    const chosenHtml = chooseDetailHtml(evidence.goods);
    const chosenMain = chooseMainImage(evidence.goods);
    const chosenAdditional = chooseAdditionalImages(evidence.goods, chosenMain);
    stats.gifExcludedCount += chosenAdditional.gifExcluded;
    const currentAsset = record(item.detailPageAsset);
    const currentHtml = text(currentAsset.html);
    const currentMain = text(currentAsset.mainImageUrl);
    const currentAdditional = Array.isArray(currentAsset.additionalImageUrls)
      ? unique(currentAsset.additionalImageUrls.map(text).filter(Boolean), MAX_ADDITIONAL_IMAGES)
      : [];
    let changed = false;
    const nextItem = { ...item };
    if (categoryChoice.value) {
      if (categoryChoice.value === currentCategory) stats.categoryAlreadySameCount += 1;
      else {
        nextItem.shoplingCategory = categoryChoice.value;
        stats.categoryChangedCount += 1;
        changed = true;
      }
    } else if (categoryChoice.tied) stats.categoryTieSkippedCount += 1;
    else stats.categoryMissingCount += 1;
    const nextAsset: UnknownRecord = { ...currentAsset };
    if (currentHtml) stats.htmlPreservedCount += 1;
    else if (chosenHtml) {
      nextAsset.html = chosenHtml;
      stats.htmlFilledCount += 1;
      changed = true;
    } else stats.htmlMissingCount += 1;
    if (currentMain) stats.mainImagePreservedCount += 1;
    else if (chosenMain) {
      nextAsset.mainImageUrl = chosenMain;
      stats.mainImageFilledCount += 1;
      changed = true;
    } else stats.mainImageMissingCount += 1;
    if (currentAdditional.length) stats.additionalImagesPreservedCount += 1;
    else if (chosenAdditional.images.length) {
      nextAsset.additionalImageUrls = chosenAdditional.images;
      stats.additionalImagesFilledCount += 1;
      changed = true;
    } else stats.additionalImagesMissingCount += 1;
    if (changed) {
      const now = new Date().toISOString();
      nextItem.detailPageAsset = nextAsset;
      nextItem.detailPageAssetSource = {
        source: "shopling_existing_product_backfill",
        backfilledAt: now,
        goodsKeys: evidence.goodsKeys,
        categoryPolicy: "majority_by_goods_key",
        shippingNoticeRemoved: true,
        gifAdditionalImagesExcluded: true,
      };
      nextItem.updatedAt = now;
      nextItem.updatedBy = "Shopling 기존상품 데이터 일괄복구";
      items[index] = nextItem;
      changedIds.push(text(item.id));
    }
    if (samples.length < 20) {
      samples.push({
        modelNumber,
        goodsKeyCount: evidence.goodsKeys.length,
        currentCategory,
        selectedCategory: categoryChoice.value,
        categoryChoices: categoryChoice.choices,
        categoryTied: categoryChoice.tied,
        htmlAvailable: Boolean(chosenHtml),
        mainImageAvailable: Boolean(chosenMain),
        additionalImageCount: chosenAdditional.images.length,
        changed,
      });
    }
  }
  if (mode === "apply" && changedIds.length) {
    state.items = items;
    state.savedAt = new Date().toISOString();
    await writeProductLaunchState(config, identity, state);
    await reconcileProductLaunchNormalizedAfterLegacyItems(config, identity, changedIds);
  }
  return Response.json({
    ok: true,
    mode,
    changedCount: changedIds.length,
    stats,
    unmatchedModels: unique(unmatchedModels, 500),
    samples,
  });
}
