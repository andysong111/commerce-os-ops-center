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
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "shopling_existing_product_backfill";
const MAX_GOODS_PER_REQUEST = 40;
const MAX_GOODS_PER_ITEM = 8;
const MAX_ADDITIONAL_IMAGES = 10;
const PRODUCT_FIELDS = [
  "goods_key",
  ...Array.from({ length: 32 }, (_, index) => `img_${index}`),
].join(",");

const SHIPPING_NOTICE_URLS = [
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%801%EB%B2%88111.jpg",
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%802%EB%B2%88%20222.jpg",
  "https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%803%EB%B2%88111.jpg",
  "https://ai.esmplus.com/andy80101/%EC%83%88%ED%8F%B4%EB%8D%9458/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%803%EB%B2%8831.jpg",
];

type UnknownRecord = Record<string, unknown>;
type GoodsImages = {
  goodsKey: string;
  img0: string[];
  img19: string[];
  all: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeGoodsKey(value: unknown) {
  const normalized = text(value);
  return /^\d{5,12}$/.test(normalized) ? normalized : "";
}

function unique(values: string[], limit = Number.MAX_SAFE_INTEGER) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = text(raw);
    if (!value) continue;
    const key = normalizedUrlKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function splitImageField(value: unknown) {
  const raw = text(value);
  if (!raw) return [];
  return raw
    .split(/[\t\r\n ]+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\//i.test(entry));
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

function isShippingNotice(value: string) {
  return SHIPPING_NOTICE_KEYS.has(normalizedUrlKey(value));
}

function isGifUrl(value: string) {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return /\.gif(?:$|[?#])/i.test(value);
  }
}

function cleanImages(values: string[], limit = Number.MAX_SAFE_INTEGER) {
  return unique(
    values.filter((value) => !isGifUrl(value) && !isShippingNotice(value)),
    limit,
  );
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, { value: string; count: number; first: number }>();
  values.forEach((value, index) => {
    const key = normalizedUrlKey(value);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { value, count: 1, first: index });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0]?.value || "";
}

function chooseMainImage(goods: GoodsImages[]) {
  const fromImg0 = cleanImages(goods.flatMap((row) => row.img0));
  if (fromImg0.length) return mostFrequent(fromImg0);
  const fromImg19 = cleanImages(goods.flatMap((row) => row.img19));
  if (fromImg19.length) return mostFrequent(fromImg19);
  return cleanImages(goods.flatMap((row) => row.all))[0] || "";
}

function chooseAdditionalImages(goods: GoodsImages[], mainImageUrl: string) {
  const mainKey = normalizedUrlKey(mainImageUrl);
  return cleanImages(goods.flatMap((row) => row.all))
    .filter((value) => normalizedUrlKey(value) !== mainKey)
    .slice(0, MAX_ADDITIONAL_IMAGES);
}

function normalizeCurrentAdditional(value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  return cleanImages(
    raw.flatMap((entry) => splitImageField(entry)),
    MAX_ADDITIONAL_IMAGES,
  );
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

async function fetchGoodsImages(goodsKeys: string[]) {
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const result = new Map<string, GoodsImages>();
  for (let index = 0; index < goodsKeys.length; index += MAX_GOODS_PER_REQUEST) {
    const chunk = goodsKeys.slice(index, index + MAX_GOODS_PER_REQUEST);
    const response = await postShoplingXml(config.productsUrl, buildProductLookupXml(config, chunk), {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-legacy-shopling-image-repair/1.0",
      },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`LEGACY_SHOPLING_IMAGE_REPAIR_HTTP_${response.status}`);
    for (const raw of parseShoplingReadResponse("products", body)) {
      const row = record(raw);
      const goodsKey = normalizeGoodsKey(row.goods_key);
      if (!goodsKey || result.has(goodsKey)) continue;
      const all: string[] = [];
      for (let imageIndex = 0; imageIndex <= 31; imageIndex += 1) {
        all.push(...splitImageField(row[`img_${imageIndex}`]));
      }
      result.set(goodsKey, {
        goodsKey,
        img0: splitImageField(row.img_0),
        img19: splitImageField(row.img_19),
        all: unique(all),
      });
    }
  }
  return result;
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

  const targets = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (text(item.archivedAt)) return false;
      const source = record(item.detailPageAssetSource);
      return text(source.source) === SOURCE;
    });

  const goodsByItem = new Map<number, string[]>();
  const allGoodsKeys: string[] = [];
  for (const { item, index } of targets) {
    const source = record(item.detailPageAssetSource);
    const sourceGoods = Array.isArray(source.goodsKeys) ? source.goodsKeys : [];
    const goodsKeys = sourceGoods
      .map(normalizeGoodsKey)
      .filter(Boolean)
      .slice(0, MAX_GOODS_PER_ITEM);
    goodsByItem.set(index, goodsKeys);
    allGoodsKeys.push(...goodsKeys);
  }

  const fetched = await fetchGoodsImages(unique(allGoodsKeys));
  const changedIds: string[] = [];
  const samples: UnknownRecord[] = [];
  const stats = {
    targetCount: targets.length,
    requestedGoodsKeyCount: unique(allGoodsKeys).length,
    fetchedGoodsKeyCount: fetched.size,
    changedCount: 0,
    mainImageFilledCount: 0,
    mainImageNormalizedCount: 0,
    additionalImagesFilledCount: 0,
    additionalImagesNormalizedCount: 0,
    stillMissingMainCount: 0,
    stillMissingAdditionalCount: 0,
  };

  for (const { item, index } of targets) {
    const goodsKeys = goodsByItem.get(index) ?? [];
    const goods = goodsKeys.map((key) => fetched.get(key)).filter(Boolean) as GoodsImages[];
    const chosenMain = chooseMainImage(goods);
    const chosenAdditional = chooseAdditionalImages(goods, chosenMain);
    const currentAsset = record(item.detailPageAsset);
    const currentMainParts = splitImageField(currentAsset.mainImageUrl);
    const currentMain = cleanImages(currentMainParts, 1)[0] || "";
    const currentAdditional = normalizeCurrentAdditional(currentAsset.additionalImageUrls);

    let nextMain = currentMain;
    let nextAdditional = currentAdditional;
    let changed = false;

    if (!nextMain && chosenMain) {
      nextMain = chosenMain;
      stats.mainImageFilledCount += 1;
      changed = true;
    } else if (nextMain && text(currentAsset.mainImageUrl) !== nextMain) {
      stats.mainImageNormalizedCount += 1;
      changed = true;
    }

    if (!nextAdditional.length && chosenAdditional.length) {
      nextAdditional = chosenAdditional;
      stats.additionalImagesFilledCount += 1;
      changed = true;
    } else {
      const rawCurrent = Array.isArray(currentAsset.additionalImageUrls)
        ? currentAsset.additionalImageUrls.map(text).filter(Boolean)
        : [];
      if (!sameStringArray(rawCurrent, nextAdditional)) {
        stats.additionalImagesNormalizedCount += 1;
        changed = true;
      }
    }

    if (!nextMain) stats.stillMissingMainCount += 1;
    if (!nextAdditional.length) stats.stillMissingAdditionalCount += 1;

    if (changed) {
      const now = new Date().toISOString();
      items[index] = {
        ...item,
        detailPageAsset: {
          ...currentAsset,
          mainImageUrl: nextMain,
          additionalImageUrls: nextAdditional,
        },
        detailPageAssetSource: {
          ...record(item.detailPageAssetSource),
          imageRepairVersion: 1,
          imageRepairedAt: now,
          imageFields: "img_0..img_31",
          imageDelimiterNormalized: true,
          mainFallbackPolicy: "img_0_then_img_19_then_first_non_gif",
        },
        updatedAt: now,
        updatedBy: "Shopling 기존상품 대표/부가이미지 복구",
      };
      changedIds.push(text(item.id));
    }

    if (samples.length < 25) {
      samples.push({
        modelNumber: text(item.modelNumber),
        goodsKeyCount: goodsKeys.length,
        fetchedEvidenceCount: goods.length,
        currentMain: Boolean(currentMain),
        chosenMain: Boolean(chosenMain),
        currentAdditionalCount: currentAdditional.length,
        chosenAdditionalCount: chosenAdditional.length,
        changed,
      });
    }
  }

  stats.changedCount = changedIds.length;
  if (mode === "apply" && changedIds.length) {
    state.items = items;
    state.savedAt = new Date().toISOString();
    await writeProductLaunchState(config, identity, state);
    await reconcileProductLaunchNormalizedAfterLegacyItems(config, identity, changedIds);
  }

  return Response.json({
    ok: true,
    mode,
    stats,
    changedIds,
    samples,
  });
}
