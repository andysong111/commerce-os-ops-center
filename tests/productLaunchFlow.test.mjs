import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildGoodsKeyGroupMap,
  buildKeywordEngineDispatchPayload,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  inferProductGroupFromPtnGoodsCd,
} from "../src/lib/productLaunchFlow.ts";

test("suffix group inference uses extensible ptn_goods_cd ending metadata", () => {
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1a"), { groupSuffix: "a", productGroup: "도매1", productGroupType: "도매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1b"), { groupSuffix: "b", productGroup: "도매2", productGroupType: "도매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1c"), { groupSuffix: "c", productGroup: "도매3", productGroupType: "도매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1d"), { groupSuffix: "d", productGroup: "도매4", productGroupType: "도매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1e"), { groupSuffix: "e", productGroup: "소매1", productGroupType: "소매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1f"), { groupSuffix: "f", productGroup: "소매2", productGroupType: "소매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1F"), { groupSuffix: "f", productGroup: "소매2", productGroupType: "소매", productGroupStatus: "registered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("TEST1-1g"), { groupSuffix: "g", productGroup: "미등록 그룹(g)", productGroupType: "확인 필요", productGroupStatus: "unregistered" });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd(""), { groupSuffix: "", productGroup: "상품그룹 확인 필요", productGroupType: "확인 필요", productGroupStatus: "missing" });
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
  const lib = await readFile("src/lib/productLaunchFlow.ts", "utf8");
  const source = `${page}\n${component}\n${lib}`;
  for (const expected of [
    "상품 출시 플로우",
    "상품업로드 실행",
    "상품업로드 결과 가져오기",
    "상품그룹",
    "ptn_goods_cd",
    "가격설정 실행",
    "가격설정 결과 가져오기",
    "Step 3. 상품명/키워드 실행 및 검토",
    "시드 키워드",
    "키워드 엔진 입력값 확인",
    "키워드 엔진 실행",
    "키워드 실행 결과 확인",
    "결과 가져오기 및 검토 시작",
    "키워드 결과 검토 화면 열기",
    "dry_run",
    "키워드/상품명 결과는 샵플링에 자동 반영되지 않습니다",
    "현재 MVP에서는 상품명/키워드를 6개 상품코드에 동일하게 적용",
    "ptn_goods_cd 끝 글자 기준",
    "goodsKeyGroupMap",
    "product_group_status",
    "샵플링 마켓전송은 수동",
    "productLaunchFlow.uploadRequestId",
    "productLaunchFlow.priceRequestId",
    "productLaunchFlow.lastRowExpression",
    "productLaunchFlow.keywordSeed",
    "opsCenter.keywordEngine.importedArtifact.v1",
    "/api/engine-runners/dispatch-preview",
    "/api/engine-runners/dispatch",
    "/api/engine-runners/runs?kind=keyword_engine",
    "/api/engine-runners/artifacts/import-preview",
    "/keyword-review-queue?from=product-launch-flow",
    "/api/shopling-product-upload/run",
    "/api/shopling-product-upload/actions-result",
    "/api/shopling-price-modify/run",
    "/api/shopling-price-modify/actions-result",
  ]) {
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), expected);
  }
});

test("product launch flow skip existing goods_key checkbox is editable and drives upload request", async () => {
  const component = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");

  assert.match(component, /const \[skipIfGoodsKey, setSkipIfGoodsKey\] = useState\(true\)/);
  assert.match(component, /checked=\{skipIfGoodsKey\}/);
  assert.match(component, /onChange=\{\(event\) => setSkipIfGoodsKey\(event\.target\.checked\)\}/);
  assert.match(component, /skip_if_goods_key: skipIfGoodsKey/);
  assert.match(component, /체크 해제하면 이미 goods_key가 있어도 상품업로드를 다시 실행합니다\./);
  assert.doesNotMatch(component, /<input[^>]*type="checkbox"[^>]*readOnly/);
});

test("builds keyword engine dry_run dispatch payload with de-duplicated goods_key and optional seed", () => {
  const rows = [
    { goods_key: "121112" },
    { goods_key: "121113" },
    { goods_key: "121112" },
  ];
  assert.deepEqual(buildKeywordEngineDispatchPayload(rows, " 욕실 수납 "), {
    kind: "keyword_engine",
    mode: "dry_run",
    inputs: { goods_key: "121112,121113", seed_keyword: "욕실 수납" },
  });
  assert.deepEqual(buildKeywordEngineDispatchPayload(rows, " "), {
    kind: "keyword_engine",
    mode: "dry_run",
    inputs: { goods_key: "121112,121113" },
  });
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
  assert.doesNotMatch(source, /\/api\/shopling-(?!product-upload|price-modify)/i);
});


test("builds goodsKeyGroupMap with registered and unregistered product group status", () => {
  const map = buildGoodsKeyGroupMap([
    { goods_key: "121118", ptn_goods_cd: "TEST1-1a" },
    { goods_key: "121124", ptn_goods_cd: "TEST1-1g" },
  ]);
  assert.equal(map["121118"].product_group, "도매1");
  assert.equal(map["121118"].product_group_status, "registered");
  assert.equal(map["121124"].group_suffix, "g");
  assert.equal(map["121124"].product_group, "미등록 그룹(g)");
  assert.equal(map["121124"].product_group_status, "unregistered");
});

test("product group registry is table based and extensible", async () => {
  const source = await readFile("src/lib/productGroup.ts", "utf8");
  assert.match(source, /PRODUCT_GROUP_DEFINITIONS/);
  assert.match(source, /new Map/);
  assert.doesNotMatch(source, /switch\s*\(/);
});

test("upload polling UI distinguishes uncertain, artifact pending, confirmed failure, and check error states", async () => {
  const component = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");

  assert.match(component, /현재 요청 ID와 일치하는 GitHub Actions 실행을 찾는 중입니다\./);
  assert.match(component, /현재 요청의 실행은 확인됐고, 결과 파일을 기다리는 중입니다\./);
  assert.match(component, /현재 요청의 artifact에서 result_summary\.json을 찾지 못했습니다\./);
  assert.match(component, /GitHub Actions 바로가기/);
  assert.match(component, /상품업로드 결과 확인 중 오류가 발생했습니다\./);
  assert.match(component, /상세 오류/);
  assert.match(component, /result\?\.message/);
  assert.match(component, /result\?\.runId/);
  assert.match(component, /result\?\.runUrl/);
  assert.match(component, /function isConfirmedUploadFailure/);
  assert.match(component, /runStatus === "completed" && \["failure", "cancelled", "timed_out"\]/);
  assert.match(component, /phase === "failed" && \(!!result\.runId \|\| !!result\.runUrl\)/);
  assert.match(component, /result\?\.phase === "waiting_artifact" \|\| result\?\.phase === "completed_no_artifact"/);
  assert.match(component, /cardClass: "border-amber-200 bg-amber-50"/);
  assert.doesNotMatch(component, /result\?\.status === "error" \|\| result\?\.phase === "failed"/);
});
