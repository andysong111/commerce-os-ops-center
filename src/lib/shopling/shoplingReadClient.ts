import { parseSimpleXml } from "@/lib/shopling/simpleXml";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export type ShoplingReadResource = "products" | "orders" | "claims";

export type ShoplingDateRange = {
  start: string;
  end: string;
};

export type ShoplingReadConfig = {
  loginId: string;
  companyId: string;
  authKey: string;
  productsUrl: string;
  ordersUrl: string;
  claimsUrl: string;
};

type RawObject = Record<string, unknown>;

export const DEFAULT_SHOPLING_READ_URLS = {
  products:
    "https://api.shopling.co.kr/prod/prod_gather_api.phtml?mode=2",
  orders:
    "https://api.shopling.co.kr/order/order_gather_api.phtml?mode=2",
  claims:
    "https://api.shopling.co.kr/claim/claim_gather_api.phtml?mode=2",
} as const;

const PRODUCT_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "org_price",
  "sale_price",
  "list_price",
  "season_tp",
  "model_no",
  "sale_status",
].join(",");

const ORDER_FIELDS = [
  "ord_no",
  "mall_key",
  "mall_login_id",
  "mall_ord_id",
  "mall_ord_seq",
  "mall_ord_dt",
  "mall_pay_dt",
  "ord_tp",
  "auto_fg",
  "ord_status",
  "prod_id",
  "opt_id",
  "t_prod_nm",
  "t_opt_valu",
  "buying_cd",
  "ptn_goods_cd",
  "mall_ord_amt",
  "mall_pay_amt",
  "mall_unit_price",
  "mall_supply_price",
  "mall_ord_cnt",
  "djustment_amt",
  "org_price",
  "mall_prod_key",
  "mall_ptn_goods_cd",
  "mall_prod_nm",
  "mall_opt_valu",
  "mall_opt_price",
  "mall_opt_cd",
  "org_ord_no",
  "i_dt",
].join(",");

const CLAIM_FIELDS = [
  "claim_key",
  "mall_key",
  "mall_login_id",
  "auto_fg",
  "mall_claim_tp",
  "ord_status",
  "mall_ord_id",
  "mall_prod_key",
  "mall_claim_no",
  "ord_no",
  "prod_id",
  "prod_use_status",
  "mall_claim_rsn2",
  "mall_claim_rsn",
  "mall_claim_cnts",
  "memo",
  "dlvy_fee",
  "enclose_amt",
  "i_dt",
  "claim_status",
].join(",");

function required(value: string | undefined, name: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`SHOPLING_CREDENTIAL_REQUIRED:${name}`);
  return normalized;
}

export function shoplingReadConfigFromEnv(
  source: Record<string, string | undefined>,
): ShoplingReadConfig {
  return {
    loginId: required(source.SHOPLING_LOGIN_ID, "SHOPLING_LOGIN_ID"),
    companyId: required(
      source.SHOPLING_COMPANY_ID,
      "SHOPLING_COMPANY_ID",
    ),
    authKey: required(
      source.SHOPLING_API_AUTH_KEY,
      "SHOPLING_API_AUTH_KEY",
    ),
    productsUrl:
      source.SHOPLING_PRODUCTS_API_URL?.trim() ||
      DEFAULT_SHOPLING_READ_URLS.products,
    ordersUrl:
      source.SHOPLING_ORDERS_API_URL?.trim() ||
      DEFAULT_SHOPLING_READ_URLS.orders,
    claimsUrl:
      source.SHOPLING_CLAIMS_API_URL?.trim() ||
      DEFAULT_SHOPLING_READ_URLS.claims,
  };
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function compactXml(lines: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>${lines.join("")}`;
}

export function buildShoplingReadRequestXml(
  resource: ShoplingReadResource,
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  range: ShoplingDateRange,
) {
  const start = range.start.replaceAll("-", "");
  const end = range.end.replaceAll("-", "");
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error("SHOPLING_DATE_RANGE_INVALID");
  }
  const auth = [
    `<login_id>${cdata(config.loginId)}</login_id>`,
    `<company_id>${cdata(config.companyId)}</company_id>`,
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>`,
  ];

  if (resource === "products") {
    return compactXml([
      "<reqst><apiProdGather>",
      ...auth,
      `<search_tp>${cdata("수정일")}</search_tp>`,
      `<start_dt>${start}</start_dt>`,
      `<end_dt>${end}</end_dt>`,
      `<prod_fields>${cdata(PRODUCT_FIELDS)}</prod_fields>`,
      "<opt_yn>Y</opt_yn><attri_yn>N</attri_yn>",
      "</apiProdGather></reqst>",
    ]);
  }

  if (resource === "orders") {
    return compactXml([
      "<reqst><apiOrdGather>",
      ...auth,
      `<start_dt>${start}</start_dt>`,
      `<end_dt>${end}</end_dt>`,
      `<ord_fields>${cdata(ORDER_FIELDS)}</ord_fields>`,
      "</apiOrdGather></reqst>",
    ]);
  }

  return compactXml([
    "<reqst><apiClaimGather>",
    ...auth,
    `<start_dt>${start}</start_dt>`,
    `<end_dt>${end}</end_dt>`,
    `<claim_fields>${cdata(CLAIM_FIELDS)}</claim_fields>`,
    "</apiClaimGather></reqst>",
  ]);
}

function asObject(value: unknown): RawObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function asObjects(value: unknown): RawObject[] {
  if (Array.isArray(value)) {
    return value.map(asObject).filter(Boolean) as RawObject[];
  }
  const object = asObject(value);
  return object ? [object] : [];
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value).trim();
  }
  const object = asObject(value);
  if (!object) return "";
  return scalar(object["#text"] ?? object.__cdata ?? object.cdata);
}

function splitCsv(value: unknown) {
  const text = scalar(value);
  return text ? text.split(",").map((item) => item.trim()) : [];
}

function cartesianOptionNames(options: RawObject | undefined) {
  const dimensions = asObjects(options?.optList)
    .map((list) => {
      const title = scalar(list.title);
      const values = splitCsv(list.value);
      return values.map((value) =>
        title && title !== "단품" ? `${title}: ${value}` : value,
      );
    })
    .filter((dimension) => dimension.length > 0);

  if (!dimensions.length) return ["단품"];
  return dimensions.reduce<string[]>(
    (combinations, dimension) =>
      combinations.flatMap((prefix) =>
        dimension.map((value) =>
          prefix ? `${prefix} / ${value}` : value,
        ),
      ),
    [""],
  );
}

function flattenProduct(goods: RawObject) {
  const options = asObject(goods.options);
  const optionNames = cartesianOptionNames(options);
  const optionIds = splitCsv(options?.optId);
  const barcodes = splitCsv(options?.optBarcode);
  const partnerOptionCodes = splitCsv(options?.optPtnOptCd);
  const optionStatuses = splitCsv(options?.optStatus);
  const optionQuantities = splitCsv(options?.optQty);
  const optionAmounts = splitCsv(options?.optAmt);
  const optionImageUrls = splitCsv(options?.optImgUrl);
  const optionCount = Math.max(
    optionNames.length,
    optionIds.length,
    barcodes.length,
    partnerOptionCodes.length,
    optionStatuses.length,
    optionQuantities.length,
    optionAmounts.length,
    optionImageUrls.length,
    1,
  );
  const product = { ...goods };
  delete product.options;
  delete product.goodsAttri;

  return Array.from({ length: optionCount }, (_, index) => ({
    ...product,
    optId: optionIds[index] ?? "",
    optBarcode: barcodes[index] ?? "",
    optPtnOptCd: partnerOptionCodes[index] ?? "",
    optStatus: optionStatuses[index] ?? "",
    optQty: optionQuantities[index] ?? "",
    optAmt: optionAmounts[index] ?? "",
    optImgUrl: optionImageUrls[index] ?? "",
    optionName: optionNames[index] ?? `옵션 ${index + 1}`,
  }));
}

function responseMessage(parsed: unknown) {
  const queue: unknown[] = [parsed];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const object = asObject(current);
    if (!object) continue;
    for (const [key, value] of Object.entries(object)) {
      if (["msg", "message", "error", "err_msg"].includes(key.toLowerCase())) {
        const text = scalar(value);
        if (text) return text;
      }
      queue.push(value);
    }
  }
  return "";
}

export function parseShoplingReadResponse(
  resource: ShoplingReadResource,
  body: string,
) {
  let parsed: unknown;
  try {
    const trimmed = body.trim();
    parsed =
      trimmed.startsWith("{") || trimmed.startsWith("[")
        ? JSON.parse(trimmed)
        : parseSimpleXml(trimmed);
  } catch {
    throw new Error(`SHOPLING_${resource.toUpperCase()}_INVALID_RESPONSE`);
  }

  const rspns = asObject(asObject(parsed)?.rspns ?? parsed);
  if (resource === "products") {
    const container = asObject(rspns?.apiProdGather);
    if (!container) {
      const message = responseMessage(parsed);
      throw new Error(
        `SHOPLING_PRODUCTS_RESPONSE_ERROR${message ? `:${message}` : ""}`,
      );
    }
    return asObjects(container.goodsInfo).flatMap(flattenProduct);
  }
  if (resource === "orders") {
    const container = asObject(rspns?.apiOrdGatherRst);
    if (!container) {
      const message = responseMessage(parsed);
      throw new Error(
        `SHOPLING_ORDERS_RESPONSE_ERROR${message ? `:${message}` : ""}`,
      );
    }
    return asObjects(container.ordListRst);
  }
  const container = asObject(rspns?.apiClaimGatherRst);
  if (!container) {
    const message = responseMessage(parsed);
    throw new Error(
      `SHOPLING_CLAIMS_RESPONSE_ERROR${message ? `:${message}` : ""}`,
    );
  }
  return asObjects(container.claimListRst);
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("SHOPLING_DATE_INVALID");
  }
  return date;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function splitShoplingDateRange(
  start: string,
  end: string,
  maximumInclusiveDays: number,
): ShoplingDateRange[] {
  const first = toUtcDate(start);
  const last = toUtcDate(end);
  if (first > last || maximumInclusiveDays < 1) {
    throw new Error("SHOPLING_DATE_RANGE_INVALID");
  }
  const result: ShoplingDateRange[] = [];
  let cursor = first;
  while (cursor <= last) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maximumInclusiveDays - 1);
    const boundedEnd = chunkEnd > last ? last : chunkEnd;
    result.push({ start: formatDate(cursor), end: formatDate(boundedEnd) });
    cursor = new Date(boundedEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export class ShoplingReadClient {
  constructor(private readonly config: ShoplingReadConfig) {}

  private url(resource: ShoplingReadResource) {
    if (resource === "products") return this.config.productsUrl;
    if (resource === "orders") return this.config.ordersUrl;
    return this.config.claimsUrl;
  }

  async read(resource: ShoplingReadResource, range: ShoplingDateRange) {
    const xml = buildShoplingReadRequestXml(resource, this.config, range);
    const response = await postShoplingXml(this.url(resource), xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-ops-center-shopling-read/1.0",
      },
      timeoutMs: 45_000,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `SHOPLING_${resource.toUpperCase()}_HTTP_${response.status}`,
      );
    }
    return parseShoplingReadResponse(resource, body);
  }

  async readRanges(
    resource: ShoplingReadResource,
    ranges: ShoplingDateRange[],
  ) {
    const rows: RawObject[] = [];
    for (const range of ranges) rows.push(...(await this.read(resource, range)));
    return rows;
  }
}
