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
const MAX_GOODS_KEYS_PER_RUN = 240;
const MAX_NO_IMAGE_ATTEMPTS = 3;
const MAX_ADDITIONAL_IMAGES = 10;
const CDN_PROBE_CONCURRENCY = 12;
const CDN_PROBE_TIMEOUT_MS = 5_000;
const PRODUCT_FIELDS = [
  "goods_key",
  "dtl_desc",
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
  detailHtml: string;
  mainImageUrl: string;
  additionalImageUrls: string[];
};
type RepairCandidate = {
  itemIndex: number;
  itemId: string;
  modelNumber: string;
  goodsKeys: string[];
  attemptedAtMs: number;
};
type CdnProbeResult = {
  probedGoodsCount: number;
  resolvedGoodsCount: number;
  byGoodsKey: Map<string, string>;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
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

function htmlFingerprint(value: unknown) {
  return text(value).replace(/\s+/g, " ").trim();
}

function rowImages(row: UnknownRecord): GoodsImages | null {
  const goodsKey = normalizeGoodsKey(row.goods_key);
  if (!goodsKey) return null;

  const byField = Array.from({ length: 32 }, (_, index) =>
    splitImageField(row[`img_${index}`]),
  );
  const allImages = unique(byField.flat()).filter(validRepresentativeUrl);
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

  return {
    goodsKey,
    detailHtml: text(row.dtl_desc),
    mainImageUrl,
    additionalImageUrls,
  };
}

function chooseMainImage(goods: GoodsImages[], preferredHtml: unknown) {
  const expectedFingerprint = htmlFingerprint(preferredHtml);
  const preferredGoods = expectedFingerprint
    ? goods.filter(
        (row) =>
          row.mainImageUrl && htmlFingerprint(row.detailHtml) === expectedFingerprint,
      )
    : [];
  const source = preferredGoods.length ? preferredGoods : goods;
  const ranked = new Map<string, { value: string; count: number; first: number }>();
  let first = 0;
  for (const row of source) {
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
    for (const value of [row.mainImageUrl, ...row.additionalImageUrls]) {
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

function repairAttemptCount(item: UnknownRecord) {
  return Math.max(
    0,
    integer(record(item.detailPageAssetSource).imageRepairAttemptCount),
  );
}

function repairAttemptedAtMs(item: UnknownRecord) {
  const value = Date.parse(
    text(record(item.detailPageAssetSource).imageRepairAttemptedAt),
  );
  return Number.isFinite(value) ? value : 0;
}

function needsRepair(item: UnknownRecord) {
  if (text(item.workBatch) !== TARGET_BATCH || text(item.archivedAt)) return false;
  const source = record(item.detailPageAssetSource);
  if (text(source.source) !== SOURCE_NAME) return false;
  if (text(source.imageRepairVersion) === REPAIR_VERSION) return false;
  if (text(source.imageRepairState) === "deferred_no_image_evidence") return false;
  if (repairAttemptCount(item) >= MAX_NO_IMAGE_ATTEMPTS) return false;
  return itemGoodsKeys(item).length > 0;
}

function repairCandidates(items: UnknownRecord[]) {
  return items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => needsRepair(item))
    .map(({ item, itemIndex }) => ({
      itemIndex,
      itemId: text(item.id),
      modelNumber: normalizeModel(item.modelNumber),
      goodsKeys: itemGoodsKeys(item),
      attemptedAtMs: repairAttemptedAtMs(item),
    }))
    .filter((candidate) => candidate.itemId && candidate.goodsKeys.length > 0)
    .sort(
      (a, b) => a.attemptedAtMs - b.attemptedAtMs || a.itemIndex - b.itemIndex,
    );
}

function selectCandidateBatch(candidates: RepairCandidate[]) {
  const selected: RepairCandidate[] = [];
  const goodsKeys = new Set<string>();
  for (const candidate of candidates) {
    const additions = candidate.goodsKeys.filter((key) => !goodsKeys.has(key));
    if (
      selected.length > 0 &&
      goodsKeys.size + additions.length > MAX_GOODS_KEYS_PER_RUN
    ) {
      break;
    }
    selected.push(candidate);
    candidate.goodsKeys.forEach((key) => goodsKeys.add(key));
    if (goodsKeys.size >= MAX_GOODS_KEYS_PER_RUN) break;
  }
  return { selected, goodsKeys: [...goodsKeys] };
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
          "user-agent": "commerce-os-legacy-image-repair/1.2",
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

function inferShoplingCdnBases(items: UnknownRecord[]) {
  const counts = new Map<string, { base: string; count: number; first: number }>();
  let first = 0;
  for (const item of items) {
    const asset = record(item.detailPageAsset);
    const urls = [
      ...splitImageField(asset.mainImageUrl),
      ...normalizeExistingAdditional(asset.additionalImageUrls),
    ];
    for (const url of urls) {
      const match = url.match(
        /^(https?):\/\/img\.shopling\.co\.kr\/prodImg\/(img_\d+)\/([^/]+)\/prod_\d+\/\d+_0\.(?:jpe?g|png|webp)(?:[?#].*)?$/i,
      );
      if (!match) continue;
      const base = `${match[1].toLowerCase()}://img.shopling.co.kr/prodImg/${match[2]}/${match[3]}`;
      const key = base.toLowerCase();
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { base, count: 1, first: first++ });
    }
  }
  const primary = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.first - b.first,
  )[0]?.base;
  if (!primary) return [];
  return unique([
    primary.replace(/^http:/i, "https:"),
    primary.replace(/^https:/i, "http:"),
  ]);
}

function shoplingCdnCandidateUrls(bases: string[], goodsKey: string) {
  const numeric = Number(goodsKey);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return [];
  const bucket = Math.floor(numeric / 1000);
  return unique(
    bases.map(
      (base) => `${base}/prod_${bucket}/${goodsKey}_0.jpg`,
    ),
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function responseIsImage(response: Response) {
  const contentType = text(response.headers.get("content-type")).toLowerCase();
  return response.ok && contentType.startsWith("image/");
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The probe already has enough response metadata; body cancellation is best-effort.
  }
}

async function probeImageUrl(url: string) {
  try {
    const head = await fetchWithTimeout(
      url,
      {
        method: "HEAD",
        headers: { accept: "image/*,*/*;q=0.8" },
      },
      CDN_PROBE_TIMEOUT_MS,
    );
    if (responseIsImage(head)) return url;
  } catch {
    // Some legacy image hosts reject HEAD; use a bounded ranged GET below.
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          accept: "image/*,*/*;q=0.8",
          range: "bytes=0-1023",
        },
      },
      CDN_PROBE_TIMEOUT_MS,
    );
    const valid = responseIsImage(response);
    await cancelBody(response);
    return valid ? url : "";
  } catch {
    return "";
  }
}

async function probeShoplingCdn(
  bases: string[],
  goodsKeys: string[],
  current: Map<string, GoodsImages>,
): Promise<CdnProbeResult> {
  const missingKeys = goodsKeys.filter(
    (goodsKey) => !text(current.get(goodsKey)?.mainImageUrl),
  );
  const byGoodsKey = new Map<string, string>();
  let probedGoodsCount = 0;

  for (
    let index = 0;
    index < missingKeys.length;
    index += CDN_PROBE_CONCURRENCY
  ) {
    const chunk = missingKeys.slice(index, index + CDN_PROBE_CONCURRENCY);
    const resolved = await Promise.all(
      chunk.map(async (goodsKey) => {
        probedGoodsCount += 1;
        for (const url of shoplingCdnCandidateUrls(bases, goodsKey)) {
          const validUrl = await probeImageUrl(url);
          if (validUrl) return { goodsKey, validUrl };
        }
        return { goodsKey, validUrl: "" };
      }),
    );
    for (const entry of resolved) {
      if (entry.validUrl) byGoodsKey.set(entry.goodsKey, entry.validUrl);
    }
  }

  return {
    probedGoodsCount,
    resolvedGoodsCount: byGoodsKey.size,
    byGoodsKey,
  };
}

function mergeCdnEvidence(
  current: Map<string, GoodsImages>,
  cdn: CdnProbeResult,
) {
  for (const [goodsKey, mainImageUrl] of cdn.byGoodsKey) {
    const existing = current.get(goodsKey);
    current.set(goodsKey, {
      goodsKey,
      detailHtml: text(existing?.detailHtml),
      mainImageUrl: text(existing?.mainImageUrl) || mainImageUrl,
      additionalImageUrls: existing?.additionalImageUrls ?? [],
    });
  }
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
  const allCandidates = repairCandidates(items);

  if (!allCandidates.length) {
    return Response.json({
      ok: true,
      done: true,
      busy: false,
      repairedItems: 0,
      reason: "no_candidates",
    });
  }

  const batch = selectCandidateBatch(allCandidates);
  const candidates = batch.selected;
  const allGoodsKeys = batch.goodsKeys;
  const shoplingConfig = shoplingReadConfigFromEnv(shoplingEnvironment());
  const fetched = await fetchGoodsImages(shoplingConfig, allGoodsKeys);
  const cdnBases = inferShoplingCdnBases(items);
  const cdn = cdnBases.length
    ? await probeShoplingCdn(cdnBases, allGoodsKeys, fetched.byGoodsKey)
    : {
        probedGoodsCount: 0,
        resolvedGoodsCount: 0,
        byGoodsKey: new Map<string, string>(),
      };
  mergeCdnEvidence(fetched.byGoodsKey, cdn);

  const now = new Date().toISOString();
  const changedIds: string[] = [];
  const unresolvedModels: string[] = [];
  let repairedMain = 0;
  let repairedAdditional = 0;
  let normalizedDelimiterItems = 0;
  let noImageEvidenceItems = 0;
  let deferredNoImageItems = 0;

  for (const candidate of candidates) {
    const item = items[candidate.itemIndex];
    const existingAsset = record(item.detailPageAsset);
    const existingSource = record(item.detailPageAssetSource);
    const attemptCount = repairAttemptCount(item) + 1;
    const goods = candidate.goodsKeys
      .map((goodsKey) => fetched.byGoodsKey.get(goodsKey))
      .filter(Boolean) as GoodsImages[];

    const chosenMain = chooseMainImage(goods, existingAsset.html);
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
      const deferred = attemptCount >= MAX_NO_IMAGE_ATTEMPTS;
      if (deferred) deferredNoImageItems += 1;
      if (candidate.modelNumber && unresolvedModels.length < 25) {
        unresolvedModels.push(candidate.modelNumber);
      }
      item.detailPageAssetSource = {
        ...existingSource,
        imageRepairAttemptedAt: now,
        imageRepairAttemptCount: attemptCount,
        imageRepairState: deferred
          ? "deferred_no_image_evidence"
          : "retry_no_image_evidence",
        imageRepairLastGoodsKeys: candidate.goodsKeys,
        imageRepairFetchedGoodsCount: goods.length,
        imageRepairCdnBaseDetected: cdnBases.length > 0,
      };
      item.updatedAt = now;
      item.updatedBy = "legacy Shopling image repair";
      changedIds.push(candidate.itemId);
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
      imageRepairAttemptedAt: now,
      imageRepairAttemptCount: attemptCount,
      imageRepairState: "completed",
      imageRepairEvidenceSource: cdn.resolvedGoodsCount > 0
        ? "shopling_api_or_validated_cdn"
        : "shopling_api",
      imageRepairGoodsKeys: candidate.goodsKeys,
      imageRepairFetchedGoodsCount: goods.length,
      imageRepairCdnBaseDetected: cdnBases.length > 0,
    };
    item.updatedAt = now;
    item.updatedBy = "legacy Shopling image repair";
    changedIds.push(candidate.itemId);
  }

  const nextState = { ...state, items, updatedAt: now };
  await writeProductLaunchState(adminConfig.value, identity, nextState);
  const normalizedSync = await reconcileProductLaunchNormalizedAfterLegacyItems(
    adminConfig.value,
    identity,
    changedIds,
  );
  const remainingRetryableCount = repairCandidates(items).length;
  const busy = remainingRetryableCount > 0;

  console.info("[legacy-shopling-image-repair] batch completed", {
    totalCandidateCount: allCandidates.length,
    batchCandidateCount: candidates.length,
    remainingRetryableCount,
    requestedGoodsKeyCount: allGoodsKeys.length,
    fetchedRows: fetched.fetchedRows,
    fetchedGoodsCount: fetched.byGoodsKey.size,
    cdnBaseDetected: cdnBases.length > 0,
    cdnProbedGoodsCount: cdn.probedGoodsCount,
    cdnResolvedGoodsCount: cdn.resolvedGoodsCount,
    repairedMain,
    repairedAdditional,
    normalizedDelimiterItems,
    noImageEvidenceItems,
    deferredNoImageItems,
    unresolvedModels,
  });

  return Response.json({
    ok: true,
    done: !busy,
    busy,
    totalCandidateCount: allCandidates.length,
    batchCandidateCount: candidates.length,
    remainingRetryableCount,
    requestedGoodsKeyCount: allGoodsKeys.length,
    fetchedRows: fetched.fetchedRows,
    fetchedGoodsCount: fetched.byGoodsKey.size,
    cdnBaseDetected: cdnBases.length > 0,
    cdnProbedGoodsCount: cdn.probedGoodsCount,
    cdnResolvedGoodsCount: cdn.resolvedGoodsCount,
    repairedItems: changedIds.length,
    repairedMain,
    repairedAdditional,
    normalizedDelimiterItems,
    noImageEvidenceItems,
    deferredNoImageItems,
    unresolvedModels,
    normalizedSync,
  });
}
