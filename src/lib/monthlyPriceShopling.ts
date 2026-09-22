import { shoplingReadConfigFromEnv, parseShoplingReadResponse } from "@/lib/shopling/shoplingReadClient";
import { buildShoplingProductIdLookupXml } from "@/lib/shopling/shoplingCurrentPriceResolver";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import { parseSimpleXml } from "@/lib/shopling/simpleXml";
import { monthlyRecord, monthlyMoney, type MonthlyPriceWrite } from "@/lib/monthlyPriceCore";

const PRODUCT_WRITE_URL = "https://api.shopling.co.kr/prod/prod_modify_api.phtml?mode=2";
const MALL_WRITE_URL = "https://api.shopling.co.kr/prod/prod_each_mall_modify_api.phtml?mode=2";
const headers = { accept: "application/xml, text/xml", "content-type": "application/xml; charset=utf-8" };
function config() { return shoplingReadConfigFromEnv(process.env); }
function cdata(value: string) { return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`; }
function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function asObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asObject).filter(Boolean) as Record<string, unknown>[];
  const row = asObject(value); return row ? [row] : [];
}
function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  const row = asObject(value); return row ? scalar(row["#text"] ?? row.__cdata ?? row.cdata) : "";
}
function csv(value: unknown) { const text = scalar(value); return text ? text.split(",").map((row) => row.trim()) : []; }
export type MonthlyShoplingOptionList = { title: string; values: string[] };
export type MonthlyShoplingLiveSnapshot = {
  rows: Record<string, unknown>[];
  optionLists: MonthlyShoplingOptionList[];
  optionIds: string[];
};
function optionSnapshot(body: string, rows: Record<string, unknown>[]): MonthlyShoplingLiveSnapshot {
  const parsed = parseSimpleXml(body);
  const rspns = asObject(asObject(parsed)?.rspns ?? parsed);
  const container = asObject(rspns?.apiProdGather);
  const goods = asObjects(container?.goodsInfo);
  if (goods.length !== 1) throw new Error("MONTHLY_PRICE_LIVE_PRODUCT_REQUIRED");
  const options = asObject(goods[0].options);
  const optionLists = asObjects(options?.optList).map((list) => ({
    title: scalar(list.title),
    values: csv(list.value),
  }));
  if (optionLists.some((list) => !list.title || !list.values.length || list.values.some((value) => !value))) throw new Error("MONTHLY_PRICE_OPTION_STRUCTURE_INVALID");
  const optionIds = rows.map((row) => String(row.optId ?? ""));
  if (!optionIds.length || optionIds.some((id) => !id) || new Set(optionIds).size !== optionIds.length) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
  return { rows, optionLists, optionIds };
}
export async function readMonthlyLiveProduct(goodsKey: string): Promise<MonthlyShoplingLiveSnapshot> {
  if (!/^\d{5,9}$/.test(goodsKey)) throw new Error("MONTHLY_PRICE_GOODSKEY_INVALID");
  const cfg = config();
  const xml = buildShoplingProductIdLookupXml(cfg, [goodsKey], "goods_key,ptn_goods_cd,prod_nm,org_price,sale_price,list_price,sale_status");
  const result = await postShoplingXml(cfg.productsUrl, xml, { headers, timeoutMs: 15_000 });
  if (!result.ok) throw new Error("MONTHLY_PRICE_SHOPLING_READ_FAILED");
  const body = await result.text();
  const rows = parseShoplingReadResponse("products", body) as Record<string, unknown>[];
  return optionSnapshot(body, rows);
}
function optionXml(write: MonthlyPriceWrite, snapshot?: MonthlyShoplingLiveSnapshot) {
  if (!write.optionAmounts) return "";
  const changed = write.optionAmounts.some((row) => row.target !== row.before);
  if (!changed) return "";
  if (!snapshot) throw new Error("MONTHLY_PRICE_OPTION_STRUCTURE_REQUIRED");
  const targetById = new Map(write.optionAmounts.map((row) => [row.optionId, row.target]));
  if (targetById.size !== write.optionAmounts.length || snapshot.optionIds.length !== write.optionAmounts.length) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
  const targetAmounts = snapshot.optionIds.map((id) => {
    const value = targetById.get(id);
    if (value === undefined) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
    return monthlyMoney(value, true);
  });
  if (!snapshot.optionLists.length) throw new Error("MONTHLY_PRICE_OPTION_STRUCTURE_REQUIRED");
  const combinationCount = snapshot.optionLists.reduce((count, list) => count * list.values.length, 1);
  if (combinationCount !== targetAmounts.length) throw new Error("MONTHLY_PRICE_OPTION_STRUCTURE_INVALID");
  const lists = snapshot.optionLists.map((list) =>
    `<optList><title>${cdata(list.title)}</title><value>${cdata(list.values.join(","))}</value></optList>`
  ).join("");
  return `<options>${lists}<optAmt>${targetAmounts.join(",")}</optAmt></options>`;
}
export function buildMonthlyPriceWriteXml(
  goodsKey: string,
  write: MonthlyPriceWrite,
  auth: { loginId: string; companyId: string; authKey: string },
  snapshot?: MonthlyShoplingLiveSnapshot,
) {
  if (!/^\d{5,9}$/.test(goodsKey) || (write.mallKey && !/^SMALL_\d{5}$/.test(write.mallKey))) throw new Error("MONTHLY_PRICE_WRITE_SCOPE_INVALID");
  for (const values of [write.before, write.target]) { monthlyMoney(values.sellPrice); monthlyMoney(values.purchasePrice, true); monthlyMoney(values.consumerPrice, true); }
  const optionIncrease = Boolean(write.optionAmounts?.some((row) => row.target > row.before));
  if (
    write.target.sellPrice < write.before.sellPrice
    || (!optionIncrease && write.target.sellPrice <= write.before.sellPrice)
    || write.target.purchasePrice !== write.before.purchasePrice
    || write.target.consumerPrice !== write.before.consumerPrice
    || write.optionAmounts?.some((row) => row.target < row.before || row.targetEffectivePrice < row.currentEffectivePrice)
  ) throw new Error("MONTHLY_PRICE_WRITE_POLICY_VIOLATION");
  if (write.mallKey && write.optionAmounts) throw new Error("MONTHLY_PRICE_OPTION_MALL_SCOPE_INVALID");
  const tag = write.mallKey ? "apiProdEachMdy" : "apiProdMdy";
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><${tag}><login_id>${cdata(auth.loginId)}</login_id><company_id>${cdata(auth.companyId)}</company_id><api_auth_key>${cdata(auth.authKey)}</api_auth_key><goodsInfo>${write.mallKey ? `<mall_key>${write.mallKey}</mall_key>` : ""}<goods_key>${goodsKey}</goods_key><sale_price>${write.target.sellPrice}</sale_price><org_price>${write.target.purchasePrice}</org_price><list_price>${write.target.consumerPrice}</list_price>${write.mallKey ? "" : optionXml(write, snapshot)}</goodsInfo></${tag}></reqst>`;
}
export function assertMonthlyWriteAcknowledgement(body: string, goodsKey: string) {
  const parsed = parseSimpleXml(body);
  const queue: unknown[] = [parsed], results: Record<string, unknown>[] = [];
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) { queue.push(...node); continue; }
    for (const [key, value] of Object.entries(monthlyRecord(node))) {
      if (key === "goodsRst") results.push(...(Array.isArray(value) ? value : [value]).map(monthlyRecord));
      else if (typeof value === "object") queue.push(value);
    }
  }
  if (results.length !== 1 || String(results[0].code) !== "000" || (results[0].goods_key && String(results[0].goods_key) !== goodsKey)) throw new Error("MONTHLY_PRICE_WRITE_ACK_UNVERIFIED");
}
export async function writeMonthlyShoplingPrice(goodsKey: string, write: MonthlyPriceWrite, snapshot?: MonthlyShoplingLiveSnapshot) {
  const xml = buildMonthlyPriceWriteXml(goodsKey, write, config(), snapshot);
  const result = await postShoplingXml(write.mallKey ? MALL_WRITE_URL : PRODUCT_WRITE_URL, xml, { headers, timeoutMs: 15_000 });
  if (!result.ok) throw new Error("MONTHLY_PRICE_WRITE_UNCERTAIN");
  assertMonthlyWriteAcknowledgement(await result.text(), goodsKey);
}
