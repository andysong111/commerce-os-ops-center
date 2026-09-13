import test from "node:test";
import assert from "node:assert/strict";
import { buildA18FrameStartV0340 } from "../src/lib/shoplingMarketA18FrameStartV0340.ts";

function fixture() {
  return {
    "manifest.json": JSON.stringify({ manifest_version: 3, version: "0.3.39", description: "old", action: { default_title: "old" } }),
    "background-root.mjs": `
const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/v0339/status";
globalThis.ShoplingRecoveryV0339 = {};
`,
    "content-group-canary.mjs": `(() => {
  function isProductListUi(){return true}
  const SELECTED_START_MESSAGE="commerce-os-shopling-selected-market-start-v0339";
  const CONTROL_START_MESSAGE="commerce-os-shopling-parallel-control-start-v0330";
  function startSelectedQueue(){return Promise.resolve({ok:true})}
  function startParallelCanary(){return Promise.resolve()}
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || window.top !== window || !isProductListUi()) return false;
    if (message.type === SELECTED_START_MESSAGE) {
      startSelectedQueue(message.jobIds)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "selected_shopling_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));
      return true;
    }
    if (message.type === CONTROL_START_MESSAGE) {
      startParallelCanary()
        .then(() => sendResponse({ ok: true, version: "0.3.39" }))
        .catch((error) => sendResponse({ ok: false, error: "parallel_control_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));
      return true;
    }
    return false;
  });
})();`,
    "popup.js": `
const START_MESSAGE = "commerce-os-shopling-selected-market-start-v0339";
const statusNode={textContent:""};
function text(value){return String(value==null?"":value).trim()}
function sendStart(tabId, jobIds) {
  return new Promise(function (resolve) {
    chrome.tabs.sendMessage(tabId, { type: START_MESSAGE, jobIds: jobIds }, function (response) {
      const lastError = chrome.runtime.lastError;
      resolve({ ok: !lastError && response && response.ok === true, response: response || null, error: lastError ? String(lastError.message || lastError) : "" });
    });
  });
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
async function waitTabComplete(tabId, timeoutMs) { return true; }
async function startWithA18Recovery(tab, jobIds) {
  const first = await sendStart(tab.id, jobIds);
  if (first.ok) return first;
  statusNode.textContent = "A18 실행기 연결이 없어 자동 새로고침 후 다시 연결 중...";
  await chrome.tabs.reload(tab.id);
  const loaded = await waitTabComplete(tab.id, 12000);
  if (!loaded) return { ok: false, response: null, error: "A18 자동 새로고침이 12초 안에 완료되지 않았습니다." };
  await sleep(700);
  const second = await sendStart(tab.id, jobIds);
  if (second.ok) return second;
  return { ok: false, response: second.response, error: text(second.error || first.error || "A18 실행기 시작 신호 실패") };
}
function selectedJobIds() { return []; }
`,
    "popup.html": `<h1>Shopling Market Sender v0.3.39 · 안전 대량전송</h1><div>최신 SEO 대량등록 중 fresh pending만 선택합니다. 최대 3상품/18채널씩 순차 병렬 처리하고 결과 프레임 성공을 서버 원장에 자동 마감합니다.</div>`,
    "recovery.mjs": `globalThis.ShoplingRecoveryV0339={};`,
    "README.txt": "old",
    "VERSION.txt": "0.3.39",
  };
}

test("v0.3.40 targets the exact A18 frame and never reloads the operator control tab", () => {
  const out = buildA18FrameStartV0340(fixture());
  assert.equal(JSON.parse(out["manifest.json"]).version, "0.3.40");
  assert.match(out["popup.js"], /locateA18ProductFrame/);
  assert.match(out["popup.js"], /target:\s*\{\s*tabId:\s*tabId,\s*allFrames:\s*true\s*\}/);
  assert.match(out["popup.js"], /chrome\.tabs\.sendMessage\(tabId,[\s\S]*\{ frameId: frameId \}/);
  assert.doesNotMatch(out["popup.js"], /chrome\.tabs\.reload\(/);
  assert.match(out["popup.js"], /원본 탭은 자동 새로고침하지 않습니다/);
});

test("embedded A18 frame may consume bulk start while legacy control remains top-frame only", () => {
  const out = buildA18FrameStartV0340(fixture());
  const source = out["content-group-canary.mjs"];
  const selectedIndex = source.indexOf("message.type === SELECTED_START_MESSAGE");
  const topGuardIndex = source.indexOf("if (window.top !== window) return false;");
  const controlIndex = source.indexOf("message.type === CONTROL_START_MESSAGE");
  assert.ok(selectedIndex >= 0 && topGuardIndex > selectedIndex && controlIndex > topGuardIndex);
  assert.doesNotMatch(source, /!message \|\| window\.top !== window \|\| !isProductListUi/);
});

test("v0.3.40 deliberately retains the hardened v0.3.39 status watchdog", () => {
  const out = buildA18FrameStartV0340(fixture());
  assert.match(out["background-root.mjs"], /shopling-market-group-canary\/v0339\/status/);
  assert.doesNotMatch(out["background-root.mjs"], /shopling-market-group-canary\/v0340\/status/);
});
