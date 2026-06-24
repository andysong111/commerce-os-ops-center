import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  inferProductGroupFromPtnGoodsCd,
} from "../src/lib/productLaunchFlow.ts";

test("suffix group inference uses ptn_goods_cd ending letters only", () => {
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1a"), "도매1");
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1b"), "도매2");
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1c"), "도매3");
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1d"), "도매4");
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1e"), "소매1");
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1f"), "소매2");
  assert.equal(inferProductGroupFromPtnGoodsCd("BAA1-1A"), "도매1");
  assert.equal(inferProductGroupFromPtnGoodsCd("1BAA1-1"), "확인 필요");
  assert.equal(inferProductGroupFromPtnGoodsCd("6BAA1-1"), "확인 필요");
  assert.equal(inferProductGroupFromPtnGoodsCd(""), "확인 필요");
});

test("extracts upload rows and de-duplicates goods_key values for price modify", () => {
  const sample = {
    summary: {
      goods_keys: [
        { row: 950, channel: "도매1", code: "OK", success: true, goods_key: "121112", ptn_goods_cd: "BAA1-1a" },
        { row: 950, channel: "도매2", code: "OK", ok: true, goods_key: "121113", ptn_goods_cd: "BAA1-1b" },
        { row: 950, channel: "도매3", code: "SKIP", success: false, goods_key: "", ptn_goods_cd: "BAA1-1c" },
        { row: 950, channel: "도매1", code: "OK", success: true, goods_key: "121112", ptn_goods_cd: "BAA1-1a" },
      ],
    },
  };

  const rows = extractRowsWithGoodsKey(sample);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.channel), ["도매1", "도매2", "도매1"]);
  assert.deepEqual(rows.map((row) => row.code), ["OK", "OK", "OK"]);
  assert.deepEqual(rows.map((row) => row.ptn_goods_cd), ["BAA1-1a", "BAA1-1b", "BAA1-1a"]);
  assert.deepEqual(dedupeGoodsKeysForPriceModify(rows), ["121112", "121113"]);
});

test("UI source includes MVP copy, storage keys, and API usage strings", async () => {
  const component = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const page = await readFile("src/app/product-launch-flow/page.tsx", "utf8");
  const source = `${page}\n${component}`;
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
    "ptn_goods_cd 끝 글자 a~f 기준",
    "샵플링 마켓전송은 수동",
    "productLaunchFlow.uploadRequestId",
    "productLaunchFlow.priceRequestId",
    "productLaunchFlow.lastRowExpression",
    "/api/shopling-product-upload/run",
    "/api/shopling-product-upload/actions-result",
    "/api/shopling-price-modify/run",
    "/api/shopling-price-modify/actions-result",
  ]) {
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), expected);
  }
});

test("product launch flow sources do not include restricted execution or credential literals", async () => {
  const paths = [
    "src/lib/productLaunchFlow.ts",
    "src/components/product-launch-flow/ProductLaunchFlow.tsx",
    "src/app/product-launch-flow/page.tsx",
  ];
  const source = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /shell\s*:\s*true/i);
  assert.doesNotMatch(source, /child_process\.exec/);
  assert.doesNotMatch(source, /PowerShell/i);
  assert.doesNotMatch(source, /github[_-]?token\s*[:=]\s*["'][^"']+/i);
  assert.doesNotMatch(source, /(shopling|샵플링).{0,30}(password|secret|credential|token)\s*[:=]\s*["'][^"']+/i);
});
