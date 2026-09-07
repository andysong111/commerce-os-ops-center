import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import {
  DEFAULT_SHOPLING_READ_URLS,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TARGET_BATCH = "등록완료건";
const SOURCE_NAME = "shopling_existing_product_backfill";
const REPAIR_VERSION = "legacy_shopling_image_repair_v1";
const MAX_GOODS_PER_REQUEST = 40;
const MAX_ADDITIONAL_IMAGES = 10;
const PRODUCT_FIELDS = [
  "goods_key",
  ...Array.from({ length: 32 }, (_, index) => `img_${index}`),
].join(",");

const SHIPPING_NOTICE_URLS = [
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%801%EB%B2%88111.jpg",
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%802%EB%B2%88%20222.jpg",
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%803%EB%B2%88111.jpg",
  "https://ai.esmplus.com/andy80101/%EC%83%88%ED%8F%B4%EB%8D%9458/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%803%EB%B2%8831.jpg",
];

type UnknownRecord = Record<string, unknown>;
type GoodsImages = {
  goodsKey: string;
  mainImageUrl: string;
  additionalImageUrls: string[];
};
type RepairCandidate = {
  itemIndex: number;
  itemId: string;
  modelNumber: string;
  goodsKeys: string[];
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

function normalizedUrlKey(value: string) {
  const normalized = text(value).replace(/^http:/i, "https:");
  try {
    return decodeURIComponent(normalized).toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

const SHIPPING_NOTICE_KEYS = new Set(SHIPPING_NOTICE_URLS.map(normalizedUrlKey));

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
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

function splitImageField(value: unknown) {
  const rawValues = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const raw of rawValues) {
    const normalized = text(raw);
    if (!normalized) continue;
    const pieces = normalized
      .split(/[\t\r\n]+/)
      .flatMap((entry) => entry.split(/\s+(?=https?:\/\/)/i))
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const piece of pieces) {
      if (isHttpUrl(piece)) result.push(piece);
    }
  }
  return unique(result);
}

function validRepresentativeUrl(value: string) {
  return (
    isHttpUrl(value) &&
    !isGifUrl(value) &&
    !SHIPPING_NOTICE_KEYS.has(normalizedUrlKey(value))
  );
}

function rowImages(row: UnknownRecord): GoodsImages | null {
  const goodsKey = normalizeGoodsKey(row.goods_key);
  if (!goodsKey) return null;

  const byField = Array.from({ length: 32 }, (_, index) =>
    splitImageField(row[`img_${index}`]),
  );
  const allImages = unique(byField.flat()).filter(validRepresentativeUrl);
  if (!allImages.length) {
    return { goodsKey, mainImageUrl: "", additionalImageUrls: [] };
  }

  const primaryCandidates = unique([
    ...byField[0],
    ...byField[19],
    ...allImages,
  ]).filter(validRepresentativeUrl);
  const mainImageUrl = primaryCandidates[0] || "";
  const mainKey = normalizedUrlKey(mainImageUrl);
  const additionalImageUrls = allImages
    .filter((url) => normalizedUrlKey(url) !== mainKey)
    .slice(0, MAX_ADDITIONAL_IMAGES);

  return { goodsKey, mainImageUrl, additionalImageUrls };
}

function chooseMainImage(goods: GoodsImages[]) {
  const ranked = new Map<string, { value: string; count: number; first: number }>();
  let first = 0;
  for (const row of goods) {
    const value = text(row.mainImageUrl);
    if (!validRepresentativeUrl(value)) continue;
    const key = normalizedUrlKey(value);
    const current = ranked.get(key);
    if (current) current.count += 1;
    else ranked.set(key, { value, count: 1, first: first++ });
  }
  return (
    [...ranked.values()].sort(
      (a, b) => b.count - a.count || a.first - b.first,
    )[0]?.value || ""
  );
}

function chooseAdditionalImages(goods: GoodsImages[], mainImageUrl: string) {
  const ranked = new Map<string, { value: string; count: number; first: number }>();
  const mainKey = normalizedUrlKey(mainImageUrl);
  let first = 0;
  for (const row of goods) {
    const seenInGoods = new Set<string>();
    for (const value of row.additionalImageUrls) {
      if (!validRepresentativeUrl(value)) continue;
      const key = normalizedUrlKey(value);
      if (!key || key === mainKey || seenInGoods.has(key)) continue;
      seenInGoods.add(key);
      const current = ranked.get(key);
      if (current) current.count += 1;
      else ranked.set(key, { value, count: 1, first: first++ });
    }
  }
  return [...ranked.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .map((entry) => entry.value)
    .slice(0, MAX_ADDITIONAL_IMAGES);
}

function normalizeExistingAdditional(value: unknown) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return unique(raw.flatMap(splitImageField))
    .filter(validRepresentativeUrl)
    .slice(0, MAX_ADDITIONAL_IMAGES);
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function buildProductLookupXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  goodsKeys: string[],
) {
  const today = todayYmd();
  return (
    `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdGather>` +
    `<login_id>${cdata(config.loginId)}</login_id>` +
    `<company_id>${cdata(config.companyId)}</company_id>` +
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>` +
    `<search_tp>${cdata("수정일")}</search_tp>` +
    `<start_dt>${today}</start_dt><end_dt>${today}</end_dt>` +
    `<key_search_tp>${cdata("상품코드")}</key_search_tp>` +
    `<prod_id>${cdata(goodsKeys.join(","))}</prod_id>` +
    `<prod_fields>${cdata(PRODUCT_FIELDS)}</prod_fields>` +
    `<opt_yn>N</opt_yn><attri_yn>N</attri_yn>` +
    `</apiProdGather></reqst>`
  );
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

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function itemGoodsKeys(item: UnknownRecord) {
  const source = record(item.detailPageAssetSource);
  const sourceGoods = Array.isArray(source.goodsKeys) ? source.goodsKeys : [];
  const shoplingProducts = Array.isArray(item.shoplingProducts)
    ? item.shoplingProducts
    : [];
  const fallbackGoods = shoplingProducts.flatMap((value) => {
    const row = record(value);
    return [row.goodsKey, row.goods_key, row.productId, row.product_id];
  });
  return unique(
    [...sourceGoods, ...fallbackGoods].map(normalizeGoodsKey).filter(Boolean),
  );
}

function needsRepair(item: UnknownRecord) {
  if (text(item.workBatch) !== TARGET_BATCH || text(item.archivedAt)) return false;
  const source = record(item.detailPageAssetSource);
  if (text(source.source) !== SOURCE_NAME) return false;
  if (text(source.imageRepairVersion) === REPAIR_VERSION) return false;
  return itemGoodsKeys(item).length > 0;
}

async function fetchGoodsImages(config: ShoplingReadConfig, goodsKeys: string[]) {
  const byGoodsKey = new Map<string, GoodsImages>();
  let fetchedRows = 0;
  for (let index = 0; index < goodsKeys.length; index += MAX_GOODS_PER_REQUEST) {
    const chunk = goodsKeys.slice(index, index + MAX_GOODS_PER_REQUEST);
    const response = await postShoplingXml(
      config.productsUrl,
      buildProductLookupXml(config, chunk),
      {
        headers: {
          accept: "application/xml, text/xml",
          "content-type": "application/xml; charset=utf-8",
          "user-agent": "commerce-os-legacy-image-repair/1.0",
        },
        timeoutMs: 45_000,
      },
    );
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`LEGACY_SHOPLING_IMAGE_REPAIR_HTTP_${response.status}`);
    }
    const rows = parseShoplingReadResponse("products", body).map(record);
    fetchedRows += rows.length;
    for (const row of rows) {
      const normalized = rowImages(row);
      if (normalized && !byGoodsKey.has(normalized.goodsKey)) {
        byGoodsKey.set(normalized.goodsKey, normalized);
      }
    }
  }
  return { byGoodsKey, fetchedRows };
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return Response.json({ ok: false, error: "Production only" }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET missing" }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const adminConfig = getProductLaunchAdminConfig();
  if (!adminConfig.ok) {
    return Response.json(adminConfig.body, { status: adminConfig.status });
  }
  const identity = temporaryOpsIdentity();
  const stateRow = await readProductLaunchState(adminConfig.value, identity.userId);
  const state = record(stateRow?.state_payload);
  const items = Array.isArray(state.items) ? state.items.map(record) : [];
  const candidates: RepairCandidate[] = items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => needsRepair(item))
    .map(({ item, itemIndex }) => ({
      itemIndex,
      itemId: text(item.id),
      modelNumber: normalizeModel(item.modelNumber),
      goodsKeys: itemGoodsKeys(item),
    }))
    .filter((candidate) => candidate.itemId && candidate.goodsKeys.length > 0);

  if (!candidates.length) {
    return Response.json({
      ok: true,
      done: true,
      repairedItems: 0,
      reason: "no_candidates",
    });
  }

  const allGoodsKeys = unique(candidates.flatMap((candidate) => candidate.goodsKeys));
  const shoplingConfig = shoplingReadConfigFromEnv(shoplingEnvironment());
  const fetched = await fetchGoodsImages(shoplingConfig, allGoodsKeys);
  const now = new Date().toISOString();
  const changedIds: string[] = [];
  const unresolvedModels: string[] = [];
  let repairedMain = 0;
  let repairedAdditional = 0;
  let normalizedDelimiterItems = 0;
  let noImageEvidenceItems = 0;

  for (const candidate of candidates) {
    const item = items[candidate.itemIndex];
    const existingAsset = record(item.detailPageAsset);
    const existingSource = record(item.detailPageAssetSource);
    const goods = candidate.goodsKeys
      .map((goodsKey) => fetched.byGoodsKey.get(goodsKey))
      .filter(Boolean) as GoodsImages[];

    const chosenMain = chooseMainImage(goods);
    const chosenAdditional = chooseAdditionalImages(goods, chosenMain);
    const existingMain =
      splitImageField(existingAsset.mainImageUrl).filter(validRepresentativeUrl)[0] || "";
    const existingAdditionalRaw = Array.isArray(existingAsset.additionalImageUrls)
      ? existingAsset.additionalImageUrls
      : existingAsset.additionalImageUrls
        ? [existingAsset.additionalImageUrls]
        : [];
    const existingAdditional = normalizeExistingAdditional(
      existingAsset.additionalImageUrls,
    );
    const hadEmbeddedDelimiter = existingAdditionalRaw.some(
      (value) => splitImageField(value).length > 1,
    );

    const finalMain = existingMain || chosenMain;
    const finalMainKey = normalizedUrlKey(finalMain);
    const finalAdditional = unique([
      ...existingAdditional,
      ...chosenAdditional,
    ])
      .filter(validRepresentativeUrl)
      .filter((url) => normalizedUrlKey(url) !== finalMainKey)
      .slice(0, MAX_ADDITIONAL_IMAGES);

    if (!finalMain) {
      noImageEvidenceItems += 1;
      if (candidate.modelNumber && unresolvedModels.length < 25) {
        unresolvedModels.push(candidate.modelNumber);
      }
      continue;
    }

    if (!existingMain) repairedMain += 1;
    if (finalAdditional.length > existingAdditional.length) repairedAdditional += 1;
    if (hadEmbeddedDelimiter) normalizedDelimiterItems += 1;

    item.detailPageAsset = {
      ...existingAsset,
      mainImageUrl: finalMain,
      additionalImageUrls: finalAdditional,
    };
    item.detailPageAssetSource = {
      ...existingSource,
      imageRepairVersion: REPAIR_VERSION,
      imageRepairedAt: now,
      imageRepairGoodsKeys: candidate.goodsKeys,
      imageRepairFetchedGoodsCount: goods.length,
    };
    item.updatedAt = now;
    item.updatedBy = "legacy Shopling image repair";
    changedIds.push(candidate.itemId);
  }

  if (!changedIds.length) {
    console.warn("[legacy-shopling-image-repair] no repairable image evidence", {
      candidateCount: candidates.length,
      requestedGoodsKeyCount: allGoodsKeys.length,
      fetchedRows: fetched.fetchedRows,
      fetchedGoodsCount: fetched.byGoodsKey.size,
      unresolvedModels,
    });
    return Response.json({
      ok: true,
      done: false,
      candidateCount: candidates.length,
      repairedItems: 0,
      requestedGoodsKeyCount: allGoodsKeys.length,
      fetchedRows: fetched.fetchedRows,
      fetchedGoodsCount: fetched.byGoodsKey.size,
      noImageEvidenceItems,
      unresolvedModels,
      reason: "no_repairable_image_evidence",
    });
  }

  const nextState = { ...state, items, updatedAt: now };
  await writeProductLaunchState(adminConfig.value, identity, nextState);
  const normalizedSync = await reconcileProductLaunchNormalizedAfterLegacyItems(
    adminConfig.value,
    identity,
    changedIds,
  );

  console.info("[legacy-shopling-image-repair] completed", {
    candidateCount: candidates.length,
    requestedGoodsKeyCount: allGoodsKeys.length,
    fetchedRows: fetched.fetchedRows,
    fetchedGoodsCount: fetched.byGoodsKey.size,
    repairedMain,
    repairedAdditional,
    normalizedDelimiterItems,
    noImageEvidenceItems,
    unresolvedModels,
  });

  return Response.json({
    ok: true,
    done: noImageEvidenceItems === 0,
    candidateCount: candidates.length,
    requestedGoodsKeyCount: allGoodsKeys.length,
    fetchedRows: fetched.fetchedRows,
    fetchedGoodsCount: fetched.byGoodsKey.size,
    repairedItems: changedIds.length,
    repairedMain,
    repairedAdditional,
    normalizedDelimiterItems,
    noImageEvidenceItems,
    unresolvedModels,
    normalizedSync,
  });
}
