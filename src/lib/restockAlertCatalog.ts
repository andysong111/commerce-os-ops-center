import { PRODUCT_GROUP_MARKET_REGISTRY } from "./productGroupMarketRegistry";
import { ownStoreLink, storeProductNumber } from "./restockAlertCore";
import { normalizeShoplingBcode } from "./shopling/shoplingBcodeIndexCore";
import { shoplingReadConfigFromEnv } from "./shopling/shoplingReadClient";
import { readShoplingStockVariants } from "./shopling/shoplingOptionStatus";
import { postShoplingXml } from "./shopling/shoplingTlsTransport";
import { parseSimpleXml } from "./shopling/simpleXml";

type Row = Record<string, unknown>;
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const field = (name: string, value: string) =>
  "<" +
  name +
  "><![CDATA[" +
  value.replaceAll("]]>", "]]]]><![CDATA[>") +
  "]]></" +
  name +
  ">";
export type RestockProduct = {
  number: string;
  url: string;
  name: string;
  options: string[];
  offer?: import("./restockMarketOffer").MarketOffer;
};
export async function restockCatalog(
  barcode: string,
  selectedUrl: string,
  keys: string[],
  requireSale = true,
): Promise<RestockProduct> {
  if (!keys.length) throw new Error("CATALOG");
  const config = shoplingReadConfigFromEnv(process.env);
  const fetched = await readShoplingStockVariants(keys);
  const rows = fetched.filter(
    (r) =>
      normalizeShoplingBcode(r.partnerOptionCode) === barcode &&
      r.productSaleStatus !== "E" &&
      keys.includes(r.goodsKey),
  );
  if (!rows.length) throw new Error("CATALOG");
  const mall = PRODUCT_GROUP_MARKET_REGISTRY.find(
    (m) => m.mallKey === "SMALL_00014",
  )!;
  const ids = [...new Set(rows.map((r) => r.goodsKey))];
  const infos = ids
    .map(
      (id) =>
        "<goodsInfo>" +
        field("mall_key", mall.mallKey) +
        field("mall_login_id", mall.accountIdLabel) +
        field("goods_key", id) +
        "</goodsInfo>",
    )
    .join("");
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><reqst><apiGetMallGoodsCd>' +
    field("login_id", config.loginId) +
    field("company_id", config.companyId) +
    field("api_auth_key", config.authKey) +
    infos +
    "</apiGetMallGoodsCd></reqst>";
  const res = await postShoplingXml(
    "https://api.shopling.co.kr/prod/get_mall_goods_cd.phtml?mode=2",
    xml,
    {
      headers: {
        accept: "application/xml",
        "content-type": "application/xml; charset=utf-8",
      },
      timeoutMs: 10000,
    },
  );
  if (!res.ok) throw new Error("CATALOG");
  const root = record(
    record(parseSimpleXml(await res.text()).rspns).apiGetMallGoodsCdRst,
  );
  if (
    String(root.login_id) !== config.loginId ||
    String(root.company_id) !== config.companyId
  )
    throw new Error("CATALOG");
  const links = (
    Array.isArray(root.goodsListRst) ? root.goodsListRst : [root.goodsListRst]
  )
    .map(record)
    .filter(
      (r) =>
        r.mall_key === mall.mallKey &&
        r.mall_login_id === mall.accountIdLabel &&
        r.code === "000" &&
        ids.includes(String(r.goods_key)) &&
        /^[1-9]\d{0,12}$/.test(String(r.mall_goods_cd)),
    );
  const allowed = selectedUrl
    ? links.filter((r) => r.mall_goods_cd === storeProductNumber(selectedUrl))
    : links;
  if (allowed.length !== 1) throw new Error("CATALOG");
  const source = rows.filter((r) => r.goodsKey === allowed[0].goods_key);
  if (source.length !== 1) throw new Error("CATALOG");
  const row = source[0],
    number = String(allowed[0].mall_goods_cd);
  if (
    !row.productName.trim() ||
    (requireSale && (row.productSaleStatus !== "B" || row.optionStatus !== "B"))
  )
    throw new Error("CATALOG");
  const options = row.selection
    .filter((option) => !(option.title === "단품" && option.value === "단품"))
    .map((option) => option.value.trim());
  if (
    options.some((v) => !v) ||
    (!options.length &&
      fetched.filter((r) => r.goodsKey === row.goodsKey).length !== 1)
  )
    throw new Error("CATALOG");
  return {
    number,
    url: ownStoreLink(number),
    name: [row.productName, ...options].join(" "),
    options,
  };
}
