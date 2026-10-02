import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIdentityOrderReadXml,
  buildIdentityProductReadXml,
  parseIdentityOrders,
  parseIdentityProducts,
  readShoplingIdentitySources,
  shoplingIdentityConfigFromEnv,
} from "../local-agent/src/shopling-api-identity-source.mjs";
import { isScopedShoplingApiUrl } from "../local-agent/src/shopling-api-transport.mjs";

const config = {
  loginId: "test-id",
  companyId: "test-company",
  authKey: "test-key",
  ordersUrl: "https://api.shopling.co.kr/order/order_gather_api.phtml?mode=2",
  productsUrl: "https://api.shopling.co.kr/prod/prod_gather_api.phtml?mode=2",
};

const orderXml = `<rspns><apiOrdGatherRst>
  <ordListRst><ord_no>3493809</ord_no><prod_id>116501</prod_id><opt_id>282</opt_id><t_prod_nm>상품</t_prod_nm><t_opt_valu>화이트</t_opt_valu><ptn_goods_cd>PRODUCT-A</ptn_goods_cd><mall_ord_cnt>1</mall_ord_cnt></ordListRst>
  <ordListRst><ord_no>unwanted</ord_no><prod_id>999999</prod_id><opt_id>1</opt_id></ordListRst>
</apiOrdGatherRst></rspns>`;

const productXml = `<rspns><apiProdGather><goodsInfo>
  <goods_key>116501</goods_key><ptn_goods_cd>임의값</ptn_goods_cd><prod_nm>상품</prod_nm><model_no>AAA094</model_no><model_nm>상품 모델</model_nm>
  <options><optId>281,282</optId><optPtnOptCd>BAF3-1,BAF3-2</optPtnOptCd><optStatus>B,B</optStatus></options>
</goodsInfo></apiProdGather></rspns>`;

test("identity order request contains only mapping fields and no delivery PII", () => {
  const xml = buildIdentityOrderReadXml(config, "2026-09-30", "20260930");
  assert.match(xml, /ord_no,prod_id,opt_id,t_prod_nm,t_opt_valu,ptn_goods_cd,mall_ord_cnt/);
  assert.doesNotMatch(xml, /수취|recipient|address|phone|receiver|ord_addr|ord_tel/i);
  assert.match(xml, /<start_dt>20260930<\/start_dt>/);
});

test("identity product request is exact, bounded, and option-enabled", () => {
  const xml = buildIdentityProductReadXml(config, ["116501", "116501", "119923"]);
  assert.match(xml, /<prod_id><!\[CDATA\[116501,119923\]\]><\/prod_id>/);
  assert.match(xml, /<opt_yn>Y<\/opt_yn>/);
  assert.match(xml, /model_no,model_nm/);
  assert.throws(() => buildIdentityProductReadXml(config, []), /SHOPLING_PRODUCT_ID_LOOKUP_BATCH_INVALID/);
});

test("identity parsers preserve exact order and aligned option codes", () => {
  assert.deepEqual(parseIdentityOrders(orderXml)[0], {
    ord_no: "3493809",
    prod_id: "116501",
    opt_id: "282",
    t_prod_nm: "상품",
    t_opt_valu: "화이트",
    ptn_goods_cd: "PRODUCT-A",
    mall_ord_cnt: "1",
  });
  assert.deepEqual(parseIdentityProducts(productXml).map((row) => [row.optId, row.optPtnOptCd]), [
    ["281", "BAF3-1"],
    ["282", "BAF3-2"],
  ]);
  assert.equal(parseIdentityProducts(productXml)[0].ptn_goods_cd, "임의값");
  assert.equal(parseIdentityProducts(productXml)[0].model_no, "AAA094");
  assert.equal(parseIdentityProducts(productXml)[0].model_nm, "상품 모델");
});

test("source reader filters requested orders before exact product lookup", async () => {
  const calls = [];
  const source = await readShoplingIdentitySources({
    config,
    startDate: "20260930",
    endDate: "20260930",
    shoplingOrderNos: ["3493809"],
  }, {
    postXml: async (url, xml) => {
      calls.push({ url, xml });
      return { ok: true, status: 200, body: calls.length === 1 ? orderXml : productXml };
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(source.orderRows.map((row) => row.ord_no), ["3493809"]);
  assert.match(calls[1].xml, /116501/);
  assert.doesNotMatch(calls[1].xml, /999999/);
});

test("credentials fail closed and TLS compatibility is host-scoped", () => {
  assert.throws(() => shoplingIdentityConfigFromEnv({}), /SHOPLING_CREDENTIAL_REQUIRED:SHOPLING_LOGIN_ID/);
  assert.equal(isScopedShoplingApiUrl(config.ordersUrl), true);
  assert.equal(isScopedShoplingApiUrl("https://api.shopling.co.kr.evil.example/order"), false);
  assert.equal(isScopedShoplingApiUrl("http://api.shopling.co.kr/order"), false);
});
