import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.3.4";
const VERSION = "0.3.7";
const CONTROL_START_MESSAGE = "commerce-os-shopling-parallel-control-start-v037";

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_parallel_worker_${name}_invalid: ${message}`);
  }
}

function replaceOnce(source: string, anchor: string, replacement: string, errorCode: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(errorCode);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${errorCode}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function replaceBetween(source: string, start: string, end: string, replacement: string, errorCode: string) {
  const startAt = source.indexOf(start);
  if (startAt < 0) throw new Error(`${errorCode}_start_missing`);
  const endAt = source.indexOf(end, startAt + start.length);
  if (endAt < 0) throw new Error(`${errorCode}_end_missing`);
  return `${source.slice(0, startAt)}${replacement}${source.slice(endAt)}`;
}

function rewriteBackground(source: string) {
  const rewritten = replaceOnce(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV034";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV037";',
    "shopling_parallel_worker_v037_background_state_anchor_missing",
  );
  assertScript("background-root-v037", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = source;
  rewritten = replaceOnce(rewritten, 'const VERSION = "0.3.4";', 'const VERSION = "0.3.7";', "shopling_parallel_worker_v037_content_version_anchor_missing");
  rewritten = replaceOnce(rewritten, 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV034";', 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV037";', "shopling_parallel_worker_v037_run_state_anchor_missing");
  rewritten = replaceOnce(rewritten, 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV034";', 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV037";', "shopling_parallel_worker_v037_worker_state_anchor_missing");
  rewritten = replaceOnce(
    rewritten,
    '  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";',
    `  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";\n  const CONTROL_START_MESSAGE = "${CONTROL_START_MESSAGE}";\n  const CONTROL_UI_MODE = "extension-action-only-no-shopling-dom";`,
    "shopling_parallel_worker_v037_control_message_anchor_missing",
  );
  rewritten = replaceOnce(rewritten, "  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;", "  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;\n  const A18_NAVIGATION_TIMEOUT_MS = 20000;\n  const RESULT_SETTLE_MS = 2500;", "shopling_parallel_worker_v037_a18_timeout_anchor_missing");
  rewritten = replaceOnce(rewritten, '    if (!["worker_opening", "await_a18", "a18_clicked"].includes(state.stage)) return;', '    if (!["worker_opening", "await_a18"].includes(state.stage)) return;', "shopling_parallel_worker_v037_repeat_a18_gate_anchor_missing");

  rewritten = replaceOnce(
    rewritten,
    `  function isSubmitResultPage() {\n    return /\\/prod_a\\/prod_rgst_rspt\\.phtml$/i.test(location.pathname)\n      && /shopling\\.co\\.kr$/i.test(location.hostname);\n  }`,
    `  function isSubmitResultPage() {\n    return /\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i.test(location.pathname)\n      && /shopling\\.co\\.kr$/i.test(location.hostname);\n  }\n\n  function isMallResultFrame() {\n    return /\\/prod\\/rgst\\/[^/]+_rgst\\.phtml$/i.test(location.pathname)\n      && /shopling\\.co\\.kr$/i.test(location.hostname);\n  }\n\n  function expectedMallResultFrames() {\n    if (!isSubmitResultPage()) return 0;\n    return [...document.querySelectorAll(\"iframe[src], frame[src]\")].filter((frame) => {\n      const src = String(frame.getAttribute(\"src\") || \"\");\n      return /\\/prod\\/rgst\\/[^/?#]+_rgst\\.phtml/i.test(src);\n    }).length;\n  }\n\n  function resultEvidenceKey(runId, goodsKey, frameId) {\n    return \`commerceOsShoplingParallelResultV037:\${runId}:\${goodsKey}:\${frameId}\`;\n  }\n\n  async function storeMallResultEvidence(state) {\n    if (!isMallResultFrame()) return false;\n    const body = bodyText();\n    if (!/성공건수|실패건수|성공여부|상품 등록 전송 결과/i.test(body)) return false;\n    const successCount = countFrom(body, /성공건수\\s*[:：]?\\s*([\\d,]+)/i);\n    const failureCount = countFrom(body, /실패건수\\s*[:：]?\\s*([\\d,]+)/i);\n    const success = successCount > 0 || /성공여부\\s*성공/i.test(body);\n    const failure = failureCount > 0 || /성공여부\\s*실패/i.test(body);\n    const isSelpa = /셀파/i.test(body);\n    const frameId = encodeURIComponent([location.hostname, location.pathname, location.search].join(\"|\")).slice(0, 500);\n    await storageSet({\n      [resultEvidenceKey(state.runId, state.task.goodsKey, frameId)]: {\n        runId: state.runId,\n        goodsKey: state.task.goodsKey,\n        frameId,\n        isSelpa,\n        success,\n        failure,\n        successCount,\n        failureCount,\n        capturedAt: Date.now(),\n      },\n    });\n    return true;\n  }\n\n  async function collectedMallEvidence(state) {\n    const all = await storageGet(null);\n    const prefix = \`commerceOsShoplingParallelResultV037:\${state.runId}:\${state.task.goodsKey}:\`;\n    return Object.keys(all)\n      .filter((key) => key.startsWith(prefix))\n      .map((key) => all[key])\n      .filter(Boolean);\n  }`,
    "shopling_parallel_worker_v037_result_page_anchor_missing",
  );

  const driveAnchor = `      if (isIdChoicePage()) { await driveIdChoice(state); return; }\n      if (isPreProdChoicePage()) { await drivePreProd(state); return; }\n      if (isProductListUi()) { await driveProductList(state); return; }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`;
  const driveReplacement = `      if (isMallResultFrame()) {\n        await storeMallResultEvidence(state);\n        return;\n      }\n      if (isIdChoicePage()) { await driveIdChoice(state); return; }\n      if (isPreProdChoicePage()) { await drivePreProd(state); return; }\n      if (isProductListUi()) { await driveProductList(state); return; }\n      if (state.stage === "a18_clicked") {\n        const age = Date.now() - Number(state.stepAt || 0);\n        if (age >= A18_NAVIGATION_TIMEOUT_MS) {\n          await failTask(state, "a18_navigation_timeout", "A18 진입 클릭 후 상품등록 화면을 확인하지 못했습니다. 메뉴를 반복 클릭하지 않고 이 채널만 안전중단했습니다.");\n        }\n        return;\n      }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`;
  rewritten = replaceOnce(rewritten, driveAnchor, driveReplacement, "shopling_parallel_worker_v037_drive_wait_anchor_missing");

  rewritten = replaceOnce(
    rewritten,
    `  async function checkSubmitOutcome(state) {\n    if (state.stage !== "submit_clicked" || !isSubmitResultPage()) return;\n    const task = state.task;\n    const evidence = submitEvidence();\n    if (evidence.success) {\n      const ignored = evidence.ignoredSelpaFailures > 0\n        ? \` · 셀파 실패 \${evidence.ignoredSelpaFailures}건은 운영정책상 무시\`\n        : "";\n      await completeTask(\n        state,\n        "sent",\n        "shopling_submit_success_parallel_worker",\n        \`\${task.profile} 실제 Shopling 결과 화면에서 비셀파 성공을 확인했습니다\${ignored}.\`,\n      );\n      return;\n    }\n    if (evidence.failure) {\n      await failTask(state, "shopling_submit_result_has_nonselfa_failure", \`\${task.profile} 송신 결과에 셀파 외 실패가 있어 이 채널만 확인필요로 보존합니다.\`);\n      return;\n    }\n    const age = Date.now() - Number(state.submitClickedAt || 0);\n    if (!evidence.processing && age >= SUBMIT_CONFIRM_TIMEOUT_MS) {\n      await failTask(state, "submit_result_requires_manual_check", \`\${task.profile} 실제 결과 페이지에서 \${SUBMIT_CONFIRM_TIMEOUT_MS / 1000}초 동안 확정 성공결과를 확인하지 못했습니다.\`);\n    }\n  }`,
    `  async function checkSubmitOutcome(state) {\n    if (state.stage !== "submit_clicked" || !isSubmitResultPage()) return;\n    const task = state.task;\n    const age = Date.now() - Number(state.submitClickedAt || 0);\n    if (age < RESULT_SETTLE_MS) return;\n\n    const direct = submitEvidence();\n    const frames = await collectedMallEvidence(state);\n    const expectedFrames = expectedMallResultFrames();\n    const allFramesSettled = expectedFrames > 0 && frames.length >= expectedFrames;\n    const frameHasSuccess = frames.some((row) => row && row.success === true);\n    const ignoredSelpaFailures = frames.filter((row) => row && row.isSelpa === true && row.failure === true).length;\n    const nonIgnoredFrameFailure = frames.some((row) => row && row.isSelpa !== true && row.failure === true);\n    const directDefinitive = direct.success || direct.failure;\n\n    if (!directDefinitive && expectedFrames > 0 && !allFramesSettled) {\n      if (age < SUBMIT_CONFIRM_TIMEOUT_MS) return;\n    }\n\n    const hasSuccess = direct.success || (allFramesSettled && frameHasSuccess);\n    const hasFailure = direct.failure || (allFramesSettled && nonIgnoredFrameFailure);\n\n    if (hasFailure) {\n      await failTask(state, "shopling_submit_result_has_nonselfa_failure", \`\${task.profile} 송신 결과에 셀파 외 실패가 있어 이 채널만 확인필요로 보존합니다.\`);\n      return;\n    }\n    if (hasSuccess) {\n      const ignored = Math.max(Number(direct.ignoredSelpaFailures || 0), ignoredSelpaFailures) > 0\n        ? \` · 셀파 실패 \${Math.max(Number(direct.ignoredSelpaFailures || 0), ignoredSelpaFailures)}건은 운영정책상 무시\`\n        : "";\n      await completeTask(\n        state,\n        "sent",\n        "shopling_submit_success_parallel_worker_v037",\n        \`\${task.profile} 실제 Shopling 결과창/쇼핑몰별 결과 프레임에서 비셀파 성공을 확인했습니다\${ignored}.\`,\n      );\n      return;\n    }\n    if (!direct.processing && age >= SUBMIT_CONFIRM_TIMEOUT_MS) {\n      await failTask(state, "submit_result_requires_manual_check", \`\${task.profile} 결과 프레임 \${frames.length}/\${expectedFrames || "?"}개 확인 후에도 \${SUBMIT_CONFIRM_TIMEOUT_MS / 1000}초 동안 확정 결과를 만들지 못했습니다.\`);\n    }\n  }`,
    "shopling_parallel_worker_v037_submit_outcome_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      if (state.stage === "submit_clicked") {\n        if (isSubmitResultPage()) await checkSubmitOutcome(state);\n        return;\n      }`,
    `      if (state.stage === "submit_clicked") {\n        if (isMallResultFrame()) {\n          await storeMallResultEvidence(state);\n          return;\n        }\n        if (isSubmitResultPage()) await checkSubmitOutcome(state);\n        return;\n      }`,
    "shopling_parallel_worker_v037_submit_frame_drive_anchor_missing",
  );

  rewritten = replaceBetween(
    rewritten,
    "  function mount() {",
    "\n  chrome.storage.onChanged.addListener",
    `  function mount() {\n    return CONTROL_UI_MODE;\n  }\n`,
    "shopling_parallel_worker_v037_mount_block",
  );

  const startupAnchor = `  mount();\n  const observer = new MutationObserver(() => mount());\n  observer.observe(document.documentElement, { childList: true, subtree: true });\n  timer = setInterval(() => void drive(), 800);\n  panelTimer = setInterval(() => void refreshPanel(), 1200);\n  void drive();`;
  const startupReplacement = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {\n    if (!message || message.type !== CONTROL_START_MESSAGE || !isProductListUi()) return false;\n    startParallelCanary()\n      .then(() => sendResponse({ ok: true, version: VERSION }))\n      .catch((error) => sendResponse({ ok: false, error: "parallel_control_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));\n    return true;\n  });\n\n  timer = setInterval(() => void drive(), 800);\n  panelTimer = null;\n  void drive();`;
  rewritten = replaceOnce(rewritten, startupAnchor, startupReplacement, "shopling_parallel_worker_v037_popup_startup_anchor_missing");

  assertScript("content-group-canary-v037", rewritten);
  return rewritten;
}

const POPUP_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shopling Parallel Worker</title>
<style>
body{width:360px;margin:0;padding:14px;font:13px/1.45 Arial,sans-serif;color:#0f172a;background:#fff;box-sizing:border-box}
h1{font-size:14px;margin:0 0 6px;color:#0f766e}p{margin:0 0 10px;color:#64748b}#status{padding:9px;border:1px solid #dbeafe;border-radius:8px;background:#f8fafc;margin-bottom:10px}button{width:100%;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:default}.guard{font-size:11px;color:#64748b;margin-top:9px}
</style>
</head>
<body>
<h1>Parallel Fresh Worker v0.3.7</h1>
<p>A18 화면에는 어떤 패널도 올리지 않습니다. 실제 Shopling 결과창의 모든 쇼핑몰 결과가 끝난 뒤 성공/실패를 자동 확정합니다.</p>
<div id="status">상태 확인 중...</div>
<button id="start" type="button">남은 채널 병렬 처리 시작</button>
<div class="guard">goods_key + 자사상품코드 이중일치 · 채널별 독립잠금 · 전체 결과 확인 후 판정 · A18 진입 1회</div>
<script src="popup.js"></script>
</body>
</html>
`;

const POPUP_JS = `"use strict";
const VERSION = "0.3.7";
const START_MESSAGE = "${CONTROL_START_MESSAGE}";
const RUN_STATE_KEY = "commerceOsShoplingParallelRunV037";
const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV037:";
const statusNode = document.getElementById("status");
const startButton = document.getElementById("start");

function text(value) { return String(value == null ? "" : value).replace(/\\s+/g, " ").trim(); }

async function activeShoplingTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !Number.isInteger(tab.id) || !/^https?:\\/\\/a\\.shopling\\.co\\.kr\\//i.test(String(tab.url || ""))) return null;
  return tab;
}

async function refresh() {
  const all = await chrome.storage.local.get(null);
  const run = all[RUN_STATE_KEY] || null;
  if (!run) {
    statusNode.textContent = "v" + VERSION + " · 새 실행 준비";
    startButton.disabled = false;
    return;
  }
  const states = Object.keys(all).filter(function (key) { return key.indexOf(WORKER_STATE_PREFIX + run.runId + ":") === 0; }).map(function (key) { return all[key]; }).filter(Boolean);
  const running = states.filter(function (row) { return row.status === "running"; }).length;
  const sent = states.filter(function (row) { return row.status === "completed" && row.outcome === "sent"; }).length;
  const skipped = states.filter(function (row) { return row.status === "completed" && row.outcome === "already_registered"; }).length;
  const failed = states.filter(function (row) { return row.status === "failed"; }).length;
  const confirm = states.filter(function (row) { return row.status === "confirm_needed"; }).length;
  statusNode.textContent = "v" + VERSION + " · " + text(run.status) + " · 실행 " + running + " · 성공 " + sent + " · 이미등록 " + skipped + " · 실패 " + failed + " · 확인필요 " + confirm;
  startButton.disabled = run.status === "opening" || run.status === "running" || run.status === "confirm_needed";
}

startButton.addEventListener("click", async function () {
  startButton.disabled = true;
  statusNode.textContent = "현재 A18 탭 확인 중...";
  const tab = await activeShoplingTab();
  if (!tab) {
    statusNode.textContent = "Shopling 관리자 A18 탭을 먼저 활성화하세요.";
    startButton.disabled = false;
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: START_MESSAGE }, function (response) {
    const lastError = chrome.runtime.lastError;
    if (lastError || !response || response.ok !== true) {
      statusNode.textContent = "A18 상품등록 화면을 찾지 못했습니다. A18 화면을 새로고침한 뒤 다시 누르세요.";
      startButton.disabled = false;
      return;
    }
    statusNode.textContent = "병렬 Worker 시작 신호를 전달했습니다.";
    setTimeout(refresh, 300);
  });
});

chrome.storage.onChanged.addListener(function () { refresh(); });
refresh();
`;

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};
  const manifestSource = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource) as { version?: string; description?: string; permissions?: string[]; content_scripts?: Array<{ js?: string[] }>; action?: Record<string, string> };
  if (manifest.version !== BASE_VERSION) throw new Error("shopling_parallel_worker_base_manifest_version_mismatch");
  if (manifest.permissions?.includes("contentSettings")) throw new Error("shopling_parallel_worker_obsolete_popup_permission_present");
  if (manifest.permissions?.includes("scripting")) throw new Error("shopling_parallel_worker_obsolete_launcher_script_permission_present");

  manifest.version = VERSION;
  manifest.description = "Shopling A18 DOM에는 제어 UI를 삽입하지 않고, 실제 prod_rgst_tsrmt 결과창의 모든 쇼핑몰별 결과 프레임이 끝난 뒤 자동 판정하는 병렬 등록 버전입니다.";
  manifest.action = { default_title: "Commerce OS Shopling Parallel Worker", default_popup: "popup.html" };
  manifest.content_scripts = (manifest.content_scripts || []).map((entry) => ({ ...entry, js: ["content-group-canary.mjs"] }));
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const backgroundSource = (await readFile(
    path.join(root, "background-root.mjs"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const contentSource = (await readFile(
    path.join(root, "content-group-canary.mjs"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  entries["background-root.mjs"] = strToU8(rewriteBackground(backgroundSource));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(contentSource));
  entries["popup.html"] = strToU8(POPUP_HTML);
  entries["popup.js"] = strToU8(POPUP_JS);

  const background = new TextDecoder().decode(entries["background-root.mjs"]);
  const content = new TextDecoder().decode(entries["content-group-canary.mjs"]);
  const popup = new TextDecoder().decode(entries["popup.js"]);
  if (!background.includes("chrome.tabs.duplicate")) throw new Error("shopling_parallel_worker_a18_duplicate_missing");
  if (!background.includes("Promise.allSettled")) throw new Error("shopling_parallel_worker_parallel_clone_missing");
  if (!background.includes("commerceOsShoplingParallelWorkerMetaV037")) throw new Error("shopling_parallel_worker_v037_background_state_isolation_missing");
  if (!background.includes("parallel: true")) throw new Error("shopling_parallel_worker_parallel_contract_missing");
  if (background.includes("clickManagerAccessOnLauncher")) throw new Error("shopling_parallel_worker_obsolete_manager_launcher_present");
  if (!background.includes("group-canary-release-v0.3.2")) throw new Error("shopling_parallel_worker_claim_release_missing");
  if (!content.includes("commerceOsShoplingParallelWorkerV037")) throw new Error("shopling_parallel_worker_v037_state_isolation_missing");
  if (!content.includes("commerceOsShoplingParallelRunV037")) throw new Error("shopling_parallel_worker_v037_run_isolation_missing");
  if (!content.includes("extension-action-only-no-shopling-dom")) throw new Error("shopling_parallel_worker_v037_no_dom_mode_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("shopling_parallel_worker_v037_shopling_dom_panel_present");
  if (!content.includes(CONTROL_START_MESSAGE)) throw new Error("shopling_parallel_worker_v037_control_listener_missing");
  if (!content.includes("prod_rgst_(?:rspt|tsrmt)")) throw new Error("shopling_parallel_worker_v037_tsrmt_result_missing");
  if (!content.includes("isMallResultFrame")) throw new Error("shopling_parallel_worker_v037_mall_frame_missing");
  if (!content.includes("expectedMallResultFrames")) throw new Error("shopling_parallel_worker_v037_expected_frames_missing");
  if (!content.includes("allFramesSettled")) throw new Error("shopling_parallel_worker_v037_all_frames_gate_missing");
  if (!content.includes("collectedMallEvidence")) throw new Error("shopling_parallel_worker_v037_frame_aggregation_missing");
  if (!content.includes("shopling_submit_success_parallel_worker_v037")) throw new Error("shopling_parallel_worker_v037_success_contract_missing");
  if (content.includes('if (!["worker_opening", "await_a18", "a18_clicked"].includes(state.stage))')) throw new Error("shopling_parallel_worker_repeat_a18_click_gate_present");
  if (!content.includes("a18_navigation_timeout")) throw new Error("shopling_parallel_worker_a18_one_shot_timeout_missing");
  if (!content.includes("ignoredSelpaFailures")) throw new Error("shopling_parallel_worker_selfa_policy_missing");
  if (!content.includes("nonIgnoredFailure")) throw new Error("shopling_parallel_worker_nonselfa_failure_guard_missing");
  if (!popup.includes("chrome.tabs.sendMessage")) throw new Error("shopling_parallel_worker_v037_popup_send_missing");
  if (!popup.includes(CONTROL_START_MESSAGE)) throw new Error("shopling_parallel_worker_v037_popup_contract_missing");
  assertScript("popup-v037", popup);

  const readme = await readFile(path.join(root, "README.txt"), "utf8");
  entries["README.txt"] = strToU8(`v${VERSION} RESULT-AWARE HOTFIX\n- Shopling A18 페이지에는 제어 패널/버튼/오버레이를 삽입하지 않습니다.\n- 실제 prod_rgst_tsrmt 결과 컨테이너와 각 /prod/rgst/*_rgst.phtml 프레임을 함께 판정합니다.\n- 결과 프레임 수만큼 증거가 모두 모이기 전에는 일부 성공만 보고 sent로 확정하지 않습니다.\n- 비셀파 실패가 하나라도 있으면 해당 채널만 confirm_needed, 셀파 단독 실패는 무시합니다.\n- 성공이 확인되면 sent 기록 후 그 복제 Worker 창만 닫습니다.\n- 복제 Worker의 A18 메뉴 hover/click은 최초 1회만 수행합니다.\n\n${readme}`);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Parallel Fresh Worker Canary v${VERSION}\n`);

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-parallel-fresh-worker-canary-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
