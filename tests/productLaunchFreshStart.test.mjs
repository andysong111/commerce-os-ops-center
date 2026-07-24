import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/components/product-launch-flow/ProductLaunchFlow.tsx",
    import.meta.url,
  ),
  "utf8",
);

const between = (start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

const freshButtonBlock = between(
  '<button\n          type="button"\n          onClick={startFreshProductLaunch}',
  "        </button>",
);
const resetDisabledBlock = between(
  "const resetProductLaunchDisabled =",
  "  const hasProductLaunchWorkState =",
);
const workStateBlock = between(
  "const hasProductLaunchWorkState =",
  "  const lastCheckedAt =",
);
const freshHandlerBlock = between(
  "const startFreshProductLaunch = () => {",
  "  const retryProductLaunchSession = () =>",
);
const resetSessionBlock = between(
  "const resetProductLaunchSession = () => {",
  "  const startFreshProductLaunch = () =>",
);
const clearFailureBlock = between(
  "const clearProductLaunchFailureState = (options: {",
  "  const resetProductLaunchSession = () =>",
);
const clearStorageBlock = between(
  "function clearProductLaunchSession() {",
  "function removeStorageKeysByPrefix",
);
const renderBeforeCockpit = between("  return (", "      <LaunchCockpit");
const errorDrawerBlock = between(
  '      {cockpit.primaryAction === "failed"',
  "      ) : null}",
);
const developerDetailsBlock = between(
  '      <details className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">',
  "      </details>",
);
const cockpitBlock = between("function LaunchCockpit", "function ErrorDrawer");

const requiredSnippets = (text, snippets) => {
  for (const snippet of snippets)
    assert.equal(text.includes(snippet), true, `missing ${snippet}`);
};

test("visible fresh-start text exists before status board and outside hidden areas", () => {
  assert.match(source, /이전 내용 지우고 새로 시작/);
  assert.match(renderBeforeCockpit, /이전 내용 지우고 새로 시작/);
  assert.ok(
    source.indexOf("이전 내용 지우고 새로 시작") <
      source.indexOf("<OperatorLaunchStatusBoard"),
  );
  assert.ok(
    source.indexOf("이전 내용 지우고 새로 시작") <
      source.indexOf("<RecoveryBanner"),
  );
  assert.doesNotMatch(errorDrawerBlock, /이전 내용 지우고 새로 시작/);
  assert.doesNotMatch(developerDetailsBlock, /이전 내용 지우고 새로 시작/);
});

test("fresh-start button is a secondary destructive action only", () => {
  assert.match(freshButtonBlock, /onClick=\{startFreshProductLaunch\}/);
  assert.doesNotMatch(freshButtonBlock, /onNext/);
  assert.doesNotMatch(
    freshButtonBlock,
    /handleUnifiedProductLaunchAction|handleProductLaunchPrimaryAction/,
  );
  assert.match(freshButtonBlock, /border-red-500/);
  assert.match(freshButtonBlock, /bg-white/);
  assert.match(freshButtonBlock, /text-red-700/);
  assert.equal((cockpitBlock.match(/onClick=\{onNext\}/g) ?? []).length, 1);
});

test("no-work state disables the reset button", () => {
  assert.match(
    source,
    /disabled=\{resetProductLaunchDisabled \|\| !hasProductLaunchWorkState\}/,
  );
});

test("busy states disable reset", () => {
  requiredSnippets(resetDisabledBlock, [
    "uploadRunning",
    "uploadFetching",
    "uploadPolling",
    "priceRunning",
    "priceFetching",
    "pricePolling",
    "finalPriceRunning",
    "finalPriceFetching",
    "finalPricePolling",
    "!!keywordBusy",
    "keywordPolling",
    "manualApplyBusy",
    "manualApplyPolling",
    'manualPreviewStatus === "checking"',
  ]);
});

test("work-state covers restored, current, result, and input state", () => {
  requiredSnippets(workStateBlock, [
    "sessionRestored",
    "!!rowExpression.trim()",
    "!!uploadRequestId",
    "!!priceRequestId",
    "!!finalPriceRequestId",
    "!!uploadRunResult",
    "!!uploadActionsResult",
    "!!priceRunResult",
    "!!priceActionsResult",
    "!!keywordPreview",
    "!!keywordDispatchResult",
    "!!keywordRunsResult",
    "!!keywordApplyState",
    "!!manualPreviewResult",
    "!!manualPreflightResult",
    "!!manualApplyRequestId",
    "!!manualApplyResult",
    "!!finalPriceRunResult",
    "!!finalPriceActionsResult",
    "Object.values(manualTitleOverridesByGoodsKey)",
    "Object.values(manualKeywordOverridesByGoodsKey)",
    "!!keywordSeed.trim()",
    "Object.values(seedKeywordsBySourceRow)",
  ]);
});

test("confirmation warns Shopling changes are not undone", () => {
  assert.match(freshHandlerBlock, /window\.confirm\(/);
  assert.match(
    freshHandlerBlock,
    /이미 샵플링에 반영된 상품, 가격, 상품명과 검색어는 되돌아가지 않습니다/,
  );
});

test("cancellation performs no reset and confirmed reset reloads", () => {
  assert.match(
    freshHandlerBlock,
    /if \(!confirmed\) return;\n    resetProductLaunchSession\(\);\n    window\.location\.reload\(\);/,
  );
});

test("fresh handler only calls resetProductLaunchSession and reload", () => {
  assert.doesNotMatch(
    freshHandlerBlock,
    /handleUnifiedProductLaunchAction|handleProductLaunchPrimaryAction|runFinalPriceModify|applyManualCandidates|fetch\(/,
  );
});

test("reset clears row expressions and request IDs", () => {
  requiredSnippets(clearFailureBlock, [
    'setRowExpression(options.keepRowExpression ? preservedRowExpression : "")',
    "setLastStartedRowExpression(",
    'setUploadRequestId("")',
    'setPriceRequestId("")',
    'setFinalPriceRequestId("")',
  ]);
});

test("reset clears upload, price, keyword, and final-price results", () => {
  requiredSnippets(clearFailureBlock, [
    "setUploadRunResult(null)",
    "setUploadActionsResult(null)",
    "setPriceRunResult(null)",
    "setPriceActionsResult(null)",
    "setKeywordPreview(null)",
    "setKeywordDispatchResult(null)",
    "setKeywordRunsResult(null)",
    "setKeywordApplyState(null)",
    "setFinalPriceRunResult(null)",
    "setFinalPriceActionsResult(null)",
  ]);
});

test("reset clears manual inputs and omitted manual preview/apply state", () => {
  requiredSnippets(clearFailureBlock, [
    "setManualTitleOverridesByGoodsKey({})",
    "setManualKeywordOverridesByGoodsKey({})",
    'setManualPreviewStatus("")',
    "setManualPreviewResult(null)",
    "setManualPreflightResult(null)",
    "setManualApplyBusy(false)",
    'setManualApplyRequestId("")',
    'setManualApplyActionsUrl("")',
    'setManualApplyRunUrl("")',
    'setManualApplyCommandPreview("")',
    "setManualApplyResult(null)",
    "setManualApplyPolling(false)",
    "setManualApplyPollCount(0)",
    "setManualApplyLastCheckedAt(null)",
    "setManualApplyNextCheckIn(0)",
    'setManualApplyErrorMessage("")',
  ]);
});

test("reset clears execution refs, counters, imported state, seed, and actual-apply toggle", () => {
  requiredSnippets(clearFailureBlock, [
    "uploadPollCountRef.current = 0",
    "setUploadPollStartedAt(null)",
    "setEmbeddedReviewOpen(false)",
    'setKeywordImportedAt("")',
    'autoPriceStartedForUploadRequestRef.current = ""',
    'autoKeywordStartedForPriceRequestRef.current = ""',
    'autoKeywordImportedArtifactRef.current = ""',
    'finalPriceStartedForRealApplyRequestRef.current = ""',
  ]);
  requiredSnippets(resetSessionBlock, [
    'setKeywordSeed("")',
    "setAutoActualApplyEnabled(false)",
  ]);
});

test("storage deletion remains scoped by exact keys and prefixes", () => {
  requiredSnippets(clearStorageBlock, [
    "PRODUCT_LAUNCH_SESSION_STORAGE_KEY",
    "UPLOAD_REQUEST_ID_STORAGE_KEY",
    "PRICE_REQUEST_ID_STORAGE_KEY",
    "LAST_ROW_EXPRESSION_STORAGE_KEY",
    "KEYWORD_SEED_STORAGE_KEY",
    "MANUAL_WIZARD_STORAGE_KEY",
    "MANUAL_CANDIDATES_STORAGE_KEY",
    "KEYWORD_ARTIFACT_HANDOFF_STORAGE_KEY",
    "SEED_KEYWORDS_STORAGE_PREFIX",
    "MANUAL_TITLE_OVERRIDES_STORAGE_PREFIX",
    "MANUAL_KEYWORD_OVERRIDES_STORAGE_PREFIX",
    'removeStorageKeysByPrefix(window.sessionStorage, ["productLaunchFlow"])',
  ]);
  assert.doesNotMatch(
    clearStorageBlock,
    /localStorage\.clear|sessionStorage\.clear/,
  );
  assert.doesNotMatch(
    clearStorageBlock,
    /opsCenter\.(?!keywordEngine\.importedArtifact)/,
  );
});

test("fresh button does not cause API calls or market transmission", () => {
  assert.doesNotMatch(
    freshHandlerBlock,
    /fetch\(|workflow|dispatch|Shopling|market|transmission/,
  );
  assert.equal(process.env.REAL_FETCH, undefined);
  assert.equal(process.env.GITHUB_ACTIONS_DISPATCH, undefined);
  assert.equal(process.env.SHOPLING_WRITE, undefined);
});
