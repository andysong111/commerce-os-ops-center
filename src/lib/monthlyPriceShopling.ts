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
export async function readMonthlyLiveProduct(goodsKey: string) {
  if (!/^\d{5,9}$/.test(goodsKey)) throw new Error("MONTHLY_PRICE_GOODSKEY_INVALID");
  const cfg = config();
  const xml = buildShoplingProductIdLookupXml(cfg, [goodsKey], "goods_key,ptn_goods_cd,prod_nm,org_price,sale_price,list_price,sale_status");
  const result = await postShoplingXml(cfg.productsUrl, xml, { headers, timeoutMs: 15_000 });
  if (!result.ok) throw new Error("MONTHLY_PRICE_SHOPLING_READ_FAILED");
  return parseShoplingReadResponse("products", await result.text()) as Record<string, unknown>[];
}
export function buildMonthlyPriceWriteXml(goodsKey: string, write: MonthlyPriceWrite, auth: { loginId: string; companyId: string; authKey: string }) {
  if (!/^\d{5,9}$/.test(goodsKey) || (write.mallKey && !/^SMALL_\d{5}$/.test(write.mallKey))) throw new Error("MONTHLY_PRICE_WRITE_SCOPE_INVALID");
  for (const values of [write.before, write.target]) { monthlyMoney(values.sellPrice); monthlyMoney(values.purchasePrice, true); monthlyMoney(values.consumerPrice, true); }
  if (write.target.sellPrice <= write.before.sellPrice || write.target.purchasePrice !== write.before.purchasePrice || write.target.consumerPrice !== write.before.consumerPrice) throw new Error("MONTHLY_PRICE_WRITE_POLICY_VIOLATION");
  const tag = write.mallKey ? "apiProdEachMdy" : "apiProdMdy";
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><${tag}><login_id>${cdata(auth.loginId)}</login_id><company_id>${cdata(auth.companyId)}</company_id><api_auth_key>${cdata(auth.authKey)}</api_auth_key><goodsInfo>${write.mallKey ? `<mall_key>${write.mallKey}</mall_key>` : ""}<goods_key>${goodsKey}</goods_key><sale_price>${write.target.sellPrice}</sale_price><org_price>${write.target.purchasePrice}</org_price><list_price>${write.target.consumerPrice}</list_price></goodsInfo></${tag}></reqst>`;
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
export async function writeMonthlyShoplingPrice(goodsKey: string, write: MonthlyPriceWrite) {
  const xml = buildMonthlyPriceWriteXml(goodsKey, write, config());
  const result = await postShoplingXml(write.mallKey ? MALL_WRITE_URL : PRODUCT_WRITE_URL, xml, { headers, timeoutMs: 15_000 });
  if (!result.ok) throw new Error("MONTHLY_PRICE_WRITE_UNCERTAIN");
  assertMonthlyWriteAcknowledgement(await result.text(), goodsKey);
}
