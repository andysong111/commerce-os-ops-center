import { ownStoreLink } from "./restockAlertCore.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "./productGroupMarketRegistry.ts";

export type MarketOffer = { market: string; url: string; price: number };
export type QuoteTarget = { goodsKey: string; adjustment: number };
export type MarketQuote = {
  offer: MarketOffer | null;
  marketCount: number;
  complete: boolean;
};
export type QuoteView = {
  state: "pending" | "ready" | "unavailable";
  result?: MarketQuote;
};
const markets = new Map([
  ["SMALL_00014", "카페24"],
  ["SMALL_00069", "도매꾹"],
  ["SMALL_00107", "오너클랜"],
  ["SMALL_00004", "스마트스토어"],
]);
const accounts = PRODUCT_GROUP_MARKET_REGISTRY.filter((a) =>
  markets.has(a.mallKey),
);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
type Row = Record<string, unknown>;
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};

function offerLink(mall: string, code: string) {
  if (mall === "오너클랜")
    return /^W[A-Z0-9]{3,12}$/.test(code)
      ? "https://ownerclan.com/V2/product/view.php?selfcode=" + code
      : "";
  if (!/^[1-9]\d{0,14}$/.test(code)) return "";
  if (mall === "카페24") return ownStoreLink(code);
  if (mall === "도매꾹") return "https://domeggook.com/" + code;
  // The registered Smart Store account's Shopling product link resolves to ssjshop.
  return "https://smartstore.naver.com/ssjshop/products/" + code;
}

export function rankRestockOffers(
  targets: QuoteTarget[],
  observations: unknown,
): MarketQuote {
  const byUrl = new Map<string, MarketOffer>();
  let complete = true;
  const batches = Array.isArray(observations) ? observations.map(record) : [];
  for (const target of targets) {
    const matches = batches.filter((b) => b.goodsKey === target.goodsKey);
    if (matches.length !== 1 || !Array.isArray(matches[0].rows)) {
      complete = false;
      continue;
    }
    for (const raw of matches[0].rows) {
      const r = record(raw);
      const seller = accounts.find(
        (a) =>
          a.marketName === text(r.site) && a.accountIdLabel === text(r.account),
      );
      if (!seller) continue;
      const market = markets.get(seller.mallKey)!;
      if (text(r.status) !== "판매중") continue;
      const url = offerLink(market, text(r.code));
      const price = Number(r.basePrice) + target.adjustment;
      if (
        !url ||
        !Number.isSafeInteger(r.basePrice) ||
        Number(r.basePrice) <= 0 ||
        !Number.isSafeInteger(price) ||
        price <= 0 ||
        price > 100000000
      ) {
        complete = false;
        continue;
      }
      const prior = byUrl.get(url);
      if (prior && prior.price !== price) {
        complete = false;
        continue;
      }
      byUrl.set(url, { market, url, price });
    }
  }
  const order = [...markets.values()];
  const offers = [...byUrl.values()].sort(
    (a, b) =>
      a.price - b.price ||
      order.indexOf(a.market) - order.indexOf(b.market) ||
      a.url.localeCompare(b.url),
  );
  return {
    offer: complete ? (offers[0] ?? null) : null,
    marketCount: new Set(offers.map((o) => o.market)).size,
    complete,
  };
}
