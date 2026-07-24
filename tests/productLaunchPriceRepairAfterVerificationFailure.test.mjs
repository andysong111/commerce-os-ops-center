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
const effectBlock = between(
  "useEffect(() => {\n    const realApplyRequestId = manualApplyRequestId;",
  "\n  return (",
);
const unifiedHandlerBlock = between(
  "const handleUnifiedProductLaunchAction = () => {",
  "\n  };\n\n  useEffect(() => {\n    if (!autopilotEnabled) return;",
);
const launchCockpitBlock = functionBlock("LaunchCockpit");

function isFinalManualApplyResultLocal(result) {
  const value = String(
    result?.phase ?? result?.status ?? result?.summary?.status ?? "",
  );
  return [
    "artifact_ready",
    "failed",
    "blocked",
    "completed_no_artifact",
    "error",
    "success",
    "partial_failure",
    "success_with_verification_warning",
    "partial_success_unverified",
  ].includes(value);
}

function summarizeLocal(result) {
  const summary = result?.summary ?? {};
  return {
    failedCount: Number(summary.failed_item_count ?? 0),
    blockedCount: Number(summary.blocked_item_count ?? 0),
    appliedItemCount: Number(summary.applied_item_count ?? 0),
    titleNotAppliedCount: Number(summary.title_apply_not_applied_count ?? 0),
    titleFailedCount: 0,
    searchNotAppliedCount: Number(summary.search_apply_not_applied_count ?? 0),
    searchFailedCount: 0,
  };
}

function isManualApplyReadyForFinalPriceLocal(result) {
  const status = String(result?.summary?.status ?? result?.status ?? "");
  const summary = summarizeLocal(result);
  return (
    isFinalManualApplyResultLocal(result) &&
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

function isManualApplyPriceRepairRequiredLocal(result) {
  const summary = result?.summary ?? {};
  return (
    isFinalManualApplyResultLocal(result) &&
    summary.real_apply_executed === true &&
    Number(summary.title_batch_request_count) > 0 &&
    result?.status !== "queued" &&
    result?.status !== "running" &&
    summary.dry_run !== true &&
    String(summary.dry_run ?? "").toLowerCase() !== "true"
  );
}

const realFailureFixture = {
  status: "failed",
  phase: "failed",
  requestId: "apply-real-1",
  summary: {
    status: "failed",
    real_apply_executed: true,
    title_batch_request_count: 1,
    title_apply_success_count: 0,
    title_apply_unverified_count: 36,
    failed_item_count: 36,
    requires_final_price_pass: false,
  },
};

test("real failed title verification still requires price repair but is not launch-ready", () => {
  assert.equal(isManualApplyPriceRepairRequiredLocal(realFailureFixture), true);
  assert.equal(isManualApplyReadyForFinalPriceLocal(realFailureFixture), false);
  assert.match(functionBlock("isManualApplyPriceRepairRequired"), /real_apply_executed === true/);
  assert.match(functionBlock("isManualApplyPriceRepairRequired"), /Number\(summary\.title_batch_request_count\) > 0/);
  assert.doesNotMatch(functionBlock("isManualApplyPriceRepairRequired"), /requires_final_price_pass/);
  assert.match(effectBlock, /!manualApplyPriceRepairRequired/);
  assert.doesNotMatch(effectBlock, /!manualApplyReadyForFinalPrice/);
});

test("blocked result with no title batch does not repair price", () => {
  assert.equal(isManualApplyPriceRepairRequiredLocal({ status: "blocked", summary: { real_apply_executed: true, title_batch_request_count: 0 } }), false);
});

test("config error before title request does not repair price", () => {
  assert.equal(isManualApplyPriceRepairRequiredLocal({ status: "error", summary: { real_apply_executed: false, title_batch_request_count: 0 } }), false);
});

test("dry_run does not repair price", () => {
  for (const dry_run of [true, "true"]) {
    assert.equal(isManualApplyPriceRepairRequiredLocal({ status: "success", summary: { real_apply_executed: true, title_batch_request_count: 1, dry_run } }), false);
  }
});

test("queued or running result does not repair price", () => {
  for (const status of ["queued", "running"]) {
    assert.equal(isManualApplyPriceRepairRequiredLocal({ status, summary: { real_apply_executed: true, title_batch_request_count: 1 } }), false);
  }
});

test("same apply requestId cannot dispatch price twice and polling blocks duplicate clicks", () => {
  assert.match(effectBlock, /manualApplyResult\?\.requestId !== realApplyRequestId/);
  assert.match(effectBlock, /finalPriceStartedForRealApplyRequestRef\.current === realApplyRequestId/);
  assert.match(effectBlock, /finalPriceStartedForRealApplyRequestRef\.current = realApplyRequestId/);
  const runFinalPriceBlock = between("const runFinalPriceModify = useCallback", "\n  }, [");
  assert.match(runFinalPriceBlock, /finalPricePolling/);
});

test("price repair success does not falsely mark launch complete", () => {
  const actualApplySnippet = between("const actualApplyDone =", ";\n  const priceIssueState");
  assert.match(actualApplySnippet, /manualApplyReadyForFinalPrice/);
  assert.doesNotMatch(actualApplySnippet, /manualApplyPriceRepairRequired/);
  assert.match(launchCockpitBlock, /finalPriceDone && !manualApplyReadyForFinalPrice\n\s+\? "가격 복구 완료 · 상품명 검증 필요"/);
});

test("unified button starts repair instead of resending manual title apply", () => {
  assert.match(unifiedHandlerBlock, /manualApplyPriceRepairRequired && !finalPriceDone/);
  assert.match(unifiedHandlerBlock, /void runFinalPriceModify\(\);/);
  assert.match(unifiedHandlerBlock, /return;\n    }\n\n    handleProductLaunchPrimaryAction\(\);/);
  assert.doesNotMatch(unifiedHandlerBlock, /applyManualCandidates\(/);
  assert.doesNotMatch(unifiedHandlerBlock, /confirmManualCandidates\(/);
});
