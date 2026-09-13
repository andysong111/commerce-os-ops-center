import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const executorPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-lifecycle-executor.js",
  import.meta.url,
);
const currentStatusGuardPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-lifecycle-current-status-v062.js",
  import.meta.url,
);
const mainExecPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-lifecycle-main-exec.js",
  import.meta.url,
);
const backgroundPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-lifecycle.js",
  import.meta.url,
);
const backgroundRootPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-root.js",
  import.meta.url,
);
const bridgeRoutePath = new URL(
  "../src/app/api/shopling-lifecycle-bridge/route.ts",
  import.meta.url,
);
const downloadRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/download/route.ts",
  import.meta.url,
);

test("lifecycle executor parses and targets the diagnosed Shopling product-list controls", async () => {
  const source = await readFile(executorPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PRODUCT_LIST_PATH = "\/prod\/prodLst\.phtml"/);
  assert.match(source, /select\[name="sort_tp"\]/);
  assert.match(source, /setSelectValue\(sort, "A"\)/);
  assert.match(source, /select\[name="sale_status_chg"\]/);
  assert.match(source, /context\.desiredState === "SELLING" \? "B"/);
  assert.match(source, /context\.desiredState === "SOLD_OUT" \? "C"/);
  assert.match(source, /: "Z"/);
});

test("lifecycle current-status guard narrows the first search to the read-only B or C snapshot", async () => {
  const source = await readFile(currentStatusGuardPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /commerce_os_lifecycle_current/);
  assert.match(source, /\^\[BC\]\$/);
  assert.match(source, /STAGE_SEARCHED = "search-submitted"/);
  assert.match(source, /STAGE_VERIFY = "verify-submitted"/);
  assert.match(source, /stage === STAGE_SEARCHED/);
  assert.match(source, /return query\.currentSaleStatus/);
  assert.match(source, /stage === STAGE_VERIFY/);
  assert.match(source, /desiredStatus\(query\.desiredState\)/);
  assert.match(source, /select\[name="sale_status"\]/);
  assert.match(source, /document\.addEventListener\("click"/);
  assert.match(source, /document\.addEventListener\("submit"/);
  assert.doesNotMatch(source, /status_chg|del_submit/);
});

test("lifecycle executor mutates only one exact goods-key row and verifies again before success", async () => {
  const source = await readFile(executorPath, "utf8");
  assert.match(source, /function rowHasExactGoodsKey/);
  assert.match(source, /const rows = matchingRows\(context\.goodsKey\)/);
  assert.match(source, /rows\.length !== 1/);
  assert.match(source, /checkSingleRow\(rows\[0\]\)/);
  assert.match(source, /const STAGE_VERIFY = "verify-submitted"/);
  assert.match(source, /prepareSearch\(context, true\)/);
  const verifyBlock = source.indexOf('if (stage === STAGE_VERIFY)');
  const successCall = source.indexOf('finish(context, "succeeded"', verifyBlock);
  assert.ok(verifyBlock >= 0 && successCall > verifyBlock);
});

test("background scripting executor runs only in top-frame Shopling MAIN world and validates persisted context", async () => {
  const source = await readFile(mainExecPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /commerce-os-shopling-lifecycle-main-execute/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /world: "MAIN"/);
  assert.match(source, /frameId !== 0/);
  assert.match(source, /commerceOsShoplingLifecycleTaskContext/);
  assert.match(source, /storedToken !== cleanToken/);
  assert.match(source, /lifecycle_main_exec_context_mismatch/);
  assert.match(source, /location\.hostname !== "a\.shopling\.co\.kr"/);
  assert.match(source, /location\.pathname !== "\/prod\/prodLst\.phtml"/);
});

test("v0.6.0+ schedules the verified Shopling button click directly in MAIN world without cross-world CustomEvent transport", async () => {
  const source = await readFile(mainExecPath, "utf8");
  assert.match(source, /const BRIDGE_VERSION = "v0\.6\.0"/);
  assert.match(source, /button\.click\(\)/);
  assert.match(source, /window\.confirm = \(\) => true/);
  assert.match(source, /commerceOsShoplingLifecycleMainScheduled/);
  assert.doesNotMatch(source, /CustomEvent|main_world_submit_timeout/);
});

test("delete remains double-gated in isolated executor and MAIN-world scripting executor", async () => {
  const executor = await readFile(executorPath, "utf8");
  const mainExec = await readFile(mainExecPath, "utf8");
  assert.match(executor, /context\.desiredState === "DELETE" && !context\.allowDelete/);
  assert.match(executor, /삭제 Canary가 서버에서 승인되지 않아 삭제를 실행하지 않았습니다/);
  assert.match(mainExec, /cleanAction === "delete"/);
  assert.match(mainExec, /desiredState !== "DELETE" \|\| stored\.allowDelete !== true \|\| allowDelete !== true/);
  assert.match(mainExec, /delete_canary_not_armed/);
  assert.match(mainExec, /del_submit\\s\*\\\(/);
  assert.match(mainExec, /status_chg\\s\*\\\(/);
});

test("background root loads the direct MAIN-world lifecycle executor and keeps an independent recurring poller", async () => {
  const source = await readFile(backgroundRootPath, "utf8");
  assert.match(source, /background-shopling-lifecycle-main-exec\.js/);
  assert.match(source, /SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM/);
  assert.match(source, /commerce-os-shopling-lifecycle-recurring-keeper/);
  assert.match(source, /periodInMinutes:\s*1/);
  assert.match(source, /lifecycleProcessExecutorQueue/);
  assert.doesNotMatch(source, /commerce-os-shopling-lifecycle-executor"/);
});

test("background executor re-reads current sale status before opening the browser and keeps fallback fail-closed", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /SHOPLING_LIFECYCLE_STATUS_PROBE_ENDPOINT/);
  assert.match(source, /shopling-lifecycle-status-probe/);
  assert.match(source, /lifecycleReadCurrentSaleStatus/);
  assert.match(source, /state \|\| ""\)\.trim\(\) !== "READY"/);
  assert.match(source, /\^\[BC\]\$/);
  assert.match(source, /commerce_os_lifecycle_current/);
  assert.match(source, /lifecycleExecutorUrl\(task, claimed\.runId, claimed\.deleteExecutionEnabled, currentSaleStatus\)/);
});

test("background executor is serialized, yields to existing Shopling workers, and times out fail-closed", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /SHOPLING_LIFECYCLE_EXECUTOR_ALARM/);
  assert.match(source, /limit:\s*1/);
  assert.match(source, /lifecycleOtherShoplingWorkerBusy/);
  assert.match(source, /commerceOsShoplingTitleBatchRun/);
  assert.match(source, /commerceOsShoplingPipelineMarketRun/);
  assert.match(source, /SHOPLING_LIFECYCLE_EXECUTOR_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(source, /"confirm_needed"/);
  assert.match(source, /chrome\.tabs\.create/);
  assert.match(source, /active:\s*false/);
  assert.doesNotMatch(source, /document\.cookie|password/i);
});

test("server bridge claims only non-shadow pending work and never releases DELETE without explicit env gate", async () => {
  const source = await readFile(bridgeRoutePath, "utf8");
  assert.match(source, /SHOPLING_LIFECYCLE_DELETE_EXECUTION_ENABLED/);
  assert.match(source, /desired === "SELLING" \|\| desired === "SOLD_OUT"/);
  assert.match(source, /desired === "DELETE" && allowDelete/);
  assert.match(source, /\.eq\("status", "pending"\)/);
  assert.match(source, /\.eq\("shadow_mode", false\)/);
  assert.match(source, /STALE_CLAIM_MINUTES = 15/);
  assert.match(source, /status: "confirm_needed"/);
  assert.match(source, /deleteExecutionEnabled: allowDelete/);
});

test("download package preserves the lifecycle base while applying the v0.6.4 separation boundary", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  const separation = await readFile(new URL("../src/lib/shoplingTitleWorkflowSeparation.ts", import.meta.url), "utf8");
  const root = await readFile(backgroundRootPath, "utf8");
  assert.match(source, /manifest\.version = "0\.6\.3"/);
  assert.match(source, /separateShoplingTitleWorkflow\(entries\)/);
  assert.match(source, /zipSync\(separatedEntries/);
  assert.match(separation, /SEPARATED_TITLE_VERSION = "0\.6\.4"/);
  assert.match(source, /"alarms", "scripting"/);
  assert.match(source, /background-shopling-lifecycle-main-exec\.js/);
  assert.match(
    source,
    /js: \[[\s\S]{0,120}"content-shopling-lifecycle-current-status-v062\.js"[\s\S]{0,120}"content-shopling-lifecycle-executor\.js"[\s\S]{0,120}\],[\s\S]{0,120}all_frames: false/,
  );
  assert.doesNotMatch(source, /world: "MAIN"/);
  assert.match(root, /SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM/);
  // The final ZIP and byte-preservation contracts are exercised by
  // shoplingTitleWorkflowSeparation.test.mjs, not historical version comments.
});

test("download package rewrites legacy event invokeMutation into background scripting message transport", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.match(source, /LEGACY_LIFECYCLE_INVOKE_MUTATION/);
  assert.match(source, /SCRIPTING_LIFECYCLE_INVOKE_MUTATION/);
  assert.match(source, /commerce-os-shopling-lifecycle-main-execute/);
  assert.match(source, /shopling_v060_legacy_event_bridge_still_present/);
  assert.match(source, /rewriteLifecycleExecutor/);
});
