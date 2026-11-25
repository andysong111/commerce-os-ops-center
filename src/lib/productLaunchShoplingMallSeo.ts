import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";
import {
  dispatchKeywordShoplingDirectApply,
  KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
} from "@/lib/keywordShoplingDirectApplyRunner";

const GROUP_CHANNEL_KEY = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
} as const;

type ProductGroup = keyof typeof GROUP_CHANNEL_KEY;
type UnknownRecord = Record<string, unknown>;

export type ProductLaunchMallSeoPlanRow = {
  goods_key: string;
  mall_key: string;
  final_title: string;
  final_site_srch: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeSearchLine(value: unknown) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[,\n;|/]+|\s{2,}/)
        .map(text)
        .filter(Boolean),
    ),
  ].join(",");
}

export function buildProductLaunchMallSeoPlan(
  itemInput: unknown,
): ProductLaunchMallSeoPlanRow[] {
  const item = record(itemInput);
  const products = record(item.shoplingProducts);
  const seoFinal = record(item.seoFinal);
  const mallTitles = Array.isArray(seoFinal.mallTitles)
    ? seoFinal.mallTitles.map(record)
    : [];
  const searchLine = normalizeSearchLine(
    seoFinal.searchLine ||
      (Array.isArray(seoFinal.searchKeywords)
        ? seoFinal.searchKeywords.join(",")
        : ""),
  );
  const searchCount = searchLine ? searchLine.split(",").filter(Boolean).length : 0;
  if (searchCount !== 10) {
    throw new Error("쇼핑몰별 상품명 반영에는 공통 검색어가 정확히 10개 필요합니다.");
  }
  if (mallTitles.length !== PRODUCT_GROUP_MARKET_REGISTRY.length) {
    throw new Error(
      `SEO Cloud 쇼핑몰별 상품명은 ${PRODUCT_GROUP_MARKET_REGISTRY.length}개가 필요합니다. 현재 ${mallTitles.length}개입니다.`,
    );
  }

  const titleByTarget = new Map<string, string>();
  for (const row of mallTitles) {
    const productGroup = text(row.productGroup) as ProductGroup;
    const mallKey = text(row.mallKey);
    const title = text(row.title);
    if (!(productGroup in GROUP_CHANNEL_KEY)) {
      throw new Error(`지원하지 않는 상품그룹입니다: ${productGroup}`);
    }
    if (!/^SMALL_\d{5}$/.test(mallKey)) {
      throw new Error(`쇼핑몰 ID가 올바르지 않습니다: ${mallKey}`);
    }
    if (!title) {
      throw new Error(`${productGroup}/${mallKey} 쇼핑몰별 상품명이 비어 있습니다.`);
    }
    if (new TextEncoder().encode(title).length > 100) {
      throw new Error(`${productGroup}/${mallKey} 쇼핑몰별 상품명이 100bytes를 초과했습니다.`);
    }
    const target = `${productGroup}:${mallKey}`;
    if (titleByTarget.has(target)) {
      throw new Error(`쇼핑몰별 상품명 대상이 중복되었습니다: ${target}`);
    }
    titleByTarget.set(target, title);
  }

  const plan = PRODUCT_GROUP_MARKET_REGISTRY.map((market) => {
    const productGroup = market.productGroup as ProductGroup;
    const channel = record(products[GROUP_CHANNEL_KEY[productGroup]]);
    const goodsKey = text(channel.goodsKey);
    const title = titleByTarget.get(`${productGroup}:${market.mallKey}`) ?? "";
    if (!/^\d+$/.test(goodsKey)) {
      throw new Error(`${productGroup} goods_key가 없어 쇼핑몰별 상품명을 반영할 수 없습니다.`);
    }
    if (!title) {
      throw new Error(`${productGroup}/${market.mallKey} 상품명 재고가 없습니다.`);
    }
    return {
      goods_key: goodsKey,
      mall_key: market.mallKey,
      final_title: title,
      final_site_srch: searchLine,
    };
  });

  const targets = new Set(plan.map((row) => `${row.goods_key}:${row.mall_key}`));
  if (targets.size !== plan.length) {
    throw new Error("동일 goods_key/쇼핑몰 ID가 중복되어 쇼핑몰별 상품명 반영을 차단했습니다.");
  }
  return plan;
}

export async function dispatchProductLaunchMallSeo(itemInput: unknown) {
  const plan = buildProductLaunchMallSeoPlan(itemInput);
  const result = await dispatchKeywordShoplingDirectApply({
    execution_plan_json: JSON.stringify(plan),
    confirmation_text: KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
    max_items: plan.length,
  });
  if (result.status !== "queued" || !result.requestId) {
    throw new Error(result.message || "쇼핑몰별 상품명·검색어 반영을 시작하지 못했습니다.");
  }
  return { ...result, plan };
}
