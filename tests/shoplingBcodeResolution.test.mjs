import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOrderBCode,
  resolveShipmentManifestBCodes,
} from "../local-agent/src/shopling-bcode-resolution.mjs";

const productRows = [
  { goods_key: "116501", optId: "281", optPtnOptCd: " baf3-1 " },
  { goods_key: "116501", optId: "282", optPtnOptCd: "BAF3-2" },
  { goods_key: "119923", optId: "991", optPtnOptCd: "BBA10-1" },
];

test("order resolves B-code only by exact product and option identifiers", () => {
  const result = resolveOrderBCode({
    ord_no: "3493809",
    prod_id: "116501",
    opt_id: "282",
    t_prod_nm: "mapped product",
    t_opt_valu: "white",
  }, productRows);
  assert.equal(result.ok, true);
  assert.equal(result.value.bCode, "BAF3-2");
  assert.equal(result.value.bCodeEvidence, "EXACT_OPTION_MANAGEMENT_CODE");
  assert.equal(result.value.optionName, "white");
});

test("multi-option product without order option id remains unresolved", () => {
  const result = resolveOrderBCode({ ord_no: "3493809", prod_id: "116501" }, productRows);
  assert.equal(result.ok, false);
  assert.equal(result.issue.code, "ORDER_OPTION_ID_REQUIRED");
});

test("single-option product can resolve without an option id", () => {
  const result = resolveOrderBCode({ ord_no: "3492903", prod_id: "119923" }, productRows);
  assert.equal(result.ok, true);
  assert.equal(result.value.bCode, "BBA10-1");
});

test("site self code never replaces a missing option variant", () => {
  const result = resolveOrderBCode({
    ord_no: "3493809",
    prod_id: "116501",
    opt_id: "missing",
    ptn_goods_cd: "BAF3-9",
  }, []);
  assert.equal(result.ok, false);
  assert.equal(result.issue.code, "PRODUCT_VARIANT_NOT_FOUND");
});

test("single option rejects site self code and returns model number only as a lookup clue", () => {
  const result = resolveOrderBCode({
    ord_no: "3493809",
    prod_id: "116501",
    opt_id: "25645268",
    ptn_goods_cd: "aaa094-3",
  }, [{
    goods_key: "116501",
    optId: "25645268",
    optPtnOptCd: "",
    ptn_goods_cd: "AAA094-3",
    model_no: "AAA094",
    model_nm: "계란펀칭기",
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.issue.code, "BCODE_NOT_RESOLVED");
  assert.equal(result.issue.modelNo, "AAA094");
  assert.equal(result.issue.modelName, "계란펀칭기");
});

test("site self code remains forbidden even when current and order values agree", () => {
  const result = resolveOrderBCode({
    ord_no: "3493809",
    prod_id: "116501",
    opt_id: "25645268",
    ptn_goods_cd: "AAA094-3",
  }, [{
    goods_key: "116501",
    optId: "25645268",
    optPtnOptCd: "",
    ptn_goods_cd: "AAA094-3",
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.issue.code, "BCODE_NOT_RESOLVED");
});

test("manifest product mismatch blocks B-code enrichment", () => {
  const result = resolveShipmentManifestBCodes({
    manifest: { orders: [{ shoplingOrderNo: "3493809", shoplingProductCode: "999999" }] },
    orderRows: [{ ord_no: "3493809", prod_id: "116501", opt_id: "281" }],
    productRows,
  });
  assert.equal(result.bCodeResolution.ready, false);
  assert.equal(result.orders[0].bCode, "");
  assert.equal(result.bCodeResolution.unresolvedOrders[0].code, "MANIFEST_ORDER_PRODUCT_MISMATCH");
});

test("combined-package orders are enriched independently", () => {
  const result = resolveShipmentManifestBCodes({
    manifest: {
      orders: [
        { shoplingOrderNo: "1", invoiceNo: "587625375310", shoplingProductCode: "116501" },
        { shoplingOrderNo: "2", invoiceNo: "587625375310", shoplingProductCode: "119923" },
      ],
    },
    orderRows: [
      { ord_no: "1", prod_id: "116501", opt_id: "281" },
      { ord_no: "2", prod_id: "119923", opt_id: "991" },
    ],
    productRows,
  });
  assert.equal(result.bCodeResolution.ready, true);
  assert.deepEqual(result.orders.map((row) => row.bCode), ["BAF3-1", "BBA10-1"]);
});
