import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractUploadGoodsKeyRows, inferProductGroupFromPtnGoodsCd, uniqueGoodsKeys } from "../src/lib/productLaunchFlow.ts";

test("group inference maps ptn_goods_cd prefixes", () => {
  assert.equal(inferProductGroupFromPtnGoodsCd("1abc"), "도매1");
  assert.equal(inferProductGroupFromPtnGoodsCd("2abc"), "도매2");
  assert.equal(inferProductGroupFromPtnGoodsCd("3abc"), "도매3");
  assert.equal(inferProductGroupFromPtnGoodsCd("4abc"), "도매4");
  assert.equal(inferProductGroupFromPtnGoodsCd("5abc"), "소매1");
  assert.equal(inferProductGroupFromPtnGoodsCd("6abc"), "소매2");
  assert.equal(inferProductGroupFromPtnGoodsCd("xabc"), "확인 필요");
  assert.equal(inferProductGroupFromPtnGoodsCd(""), "확인 필요");
});

test("goods_key extraction normalizes rows, ignores empty goods_key, and uniqueGoodsKeys de-duplicates", () => {
  const summary = { goods_keys: [
    { row: 950, channel: "도매1", code: "OK", success: true, goods_key: "121112", ptn_goods_cd: "1ABC" },
    { row: 950, channel: "도매2", code: "OK", goods_key: "", ptn_goods_cd: "2ABC" },
    { row: 950, channel: "도매3", code: "SKIP", ok: "skip", goods_key: "121112", ptnGoodsCd: "3ABC" },
    { row: 950, channel: "도매4", code: "OK", goodsKey: "121113", ptn_goods_cd: "4ABC" },
  ] };
  const rows = extractUploadGoodsKeyRows(summary);
  assert.deepEqual(rows.map((row) => ({ goods_key: row.goods_key, ptn_goods_cd: row.ptn_goods_cd, channel: row.channel, code: row.code })), [
    { goods_key: "121112", ptn_goods_cd: "1ABC", channel: "도매1", code: "OK" },
    { goods_key: "121112", ptn_goods_cd: "3ABC", channel: "도매3", code: "SKIP" },
    { goods_key: "121113", ptn_goods_cd: "4ABC", channel: "도매4", code: "OK" },
  ]);
  assert.deepEqual(uniqueGoodsKeys(rows), ["121112", "121113"]);
});

test("UI source includes launch flow MVP copy, storage keys, and API usage strings", () => {
  const source = readFileSync("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "상품 출시 플로우",
    "상품업로드 실행",
    "상품업로드 결과 가져오기",
    "상품그룹",
    "ptn_goods_cd",
    "가격설정 실행",
    "가격설정 결과 가져오기",
    "상품명/키워드 준비",
    "현재 MVP에서는 상품명/키워드를 6개 상품코드에 동일하게 적용",
    "샵플링 마켓전송은 수동",
    "productLaunchFlow.uploadRequestId",
    "productLaunchFlow.priceRequestId",
    "productLaunchFlow.lastRowExpression",
    "/api/shopling-product-upload/run",
    "/api/shopling-product-upload/actions-result",
    "/api/shopling-price-modify/run",
    "/api/shopling-price-modify/actions-result",
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("launch flow source does not include forbidden security patterns", () => {
  const source = readFileSync("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8") + readFileSync("src/lib/productLaunchFlow.ts", "utf8");
  assert.equal(source.includes("shell: true"), false);
  assert.equal(source.includes("child_process.exec"), false);
  assert.equal(source.includes("PowerShell"), false);
  assert.equal(/ghp_[A-Za-z0-9_]+/.test(source), false);
  assert.equal(/SHOPLING_(?:PASSWORD|TOKEN|SECRET|API_KEY)\s*=\s*["'][^"']+["']/.test(source), false);
});
