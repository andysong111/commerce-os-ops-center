import type { KeywordElonSourceDraft } from "./keywordEngineElonLabV2.ts";
import { parse1688OfferId, validate1688Url } from "./keywordEngineElonLabV2.ts";
import type { SeoBulkSeedInput } from "./seoBulkSourceFallback.ts";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { buildLegacyShoplingModelDiscoveryXml, buildLegacyShoplingProductLookupXml } from "@/lib/legacySeoShoplingEvidence";
import { parseShoplingReadResponse, shoplingReadConfigFromEnv, type ShoplingReadConfig } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

type Row = Record<string, unknown>;
const LOOKUP_BUDGET_MS = 75_000;
const CACHE_TTL_MS = 120_000;
const MAX_KEYS = 40;
const MAX_WINDOWS = 28;
// Short-lived, read-only account-wide indexes: multiple RUNs do not rescan the same date windows.
const windowCache = new Map<string, { expiresAt: number; promise: Promise<Row[]> }>();
let planningCache: { expiresAt: number; promise: ReturnType<typeof loadProductPlanningSnapshot> } | null = null;

function text(value: unknown): string {
  if (value && typeof value === "object") {
    const row = value as Row;
    return text(row["#text"] ?? row.__cdata ?? row.cdata);
  }
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}
function model(value: unknown) { return text(value).toUpperCase().replace(/\s+/g, ""); }
function unique(values: unknown[], limit = 40) {
  return [...new Set(values.map(text).filter(Boolean))].slice(0, limit);
}
function keys(values: unknown[]) { return unique(values.filter((value) => /^\d{5,12}$/.test(text(value))), MAX_KEYS); }

/** Trusted launch records only supply lookup hints. The live model_no must still match exactly. */
export function seoBulkShoplingGoodsKeys(item: Row): string[] {
  const products = item.shoplingProducts && typeof item.shoplingProducts === "object" ? item.shoplingProducts as Row : {};
  const history = Array.isArray(item.shoplingRegistrationHistory) ? item.shoplingRegistrationHistory : [];
  return keys([
    ...Object.values(products).map((value) => (value && typeof value === "object" ? (value as Row).goodsKey : "")),
    ...history.slice(-12).reverse().flatMap((value) => {
      const entry = value && typeof value === "object" ? value as Row : {};
      return Array.isArray(entry.registeredGoodsKeys) ? entry.registeredGoodsKeys : [];
    }),
  ]);
}

export function buildSeoBulkShoplingSource(input: SeoBulkSeedInput, rows: Row[]): KeywordElonSourceDraft | null {
  const wanted = model(input.modelNumber);
  if (!wanted) return null;
  // Missing or conflicting model identity is not accepted, even when a historical goods_key matched.
  const exact = rows.filter((row) => model(row.model_no) === wanted);
  const titles = unique(exact.map((row) => row.prod_nm).filter((title) => model(title) !== wanted), 8);
  if (!titles.length) return null;
  const optionNames = unique(exact.filter((row) => text(row.optStatus).toUpperCase() !== "X").map((row) => row.optionName), 60);
  const searchKeywords = unique(exact.flatMap((row) => text(row.site_srch).split(/[,，\r\n]+/)), 80);
  const categories = unique(exact.map((row) => row.cate_all_nm), 6);
  const url = validate1688Url(input.sourceUrl) ? input.sourceUrl : "";
  return {
    url, offerId: parse1688OfferId(url), autoStatus: "partial",
    chineseTitle: titles[0],
    optionText: optionNames.join("\n") || text(input.optionText),
    supportingText: [
      input.productName ? `출시관리 모델명: ${text(input.productName)}` : "",
      `모델번호: ${wanted}`,
      `기존 Shopling 상품명: ${titles.join(" | ")}`,
      categories.length ? `Shopling 카테고리: ${categories.join(" | ")}` : "",
      searchKeywords.length ? `기존 Shopling 검색어(검증 전 참고자료): ${searchKeywords.join(", ")}` : "",
      "기존 검색어와 상품명은 참고자료이며 상품 정체성 검증과 금지키워드 필터를 생략하지 않습니다.",
    ].filter(Boolean).join(" · ").slice(0, 12_000),
    warnings: ["BULK_SHOPLING_EXACT_MODEL_VERIFIED"],
    collectedAt: new Date().toISOString(),
  };
}

function planningSnapshot() {
  const now = Date.now();
  if (planningCache && planningCache.expiresAt > now) return planningCache.promise;
  const promise = loadProductPlanningSnapshot();
  const entry = { expiresAt: now + CACHE_TTL_MS, promise };
  planningCache = entry;
  void promise.catch(() => { if (planningCache === entry) planningCache = null; });
  return promise;
}

async function gather(config: ShoplingReadConfig, xml: string, deadline: number): Promise<Row[]> {
  const remaining = deadline - Date.now();
  if (remaining < 2_000) throw new Error("BULK_SHOPLING_LOOKUP_BUDGET_EXHAUSTED");
  const response = await postShoplingXml(config.productsUrl, xml, {
    headers: {
      accept: "application/xml, text/xml",
      "content-type": "application/xml; charset=utf-8",
      "user-agent": "commerce-os-general-seo-source/1.0",
    },
    // Allow for the existing transport's optional scoped TLS retry; no orphaned Promise.race requests.
    timeoutMs: Math.min(10_000, Math.floor(remaining / 2)),
  });
  if (!response.ok) throw new Error("BULK_SHOPLING_SOURCE_UNAVAILABLE");
  return parseShoplingReadResponse("products", await response.text()) as Row[];
}

/** Read-only A6 lookup. This never writes prices, options, stock, listing data, or registration queues. */
export async function loadSeoBulkShoplingSource(input: SeoBulkSeedInput): Promise<KeywordElonSourceDraft | null> {
  const wanted = model(input.modelNumber);
  if (!wanted) return null;
  const config = shoplingReadConfigFromEnv(process.env);
  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  const queried = new Set<string>();
  const lookup = async (hints: unknown[]) => {
    const goodsKeys = keys(hints).filter((key) => !queried.has(key));
    if (!goodsKeys.length) return null;
    goodsKeys.forEach((key) => queried.add(key));
    const rows = await gather(config, buildLegacyShoplingProductLookupXml(config, goodsKeys), deadline);
    const requested = new Set(goodsKeys);
    return buildSeoBulkShoplingSource(input, rows.filter((row) => requested.has(text(row.goods_key))));
  };
  const direct = await lookup(input.shoplingGoodsKeys ?? []);
  if (direct) return direct;

  // Planning is an index, not the seed authority; always verify the current Shopling response.
  try {
    const snapshot = await planningSnapshot();
    const hints = (snapshot.products ?? []).filter((product) => model(product.modelNo) === wanted)
      .flatMap((product) => (product.listings ?? []).filter((listing) => listing.active !== false).map((listing) => listing.goodsKey));
    const indexed = await lookup(hints);
    if (indexed) return indexed;
  } catch {
    // An unavailable planning index does not imply that Shopling has no product.
  }

  let end = new Date();
  end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  for (let index = 0; index < MAX_WINDOWS && end.getUTCFullYear() >= 2021; index += 1) {
    if (Date.now() >= deadline - 2_000) throw new Error("BULK_SHOPLING_LOOKUP_BUDGET_EXHAUSTED");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 89);
    if (start.getUTCFullYear() < 2021) start.setTime(Date.UTC(2021, 0, 1));
    const cacheKey = `${config.companyId}:${config.loginId}:${config.productsUrl}:${start.toISOString()}:${end.toISOString()}`;
    let entry = windowCache.get(cacheKey);
    if (!entry || entry.expiresAt <= Date.now()) {
      for (const [key, cached] of windowCache) if (cached.expiresAt <= Date.now()) windowCache.delete(key);
      if (windowCache.size >= MAX_WINDOWS) windowCache.delete(windowCache.keys().next().value!);
      const promise = gather(config, buildLegacyShoplingModelDiscoveryXml(config, start, end), deadline);
      entry = { expiresAt: Date.now() + CACHE_TTL_MS, promise };
      windowCache.set(cacheKey, entry);
      void promise.catch(() => { if (windowCache.get(cacheKey)?.promise === promise) windowCache.delete(cacheKey); });
    }
    const discovered = await entry.promise;
    const found = await lookup(discovered.filter((row) => model(row.model_no) === wanted).map((row) => row.goods_key));
    if (found) return found;
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() - 1);
  }
  return null;
}
