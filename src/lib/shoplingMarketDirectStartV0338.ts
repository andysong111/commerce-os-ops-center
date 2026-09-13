function replaceOne(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2) throw new Error("v0338 patch anchor missing/ambiguous: " + anchor.slice(0, 90));
  return source.replace(anchor, replacement);
}

function replaceSection(source: string, start: string, end: string, replacement: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + start.length) >= 0) {
    throw new Error("v0338 section anchor missing/ambiguous");
  }
  return source.slice(0, a) + replacement + source.slice(b);
}

function versioned(source: string) {
  return source
    .replaceAll("0.3.37", "0.3.38")
    .replaceAll("V0337", "V0338")
    .replaceAll("v0337", "v0338");
}

export function buildDirectStartV0338(input: Record<string, string>) {
  const output = { ...input };
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "popup.html", "recovery.mjs"]) {
    output[name] = versioned(output[name]);
  }

  let recovery = output["recovery.mjs"];
  recovery = replaceOne(
    recovery,
    '    stopMessage: "commerce-os-shopling-stop-v0338"',
    '    stopMessage: "commerce-os-shopling-stop-v0338",\n    safeSendStartMessage: "commerce-os-shopling-safe-send-start-v0338"',
  );
  output["recovery.mjs"] = recovery;

  let background = output["background-root.mjs"];
  // The hardened server claim endpoint introduced in v0.3.37 remains the authority.
  background = background.replaceAll(
    "/api/shopling-market-group-canary/v0338/claim",
    "/api/shopling-market-group-canary/v0337/claim",
  );
  background += `\n\n// v0.3.38: popup -> background -> hardened server claim -> worker windows.\n` +
`let safeSendMutationV0338 = Promise.resolve();\n` +
`async function startSafeRealSendV0338(message, sender) {\n` +
`  const r = globalThis.ShoplingRecoveryV0338;\n` +
`  if (sender.url !== chrome.runtime.getURL("popup.html")) return { ok: false, error: "safe_send_popup_required" };\n` +
`  const item = message?.item || null;\n` +
`  if (!item || !item.selectable || !item.isLatestBatch || Number(item.uploadSuccessCount || 0) !== 6 || !/^[0-9a-f-]{36}$/i.test(text(item.jobId))) {\n` +
`    return { ok: false, error: "safe_send_item_not_fresh_pending" };\n` +
`  }\n` +
`  const control = await chrome.tabs.get(message.controlTabId).catch(() => null);\n` +
`  if (!control || !isAdminControlUrl(control.url)) return { ok: false, error: "safe_send_a18_control_required" };\n` +
`  const stored = await marketAutoStorageGet([r.constants.queue, r.constants.diagnostic]);\n` +
`  if (stored[r.constants.queue]?.status === "running" || stored[r.constants.diagnostic]?.status === "running") {\n` +
`    return { ok: false, error: "safe_send_existing_run_active", message: "기존 실행을 먼저 중단·정리하세요." };\n` +
`  }\n` +
`  const now = Date.now();\n` +
`  const runId = "canary-group-v030-v0338-" + now + "-" + Math.random().toString(36).slice(2, 9);\n` +
`  const claim = await selectedClaimApi(runId, item.jobId, []);\n` +
`  if (!claim?.ok) return claim || { ok: false, error: "safe_send_claim_no_response" };\n` +
`  const tasks = (Array.isArray(claim.tasks) ? claim.tasks : []).map(normalizeTask).filter(Boolean);\n` +
`  if (!tasks.length) {\n` +
`    return { ok: true, empty: true, runId, summary: claim.summary || null, message: "실제 송신할 fresh pending 채널이 없습니다." };\n` +
`  }\n` +
`  if (tasks.length > 6 || new Set(tasks.map((task) => task.launchItemId)).size !== 1 || new Set(tasks.map((task) => task.goodsKey)).size !== tasks.length) {\n` +
`    return { ok: false, error: "safe_send_claim_identity_invalid" };\n` +
`  }\n` +
`  const queue = { version: r.constants.version, status: "running", jobIds: [item.jobId], batchRunId: runId,\n` +
`    launchedJobIds: [item.jobId], jobTasks: { [item.jobId]: tasks }, claimAttempts: { [item.jobId]: 1 },\n` +
`    activeTasks: tasks, results: [], waves: [], startedAt: now, updatedAt: now, directSafeStart: true };\n` +
`  const writes = { [r.constants.stop]: false, [r.constants.queue]: queue };\n` +
`  for (const task of tasks) {\n` +
`    writes[r.constants.workerPrefix + runId + ":" + task.goodsKey] = { version: r.constants.version, runId, task, status: "running",\n` +
`      stage: "worker_opening", startedAt: now, stepAt: now, updatedAt: now, submitArmedAt: 0, submitClickedAt: 0,\n` +
`      message: task.ptnGoodsCd + " → " + task.profile + " · v0.3.38 직접 안전 claim 완료 · A18 작업창 준비 중" };\n` +
`  }\n` +
`  await marketAutoStorageSet(writes);\n` +
`  const opened = await openParallelWorkers(runId, tasks, { tab: control });\n` +
`  if (!opened?.ok) {\n` +
`    await marketAutoStorageSet({ [r.constants.queue]: { ...queue, status: "completed_with_exceptions", error: text(opened?.message || opened?.error), finishedAt: Date.now(), updatedAt: Date.now() } });\n` +
`    return opened || { ok: false, error: "safe_send_worker_open_failed" };\n` +
`  }\n` +
`  return { ok: true, runId, taskCount: tasks.length, openedCount: Number(opened.openedCount || 0), failedCount: Number(opened.failedCount || 0), directSafeStart: true };\n` +
`}\n` +
`chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n` +
`  const r = globalThis.ShoplingRecoveryV0338;\n` +
`  if (!r || message?.type !== r.constants.safeSendStartMessage) return false;\n` +
`  safeSendMutationV0338 = safeSendMutationV0338.then(() => startSafeRealSendV0338(message, sender));\n` +
`  safeSendMutationV0338.then(sendResponse).catch((error) => sendResponse({ ok: false, error: "safe_send_start_exception", message: String(error?.message || error) }));\n` +
`  return true;\n` +
`});\n`;
  output["background-root.mjs"] = background;

  let popup = output["popup.js"];
  popup = replaceOne(
    popup,
    '  startButton.disabled = diagnosticMode() || diagnosticRunning || queueRunning || count === 0;',
    '  startButton.disabled = diagnosticMode() || diagnosticRunning || queueRunning || count !== 1;\n  if (!diagnosticMode()) startButton.textContent = count === 1 ? "선택 1상품 실전 Canary 시작" : "실전 Canary는 1상품만 선택";',
  );
  popup = replaceSection(
    popup,
    'startButton.addEventListener("click", async function () {',
    'chrome.storage.onChanged.addListener(function (changes, area) {',
    `startButton.addEventListener("click", async function () {\n` +
`  const jobIds = selectedJobIds();\n` +
`  if (jobIds.length !== 1 || diagnosticMode() || diagnosticRunning || queueRunning) return;\n` +
`  const item = items.find((row) => row.jobId === jobIds[0]);\n` +
`  if (!item || !item.selectable) { statusNode.textContent = "fresh pending 1상품만 실전 Canary가 가능합니다."; return; }\n` +
`  if (!window.confirm("선택한 1상품을 실제 마켓에 송신합니다. 저장검색/필수 기본정보 검증 후에만 송신합니다. 계속할까요?")) return;\n` +
`  const tab = await activeA18Tab();\n` +
`  if (!tab) { statusNode.textContent = "Shopling 관리자 A18 탭을 활성화한 뒤 다시 실행하세요."; return; }\n` +
`  startButton.disabled = true; queueRunning = true; statusNode.textContent = "v0.3.38 직접 안전 claim을 시작합니다...";\n` +
`  try {\n` +
`    await chrome.storage.local.set({ [recovery.constants.stop]: false });\n` +
`    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["recovery.mjs", "content-group-canary.mjs"] });\n` +
`    const result = await chrome.runtime.sendMessage({ type: recovery.constants.safeSendStartMessage, item, controlTabId: tab.id });\n` +
`    if (!result?.ok) throw new Error(result?.message || result?.error || "직접 안전 claim 실패");\n` +
`    if (result.empty) { queueRunning = false; statusNode.textContent = result.message || "실제 송신할 채널이 없습니다."; await loadItems(); return; }\n` +
`    statusNode.textContent = "직접 안전 claim 성공 · 채널 " + Number(result.taskCount || 0) + "개 · 작업창 " + Number(result.openedCount || 0) + "개 시작";\n` +
`    await refreshQueueStatus();\n` +
`  } catch (error) {\n` +
`    queueRunning = false; statusNode.textContent = "실전 Canary 시작 실패: " + text(error?.message || error); updateStartButton();\n` +
`  }\n` +
`});\n`,
  );
  output["popup.js"] = popup;

  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.38";
  manifest.description = "실전 Canary는 팝업에서 백그라운드로 직접 안전 claim한 뒤 A18 작업창을 생성합니다. storage-intent 우회 handoff를 실전 시작 경로에서 제거했습니다.";
  manifest.action.default_title = "Shopling Market Sender v0.3.38 · 직접 안전시작";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["VERSION.txt"] = "Shopling Market Sender v0.3.38\nActual send: direct popup -> background -> safe server claim -> A18 workers.\nDiagnostic remains no-submit.\n";
  output["README.txt"] = "v0.3.38 DIRECT SAFE START\n- 실전 전송은 1상품 Canary만 허용합니다.\n- 팝업이 storage intent 소비를 기다리지 않고 백그라운드의 안전 claim을 직접 호출합니다.\n- 서버 v0.3.37 claim guard가 confirm_needed/submit ambiguity/다른 실행을 계속 차단합니다.\n- claim 성공 뒤에만 A18 복제 작업창을 열고, 저장검색 및 필수 기본정보 검증 뒤에만 submit lock을 획득합니다.\n- 설정검사 모드는 계속 서버 claim/arm/report를 하지 않습니다.\n";

  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "recovery.mjs"]) {
    new Function(output[name]);
  }
  return output;
}
