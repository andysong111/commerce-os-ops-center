import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildGoodsKeyGroupJson,
  buildGoodsKeyGroupMap,
  buildGoodsKeyProductGroupMap,
  computeLaunchTitleCoverage,
  expectedLaunchApplyCount,
  expectedPriceModifyUpdateCount,
  isSafeLaunchTitle,
  buildKeywordEngineDispatchPayload,
  buildLaunchSourceRowGroups,
  expandSeedKeywordsBySourceRowToGoodsKeys,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  extractUploadRows,
  inferProductGroupFromPtnGoodsCd,
  normalizeManualKeywordOverride,
  parseManualCandidateList,
  normalizeSeedKeywords,
  resolveMallTitle,
  resolveManualTitleOverride,
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
        { row: 950, channel: "도매3", code: "SKIP", success: false, goods_key: "", ptn_goods_cd: "BAA1-1c", status: "failed", message: "skip" },
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

test("extractUploadRows prefers summary.rows over goods_keys and preserves failed row fields", () => {
  const sample = {
    summary: {
      status: "failed",
      rows: [
        { row: 1, channel: "도매1", code: "110[121118]", status: "failed", message: "1 번째 줄 상품 자사상품코드 중복", goods_key: "", ptn_goods_cd: "TEST1-1a" },
      ],
      goods_keys: [
        { row: 1, channel: "도매1", code: "OK", status: "success", goods_key: "121118", ptn_goods_cd: "TEST1-1a" },
      ],
    },
  };

  const rows = extractUploadRows(sample);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, "110[121118]");
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].message, "1 번째 줄 상품 자사상품코드 중복");
  assert.equal(rows[0].ptn_goods_cd, "TEST1-1a");
  assert.deepEqual(extractRowsWithGoodsKey(sample), []);
});

test("UI source includes MVP copy, storage keys, and API usage strings", async () => {
  const component = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const page = await readFile("src/app/product-launch-flow/page.tsx", "utf8");
  const lib = await readFile("src/lib/productLaunchFlow.ts", "utf8");
  const source = `${page}\n${component}\n${lib}`;
  for (const expected of [
    "상품 출시 플로우",
    "현재 단계",
    "지금 할 일",
    "실패 원인",
    "고급 옵션 열기",
    "상세 실행 정보 열기",
    "이전 실행 기록 보기",
    "GitHub Actions 바로가기",
    "키워드 엔진 실행이 실패했습니다",
    "시드 키워드를 입력하고 다시 실행",
    "상품업로드 시작",
    "상품업로드 결과 가져오기",
    "상품업로드 실패",
    "행별 오류",
    "같은 자사상품코드가 이미 샵플링에 등록되어 있습니다",
    "이미 goods_key 있으면 스킵(권장)",
    "상품그룹",
    "ptn_goods_cd",
    "가격설정 시작",
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


test("product launch flow includes operations focus autopilot and exception lens copy", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "운영 집중 모드",
    "먼저 실재고 시트 행 번호를 입력하세요",
    "처음에는 행 번호만 입력하면 됩니다",
    "행 번호 입력 후 시작",
    "상품업로드 시작",
    "가격설정 시작",
    "키워드 dry_run 시작",
    "키워드 결과 검토 화면 열기",
    "지금 할 일",
    "현재 입력 행",
    "선택 옵션 열기",
    "자동 진행 모드",
    "켜면 상품업로드 성공 후 가격설정과 키워드 dry_run까지 자동으로 이어서 진행합니다",
    "실제 상품명/검색어 반영은 검토 화면에서 별도 승인해야 합니다",
    "가격이 비어 있을 수 있는 쇼핑몰이 있습니다",
    "모든 필수 쇼핑몰 가격 반영을 확인했습니다",
    "문제만 보기",
    "전체 보기",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});

test("product launch flow first action UX avoids generic button copy and DOM proxy", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "먼저 실재고 시트 행 번호를 입력하세요",
    "처음에는 행 번호만 입력하면 됩니다",
    "행 번호 입력 후 시작",
    "상품업로드 시작",
    "가격설정 시작",
    "키워드 dry_run 시작",
    "키워드 결과 검토 화면 열기",
    "지금 할 일",
    "현재 입력 행",
    "선택 옵션 열기",
    "실제 상품명/검색어 반영은 검토 화면에서 별도 승인해야 합니다",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
  assert.doesNotMatch(source, /다음 안전 단계 실행/);
  assert.doesNotMatch(source, /document\.getElementById\("product-launch-primary-upload-submit"\)/);
  assert.match(source, /const \[autopilotEnabled, setAutopilotEnabled\] = useState\(true\)/);
});


test("product launch flow starts upload polling and guards autopilot transitions", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "상품업로드 진행 중",
    "상품업로드 실행을 확인하는 중입니다",
    "완료되면 자동으로 결과를 확인합니다",
    "결과가 준비되면 자동으로 다음 단계로 이동합니다",
    "지금 다시 확인",
    "startUploadPolling",
    "startUploadPolling(data.requestId)",
    "autoPriceStartedForUploadRequestRef",
    "autoKeywordStartedForPriceRequestRef",
    "상품업로드 결과 확인 중...",
    "가격설정 결과 확인 중...",
    "키워드 결과 확인 중...",
  ]) {
    assert.ok(source.includes(expected), expected);
  }

  assert.doesNotMatch(source, /document\.getElementById\("product-launch-primary-upload-submit"\)/);
  assert.doesNotMatch(source, /run\("apply"\)/);
  assert.doesNotMatch(source, /keywordShoplingApply/);
});

test("product launch flow restores one-button autopilot transitions", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");

  for (const expected of [
    "const [autopilotEnabled, setAutopilotEnabled] = useState(true)",
    "autoPriceStartedForUploadRequestRef",
    "autoKeywordStartedForPriceRequestRef",
    "isSuccessfulUploadResult(uploadActionsResult, uploadRows.length)",
    "void runPriceModify();",
    "isAutopilotSafePriceResult(priceActionsResult)",
    "void dispatchKeywordEngine();",
    "verification_supported === false",
    "api_success_count",
    "required_update_count",
    "missing_price_count",
    "missing_mall_row_count",
    "mismatch_count",
    "failed_count",
    "상품출시 준비 시작",
    "준비 중입니다...",
    "AI가 상품명 반영 준비",
    "고급 / 수동 조작",
    "자동 진행 모드가 켜져 있습니다. 상품업로드 성공 후 가격설정과 키워드 dry_run까지 자동으로 이어집니다.",
    "진행 중입니다. 현재 단계: 가격설정. 자동으로 다음 단계로 이동합니다. 가격설정 결과 확인 중...",
    "키워드 dry_run 결과 확인 중...",
  ]) {
    assert.ok(source.includes(expected), expected);
  }

  assert.doesNotMatch(source, /const \[autopilotEnabled, setAutopilotEnabled\] = useState\(false\)/);

  const useEffectBlocks = source.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
  assert.ok(useEffectBlocks.some((block) => block.includes("autoPriceStartedForUploadRequestRef") && block.includes("void runPriceModify();")));
  assert.ok(useEffectBlocks.some((block) => block.includes("autoKeywordStartedForPriceRequestRef") && block.includes("void dispatchKeywordEngine();")));
  assert.ok(useEffectBlocks.every((block) => !block.includes("keywordShoplingApply") && !block.includes("/api/keyword-shopling-apply") && !block.includes('run("apply")')));
});

test("product launch flow GitHub Actions links are safe new-tab shortcuts", async () => {
  const component = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const actionLinkMatches = component.match(/(?:<Link|<a)[^>]*(?:GitHub Actions|githubActionsUrl)[\s\S]{0,240}/g) ?? [];
  assert.ok(actionLinkMatches.length > 0);
  for (const match of actionLinkMatches) {
    assert.match(match, /target="_blank"/);
    assert.match(match, /rel="noopener noreferrer"/);
  }
});

test("product launch flow skip existing goods_key checkbox is editable and drives upload request", async () => {
  const component = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");

  assert.match(component, /const \[skipIfGoodsKey, setSkipIfGoodsKey\] = useState\(true\)/);
  assert.match(component, /checked=\{skipIfGoodsKey\}/);
  assert.match(component, /onChange=\{\(event\) => setSkipIfGoodsKey\(event\.target\.checked\)\}/);
  assert.match(component, /skip_if_goods_key: skipIfGoodsKey/);
  assert.match(component, /체크하면 이미 업로드된 상품은 건너뜁니다\./);
  assert.match(component, /체크 해제는 기존 상품 수정이 아니라 새 상품 등록을 다시 시도합니다/);
  assert.match(component, /주의: 체크 해제 상태에서는 같은 행을 다시 업로드할 때 자사상품코드 중복으로 실패할 수 있습니다/);
  assert.doesNotMatch(component, /<input[^>]*type="checkbox"[^>]*readOnly/);
});

test("builds keyword engine dry_run dispatch payload with de-duplicated goods_key and optional seed", () => {
  const rows = [
    { goods_key: "121112" },
    { goods_key: "121113" },
    { goods_key: "121112" },
  ];
  assert.deepEqual(buildKeywordEngineDispatchPayload(rows, " 욕실 수납 ", { "121112": "게임패드, 컨트롤러, 조이스틱 미니", "121113": "레이싱휠/조이스틱" }), {
    kind: "keyword_engine",
    mode: "dry_run",
    inputs: { goods_key: "121112,121113", seed_keyword: "욕실 수납", seed_keywords_by_goods_key_json: JSON.stringify({ "121112": "게임패드,컨트롤러,조이스틱,미니", "121113": "레이싱휠,조이스틱" }) },
  });
  assert.deepEqual(buildKeywordEngineDispatchPayload(rows, " "), {
    kind: "keyword_engine",
    mode: "dry_run",
    inputs: { goods_key: "121112,121113" },
  });
});


test("ProductLaunchFlow builds goods_key group mapping for price modify", () => {
  const uploadRows = [
    { goods_key: "121207", ptn_goods_cd: "BASE-1a" },
    { goods_key: "121208", ptn_goods_cd: "BASE-1b" },
    { goods_key: "121209", ptn_goods_cd: "BASE-1c" },
    { goods_key: "121210", ptn_goods_cd: "BASE-1d" },
    { goods_key: "121211", ptn_goods_cd: "BASE-1e" },
    { goods_key: "121212", ptn_goods_cd: "BASE-1f" },
  ];
  const expected = { "121207": "도매1", "121208": "도매2", "121209": "도매3", "121210": "도매4", "121211": "소매1", "121212": "소매2" };
  assert.deepEqual(buildGoodsKeyProductGroupMap(uploadRows), expected);
  assert.equal(buildGoodsKeyGroupJson(uploadRows), JSON.stringify(expected));
});

test("price board count uses goodsKeys.length times 24", () => {
  const uploadRows = [
    { goods_key: "121207", ptn_goods_cd: "BASE-1a" },
    { goods_key: "121208", ptn_goods_cd: "BASE-1b" },
    { goods_key: "121209", ptn_goods_cd: "BASE-1c" },
    { goods_key: "121210", ptn_goods_cd: "BASE-1d" },
    { goods_key: "121211", ptn_goods_cd: "BASE-1e" },
    { goods_key: "121212", ptn_goods_cd: "BASE-1f" },
  ];
  const mapping = buildGoodsKeyProductGroupMap(uploadRows);
  assert.equal(expectedPriceModifyUpdateCount(mapping), uploadRows.length * 24);
  assert.equal(expectedPriceModifyUpdateCount(mapping), 144);
});

test("ProductLaunchFlow price modify dispatch contains goods_key_group_json and summary copy", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  assert.match(source, /goods_key_group_json: buildGoodsKeyGroupJson\(uploadRows\)/);
  assert.match(source, /가격 정책: 전체 쇼핑몰 가격 일괄 적용/);
  assert.match(source, /상품명\/검색어는 상품그룹별로 다르게 반영하고, 가격은 모든 쇼핑몰에 동일 정책으로 채웁니다\./);
  assert.match(source, /goodsKeyCount \* FULL_PRICE_POLICY_MALL_COUNT/);
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
  assert.match(component, /상품업로드 결과 확인 중 오류가 발생했습니다\./);
  assert.match(component, /상세 오류/);
  assert.match(component, /result\?\.message/);
  assert.match(component, /result\?\.runId/);
  assert.match(component, /result\?\.runUrl/);
  assert.match(component, /GitHub Actions 바로가기/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /문제가 있으면 실행 로그에서 실패 원인을 바로 확인할 수 있습니다/);
  assert.match(component, /function isConfirmedUploadFailure/);
  assert.match(component, /runStatus === "completed" && \["failure", "cancelled", "timed_out"\]/);
  assert.match(component, /phase === "failed" && \(!!result\.runId \|\| !!result\.runUrl\)/);
  assert.match(component, /result\?\.phase === "waiting_artifact" \|\| result\?\.phase === "completed_no_artifact"/);
  assert.match(component, /cardClass: "border-amber-200 bg-amber-50"/);
  assert.doesNotMatch(component, /result\?\.status === "error" \|\| result\?\.phase === "failed"/);
});
test("product launch flow embeds keyword review workspace copy and guarded actions", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "키워드 검토 시작",
    "이 화면에서 상품명 후보 선택부터 실제 반영 전 dry_run까지 이어서 진행합니다",
    "이제 화면을 이동하지 않고 이 상품출시 플로우 안에서 키워드 검토와 반영 준비를 진행합니다",
    "현재 연결된 상품출시 작업",
    "상품업로드 request id",
    "가격설정 request id",
    "키워드 run id",
    "artifact name",
    "상품명 첫 후보 자동 선택",
    "상품그룹별 상품명 미리보기",
    "적용 계획 생성",
    "dry_run 실행",
    "실제 샵플링 반영 실행",
    "키워드 결과 후보가 아직 불러와지지 않았습니다",
    "승인된 상품명이 있어야 미리보기를 생성할 수 있습니다",
    "적용 계획을 먼저 생성하세요",
    "dry_run 성공 후 실제 반영이 가능합니다",
    "개별 키워드 검토 화면에서 열기",
  ]) assert.ok(source.includes(expected), expected);
  assert.doesNotMatch(source, /<Link href="\/keyword-review-queue\?from=product-launch-flow" className="inline-flex rounded-lg bg-emerald-700[^>]*>키워드 결과 검토 화면 열기<\/Link>/);
});


test("embedded launch coverage requires every launched goods_key before apply", () => {
  const goodsKeys = ["121180", "121181", "121182", "121183", "121184", "121185"];
  const rows = [
    { goodsKey: "121180", reviewStatus: "approved", recommendedTitle: "안전 상품명 A", productGroup: "도매1" },
    { goodsKey: "121181", reviewStatus: "approved", recommendedTitle: "안전 상품명 B", productGroup: "도매2" },
    { goodsKey: "121185", reviewStatus: "pending", recommendedTitle: "121185", productGroup: "소매2" },
  ];
  const coverage = computeLaunchTitleCoverage({ goodsKeys, rows });
  assert.deepEqual(coverage.approvedGoodsKeys, ["121180", "121181"]);
  assert.deepEqual(coverage.missingGoodsKeys, ["121182", "121183", "121184", "121185"]);
  assert.equal(coverage.covered, false);
  assert.equal(isSafeLaunchTitle("121185"), false);
  assert.equal(isSafeLaunchTitle("안전한 원본 상품명"), true);
});

test("full launch market sanity expects 36 expanded apply items", () => {
  const uploadRows = [
    { goods_key: "1", ptn_goods_cd: "BASE-1a" },
    { goods_key: "2", ptn_goods_cd: "BASE-1b" },
    { goods_key: "3", ptn_goods_cd: "BASE-1c" },
    { goods_key: "4", ptn_goods_cd: "BASE-1d" },
    { goods_key: "5", ptn_goods_cd: "BASE-1e" },
    { goods_key: "6", ptn_goods_cd: "BASE-1f" },
  ];
  const goodsKeys = dedupeGoodsKeysForPriceModify(uploadRows);
  assert.equal(expectedLaunchApplyCount(goodsKeys, buildGoodsKeyGroupMap(uploadRows)), 36);
});



test("keyword apply auto confirmation safety remains strict", async () => {
  const keywordWorkspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  const productLaunchFlow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");

  assert.match(keywordWorkspace, /async function run\(mode: "dry_run" \| "apply", auto = false\)/);
  assert.match(keywordWorkspace, /const autoApplyConfirmed =\s*mode === "apply" &&\s*auto === true &&\s*autoApplyToShopling === true &&\s*autoApplyConfirmationText === "AUTO_APPLY_TO_SHOPLING";/);
  assert.match(keywordWorkspace, /if \(mode === "apply" && !autoApplyConfirmed && !window\.confirm\("실제 샵플링 상품명\/검색어를 수정합니다\. 계속하시겠습니까\?"\)\) return;/);
  assert.match(keywordWorkspace, /confirmation_text: mode === "apply" \? KEYWORD_APPLY_CONFIRMATION_TEXT : ""/);
  assert.match(keywordWorkspace, /void run\("apply", true\);/);
  assert.match(keywordWorkspace, /onClick=\{\(\) => void run\("apply"\)\}/);
  assert.doesNotMatch(keywordWorkspace, /onClick=\{\(\) => void run\("apply", true\)\}/);
  assert.match(keywordWorkspace, /출시 완료: 샵플링 상품명\/검색어 반영까지 완료되었습니다\./);

  const useEffectBlocks = keywordWorkspace.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
  const applyEffect = useEffectBlocks.find((block) => block.includes('void run("apply", true);'));
  assert.ok(applyEffect, "automatic apply effect exists");
  assert.match(applyEffect, /autoApplyToShopling !== true/);
  assert.match(applyEffect, /autoApplyConfirmationText !== "AUTO_APPLY_TO_SHOPLING"/);

  assert.match(productLaunchFlow, /const \[autoActualApplyEnabled, setAutoActualApplyEnabled\] = useState\(false\)/);
  assert.doesNotMatch(productLaunchFlow, /autoActualApplyConfirmation/);
  assert.doesNotMatch(productLaunchFlow, /placeholder="AUTO_APPLY_TO_SHOPLING"/);
  assert.match(productLaunchFlow, /window\.confirm\("실제 샵플링 상품명\/검색어 반영까지 자동 실행합니다\. 계속하시겠습니까\?"\)/);
  assert.match(productLaunchFlow, /autoApplyToShopling: autoActualApplyEnabled === true/);
  assert.match(productLaunchFlow, /autoApplyConfirmationText: autoActualApplyEnabled === true \? "AUTO_APPLY_TO_SHOPLING" : ""/);
  assert.doesNotMatch(productLaunchFlow, /keywordShoplingApply/);
  assert.doesNotMatch(productLaunchFlow, /\/api\/keyword-shopling-apply/);
});

test("product launch coverage source copy exists", async () => {
  const source = `${await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8")}\n${await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8")}`;
  for (const expected of [
    "상품명 반영 커버리지",
    "누락 상품명 자동 보강",
    "전체 상품그룹 반영 준비가 끝나지 않았습니다",
    "반영 대상이 일부 상품그룹으로 제한되었습니다",
    "AI가 상품명 반영 준비",
    "일부 상품그룹만 반영하면 나머지 쇼핑몰 상품명은 기존 상태로 남습니다",
    "고급 / 일부 상품만 반영",
  ]) assert.ok(source.includes(expected), expected);
});

test("AI launch agent board and automatic review preparation source exists", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  const source = `${flow}\n${workspace}`;

  for (const expected of [
    "AI 상품출시 에이전트",
    "출시 완료",
    "샵플링 상품명/검색어 반영까지 완료되었습니다",
    "고급 / 수동 조작",
    "검색어가 부족합니다. 반영은 가능하지만 나중에 보강하면 좋습니다.",
    "일부 상품정보 조회가 늦어 안전한 대체 후보를 사용했습니다.",
    "결과 요약 파일이 아직 준비되지 않았습니다.",
  ]) assert.ok(source.includes(expected), expected);

  assert.match(flow, /const autoKeywordImportedArtifactRef = useRef<string>\(""\)/);
  assert.match(flow, /autoKeywordImportedArtifactRef\.current === importKey/);
  assert.match(flow, /autoKeywordImportedArtifactRef\.current = importKey/);
  assert.match(flow, /void importKeywordArtifact\(run, artifact\)/);
  assert.match(workspace, /autoFillMissingLaunchTitles\(approveFirstCandidateRows\(current\)\)/);
  assert.match(workspace, /setPreflightResult\(buildKeywordExecutionPreflight/);
  assert.match(workspace, /void run\("dry_run", true\)/);
  assert.match(workspace, /if \(disabled \|\| !dryRunSucceeded\) return;[\s\S]*if \(autoApplyToShopling !== true\) return;[\s\S]*if \(autoApplyConfirmationText !== "AUTO_APPLY_TO_SHOPLING"\) return;/);
  assert.match(flow, /const \[autoActualApplyEnabled, setAutoActualApplyEnabled\] = useState\(false\)/);
  assert.match(flow, /if \(!checked\) \{\n      onAutoActualApplyEnabledChange\(false\);\n      return;\n    \}/);
  assert.match(flow, /onAutoActualApplyEnabledChange\(confirmed\)/);
  assert.match(flow, /켜면 상품업로드, 가격설정, 키워드 dry_run, 상품명 준비, 실제 샵플링 반영까지 자동으로 진행합니다/);
  assert.match(flow, /실제 반영은 되돌리기 어려우므로 처음 켤 때 한 번 확인합니다/);
});


test("product launch flow makes keyword real apply state explicit", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  const source = `${flow}\n${workspace}`;

  for (const expected of [
    "키워드 dry_run 대기",
    "키워드 dry_run 완료",
    "실제 샵플링 반영 대기",
    "실제 샵플링 반영 실행 중",
    "실제 샵플링 반영 완료",
    "실제 샵플링 반영 실패",
    "실제 샵플링 반영 차단됨",
    "키워드 dry_run은 완료됐지만 실제 샵플링 반영은 아직 실행되지 않았습니다.",
    "출시 보류 - 실제 반영 미완료",
    "실제 샵플링 반영 실행",
    "실제 반영 확인 중",
    "출시 결과 확인",
    "문제 확인",
  ]) assert.ok(source.includes(expected), expected);

  assert.match(flow, /actualApplyDone = \(isSuccessfulPriceResult\(priceActionsResult\) \|\| finalPriceDone\) && keywordRealApplySucceeded && finalPriceDone/s);
  assert.match(flow, /dry_run request id/);
  assert.match(flow, /real apply request id/);
  assert.match(flow, /real apply status/);
  assert.match(flow, /applied count/);
  assert.match(flow, /failed count/);
  assert.match(flow, /blocked blank title count/);
  assert.match(workspace, /if \(autoApplyToShopling !== true\) return;/);
  assert.match(workspace, /if \(preflightResult\?\.summary\.blockedCount \?\? 0\) > 0\) return;/);
  assert.match(workspace, /if \(preflightResult\?\.summary\.eligibleCount \?\? 0\) <= 0\) return;/);
});

test("AI launch board derives final apply, counts, verdicts, and price issue copy", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");

  assert.doesNotMatch(flow, /actualApplyDone=\{false\}/);
  assert.match(flow, /const actualApplyDone = \(isSuccessfulPriceResult\(priceActionsResult\) \|\| finalPriceDone\) && keywordRealApplySucceeded && finalPriceDone/);
  assert.match(flow, /actualApplyDone=\{actualApplyDone\}/);
  assert.match(flow, /mallCount=\{boardMallCount\}/);
  assert.match(flow, /const boardMallCount = expectedPriceModifyUpdateCount\(goodsKeyProductGroupMap\)/);
  assert.match(flow, /titleTargetCount=\{titleTargetCount\}/);
  assert.match(flow, /const titleTargetCount = expectedLaunchApplyCount\(goodsKeys, buildGoodsKeyGroupMap\(uploadRows\)\)/);
  assert.match(flow, /출시 완료 - 경고 있음/);
  assert.match(flow, /출시 보류 - 가격 확인 필요/);
  assert.match(flow, /쇼핑몰별 판매가 0원 항목이 남아 있습니다/);
  assert.match(flow, /가격 화면 검증 필요/);
  assert.match(flow, /가격 API는 실행됐지만 샵플링 화면 기준 0원 여부를 확인하지 못했습니다/);
  assert.match(flow, /setKeywordApplyState/);

  assert.match(workspace, /onApplyStateChange/);
  assert.match(workspace, /export type KeywordApplyState/);
  assert.match(workspace, /dryRunStatus/);
  assert.match(workspace, /realApplyStatus/);
  assert.match(workspace, /appliedCount/);
  assert.match(workspace, /failedCount/);
  assert.match(workspace, /warningCount/);
  assert.match(workspace, /requestId/);
  assert.match(workspace, /lastUpdatedAt/);
});


test("product launch flow final price pass source exists", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "가격 최종 재적용",
    "출시 보류 - 가격 최종 재적용 대기",
    "출시 보류 - 가격 최종 재적용 실패",
    "상품명/키워드 반영 후 가격을 마지막으로 한 번 더 적용합니다.",
    "finalPriceStartedForRealApplyRequestRef",
    "finalize_after_keyword_apply",
    "goodsKeys.length * FULL_PRICE_POLICY_MALL_COUNT",
    "가격 최종 재적용 실행",
    "가격 최종 재적용 확인 중",
    "final price target count",
  ]) assert.ok(source.includes(expected), expected);

  assert.match(source, /const actualApplyDone = \(isSuccessfulPriceResult\(priceActionsResult\) \|\| finalPriceDone\) && keywordRealApplySucceeded && finalPriceDone/);
  assert.match(source, /if \(finalPriceStartedForRealApplyRequestRef\.current === realApplyRequestId\) return;/);
  assert.match(source, /finalPriceStartedForRealApplyRequestRef\.current = realApplyRequestId;/);
  assert.match(source, /goods_key: goodsKeys\.join\("\,"\)/);
  assert.match(source, /goods_key_group_json: buildGoodsKeyGroupJson\(uploadRows\), policy_overrides: \[\], reason: "finalize_after_keyword_apply"/);
  assert.doesNotMatch(source, /keywordShoplingApply/);
  assert.doesNotMatch(source, /\/api\/keyword-shopling-apply/);
  assert.doesNotMatch(source, /API_AUTH_KEY/);
  assert.doesNotMatch(source, /LOGIN_PASSWORD/);
  assert.doesNotMatch(source, /shell\s*:\s*true/i);
  assert.doesNotMatch(source, /child_process/);
  assert.doesNotMatch(source, /PowerShell/i);
});

test("product launch flow source-row seed keyword board is default and old controls are advanced", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const defaultSource = flow.split("고급 / 상세 결과 보기")[0];
  for (const expected of [
    "seedKeywordsBySourceRow",
    "productLaunchFlow.seedKeywordsBySourceRow",
    "행별 핵심 키워드",
    "실재고 시트 행마다 좋은 키워드를 한 번만 입력하세요.",
    "같은 행에서 생성된 도매/소매 상품들은 이 키워드를 함께 사용합니다.",
    "AI가 이 키워드로 쇼핑몰별 상품명과 상품별 검색어를 자동 생성합니다.",
    "검색어는 상품별 1세트로 반영됩니다",
    "게임패드,컨트롤러,조이스틱,미니",
    "상품명/검색어 적용하고 가격 마무리",
    "고급 / 상세 결과 보기",
    "seed_keywords_by_goods_key_json",
    "seedKeywordsByGoodsKey, autoApplyToShopling",
  ]) assert.ok(flow.includes(expected), expected);
  assert.doesNotMatch(defaultSource, /<SeedKeywordSection goodsKeys=/);
  assert.doesNotMatch(defaultSource, /상품별 핵심 키워드/);
  assert.doesNotMatch(defaultSource, /수동 상품명 입력/);
  assert.doesNotMatch(defaultSource, /수동 검색어 입력/);
  assert.match(flow, /<ManualOverrideSection[\s\S]*<form onSubmit=\{runUpload\}/);
  assert.equal(normalizeSeedKeywords("게임패드, 컨트롤러, 조이스틱 미니"), "게임패드,컨트롤러,조이스틱,미니");
  const coverage = computeLaunchTitleCoverage({ goodsKeys: ["121181"], rows: [{ goodsKey: "121181", recommendedTitle: "", reviewStatus: "hold" }], seedKeywordsByGoodsKey: { "121181": "게임패드,컨트롤러" } });
  assert.equal(coverage.covered, true);
});

test("source-row launch seed helpers group and expand goods keys", () => {
  const rows = ["a", "b", "c", "d", "e", "f"].map((suffix, index) => ({ source_row: 950, goods_key: String(121267 + index), ptn_goods_cd: `TEST1-1${suffix}`, product_name: "현재 상품명" }));
  const groups = buildLaunchSourceRowGroups(rows, "950");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceRowId, "950");
  assert.deepEqual(groups[0].goodsKeys, ["121267", "121268", "121269", "121270", "121271", "121272"]);
  assert.deepEqual(groups[0].productGroups, ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]);
  assert.deepEqual(expandSeedKeywordsBySourceRowToGoodsKeys({ "950": "게임패드, 컨트롤러, 조이스틱 미니" }, groups), {
    "121267": "게임패드,컨트롤러,조이스틱,미니",
    "121268": "게임패드,컨트롤러,조이스틱,미니",
    "121269": "게임패드,컨트롤러,조이스틱,미니",
    "121270": "게임패드,컨트롤러,조이스틱,미니",
    "121271": "게임패드,컨트롤러,조이스틱,미니",
    "121272": "게임패드,컨트롤러,조이스틱,미니",
  });
});

test("source-row launch groups handle multiple rows and missing metadata warning", async () => {
  const rows = [
    { source_row: 950, goods_key: "121267", ptn_goods_cd: "TEST1-1a" },
    { source_row: 951, goods_key: "121268", ptn_goods_cd: "TEST1-1b" },
    { source_row: 952, goods_key: "121269", ptn_goods_cd: "TEST1-1c" },
  ];
  assert.deepEqual(buildLaunchSourceRowGroups(rows, "950,951,952").map((group) => group.sourceRowId), ["950", "951", "952"]);
  const missing = buildLaunchSourceRowGroups([{ goods_key: "121270", ptn_goods_cd: "TEST1-1a" }], "950,951");
  assert.equal(missing[0].mappingMissing, true);
});

test("manual launch override helpers enforce priority and validation", () => {
  const row = { goodsKey: "121180", editedTitle: "Edited", recommendedTitle: "Recommended", originalTitle: "Original", reviewStatus: "approved" };
  assert.equal(resolveMallTitle(row, undefined, { "121180": "Manual Title" }), "Manual Title");
  assert.equal(resolveMallTitle(row, undefined, { "121180": "" }), "Edited");
  assert.equal(resolveMallTitle(row, undefined, { "121180": "121180" }), "Edited");
  assert.equal(resolveManualTitleOverride("-", "121180"), "");
  assert.equal(resolveManualTitleOverride("피파게임패드,농구게임패드,축구게임패드,조이스틱,미니", "121180"), "피파게임패드 농구게임패드 축구게임패드 조이스틱 미니");
  assert.equal(normalizeManualKeywordOverride("게임패드,조이스틱,컨트롤러,축구게임패드,미니게임패드"), "게임패드,조이스틱,컨트롤러,축구게임패드,미니게임패드");
});


test("manual candidate parsing preserves raw comma input until generation", async () => {
  assert.deepEqual(parseManualCandidateList("피파게임패드, 농구게임패드\n축구게임패드|조이스틱,,미니|피파게임패드"), ["피파게임패드", "농구게임패드", "축구게임패드", "조이스틱", "미니"]);
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  assert.match(flow, /onManualTitleChange\(goodsKey, event\.target\.value\)/);
  assert.match(flow, /onManualKeywordChange\(goodsKey, event\.target\.value\)/);
  assert.doesNotMatch(flow, /onManualKeywordChange\(goodsKey, normalizeManualKeywordOverride\(event\.target\.value\)/);
  assert.match(flow, /parseManualCandidateList\(manualTitleOverridesByGoodsKey\[firstGoodsKey\]/);
  assert.equal(normalizeManualKeywordOverride("k1,k2,k3,k4,k5,k6,k7,k8,k9,k10,k11"), "k1,k2,k3,k4,k5,k6,k7,k8,k9,k10");
});

test("manual product launch default source hides legacy keyword UI labels", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const forbidden of [
    "AI가 상품명 반영 준비",
    "AI 상품출시 에이전트",
    "행별 핵심 키워드",
    "키워드 결과를 불러왔습니다",
    "직접 파일 넣기",
    "상품그룹별 정책 안내",
    "상품그룹별 상품명 차별화",
    "적용 계획 생성",
    "dry_run 실행",
    "실제 샵플링 반영 실행",
    "자동 진행 모드",
  ]) assert.ok(!flow.includes(forbidden), forbidden);
  for (const expected of [
    "행별 상품명/검색어 후보 입력",
    "상품명 후보 입력",
    "검색어 후보 입력",
    "대표 미리보기",
    "전체 항목 펼쳐보기",
    "승인하고 실제 반영 실행",
    "개발자 진단 보기",
  ]) assert.ok(flow.includes(expected), expected);
  for (const forbidden of [/cafe24/i, /coupang/i, /smartstore/i, /\bdefault\b/, /API_AUTH_KEY/, /LOGIN_PASSWORD/, /shell:\s*true/, /child_process/, /PowerShell/]) {
    assert.doesNotMatch(flow, forbidden);
  }
  assert.doesNotMatch(flow, /https?:\/\/[^"']*shopling/i);
});

test("manual title makes launch goods_key ready without separate approval", () => {
  const coverage = computeLaunchTitleCoverage({ goodsKeys: ["121180"], rows: [{ goodsKey: "121180", recommendedTitle: "", reviewStatus: "hold" }], manualTitleOverridesByGoodsKey: { "121180": "수동 상품명" } });
  assert.equal(coverage.covered, true);
  assert.equal(coverage.titleReadyCount, 1);
});

test("manual overrides flow source avoids forbidden execution and secret patterns", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const forbidden of [/API_AUTH_KEY/, /LOGIN_PASSWORD/, /shell:\s*true/, /child_process/, /PowerShell/, /keywordShoplingApply/]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("product launch flow persists and recovers stage-specific session ids", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "productLaunchFlow.session.v2",
    "uploadRequestId",
    "priceRequestId",
    "keywordRequestId",
    "keywordDryRunRequestId",
    "keywordRealApplyRequestId",
    "finalPriceRequestId",
    "uploadResult",
    "priceResult",
    "keywordResult",
    "finalPriceResult",
    "seedKeywordsBySourceRow",
    "readProductLaunchSession",
    "persistProductLaunchSession",
    "clearProductLaunchSession",
  ]) assert.ok(source.includes(expected), expected);

  assert.match(source, /if \(stage === "상품업로드"\) return ids\.uploadRequestId/);
  assert.match(source, /if \(stage === "가격설정"\) return ids\.priceRequestId/);
  assert.match(source, /if \(stage === "키워드 dry_run"\) return ids\.keywordDryRunRequestId \|\| ids\.keywordRequestId/);
  assert.doesNotMatch(source, /상품업로드[\s\S]{0,120}return ids\.priceRequestId/);
});

test("product launch flow restores persisted session and fetches completed artifacts", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "이전 상품출시 작업을 복구했습니다.",
    "완료된 GitHub Actions 결과를 다시 확인하는 중입니다.",
    "상품업로드 결과를 복구했습니다. 생성된 goods_key 기준으로 다음 단계를 이어갑니다.",
    "상품업로드 결과 확인 중",
    "최근 상품업로드 결과 복구",
    "현재 상품출시 작업 초기화",
    "restoredSession.uploadRequestId",
    "pollUploadResult(true, restoredSession.uploadRequestId)",
    "restoredSession.priceRequestId",
    "fetchPriceResult()",
    "restoredSession.keywordRequestId || restoredSession.keywordRunId",
    "fetchKeywordRuns()",
    "restoredSession.finalPriceRequestId",
    "fetchFinalPriceResult()",
    "extractRowsWithGoodsKey(data)",
    "setUploadRecovered(true)",
  ]) assert.ok(source.includes(expected), expected);
});

test("product launch flow derives stage from recovered results and keeps remount sessions", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const expected of [
    "deriveLaunchStage",
    "if (!isSuccessfulUploadResult(uploadActionsResult, uploadRowsCount)) return \"상품업로드\";",
    "if (!isSuccessfulPriceResult(priceActionsResult)) return \"가격설정\";",
    "return \"키워드 dry_run\";",
    "return \"실제 반영 대기\";",
    "return \"가격 최종 재적용\";",
    "return \"출시 완료\";",
    "persisted request IDs are intentionally recovered after a Vercel-style remount",
  ]) assert.ok(source.includes(expected), expected);
  assert.doesNotMatch(source, /removeItem\(PRODUCT_LAUNCH_SESSION_STORAGE_KEY\)[\s\S]{0,120}useEffect/);
});


test("manual candidate launch apply guards use runner confirmation, safe max_items, and manual readiness", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  const runner = await readFile("src/lib/keywordShoplingApplyRunner.ts", "utf8");
  const combined = `${flow}\n${workspace}`;
  assert.match(flow, /APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING"/);
  assert.match(runner, /KEYWORD_SHOPLING_APPLY_CONFIRMATION_TEXT = "APPLY_KEYWORD_RESULTS_TO_SHOPLING"/);
  assert.doesNotMatch(combined, /APPLY_SHOPLING_KEYWORD_UPDATES/);
  assert.match(workspace, /max_items: 100/);
  assert.doesNotMatch(workspace, /max_items: 500/);
  assert.match(workspace, /isSuccessfulApplyResult/);
  assert.match(workspace, /"partial_failure"/);
  assert.match(workspace, /json\.status === "error" \|\| !json\.requestId/);
  assert.match(workspace, /setResult\(json\)/);
  assert.match(combined, /hasManualCandidatesForAllSourceRows/);
  assert.match(combined, /행별 상품명\/검색어 후보를 입력하면 미리보기를 생성합니다\./);
  assert.match(workspace, /if \(!manualCandidatesReady\) return;/);
  assert.match(flow, /후보 입력 대기/);
  assert.match(workspace, /disabled=\{disabled \|\| !manualCandidatesReady\}/);
  assert.doesNotMatch(flow, /\/api\/keyword-shopling-apply/);
  assert.doesNotMatch(flow, /API_AUTH_KEY|LOGIN_PASSWORD|shell\s*:\s*true|child_process|PowerShell/i);
});
