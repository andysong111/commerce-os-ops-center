import { postShoplingApiXml } from "./shopling-api-transport.mjs";
import { parseSimpleXml } from "./simple-xml.mjs";

const URLS = {
  orders: "https://api.shopling.co.kr/order/order_gather_api.phtml?mode=2",
  claims: "https://api.shopling.co.kr/claim/claim_gather_api.phtml?mode=2",
  qna: "https://api.shopling.co.kr/qna/qna_gather_api.phtml?mode=2",
};

const ORDER_FIELDS = [
  "ord_no",
  "org_ord_no",
  "ord_status",
  "prod_id",
  "opt_id",
  "t_prod_nm",
  "t_opt_valu",
  "ptn_goods_cd",
  "mall_ord_cnt",
  "mall_unit_price",
  "mall_pay_amt",
  "dlvy_id",
  "dlvy_no",
  "mall_ord_dt",
  "i_dt",
].join(",");

const CLAIM_FIELDS = [
  "claim_key",
  "mall_claim_tp",
  "ord_status",
  "ord_no",
  "prod_id",
  "prod_use_status",
  "mall_claim_rsn2",
  "mall_claim_rsn",
  "dlvy_id",
  "dlvy_no",
  "i_dt",
  "claim_status",
].join(",");

const QNA_FIELDS = [
  "qna_key",
  "prod_id",
  "qna_tp",
  "qna_title",
  "qna_q",
  "qna_a",
  "qna_status",
  "qna_i_dt",
  "i_dt",
].join(",");

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

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function required(env, name) {
  const value = clean(env[name]);
  if (!value) throw new Error(`SHOPLING_CREDENTIAL_REQUIRED:${name}`);
  return value;
}

function numeric(value) {
  const parsed = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) throw new Error("SHOPLING_CUSTOMER_SERVICE_DATE_INVALID");
  const date = new Date(Date.UTC(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)),
  ));
  if (date.toISOString().slice(0, 10).replace(/-/g, "") !== digits) {
    throw new Error("SHOPLING_CUSTOMER_SERVICE_DATE_INVALID");
  }
  return { digits, date };
}

function validateRange(startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  const inclusiveDays = Math.floor((end.date - start.date) / 86_400_000) + 1;
  if (inclusiveDays < 1 || inclusiveDays > 31) {
    throw new Error("SHOPLING_CUSTOMER_SERVICE_RANGE_INVALID");
  }
  return { start: start.digits, end: end.digits };
}

export function splitShoplingCustomerServiceRange(startDate, endDate, maxInclusiveDays = 7) {
  const range = validateRange(startDate, endDate);
  if (!Number.isInteger(maxInclusiveDays) || maxInclusiveDays < 1) {
    throw new Error("SHOPLING_CUSTOMER_SERVICE_CHUNK_SIZE_INVALID");
  }
  const chunks = [];
  let cursor = normalizeDate(range.start).date;
  const end = normalizeDate(range.end).date;
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(
      cursor.getTime() + ((maxInclusiveDays - 1) * 86_400_000),
      end.getTime(),
    ));
    chunks.push({
      startDate: cursor.toISOString().slice(0, 10).replaceAll("-", ""),
      endDate: chunkEnd.toISOString().slice(0, 10).replaceAll("-", ""),
    });
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
  }
  return chunks;
}

export function shoplingCustomerServiceConfigFromEnv(env = process.env) {
  return {
    loginId: required(env, "SHOPLING_LOGIN_ID"),
    companyId: required(env, "SHOPLING_COMPANY_ID"),
    authKey: required(env, "SHOPLING_API_AUTH_KEY"),
    ordersUrl: clean(env.SHOPLING_ORDERS_API_URL) || URLS.orders,
    claimsUrl: clean(env.SHOPLING_CLAIMS_API_URL) || URLS.claims,
    qnaUrl: clean(env.SHOPLING_QNA_API_URL) || URLS.qna,
  };
}

function authXml(config) {
  return `<login_id>${cdata(config.loginId)}</login_id><company_id>${cdata(config.companyId)}</company_id><api_auth_key>${cdata(config.authKey)}</api_auth_key>`;
}

export function buildShoplingCustomerServiceReadXml(resource, config, startDate, endDate) {
  const range = validateRange(startDate, endDate);
  if (resource === "orders") {
    return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiOrdGather>${authXml(config)}<start_dt>${range.start}</start_dt><end_dt>${range.end}</end_dt><ord_fields>${cdata(ORDER_FIELDS)}</ord_fields></apiOrdGather></reqst>`;
  }
  if (resource === "claims") {
    return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiClaimGather>${authXml(config)}<start_dt>${range.start}</start_dt><end_dt>${range.end}</end_dt><claim_fields>${cdata(CLAIM_FIELDS)}</claim_fields></apiClaimGather></reqst>`;
  }
  if (resource === "qna") {
    return `<?xml version="1.0" encoding="UTF-8"?><reqst><apiQnaGather>${authXml(config)}<start_dt>${range.start}</start_dt><end_dt>${range.end}</end_dt><qna_fields>${cdata(QNA_FIELDS)}</qna_fields></apiQnaGather></reqst>`;
  }
  throw new Error("SHOPLING_CUSTOMER_SERVICE_RESOURCE_INVALID");
}

export function parseShoplingCustomerServiceResponse(resource, body) {
  const parsed = object(parseSimpleXml(body));
  const response = object(parsed.rspns || parsed);
  if (resource === "orders") {
    const container = object(response.apiOrdGatherRst);
    if (!Object.keys(container).length) throw new Error("SHOPLING_ORDERS_RESPONSE_ERROR");
    return objects(container.ordListRst).map((row) => ({
      orderNo: clean(row.ord_no),
      originalOrderNo: clean(row.org_ord_no),
      orderStatus: clean(row.ord_status),
      productId: clean(row.prod_id),
      optionId: clean(row.opt_id),
      productName: clean(row.t_prod_nm),
      optionName: clean(row.t_opt_valu),
      bCode: clean(row.ptn_goods_cd).toUpperCase(),
      quantity: numeric(row.mall_ord_cnt),
      unitPrice: numeric(row.mall_unit_price),
      paidAmount: numeric(row.mall_pay_amt),
      courierCode: clean(row.dlvy_id),
      invoiceNo: clean(row.dlvy_no),
      orderedAt: clean(row.mall_ord_dt || row.i_dt),
    }));
  }
  if (resource === "claims") {
    const container = object(response.apiClaimGatherRst);
    if (!Object.keys(container).length) throw new Error("SHOPLING_CLAIMS_RESPONSE_ERROR");
    return objects(container.claimListRst).map((row) => ({
      claimKey: clean(row.claim_key),
      claimType: clean(row.mall_claim_tp),
      orderStatus: clean(row.ord_status),
      orderNo: clean(row.ord_no),
      productId: clean(row.prod_id),
      productUseStatus: clean(row.prod_use_status),
      reason: clean(row.mall_claim_rsn2),
      collectedReason: clean(row.mall_claim_rsn),
      returnCourierCode: clean(row.dlvy_id),
      returnInvoiceNo: clean(row.dlvy_no),
      collectedAt: clean(row.i_dt),
      claimStatus: clean(row.claim_status),
    }));
  }
  if (resource === "qna") {
    const container = object(response.apiQnaGatherRst);
    if (!Object.keys(container).length) throw new Error("SHOPLING_QNA_RESPONSE_ERROR");
    return objects(container.qnaListRst).map((row) => ({
      qnaKey: clean(row.qna_key),
      productId: clean(row.prod_id),
      qnaType: clean(row.qna_tp),
      title: clean(row.qna_title),
      question: clean(row.qna_q),
      answer: clean(row.qna_a),
      status: clean(row.qna_status),
      askedAt: clean(row.qna_i_dt),
      collectedAt: clean(row.i_dt),
    }));
  }
  throw new Error("SHOPLING_CUSTOMER_SERVICE_RESOURCE_INVALID");
}

async function readResource(resource, input, postXml) {
  const url = input.config[`${resource}Url`];
  const rows = [];
  for (const range of splitShoplingCustomerServiceRange(input.startDate, input.endDate)) {
    const xml = buildShoplingCustomerServiceReadXml(
      resource,
      input.config,
      range.startDate,
      range.endDate,
    );
    const response = await postXml(url, xml, { timeoutMs: 45_000 });
    if (!response.ok) throw new Error(`SHOPLING_${resource.toUpperCase()}_HTTP_${response.status}`);
    rows.push(...parseShoplingCustomerServiceResponse(resource, response.body));
  }
  return rows;
}

export async function readShoplingCustomerServiceSnapshot(input, dependencies = {}) {
  const postXml = dependencies.postXml || postShoplingApiXml;
  const allowedResources = new Set(["claims", "orders", "qna"]);
  const requestedResources = input.resources || [...allowedResources];
  if (!Array.isArray(requestedResources)
    || !requestedResources.length
    || requestedResources.some((resource) => !allowedResources.has(resource))) {
    throw new Error("SHOPLING_CUSTOMER_SERVICE_RESOURCES_INVALID");
  }
  const requested = new Set(requestedResources);
  const claims = requested.has("claims") ? await readResource("claims", input, postXml) : [];
  const orders = requested.has("orders") ? await readResource("orders", input, postXml) : [];
  const qnas = requested.has("qna") ? await readResource("qna", input, postXml) : [];
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    range: { startDate: input.startDate, endDate: input.endDate },
    claims,
    orders,
    qnas,
    externalWritesPerformed: false,
  };
}
