import { postShoplingApiXml } from "./shopling-api-transport.mjs";
import { parseSimpleXml } from "./simple-xml.mjs";

const ORDERS_URL = "https://api.shopling.co.kr/order/order_gather_api.phtml?mode=2";
const PRODUCTS_URL = "https://api.shopling.co.kr/prod/prod_gather_api.phtml?mode=2";
const ORDER_FIELDS = "ord_no,prod_id,opt_id,t_prod_nm,t_opt_valu,ptn_goods_cd,mall_ord_cnt";
const PRODUCT_FIELDS = "goods_key,ptn_goods_cd,prod_nm,model_no,model_nm,sale_status";

function clean(value) {
  if (value === undefined || value === null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  if (typeof value === "object" && !Array.isArray(value)) return clean(value["#text"] ?? value.__cdata);
  return "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function objects(value) {
  return Array.isArray(value) ? value.map(object) : value ? [object(value)] : [];
}

function splitCsv(value) {
  const text = clean(value);
  return text ? text.split(",").map((item) => item.trim()) : [];
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function required(env, name) {
  const value = clean(env[name]);
  if (!value) throw new Error(`SHOPLING_CREDENTIAL_REQUIRED:${name}`);
  return value;
}

export function shoplingIdentityConfigFromEnv(env = process.env) {
  return {
    loginId: required(env, "SHOPLING_LOGIN_ID"),
    companyId: required(env, "SHOPLING_COMPANY_ID"),
    authKey: required(env, "SHOPLING_API_AUTH_KEY"),
    ordersUrl: clean(env.SHOPLING_ORDERS_API_URL) || ORDERS_URL,
    productsUrl: clean(env.SHOPLING_PRODUCTS_API_URL) || PRODUCTS_URL,
  };
}

function authXml(config) {
  return `<login_id>${cdata(config.loginId)}</login_id><company_id>${cdata(config.companyId)}</company_id><api_auth_key>${cdata(config.authKey)}</api_auth_key>`;
}

export function buildIdentityOrderReadXml(config, startDate, endDate) {
  const start = clean(startDate).replace(/\D/g, "");
  const end = clean(endDate).replace(/\D/g, "");
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) throw new Error("SHOPLING_DATE_RANGE_INVALID");
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiOrdGather>${authXml(config)}<start_dt>${start}</start_dt><end_dt>${end}</end_dt><ord_fields>${cdata(ORDER_FIELDS)}</ord_fields></apiOrdGather></reqst>`;
}

export function buildIdentityProductReadXml(config, productIds) {
  const ids = [...new Set(productIds.map(clean).filter((value) => /^\d+$/.test(value)))];
  if (!ids.length || ids.length > 50) throw new Error("SHOPLING_PRODUCT_ID_LOOKUP_BATCH_INVALID");
  return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiProdGather>${authXml(config)}<prod_id>${cdata(ids.join(","))}</prod_id><prod_fields>${cdata(PRODUCT_FIELDS)}</prod_fields><opt_yn>Y</opt_yn><attri_yn>N</attri_yn></apiProdGather></reqst>`;
}

export function parseIdentityOrders(body) {
  const parsed = object(parseSimpleXml(body));
  const container = object(object(parsed.rspns || parsed).apiOrdGatherRst);
  if (!Object.keys(container).length) throw new Error("SHOPLING_ORDERS_RESPONSE_ERROR");
  return objects(container.ordListRst).map((row) => ({
    ord_no: clean(row.ord_no),
    prod_id: clean(row.prod_id),
    opt_id: clean(row.opt_id),
    t_prod_nm: clean(row.t_prod_nm),
    t_opt_valu: clean(row.t_opt_valu),
    ptn_goods_cd: clean(row.ptn_goods_cd),
    mall_ord_cnt: clean(row.mall_ord_cnt),
  }));
}

export function parseIdentityProducts(body) {
  const parsed = object(parseSimpleXml(body));
  const container = object(object(parsed.rspns || parsed).apiProdGather);
  if (!Object.keys(container).length) throw new Error("SHOPLING_PRODUCTS_RESPONSE_ERROR");
  return objects(container.goodsInfo).flatMap((goods) => {
    const options = object(goods.options);
    const optionIds = splitCsv(options.optId);
    const bCodes = splitCsv(options.optPtnOptCd);
    const optionStatuses = splitCsv(options.optStatus);
    const count = Math.max(optionIds.length, bCodes.length, optionStatuses.length);
    return Array.from({ length: count }, (_, index) => ({
      goods_key: clean(goods.goods_key),
      ptn_goods_cd: clean(goods.ptn_goods_cd),
      prod_nm: clean(goods.prod_nm),
      model_no: clean(goods.model_no),
      model_nm: clean(goods.model_nm),
      optId: optionIds[index] || "",
      optPtnOptCd: bCodes[index] || "",
      optStatus: optionStatuses[index] || "",
    }));
  });
}

async function postAndParse(url, xml, parser, postXml) {
  const response = await postXml(url, xml, { timeoutMs: 45_000 });
  if (!response.ok) throw new Error(`SHOPLING_IDENTITY_HTTP_${response.status}`);
  return parser(response.body);
}

export async function readShoplingIdentitySources(input, dependencies = {}) {
  const postXml = dependencies.postXml || postShoplingApiXml;
  const wantedOrders = new Set(input.shoplingOrderNos.map(clean).filter(Boolean));
  const allOrders = await postAndParse(
    input.config.ordersUrl,
    buildIdentityOrderReadXml(input.config, input.startDate, input.endDate),
    parseIdentityOrders,
    postXml,
  );
  const orderRows = allOrders.filter((row) => wantedOrders.has(row.ord_no));
  const productIds = [...new Set(orderRows.map((row) => row.prod_id).filter((value) => /^\d+$/.test(value)))];
  const productRows = [];
  for (let index = 0; index < productIds.length; index += 50) {
    productRows.push(...await postAndParse(
      input.config.productsUrl,
      buildIdentityProductReadXml(input.config, productIds.slice(index, index + 50)),
      parseIdentityProducts,
      postXml,
    ));
  }
  return { orderRows, productRows };
}
