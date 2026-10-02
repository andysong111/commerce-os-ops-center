import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoplingCustomerServiceReadXml,
  parseShoplingCustomerServiceResponse,
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
  splitShoplingCustomerServiceRange,
} from "../local-agent/src/shopling-customer-service-source.mjs";

const config = {
  loginId: "test-id",
  companyId: "test-company",
  authKey: "test-secret",
  ordersUrl: "https://api.shopling.co.kr/order/order_gather_api.phtml?mode=2",
  claimsUrl: "https://api.shopling.co.kr/claim/claim_gather_api.phtml?mode=2",
  qnaUrl: "https://api.shopling.co.kr/qna/qna_gather_api.phtml?mode=2",
};

const orderResponse = `<rspns><apiOrdGatherRst><ordListRst>
  <ord_no>3493809</ord_no><org_ord_no>MALL-1</org_ord_no><ord_status>발송완료</ord_status>
  <prod_id>116501</prod_id><opt_id>282</opt_id><t_prod_nm>상품</t_prod_nm><t_opt_valu>화이트</t_opt_valu>
  <ptn_goods_cd>baf3-2</ptn_goods_cd><mall_ord_cnt>2</mall_ord_cnt><mall_unit_price>5000</mall_unit_price>
  <mall_pay_amt>10000</mall_pay_amt><dlvy_id>CJ</dlvy_id><dlvy_no>587625375225</dlvy_no>
  <mall_rcv_nm>PII-NAME</mall_rcv_nm><mall_rcv_tel>PII-PHONE</mall_rcv_tel><mall_rcv_addr>PII-ADDRESS</mall_rcv_addr>
</ordListRst></apiOrdGatherRst></rspns>`;

const claimResponse = `<rspns><apiClaimGatherRst><claimListRst>
  <claim_key>C-1</claim_key><mall_claim_tp>반품접수</mall_claim_tp><ord_status>반품접수</ord_status>
  <ord_no>3493809</ord_no><prod_id>116501</prod_id><prod_use_status>미사용</prod_use_status>
  <mall_claim_rsn2>단순변심</mall_claim_rsn2><mall_claim_rsn>단순변심</mall_claim_rsn>
  <dlvy_id></dlvy_id><dlvy_no></dlvy_no><claim_status>접수</claim_status>
  <mall_claim_cont>PII-CLAIM-MEMO</mall_claim_cont><mall_user_nm>PII-CLAIM-NAME</mall_user_nm>
</claimListRst></apiClaimGatherRst></rspns>`;

const qnaResponse = `<rspns><apiQnaGatherRst><qnaListRst>
  <qna_key>Q-1</qna_key><prod_id>116501</prod_id><qna_tp>상품문의</qna_tp>
  <qna_title>배송 문의</qna_title><qna_q>언제 오나요?</qna_q><qna_a></qna_a><qna_status>미답변</qna_status>
  <qna_wid>PII-QNA-ID</qna_wid><qna_wnm>PII-QNA-NAME</qna_wnm>
</qnaListRst></apiQnaGatherRst></rspns>`;

test("customer-service reads request only the bounded operational fields", () => {
  const orders = buildShoplingCustomerServiceReadXml("orders", config, "20260901", "20261001");
  const claims = buildShoplingCustomerServiceReadXml("claims", config, "20260901", "20261001");
  const qna = buildShoplingCustomerServiceReadXml("qna", config, "20260901", "20261001");

  assert.match(orders, /ord_no,org_ord_no,ord_status,prod_id/);
  assert.doesNotMatch(orders, /mall_rcv|mall_user|addr|tel/i);
  assert.match(claims, /claim_key,mall_claim_tp,ord_status,ord_no/);
  assert.doesNotMatch(claims, /claim_cont|memo|mall_user|addr|tel/i);
  assert.match(qna, /qna_key,prod_id,qna_tp,qna_title,qna_q,qna_a,qna_status/);
  assert.doesNotMatch(qna, /qna_wid|qna_wnm|mall_user|addr|tel/i);
});

test("customer-service read range permits 31 inclusive days and rejects 32", () => {
  assert.doesNotThrow(() => buildShoplingCustomerServiceReadXml(
    "claims", config, "20260901", "20261001",
  ));
  assert.throws(
    () => buildShoplingCustomerServiceReadXml("claims", config, "20260831", "20261001"),
    /SHOPLING_CUSTOMER_SERVICE_RANGE_INVALID/,
  );
});

test("customer-service reads split a 31-day range into non-overlapping 7-day API windows", () => {
  assert.deepEqual(splitShoplingCustomerServiceRange("20260902", "20261002"), [
    { startDate: "20260902", endDate: "20260908" },
    { startDate: "20260909", endDate: "20260915" },
    { startDate: "20260916", endDate: "20260922" },
    { startDate: "20260923", endDate: "20260929" },
    { startDate: "20260930", endDate: "20261002" },
  ]);
});

test("response parsers discard recipient, claim memo, and questioner identity fields", () => {
  const parsed = {
    orders: parseShoplingCustomerServiceResponse("orders", orderResponse),
    claims: parseShoplingCustomerServiceResponse("claims", claimResponse),
    qnas: parseShoplingCustomerServiceResponse("qna", qnaResponse),
  };
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /PII-NAME|PII-PHONE|PII-ADDRESS|PII-CLAIM|PII-QNA/);
  assert.deepEqual(parsed.orders[0], {
    orderNo: "3493809",
    originalOrderNo: "MALL-1",
    orderStatus: "발송완료",
    productId: "116501",
    optionId: "282",
    productName: "상품",
    optionName: "화이트",
    bCode: "BAF3-2",
    quantity: 2,
    unitPrice: 5000,
    paidAmount: 10000,
    courierCode: "CJ",
    invoiceNo: "587625375225",
    orderedAt: "",
  });
});

test("snapshot reader performs three reads and never returns API credentials", async () => {
  const responses = new Map([
    [config.claimsUrl, claimResponse],
    [config.ordersUrl, orderResponse],
    [config.qnaUrl, qnaResponse],
  ]);
  const calls = [];
  const snapshot = await readShoplingCustomerServiceSnapshot({
    config,
    startDate: "20260925",
    endDate: "20261001",
  }, {
    postXml: async (url, xml) => {
      calls.push({ url, xml });
      return { ok: true, status: 200, body: responses.get(url) };
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(snapshot.externalWritesPerformed, false);
  assert.equal(snapshot.claims.length, 1);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.qnas.length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /test-id|test-company|test-secret/);
});

test("snapshot reader supports a QnA-only review without calling order or claim APIs", async () => {
  const calls = [];
  const snapshot = await readShoplingCustomerServiceSnapshot({
    config,
    startDate: "20260925",
    endDate: "20261001",
    resources: ["qna"],
  }, {
    postXml: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, body: qnaResponse };
    },
  });

  assert.deepEqual(calls, [config.qnaUrl]);
  assert.deepEqual(snapshot.claims, []);
  assert.deepEqual(snapshot.orders, []);
  assert.equal(snapshot.qnas.length, 1);
});

test("customer-service credentials fail closed", () => {
  assert.throws(
    () => shoplingCustomerServiceConfigFromEnv({}),
    /SHOPLING_CREDENTIAL_REQUIRED:SHOPLING_LOGIN_ID/,
  );
});
