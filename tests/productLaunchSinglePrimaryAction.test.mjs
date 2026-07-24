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

const functionBlock = (name, next = "\n}\n\nfunction ") =>
  between(`function ${name}`, next);
const boardBlock = functionBlock(
  "OperatorLaunchStatusBoard",
  "\n}\n\nfunction isKeywordRealApplySuccess",
);
const cockpitBlock = functionBlock("LaunchCockpit");
const unifiedHandlerBlock = between(
  "const handleUnifiedProductLaunchAction = () => {",
  "\n  };\n\n  useEffect(() => {\n    if (!autopilotEnabled) return;",
);
const cockpitCallBlock = between("      <LaunchCockpit", "      />");

const countMatches = (text, pattern) => text.match(pattern)?.length ?? 0;

test("OperatorLaunchStatusBoard no longer accepts onNext", () => {
  assert.doesNotMatch(boardBlock, /onNext/);
  assert.doesNotMatch(boardBlock, /onNext: \(\) => void/);
});

test("OperatorLaunchStatusBoard contains no main progress button", () => {
  assert.doesNotMatch(boardBlock, /<button[\s\S]*onClick=\{onNext\}/);
  assert.doesNotMatch(boardBlock, /bg-emerald-700 px-5 py-3/);
});

test("boardButtonLabel is removed", () => {
  assert.doesNotMatch(source, /boardButtonLabel/);
});

test("LaunchCockpit still contains one main primary button", () => {
  assert.equal(countMatches(cockpitBlock, /onClick=\{onNext\}/g), 1);
  assert.match(cockpitBlock, /primaryAction === "upload"/);
});

test("LaunchCockpit receives handleUnifiedProductLaunchAction", () => {
  assert.match(cockpitCallBlock, /onNext=\{handleUnifiedProductLaunchAction\}/);
  assert.doesNotMatch(cockpitCallBlock, /onNext=\{handleProductLaunchPrimaryAction\}/);
});

test("unified handler calls runFinalPriceModify when manual apply is ready", () => {
  assert.match(unifiedHandlerBlock, /manualApplyReadyForFinalPrice && !finalPriceDone/);
  assert.match(unifiedHandlerBlock, /void runFinalPriceModify\(\);/);
});

test("unified handler does not call manual apply again during final-price stage", () => {
  assert.match(unifiedHandlerBlock, /return;\n    }\n\n    handleProductLaunchPrimaryAction\(\);/);
  assert.doesNotMatch(unifiedHandlerBlock, /applyManualCandidates\(/);
  assert.doesNotMatch(unifiedHandlerBlock, /confirmManualCandidates\(/);
});

test("final-price active disables the retained button", () => {
  assert.match(cockpitBlock, /const disabled = finalPriceActive \|\| actualApplyDone\n\s+\? true/);
});

test("completed launch disables the retained button", () => {
  assert.match(cockpitBlock, /const disabled = finalPriceActive \|\| actualApplyDone\n\s+\? true/);
});

test("final-price failed state shows retry label", () => {
  assert.match(cockpitBlock, /finalPriceFailed\n\s+\? "가격 최종 재적용 다시 실행"/);
});

test("final-price dispatch error participates in retry state", () => {
  assert.match(
    source,
    /const finalPriceDispatchFailed =\n\s+String\(finalPriceRunResult\?\.status \?\? ""\)\.toLowerCase\(\) === "error";/,
  );
  assert.match(
    source,
    /const finalPriceFailed =\n\s+finalPriceDispatchFailed \|\|\n\s+hasPriceFailure\(finalPriceActionsResult\) \|\|\n\s+getPriceCounts\(finalPriceActionsResult, goodsKeys\.length\)\.failCount > 0;/,
  );
  assert.match(
    cockpitBlock,
    /manualApplyReadyForFinalPrice && !finalPriceDone && finalPriceFailed\n\s+\? "가격 최종 재적용 다시 실행"/,
  );
});

test("normal upload button label remains", () => {
  assert.match(source, /if \(primaryAction === "upload"\) return "상품출시 진행 시작";/);
});

test("normal price button label remains", () => {
  assert.match(source, /primaryAction === "price"[\s\S]*"가격설정 시작"/);
});

test("candidate review and apply labels remain", () => {
  assert.match(source, /"상품명\/검색어 후보 확인"/);
  assert.match(source, /"승인하고 실제 반영 실행"/);
});

test("final-price safety guards from PR #252 remain", () => {
  for (const snippet of [
    "manualApplyResult?.requestId !== realApplyRequestId",
    "finalPriceRunning ||\n      finalPriceFetching ||\n      finalPricePolling ||\n      goodsKeys.length === 0",
    "finalPriceRunResult ||\n      finalPriceActionsResult",
    "goods_key: goodsKeys.join(\",\")",
    "goods_key_group_json: buildGoodsKeyGroupJson(uploadRows)",
    "policy_overrides: []",
  ]) assert.equal(source.includes(snippet), true, `missing ${snippet}`);
  assert.doesNotMatch(between("useEffect(() => {\n    const realApplyRequestId = manualApplyRequestId;", "\n  return ("), /autopilotEnabled/);
});

test("clean-checkout guard does not inspect git status", () => {
  const testSource = readFileSync(new URL(import.meta.url), "utf8");
  for (const forbiddenSnippet of [
    "node:" + "child_process",
    "exec" + "Sync",
    "git status --" + "porcelain",
    "assertUnchanged" + "OnlyAllowedFiles",
  ]) assert.doesNotMatch(testSource, new RegExp(forbiddenSnippet));
});

test("no real external calls occur in tests", () => {
  assert.equal(process.env.REAL_FETCH, undefined);
  assert.equal(process.env.GITHUB_ACTIONS_DISPATCH, undefined);
  assert.equal(process.env.SHOPLING_WRITE, undefined);
});
