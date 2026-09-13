function replaceOne(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2) throw new Error("v0337 patch anchor missing/ambiguous: " + anchor.slice(0, 70));
  return source.replace(anchor, replacement);
}
function section(source: string, start: string, end: string, replacement: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + start.length) >= 0) throw new Error("v0337 section anchor missing/ambiguous");
  return source.slice(0, a) + replacement + source.slice(b);
}
export function buildRecoveryV0337(input: Record<string, string>, assets: Record<string, string>) {
  const { preprod: PREPROD, background: BACKGROUND_EXTRA, popup: POPUP_EXTRA, recovery: recoveryScript } = assets;
  const output = { ...input };
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "popup.html"]) {
    output[name] = output[name].replaceAll("0.3.36", "0.3.37").replaceAll("V0336", "V0337").replaceAll("v0336", "v0337");
  }
  let content = output["content-group-canary.mjs"];
  content = section(content, "  async function drivePreProd(state) {", "  async function checkSubmitOutcome(state) {", PREPROD);
  content = replaceOne(content, '  async function reportTask(state, outcome, reasonCode, message) {',
    '  async function reportTask(state, outcome, reasonCode, message) {\n    if (globalThis.ShoplingRecoveryV0337.isDiagnostic(state.runId)) {\n      await patchWorkerState(state, { diagnosticOutcome: outcome, diagnosticReason: reasonCode, diagnosticMessage: message });\n      return { ok: true, diagnosticOnly: true, serverWrites: 0 };\n    }');
  content = replaceOne(content, '  async function drive() {',
    '  async function drive() {\n    if ((await storageGet("commerceOsShoplingStopV0337"))["commerceOsShoplingStopV0337"]) return;');
  content = replaceOne(content, '  async function selectedCoordinatorTick() {',
    '  async function selectedCoordinatorTick() {\n    if ((await storageGet("commerceOsShoplingStopV0337"))["commerceOsShoplingStopV0337"]) return;');
  content = replaceOne(content, '      queue = await saveSelectionQueue({ ...queue, launchedJobIds: [...launched]',
    '      if ((await storageGet("commerceOsShoplingStopV0337"))["commerceOsShoplingStopV0337"]) return;\n      queue = await saveSelectionQueue({ ...queue, launchedJobIds: [...launched]');
  // A failed channel exhausting the retry budget must become a terminal exception, not 0/1 forever.
  content = replaceOne(content, '          launched.delete(jobId); delete jobTasks[jobId];\n        }',
    '          launched.delete(jobId); delete jobTasks[jobId];\n        } else if (!localBusy && Number(summary.busyCount || 0) === 0 && Number(claimAttempts[jobId] || 0) >= 2) {\n          results.push(selectedRunResultForJob(jobId, summary, "송신 전 재시도 한도 종료 · 예외 확인 필요")); doneJobs.add(jobId);\n        }');
  content = replaceOne(content, '  async function completeTask(state, outcome, reasonCode, message) {',
    '  async function completeTask(state, outcome, reasonCode, message) {\n    if (globalThis.ShoplingRecoveryV0337.isDiagnostic(state.runId)) {\n      const notProven = outcome === "already_registered";\n      await patchWorkerState(state, { status: "completed", stage: "diagnostic_finished", outcome: notProven ? "diagnostic_registration_unknown" : outcome, reasonCode, message: notProven ? "그룹 미등록 검색 0건 · 과거 계정별 등록완료를 확정한 것은 아님 · 송신 없음" : message, finishedAt: Date.now() });\n      await closeCurrentWorker(state, true); return;\n    }');
  content = replaceOne(content, '  async function failTask(state, reasonCode, message) {',
    '  async function failTask(state, reasonCode, message) {\n    if (globalThis.ShoplingRecoveryV0337.isDiagnostic(state.runId)) {\n      await patchWorkerState(state, { status: "failed", stage: "diagnostic_failed", reasonCode, message: message + " · 설정검사 종료, 실제 송신/원장 변경 없음", finishedAt: Date.now() });\n      await closeCurrentWorker(state, true); return;\n    }');
  output["content-group-canary.mjs"] = content;
  let background = output["background-root.mjs"];
  background = replaceOne(background, "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/claim-all", "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/v0337/claim");
  background = 'importScripts("recovery.mjs");\n' + background;
  background = replaceOne(background, 'async function requestJson(endpoint, payload) {',
    'async function requestJson(endpoint, payload) {\n  if (globalThis.ShoplingRecoveryV0337.isDiagnostic(payload?.runId)) return { ok: false, error: "diagnostic_server_mutation_blocked" };');
  background = replaceOne(background, '  if (message.type === ARM_MESSAGE) {',
    '  if (message.type === ARM_MESSAGE && globalThis.ShoplingRecoveryV0337.isDiagnostic(runId)) { sendResponse({ ok: false, error: "diagnostic_arm_forbidden" }); return false; }\n  if (message.type === ARM_MESSAGE) {');
  background = replaceOne(background, '      return api({ action: "arm-submit", runId, goodsKey });',
    '      return marketAutoStorageGet("commerceOsShoplingStopV0337").then((stored) => stored["commerceOsShoplingStopV0337"] ? { ok: false, error: "operator_stopped" } : api({ action: "arm-submit", runId, goodsKey }));');
  // Stop auto handoff in this manual period/recovery release; no unattended task may start.
  background = replaceOne(background, '  if (message.type === MARKET_AUTO_BG_HANDOFF) {',
    '  if ([MARKET_AUTO_BG_HANDOFF, MARKET_AUTO_BG_TICK, MARKET_AUTO_BG_HEARTBEAT, MARKET_AUTO_BG_REPORT].includes(message.type)) { sendResponse({ ok: false, error: "v0337_manual_period_only" }); return false; }\n  if (message.type === MARKET_AUTO_BG_HANDOFF) {');
  background = section(background, 'void chrome.tabs.query({}).then((tabs) => {', 'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {', '// No recovery of unrelated/pre-existing result tabs on extension startup.\n\n');
  background = replaceOne(background, '  void injectResultRuntime(tabId);\n  scheduleDirectResultReconcile(tabId, 900);',
    '  void getWorkerMeta().then((meta) => {\n    if (!meta || globalThis.ShoplingRecoveryV0337.isDiagnostic(meta.runId) || !findAssignment(meta, { tab }, true)) return;\n    void injectResultRuntime(tabId); scheduleDirectResultReconcile(tabId, 900);\n  });');
  output["background-root.mjs"] = background + BACKGROUND_EXTRA;
  let popup = output["popup.js"];
  popup = replaceOne(popup, '  startButton.disabled = queueRunning || count === 0;',
    '  startButton.disabled = diagnosticMode() || diagnosticRunning || queueRunning || count === 0;\n  diagnosticButton.disabled = !diagnosticMode() || queueRunning || diagnosticRunning || count !== 1;');
  popup = replaceOne(popup, 'function renderItems() {', 'function renderItems() {\n  const kept = new Set(selectedJobIds());');
  popup = replaceOne(popup, '    const disabled = !item.selectable || queueRunning;',
    '    const disabled = !selectionAllowed(item) || queueRunning || diagnosticRunning;');
  popup = replaceOne(popup, "  document.querySelectorAll('input[data-job-id]').forEach(function (node) { node.addEventListener('change', updateStartButton); });", "  document.querySelectorAll('input[data-job-id]').forEach(function (node) { node.checked = kept.has(node.dataset.jobId) && !node.disabled; node.addEventListener('change', updateStartButton); });");
  popup = replaceOne(popup, '  const jobIds = selectedJobIds();\n  if (!jobIds.length) return;',
    '  const jobIds = selectedJobIds();\n  if (!jobIds.length || diagnosticMode() || diagnosticRunning) return;\n  if (!window.confirm("선택한 상품을 실제 마켓에 송신합니다. 확인필요 상품은 제외됩니다. 계속할까요?")) return;\n  await chrome.storage.local.set({ [recovery.constants.stop]: false });');
  popup = replaceOne(popup, '        files: ["content-group-canary.mjs"],', '        files: ["recovery.mjs", "content-group-canary.mjs"],');
  popup = replaceOne(popup, 'migrateLegacyPopupState().then(loadItems).catch(loadItems);', POPUP_EXTRA + '\nmigrateLegacyPopupState().then(loadItems).catch(loadItems);');
  popup = section(popup, "async function migrateLegacyPopupState() {", "async function refreshQueueStatus() {", "async function migrateLegacyPopupState() { return {}; }\n\n");
  output["popup.js"] = popup;
  let html = output["popup.html"];
  html = replaceOne(html, '<div id="status" class="status">상태 확인 중...</div>',
    '<div id="status" class="status">상태 확인 중...</div><label>실행모드 <select id="mode"><option value="diagnostic" selected>송신 없는 설정검사 (기본)</option><option value="send">실제 마켓전송</option></select></label><button id="stopRun" type="button">실행 중단·정리 (전송기록 유지)</button>');
  html = replaceOne(html, '<button id="start"', '<button id="diagnosticStart" type="button" disabled>선택 1상품 · 송신 없이 설정검사</button><div id="diagnosticStatus" class="status"></div><button id="exportDiagnostic" type="button" disabled>검사결과 JSON 저장</button><button id="start"');
  html = html.replace(/<div class="foot">[\s\S]*?<\/div>/, '<div class="foot">설정검사는 마켓 송신·전송기록 변경 없이 실행합니다. 확인필요 상품도 검사만 가능합니다. 과거 송신 여부는 별도 확인하며 자동으로 잠금을 풀지 않습니다. 실제 전송은 저장검색·필수 기본정보를 검증한 뒤에만 허용됩니다.</div>');
  html = replaceOne(html, '<script src="popup.js"></script>', '<script src="recovery.mjs"></script><script src="popup.js"></script>');
  output["popup.html"] = html;
  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.37";
  manifest.description = "연동정보 저장검색과 필수 기본정보를 검증합니다. 기본은 송신 없는 설정검사이며 중단 시 서버 전송기록과 확인필요 잠금을 유지합니다.";
  manifest.content_scripts = [manifest.content_scripts[0]];
  manifest.content_scripts[0].js = ["recovery.mjs", "content-group-canary.mjs"];
  manifest.action.default_title = "Shopling Market Sender · 안전검사 및 기간전송";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["recovery.mjs"] = recoveryScript;
  output["VERSION.txt"] = "Shopling Market Sender v0.3.37\nDefault: no-submit diagnostics. Server holds are never released by diagnostics.\n";
  output["README.txt"] = "v0.3.37\n1. Disable older market sender extensions and close their worker windows.\n2. Select the Shopling upload period and ONE product in diagnostic mode.\n3. Run no-submit settings check, then export diagnostic JSON.\n4. This is not proof of past non-submission. Held records require per-market review.\n5. Actual sending requires explicit mode selection and confirmation. Saved profiles and required basic templates must exist; arbitrary first/free-shipping selection is prohibited.\n6. Stop archives local state without changing server sent/armed/confirm-needed records.\n";
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "recovery.mjs"]) new Function(output[name]);
  return output;
}
