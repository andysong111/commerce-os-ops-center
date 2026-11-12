import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-group-canary/manifest.json", import.meta.url);
const backgroundPath = new URL("../public/shopling-market-group-canary/background-root.mjs", import.meta.url);
const contentPath = new URL("../public/shopling-market-group-canary/content-group-canary.mjs", import.meta.url);
const overlayPath = new URL("../public/shopling-market-group-canary/content-version-v034.mjs", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-market-group-canary/download/route.ts", import.meta.url);
const claimRoutePath = new URL("../src/app/api/shopling-market-group-canary/claim/route.ts", import.meta.url);
const releaseRoutePath = new URL("../src/app/api/shopling-market-group-canary/release/route.ts", import.meta.url);

test("parallel fresh worker v0.3.4 keeps minimal A18 clone permissions", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.3.4");
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "windows"]);
  assert.ok(manifest.host_permissions.includes("*://*.shopling.co.kr/*"));
  assert.ok(manifest.content_scripts[0].js.includes("content-version-v034.mjs"));
  assert.ok(!manifest.permissions.includes("scripting"));
  assert.ok(!manifest.permissions.includes("contentSettings"));
});

test("background clones the immutable A18 control tab once per remaining task in parallel", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /chrome\.tabs\.duplicate\(controlTabId\)/);
  assert.match(source, /chrome\.windows\.create\(\{[\s\S]*tabId: duplicate\.id/);
  assert.match(source, /Promise\.allSettled\(/);
  assert.match(source, /tasks\.map\(async \(task\)/);
  assert.match(source, /parallel: true/);
  assert.match(source, /WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV034"/);
  assert.doesNotMatch(source, /chrome\.tabs\.reload\(/);
});

test("parallel worker maps every popup and result tab back to exactly one goods_key assignment", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.match(source, /assignments: \{ \.\.\.\(meta\.assignments \|\| \{\}\), \[task\.goodsKey\]: assignment \}/);
  assert.match(source, /findAssignment\(meta, sender, allowOpener\)/);
  assert.match(source, /context\.goodsKey === goodsKey/);
  assert.match(source, /parallel_worker_arm_identity_mismatch/);
  assert.match(source, /parallel_worker_report_identity_mismatch/);
});

test("one worker failure releases only that task and does not close sibling workers", async () => {
  const background = await readFile(backgroundPath, "utf8");
  const content = await readFile(contentPath, "utf8");
  assert.match(background, /releaseTaskBeforeSubmit/);
  assert.match(background, /goodsKey: task\.goodsKey/);
  assert.match(background, /closeParallelWorker/);
  assert.match(content, /이 채널만 대기열로 원복했습니다\. 다른 병렬 채널은 계속 진행합니다/);
  assert.doesNotMatch(content, /releaseTasks\(state, Number\(state\.index/);
});

test("field-tested product selection, saved-profile mapping and per-channel submit lock remain intact", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /rowMatchesExactIdentity/);
  assert.match(source, /codePattern\.test\(label\) && goodsKeyPattern\.test\(label\)/);
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
  assert.match(source, /savedProfileSelect\(task\.profile\)/);
  assert.match(source, /SUBMIT_CONFIRM_TIMEOUT_MS = 90000/);
  assert.match(source, /workerStateKey\(runId, goodsKey\)/);
  const armIndex = source.indexOf("type: ARM_MESSAGE");
  const clickIndex = source.indexOf("click(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
});

test("result parser ignores Selpa-only failures but blocks every non-Selpa failure", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /const isSelpa = \/셀파\/i\.test\(head\)/);
  assert.match(source, /ignoredSelpaFailures/);
  assert.match(source, /const nonIgnoredFailure = parsed\.some\(\(row\) => !row\.isSelpa && row\.failure\)/);
  assert.match(source, /hasSuccess && !nonIgnoredFailure/);
  assert.match(source, /shopling_submit_result_has_nonselfa_failure/);
});

test("v0.3.4 source overlay describes simultaneous channel windows", async () => {
  const source = await readFile(overlayPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /DISPLAY_VERSION = "0\.3\.4"/);
  assert.match(source, /남은 채널별 A18 복제창 동시 생성/);
});

test("server claim keeps v030 compatibility while requiring visible A18 identity", async () => {
  const claim = await readFile(claimRoutePath, "utf8");
  const release = await readFile(releaseRoutePath, "utf8");
  assert.match(claim, /canary-group-v0\(\?:21\|30\)/);
  assert.match(claim, /group_canary_visible_goods_keys_required/);
  assert.match(claim, /\.in\("goods_key", requestedVisibleGoodsKeys\)/);
  assert.match(claim, /anchoredToVisibleA18: true/);
  assert.doesNotMatch(claim, /recentPartial/);
  assert.match(release, /\.is\("submit_armed_at", null\)/);
  assert.match(release, /status: "queued"/);
});

test("v0.3.7 download keeps click-safe popup-only control", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /const BASE_VERSION = "0\.3\.4"/);
  assert.match(source, /const VERSION = "0\.3\.7"/);
  assert.match(source, /commerceOsShoplingParallelWorkerMetaV037/);
  assert.match(source, /commerceOsShoplingParallelRunV037/);
  assert.match(source, /commerceOsShoplingParallelWorkerV037/);
  assert.match(source, /extension-action-only-no-shopling-dom/);
  assert.match(source, /default_popup: "popup\.html"/);
  assert.match(source, /chrome\.tabs\.sendMessage/);
  assert.match(source, /a18_navigation_timeout/);
  assert.match(source, /\["worker_opening", "await_a18"\]/);
  assert.match(source, /repeat_a18_click_gate_present/);
  assert.doesNotMatch(source, /pointer-events:auto!important/);
});

test("v0.3.7 recognizes actual Shopling tsrmt result container and child result frames", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /prod_rgst_\(\?:rspt\|tsrmt\)/);
  assert.match(source, /function isMallResultFrame/);
  assert.match(source, /expectedMallResultFrames/);
  assert.match(source, /commerceOsShoplingParallelResultV037/);
  assert.match(source, /collectedMallEvidence/);
  assert.match(source, /allFramesSettled/);
  assert.match(source, /frameHasSuccess/);
  assert.match(source, /nonIgnoredFrameFailure/);
  assert.match(source, /shopling_submit_success_parallel_worker_v037/);
  assert.equal(
    source.match(/\.replace\(\/\\r\\n\/g, "\\n"\)/g)?.length,
    2,
  );
  assert.match(source, /RESULT_SETTLE_MS = 2500/);
});

test("v0.3.7 does not finalize from a partial child-frame success", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /const allFramesSettled = expectedFrames > 0 && frames\.length >= expectedFrames/);
  assert.match(source, /if \(!directDefinitive && expectedFrames > 0 && !allFramesSettled\)/);
  assert.match(source, /const hasSuccess = direct\.success \|\| \(allFramesSettled && frameHasSuccess\)/);
  assert.match(source, /const hasFailure = direct\.failure \|\| \(allFramesSettled && nonIgnoredFrameFailure\)/);
});

test("v0.3.7 download syntax-checks exact generated runtime", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /new Function\(source\)/);
  assert.match(source, /assertScript\("content-group-canary-v037"/);
  assert.match(source, /assertScript\("popup-v037"/);
  assert.match(source, /zipSync\(entries, \{ level: 0 \}\)/);
});
