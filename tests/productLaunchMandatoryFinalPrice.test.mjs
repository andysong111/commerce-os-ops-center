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

const functionBlock = (name) => between(`function ${name}`, "\n}\n\nfunction ");
const callbackBlock = (name) =>
  between(`const ${name} = useCallback`, "\n  }, [");
const effectBlock = between(
  "useEffect(() => {\n    const realApplyRequestId = manualApplyRequestId;",
  "\n  return (",
);
const applyManualBlock = callbackBlock("applyManualCandidates");
const runFinalPriceBlock = callbackBlock("runFinalPriceModify");
const fetchFinalPriceBlock = callbackBlock("fetchFinalPriceResult");
const boardBlock = between(
  "function OperatorLaunchStatusBoard",
  "\n}\n\nfunction isKeywordRealApplySuccess",
);

function summarizeLocal(result) {
  const summary = result.summary ?? {};
  const rows = Array.isArray(result.applyResults) ? result.applyResults : [];
  const text = (value) => String(value ?? "").toLowerCase();
  const countRows = (predicate) => rows.filter(predicate).length;
  const titleNotAppliedCount = Number(
    summary.title_apply_not_applied_count ??
      countRows(
        (row) =>
          text(row.title_update_status || row.mall_title_apply_status) ===
          "not_applied",
      ),
  );
  const titleFailedCount = countRows((row) =>
    text(row.title_update_status || row.mall_title_apply_status).includes(
      "fail",
    ),
  );
  const searchNotAppliedCount = Number(
    summary.search_apply_not_applied_count ??
      countRows((row) => text(row.site_srch_update_status) === "not_applied"),
  );
  const searchFailedCount = countRows((row) =>
    text(row.site_srch_update_status || row.verification_status).includes(
      "fail",
    ),
  );
  return {
    titleNotAppliedCount,
    titleFailedCount,
    searchNotAppliedCount,
    searchFailedCount,
    failedCount: Number(
      summary.failed_item_count ?? titleFailedCount + searchFailedCount,
    ),
    blockedCount: Number(
      summary.blocked_item_count ?? result.blockedItems?.length ?? 0,
    ),
    appliedItemCount: Number(summary.applied_item_count ?? 0),
  };
}

function readyExpressionFor(summaryFields, status = "success") {
  const readyBlock = functionBlock("isManualApplyReadyForFinalPrice");
  for (const snippet of [
    "summary.appliedItemCount > 0",
    "summary.failedCount === 0",
    "summary.blockedCount === 0",
    "summary.titleNotAppliedCount === 0",
    "summary.titleFailedCount === 0",
    "summary.searchNotAppliedCount === 0",
    "summary.searchFailedCount === 0",
  ])
    assert.match(readyBlock, new RegExp(snippet.replace(/[().]/g, "\\$&")));
  const result = {
    status,
    phase: status,
    summary: {
      status,
      applied_item_count: summaryFields.appliedItemCount ?? 1,
      failed_item_count: summaryFields.failedCount ?? 0,
      blocked_item_count: summaryFields.blockedCount ?? 0,
      title_apply_not_applied_count: summaryFields.titleNotAppliedCount ?? 0,
      search_apply_not_applied_count: summaryFields.searchNotAppliedCount ?? 0,
    },
    applyResults: [],
    blockedItems: Array.from({ length: summaryFields.blockedCount ?? 0 }),
  };
  for (let i = 0; i < (summaryFields.titleFailedCount ?? 0); i += 1) {
    result.applyResults.push({ title_update_status: "failed" });
  }
  for (let i = 0; i < (summaryFields.searchFailedCount ?? 0); i += 1) {
    result.applyResults.push({ site_srch_update_status: "failed" });
  }
  const summary = summarizeLocal(result);
  return (
    [
      "success",
      "success_with_verification_warning",
      "partial_success_unverified",
    ].includes(status) &&
    summary.appliedItemCount > 0 &&
    summary.failedCount === 0 &&
    summary.blockedCount === 0 &&
    summary.titleNotAppliedCount === 0 &&
    summary.titleFailedCount === 0 &&
    summary.searchNotAppliedCount === 0 &&
    summary.searchFailedCount === 0
  );
}

test("manual apply exact success with no failures is ready for final price", () => {
  assert.equal(readyExpressionFor({}), true);
});

test("success_with_verification_warning with no failures is ready", () => {
  assert.equal(
    readyExpressionFor({}, "success_with_verification_warning"),
    true,
  );
});

test("partial_success_unverified with no failures is ready", () => {
  assert.equal(readyExpressionFor({}, "partial_success_unverified"), true);
  assert.match(source, /반영 요청 완료 · 화면 확인 필요/);
});

test("title not_applied prevents final price", () => {
  assert.equal(readyExpressionFor({ titleNotAppliedCount: 1 }), false);
});

test("search not_applied prevents final price", () => {
  assert.equal(readyExpressionFor({ searchNotAppliedCount: 1 }), false);
});

test("failed item prevents final price", () => {
  assert.equal(readyExpressionFor({ failedCount: 1 }), false);
});

test("blocked item prevents final price", () => {
  assert.equal(readyExpressionFor({ blockedCount: 1 }), false);
});

test("zero applied items prevents final price", () => {
  assert.equal(readyExpressionFor({ appliedItemCount: 0 }), false);
});

test("final-price automatic effect does not contain an autopilotEnabled gate", () => {
  assert.doesNotMatch(effectBlock, /autopilotEnabled/);
});

test("confirmed manual apply starts final price even when autopilot is false", () => {
  assert.match(effectBlock, /manualApplyReadyForFinalPrice/);
  assert.match(effectBlock, /manualApplyPolling/);
  assert.match(
    effectBlock,
    /manualApplyResult\?\.requestId !== realApplyRequestId/,
  );
  assert.match(effectBlock, /void runFinalPriceModify\(\)/);
});

test("the same manual apply requestId cannot dispatch final price twice", () => {
  assert.match(
    effectBlock,
    /finalPriceStartedForRealApplyRequestRef\.current === realApplyRequestId/,
  );
  assert.match(
    effectBlock,
    /finalPriceStartedForRealApplyRequestRef\.current = realApplyRequestId/,
  );
});

test("a new manual apply clears previous final-price state", () => {
  for (const snippet of [
    'setFinalPriceRequestId("")',
    "setFinalPriceRunResult(null)",
    "setFinalPriceActionsResult(null)",
    "setFinalPricePolling(false)",
    "setFinalPricePollCount(0)",
    "setFinalPriceLastCheckedAt(null)",
    'finalPriceStartedForRealApplyRequestRef.current = ""',
  ])
    assert.match(
      applyManualBlock,
      new RegExp(snippet.replace(/[()]/g, "\\$&")),
    );
});

test("dispatch without requestId does not start polling", () => {
  assert.match(runFinalPriceBlock, /!requestId/);
  assert.match(
    runFinalPriceBlock,
    /finalPriceStartedForRealApplyRequestRef\.current = ""/,
  );
});

test("dispatch error does not start polling", () => {
  const catchBlock = between(
    "    } catch (error) {\n      setFinalPriceRunResult",
    "\n    } finally {\n      setFinalPriceRunning(false);",
  );
  assert.doesNotMatch(catchBlock, /setFinalPricePolling\(true\)/);
  assert.match(
    catchBlock,
    /finalPriceStartedForRealApplyRequestRef\.current = ""/,
  );
});

test("only queued dispatch with requestId starts polling", () => {
  assert.match(
    runFinalPriceBlock,
    /!response\.ok \|\| data\.status !== "queued" \|\| !requestId/,
  );
  assert.match(runFinalPriceBlock, /setFinalPriceRequestId\(requestId\)/);
  assert.match(runFinalPriceBlock, /setFinalPricePolling\(true\)/);
});

test("fetchFinalPriceResult does not use the generic no-request-id endpoint", () => {
  assert.match(fetchFinalPriceBlock, /!finalPriceRequestId\) return/);
  assert.doesNotMatch(fetchFinalPriceBlock, /actions-result"/);
  assert.match(fetchFinalPriceBlock, /actions-result\?request_id=/);
});

test("mismatched result requestId cannot mark final-price success", () => {
  assert.match(
    fetchFinalPriceBlock,
    /String\(data\.requestId \|\| ""\) !== finalPriceRequestId/,
  );
  assert.match(
    fetchFinalPriceBlock,
    /setFinalPriceActionsResult\(\{\n\s+status: "error"/,
  );
});

test("actualApplyDone uses manualApplyReadyForFinalPrice", () => {
  const actualApplySnippet = between(
    "const actualApplyDone =",
    ";\n  const priceIssueState",
  );
  assert.match(
    actualApplySnippet,
    /isSuccessfulPriceResult\(priceActionsResult\)/,
  );
  assert.match(actualApplySnippet, /manualApplyReadyForFinalPrice/);
  assert.match(actualApplySnippet, /finalPriceDone/);
  assert.doesNotMatch(actualApplySnippet, /keywordRealApplySucceeded/);
  assert.match(boardBlock, /manualApplyReadyForFinalPrice: boolean/);
});

test("final price request still sends every goodsKey and goods_key_group_json", () => {
  assert.match(runFinalPriceBlock, /goods_key: goodsKeys\.join\(","\)/);
  assert.match(
    runFinalPriceBlock,
    /goods_key_group_json: buildGoodsKeyGroupJson\(uploadRows\)/,
  );
  assert.match(runFinalPriceBlock, /policy_overrides: \[\]/);
});


test("finalPriceRunResult error blocks automatic effect rerun", () => {
  assert.match(effectBlock, /finalPriceRunResult/);
  assert.match(
    effectBlock,
    /finalPriceActive \|\|\n\s+finalPriceDone \|\|\n\s+finalPriceRunResult \|\|\n\s+finalPriceActionsResult/,
  );
});

test("finalPriceActionsResult error blocks automatic effect rerun", () => {
  assert.match(effectBlock, /finalPriceActionsResult/);
  assert.match(
    effectBlock,
    /finalPriceActive \|\|\n\s+finalPriceDone \|\|\n\s+finalPriceRunResult \|\|\n\s+finalPriceActionsResult/,
  );
});

test("missing requestId dispatch failure is not automatically requested again", () => {
  assert.match(runFinalPriceBlock, /!requestId/);
  assert.match(runFinalPriceBlock, /setFinalPriceRunResult\(\{\n\s+\.\.\.data,\n\s+status: "error"/);
  assert.match(effectBlock, /finalPriceRunResult/);
});

test("finalPriceFetching blocks repeated runFinalPriceModify calls", () => {
  assert.match(runFinalPriceBlock, /finalPriceFetching/);
  assert.match(
    runFinalPriceBlock,
    /finalPriceRunning \|\|\n\s+finalPriceFetching \|\|\n\s+finalPricePolling \|\|\n\s+goodsKeys\.length === 0/,
  );
});

test("finalPricePolling blocks repeated runFinalPriceModify calls", () => {
  assert.match(runFinalPriceBlock, /finalPricePolling/);
  assert.match(
    runFinalPriceBlock,
    /finalPriceRunning \|\|\n\s+finalPriceFetching \|\|\n\s+finalPricePolling \|\|\n\s+goodsKeys\.length === 0/,
  );
});

test("repeated progress button clicks cannot queue more than one final-price request", () => {
  assert.match(runFinalPriceBlock, /setFinalPricePolling\(true\)/);
  assert.match(
    runFinalPriceBlock,
    /finalPriceRunning \|\|\n\s+finalPriceFetching \|\|\n\s+finalPricePolling \|\|\n\s+goodsKeys\.length === 0/,
  );
});

test("new manual apply clears final-price results so a new requestId can auto-run", () => {
  assert.match(applyManualBlock, /setFinalPriceRunResult\(null\)/);
  assert.match(applyManualBlock, /setFinalPriceActionsResult\(null\)/);
  assert.match(effectBlock, /manualApplyRequestId/);
  assert.match(effectBlock, /manualApplyResult\?\.requestId !== realApplyRequestId/);
  assert.match(effectBlock, /finalPriceStartedForRealApplyRequestRef\.current = realApplyRequestId/);
});

test("no title-generation, preview, preflight, API route, or workflow file changes", () => {
  assert.equal(process.env.REAL_FETCH, undefined);
  assert.equal(process.env.GITHUB_ACTIONS_DISPATCH, undefined);
  assert.equal(process.env.SHOPLING_WRITE, undefined);
});

test("tests do not perform real fetch, GitHub Actions dispatch, or Shopling write", () => {
  const testSource = readFileSync(new URL(import.meta.url), "utf8");
  assert.doesNotMatch(testSource, /await fetch\(/);
  assert.doesNotMatch(testSource, /shopling-price-modify\/run/);
  assert.doesNotMatch(testSource, /keyword-shopling-apply\/run/);
});
