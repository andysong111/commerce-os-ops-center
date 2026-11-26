import { createHmac } from "node:crypto";
import { normalize1688OptionName, parse1688OfferLink } from "./alibaba1688-cart-plan.mjs";

const API_URL = "https://eco.taobao.com/router/rest";
const METHOD = "alibaba.trade.buyerorderlist.get";
const ORDER_NO = /^\d{6,32}$/;
const QUERY_LIMIT = 20;
const EXPECTED_RESPONSE = "alibaba_trade_buyerorderlist_get_response";
const PAID_STATUSES = new Set(["waitsellersend", "waitbuyerreceive", "success"]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export function buyerOrderApiCredentials(env = process.env) {
  const appKey = String(env.COMMERCE_OS_1688_BUYER_APP_KEY ?? "").trim();
  const appSecret = String(env.COMMERCE_OS_1688_BUYER_APP_SECRET ?? "").trim();
  const session = String(env.COMMERCE_OS_1688_BUYER_SESSION ?? "").trim();
  return appKey && appSecret && session ? { appKey, appSecret, session } : null;
}

function requestForm(orderNos, credentials, now) {
  const timestamp = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace("T", " ");
  const params = {
    method: METHOD,
    app_key: credentials.appKey,
    session: credentials.session,
    timestamp,
    format: "json",
    v: "2.0",
    sign_method: "hmac",
    // The documented field is Number[]. Keep the original digits out of JS Number.
    param_trade_get_order_list_param: `{"order_ids":[${orderNos.join(",")}],"page":1,"page_size":${QUERY_LIMIT}}`,
  };
  const signInput = Object.keys(params).sort().map((key) => key + params[key]).join("");
  const sign = createHmac("md5", credentials.appSecret).update(signInput).digest("hex").toUpperCase();
  return new URLSearchParams({ ...params, sign });
}

function parseOfficialOrders(text) {
  let payload;
  try {
    payload = JSON.parse(text, (_key, value, context) => {
      if (typeof value !== "number" || !Number.isInteger(value) || Number.isSafeInteger(value)) return value;
      if (!/^\d+$/.test(context?.source ?? "")) {
        fail("ALIBABA1688_BUYER_ORDER_ID_PRECISION", "1688 응답의 긴 주문번호를 정확히 읽지 못했습니다.");
      }
      return context.source;
    });
  } catch (error) {
    if (error?.code) throw error;
    fail("ALIBABA1688_BUYER_RESPONSE_INVALID", "1688 공식 API의 주문 응답을 읽지 못했습니다.");
  }
  if (payload?.error_response) {
    fail("ALIBABA1688_BUYER_API_REJECTED", "1688 공식 API가 조회를 거절했습니다. 구매자 주문 조회 권한과 연결 상태를 확인해 주세요.");
  }
  const result = payload?.[EXPECTED_RESPONSE]?.result;
  const rows = result?.data?.list?.trade_info;
  if (result?.success !== true || (!Array.isArray(rows) && Number(result?.data?.count) !== 0)) {
    fail("ALIBABA1688_BUYER_RESPONSE_INVALID", "1688 공식 API에서 정상 주문 목록을 확인하지 못했습니다.");
  }
  return rows ?? [];
}

function reviewStatus(base) {
  const raw = String(base.status ?? "").trim().toLowerCase();
  if (raw === "cancel" || raw === "cancelled") return "CANCELLED";
  if (raw === "waitbuyerpay") return "UNPAID";
  const refund = String(base.refund_payment ?? "").trim();
  const refundStates = [base.refund_status, base.refund_status_for_as]
    .map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  if ((refund && !/^0(?:\.0+)?$/.test(refund)) || refundStates.some((state) => state !== "refundclose")) {
    return "REFUND_REVIEW";
  }
  return PAID_STATUSES.has(raw) && /^20\d{2}-\d{2}-\d{2}/.test(String(base.pay_time ?? ""))
    ? "PAID" : "REVIEW";
}

function itemHasRefund(item) {
  const amount = String(item?.refund_actual_fee ?? "").trim();
  return Boolean(amount && !/^0(?:\.0+)?$/.test(amount));
}

export async function read1688BuyerOrders(orderNos, credentials, options = {}) {
  if (!credentials?.appKey || !credentials?.appSecret || !credentials?.session) {
    fail("ALIBABA1688_BUYER_AUTH_REQUIRED", "1688 오픈플랫폼 구매자 주문 조회 권한을 연결해 주세요.");
  }
  const scope = new Set(orderNos);
  if (!scope.size || scope.size > 500 || scope.size !== orderNos.length ||
    orderNos.some((number) => typeof number !== "string" || !ORDER_NO.test(number))) {
    fail("ALIBABA1688_BUYER_ORDER_SCOPE_INVALID", "바코드 원본의 주문번호 범위를 확인해 주세요.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const matched = new Map();
  for (let offset = 0; offset < orderNos.length; offset += QUERY_LIMIT) {
    const batch = orderNos.slice(offset, offset + QUERY_LIMIT);
    let response;
    try {
      response = await fetchImpl(API_URL, {
        method: "POST",
        body: requestForm(batch, credentials, options.now ?? new Date()),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      fail("ALIBABA1688_BUYER_API_UNAVAILABLE", "1688 공식 주문 조회에 연결하지 못했습니다.");
    }
    if (!response.ok) fail("ALIBABA1688_BUYER_API_UNAVAILABLE", "1688 공식 주문 조회가 지연됐습니다.");
    const rows = parseOfficialOrders(await response.text());
    for (const row of rows) {
      const base = row?.base_info ?? {};
      const orderNo = String(base.id ?? "");
      if (!batch.includes(orderNo) || matched.has(orderNo)) {
        fail("ALIBABA1688_BUYER_ORDER_SCOPE_CONFLICT", "조회한 1688 주문번호가 요청 범위와 다르거나 중복됐습니다.");
      }
      const lines = row?.product_items?.product_item_info ?? [];
      const status = reviewStatus(base);
      matched.set(orderNo, {
        orderNo,
        status: status === "PAID" && lines.some(itemHasRefund) ? "REFUND_REVIEW" : status,
        lines: lines.map((item) => ({
          offerId: String(item.product_i_d ?? ""),
          quantity: Number(item.quantity),
          optionValues: (item?.sku_infos?.sku_item_desc ?? []).map((sku) => String(sku.value ?? "")),
        })),
      });
    }
  }
  return { orders: [...matched.values()], missingOrderNos: orderNos.filter((number) => !matched.has(number)) };
}

function itemIdentity(offerId, optionValues) {
  if (!/^\d{6,20}$/.test(offerId)) return "";
  const options = optionValues.map(normalize1688OptionName).filter(Boolean).sort();
  return JSON.stringify([offerId, options]);
}

function expectedIdentity(line) {
  const offer = parse1688OfferLink(line?.supplierLink);
  const option = String(line?.chinaOption ?? "").trim();
  if (!offer || !option || line?.purchaseComponents?.length || Number(line?.purchaseQuantityMultiplier ?? 1) !== 1) return "";
  const options = option === "단품" ? [] : option.split(/[,，;；]/).map((value) => value.trim());
  return itemIdentity(offer.offerId, options);
}

export function reconcile1688BuyerOrderStatuses(expectedRows, draftLines, read) {
  const draftByBarcode = new Map(draftLines.map((line) => [line.barcode, line]));
  const byOrder = new Map();
  for (const row of expectedRows) {
    if (!ORDER_NO.test(row.orderNo) || !/^[A-Z]{3}\d+-\d+$/.test(row.barcode) ||
      !Number.isSafeInteger(row.quantity) || row.quantity <= 0) {
      fail("ALIBABA1688_BUYER_ORDER_SCOPE_INVALID", "바코드 원본의 주문번호·B코드·수량을 확인해 주세요.");
    }
    const rows = byOrder.get(row.orderNo) ?? [];
    rows.push(row);
    byOrder.set(row.orderNo, rows);
  }
  const found = new Map(read.orders.map((order) => [order.orderNo, order]));
  const exceptions = [];
  let matchedQuantity = 0;
  for (const [orderNo, rows] of byOrder) {
    const order = found.get(orderNo);
    if (order?.status !== "PAID") {
      exceptions.push({ orderNo, code: order?.status ?? "MISSING" });
      continue;
    }
    const expected = new Map();
    for (const row of rows) {
      const identity = expectedIdentity(draftByBarcode.get(row.barcode));
      const previous = expected.get(identity);
      if (!identity || (previous && previous.barcode !== row.barcode)) {
        expected.clear();
        break;
      }
      expected.set(identity, { barcode: row.barcode, quantity: (previous?.quantity ?? 0) + row.quantity });
    }
    const actual = new Map();
    for (const line of order.lines) {
      const identity = itemIdentity(line.offerId, line.optionValues);
      if (!identity || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        actual.clear();
        break;
      }
      actual.set(identity, (actual.get(identity) ?? 0) + line.quantity);
    }
    if (!expected.size || actual.size !== expected.size ||
      [...expected].some(([key, line]) => actual.get(key) !== line.quantity)) {
      exceptions.push({ orderNo, code: "ITEM_OR_QUANTITY_CONFLICT" });
      continue;
    }
    matchedQuantity += rows.reduce((total, row) => total + row.quantity, 0);
  }
  return {
    orderCount: byOrder.size,
    matchedOrderCount: byOrder.size - exceptions.length,
    matchedQuantity,
    exceptions,
  };
}
