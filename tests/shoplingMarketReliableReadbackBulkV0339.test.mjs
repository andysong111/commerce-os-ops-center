import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildReliableReadbackBulkV0339 } from "../src/lib/shoplingMarketReliableReadbackBulkV0339.ts";

function fixture() {
  return {
    "manifest.json": JSON.stringify({ manifest_version: 3, version: "0.3.38", description: "old", action: { default_title: "old" } }),
    "background-root.mjs": `
const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/status";
const DIRECT_RESULT_RETRY_MS = 1400;
const DIRECT_RESULT_MAX_ATTEMPTS = 45;
function text(v){return String(v||"")}
function normalizeResultFrameEvidence(v){return v}
async function storeResultFrameEvidence(sender, rawEvidence) {
  const evidence = normalizeResultFrameEvidence(rawEvidence);
  const operation = Promise.resolve({ok:true});
  void operation.then(() => scheduleDirectResultReconcile(sender.tab.id, 650)).catch(() => null);
  return operation;
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isShoplingResultUrl(tab?.url)) return;
  void getWorkerMeta().then((meta) => {
    if (!meta || globalThis.ShoplingRecoveryV0338.isDiagnostic(meta.runId) || !findAssignment(meta, { tab }, true)) return;
    void injectResultRuntime(tabId); scheduleDirectResultReconcile(tabId, 900);
  });
});

// No recovery of unrelated/pre-existing result tabs on extension startup.
`,
    "content-group-canary.mjs": `(() => {
  function text(v){return String(v||"")}
  function selectedJobIds(raw) {
    return [...new Set((Array.isArray(raw) ? raw : [])
      .map((value) => text(value))
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 20);
  }
})();`,
    "popup.js": `
function selectedJobIds(){return []}
function diagnosticMode(){return false}
let diagnosticRunning=false, queueRunning=false, items=[];
const startButton={disabled:false,textContent:""};
function updateStartButton() {
  const count = selectedJobIds().length;
  startButton.disabled = diagnosticMode() || diagnosticRunning || queueRunning || count !== 1;
  if (!diagnosticMode()) startButton.textContent = count === 1 ? "선택 1상품 실전 Canary 시작" : "실전 Canary는 1상품만 선택";
}
startButton.addEventListener("click", async function () {
  const jobIds = selectedJobIds();
  if (jobIds.length !== 1 || diagnosticMode() || diagnosticRunning || queueRunning) return;
});
chrome.storage.onChanged.addListener(function (changes, area) {});
`,
    "popup.html": `<h1>Shopling Market Sender v0.3.38</h1><div>Commerce OS SEO 대량등록 → Shopling 업로드 완료 목록에서 직접 선택합니다. A18 화면에 보이는 상품은 대상 선정에 사용하지 않습니다.</div>`,
    "recovery.mjs": `globalThis.ShoplingRecoveryV0338={};`,
    "README.txt": "old",
    "VERSION.txt": "0.3.38",
  };
}

test("v0.3.39 package enables server-coupled positive readback and bounded bulk", () => {
  const out = buildReliableReadbackBulkV0339(fixture());
  assert.equal(JSON.parse(out["manifest.json"]).version, "0.3.39");
  assert.match(out["background-root.mjs"], /\/v0339\/status/);
  assert.match(out["background-root.mjs"], /reconcilePositivePushedEvidenceV0339/);
  assert.match(out["background-root.mjs"], /shopling_result_frame_push_success_v0339/);
  assert.match(out["background-root.mjs"], /DIRECT_RESULT_MAX_ATTEMPTS = 240/);
  const updatedListener = out["background-root.mjs"].split("chrome.tabs.onUpdated.addListener", 2)[1].split("// No recovery", 1)[0];
  assert.doesNotMatch(updatedListener, /findAssignment/);
  assert.match(out["content-group-canary.mjs"], /slice\(0, 100\)/);
  assert.match(out["popup.js"], /안전 대량전송 시작/);
  assert.match(out["popup.js"], /startWithA18Recovery\(tab, jobIds\)/);
  assert.doesNotMatch(out["popup.js"], /jobIds\.length !== 1/);
});

test("post-submit timeout is held, never reopened as plain pending", () => {
  const source = fs.readFileSync(new URL("../src/app/api/shopling-market-group-canary/v0339/status/route.ts", import.meta.url), "utf8");
  const section = source.split("const postSubmitHold =", 2)[1].split("if (postSubmitHold.error)", 1)[0];
  assert.match(section, /status: "confirm_needed"/);
  assert.match(section, /market_status: "confirm_needed"/);
  assert.match(section, /submit_result_timeout_confirm_needed_v0339/);
  assert.doesNotMatch(section, /submit_armed_at:\s*null/);
  assert.doesNotMatch(section, /claim_run_id:\s*""/);
  assert.doesNotMatch(section, /claimed_at:\s*null/);
});

test("pre-submit watchdog still releases only rows with no submit_armed evidence", () => {
  const source = fs.readFileSync(new URL("../src/app/api/shopling-market-group-canary/v0339/status/route.ts", import.meta.url), "utf8");
  const section = source.split("const stalePreSubmitRecovery =", 2)[1].split("if (stalePreSubmitRecovery.error)", 1)[0];
  assert.match(section, /status: "queued"/);
  assert.match(section, /market_status: "pending"/);
  assert.match(section, /\.is\("submit_armed_at", null\)/);
});
