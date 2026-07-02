import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildGoodsKeyGroupMap,
  computeLaunchTitleCoverage,
  expectedLaunchApplyCount,
  isSafeLaunchTitle,
  buildKeywordEngineDispatchPayload,
  dedupeGoodsKeysForPriceModify,
  extractRowsWithGoodsKey,
  extractUploadRows,
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

test("product launch flow includes AI agent board, final verdict, and guarded one-click apply copy", async () => {
  const source = `${await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8")}\n${await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8")}`;
  for (const expected of [
    "AI 상품출시 에이전트",
    "출시 완료",
    "샵플링 상품명/검색어 반영까지 완료되었습니다",
    "실제 반영까지 자동 실행",
    "AUTO_APPLY_TO_SHOPLING",
    "가격 API 반영 완료 / 화면 검증 미지원",
    "가격 확인 필요",
    "출시 완료 - 경고 있음",
    "출시 보류 - 가격 확인 필요",
    "출시 보류 - 실제 반영 미완료",
    "출시 보류 - 상품명 일부 누락",
    "진행 중입니다...",
    "실제 샵플링 반영 실행",
    "검증 불가",
    "가격 0원",
    "상품명 누락",
    "검색어 부족",
  ]) assert.ok(source.includes(expected), expected);
});

test("one-click full launch remains off by default and uses guarded apply flow", async () => {
  const productSource = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const reviewSource = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  const source = `${productSource}\n${reviewSource}`;
  assert.match(productSource, /const \[autoActualApplyEnabled, setAutoActualApplyEnabled\] = useState\(false\)/);
  assert.ok(reviewSource.includes('autoApplyConfirmationText !== "AUTO_APPLY_TO_SHOPLING"'));
  assert.ok(reviewSource.includes('/api/keyword-shopling-apply/run'));
  assert.ok(reviewSource.includes('KEYWORD_APPLY_CONFIRMATION_TEXT'));
  assert.doesNotMatch(productSource, /\/api\/keyword-shopling-apply\/run/);
  assert.doesNotMatch(source, /\/api\/shopling-(?!product-upload|price-modify)/i);
  assert.doesNotMatch(source, /API_AUTH_KEY/);
  assert.doesNotMatch(source, /LOGIN_PASSWORD/);
  assert.doesNotMatch(source, /shell\s*:\s*true/i);
  assert.doesNotMatch(source, /child_process/);
  assert.doesNotMatch(source, /PowerShell/i);
});
