function replaceOne(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2) {
    throw new Error(`v0339 patch anchor missing/ambiguous: ${anchor.slice(0, 100)}`);
  }
  return source.replace(anchor, replacement);
}

function replaceSection(source: string, start: string, end: string, replacement: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + start.length) >= 0) {
    throw new Error(`v0339 section anchor missing/ambiguous: ${start.slice(0, 90)}`);
  }
  return source.slice(0, a) + replacement + source.slice(b);
}

function versioned(source: string) {
  return source
    .replaceAll("0.3.38", "0.3.39")
    .replaceAll("V0338", "V0339")
    .replaceAll("v0338", "v0339");
}

export function buildReliableReadbackBulkV0339(input: Record<string, string>) {
  const output = { ...input };
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "popup.html", "recovery.mjs"]) {
    output[name] = versioned(output[name]);
  }

  let background = output["background-root.mjs"];
  background = replaceOne(
    background,
    'const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/status";',
    'const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/v0339/status";',
  );
  background = replaceOne(
    background,
    "const DIRECT_RESULT_RETRY_MS = 1400;\nconst DIRECT_RESULT_MAX_ATTEMPTS = 45;",
    "const DIRECT_RESULT_RETRY_MS = 1000;\nconst DIRECT_RESULT_MAX_ATTEMPTS = 240;",
  );

  background = replaceOne(
    background,
    "async function storeResultFrameEvidence(sender, rawEvidence) {",
    `async function reconcilePositivePushedEvidenceV0339(rawEvidence) {
  const evidence = normalizeResultFrameEvidence(rawEvidence);
  if (!evidence || evidence.success !== true) return { ok: true, skipped: true };
  const goodsKey = text(evidence.goodsKey);
  const recovered = await resultContextApi([goodsKey]);
  const contexts = recovered?.ok && Array.isArray(recovered.contexts) ? recovered.contexts : [];
  if (contexts.length !== 1) return { ok: false, error: "v0339_positive_context_not_unique" };
  const context = contexts[0] || null;
  const runId = text(context?.runId);
  const task = normalizeTask(context?.task);
  if (!validRunId(runId) || !task || task.goodsKey !== goodsKey) {
    return { ok: false, error: "v0339_positive_context_identity_invalid" };
  }
  const reported = await api({
    action: "report",
    runId,
    goodsKey,
    outcome: "sent",
    reasonCode: "shopling_result_frame_push_success_v0339",
    message: task.profile + " · Shopling 결과 프레임에서 성공 1건 이상을 직접 회수해 sent로 자동 마감했습니다.",
  });
  if (reported?.ok) {
    const meta = await getWorkerMeta();
    if (meta?.runId === runId && meta?.assignments?.[goodsKey]) {
      await closeParallelWorker(runId, goodsKey, null, false);
    }
  }
  return reported || { ok: false, error: "v0339_positive_report_no_response" };
}

async function storeResultFrameEvidence(sender, rawEvidence) {`,
  );

  background = replaceOne(
    background,
    "  void operation.then(() => scheduleDirectResultReconcile(sender.tab.id, 650)).catch(() => null);\n  return operation;",
    `  void operation.then(() => {
    scheduleDirectResultReconcile(sender.tab.id, 350);
    if (evidence.success === true) void reconcilePositivePushedEvidenceV0339(evidence);
  }).catch(() => null);
  return operation;`,
  );

  background = replaceSection(
    background,
    "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {",
    "// No recovery of unrelated/pre-existing result tabs on extension startup.",
    `chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isShoplingResultUrl(tab?.url)) return;
  // v0.3.39 intentionally inspects every Shopling result tab. Reporting is still fail-closed:
  // directReconcileResultTab must resolve one exact goods_key to one live submit_armed server context.
  // This removes the v0.3.38 local-assignment dependency that could miss popup/result tabs.
  void injectResultRuntime(tabId);
  scheduleDirectResultReconcile(tabId, 350);
});

`,
  );
  output["background-root.mjs"] = background;

  let content = output["content-group-canary.mjs"];
  content = replaceOne(
    content,
    `  function selectedJobIds(raw) {
    return [...new Set((Array.isArray(raw) ? raw : [])
      .map((value) => text(value))
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 20);
  }`,
    `  function selectedJobIds(raw) {
    return [...new Set((Array.isArray(raw) ? raw : [])
      .map((value) => text(value))
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 100);
  }`,
  );
  output["content-group-canary.mjs"] = content;

  let popup = output["popup.js"];
  popup = replaceOne(
    popup,
    '  startButton.disabled = diagnosticMode() || diagnosticRunning || queueRunning || count !== 1;\n  if (!diagnosticMode()) startButton.textContent = count === 1 ? "선택 1상품 실전 Canary 시작" : "실전 Canary는 1상품만 선택";',
    '  startButton.disabled = diagnosticMode() || diagnosticRunning || queueRunning || count === 0;\n  if (!diagnosticMode()) startButton.textContent = count ? "선택 " + count + "상품 안전 대량전송 시작" : "미전송 상품 선택";',
  );
  popup = replaceSection(
    popup,
    'startButton.addEventListener("click", async function () {',
    'chrome.storage.onChanged.addListener(function (changes, area) {',
    `startButton.addEventListener("click", async function () {
  const jobIds = selectedJobIds();
  if (!jobIds.length || diagnosticMode() || diagnosticRunning || queueRunning) return;
  if (!window.confirm("선택한 " + jobIds.length + "상품의 미전송 채널을 안전 대량전송합니다. 최대 3상품/18채널씩 처리하며 sent·already_registered·confirm_needed는 재송신하지 않습니다. 계속할까요?")) return;
  const tab = await activeA18Tab();
  if (!tab) { statusNode.textContent = "Shopling 관리자 A18 탭을 활성화한 뒤 다시 실행하세요."; return; }
  startButton.disabled = true;
  queueRunning = true;
  statusNode.textContent = "v0.3.39 안전 대량전송 준비 중...";
  try {
    await chrome.storage.local.set({ [recovery.constants.stop]: false });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["recovery.mjs", "content-group-canary.mjs"] });
    const started = await startWithA18Recovery(tab, jobIds);
    if (!started?.ok) throw new Error(started?.error || started?.response?.message || started?.response?.error || "대량전송 시작 실패");
    statusNode.textContent = "안전 대량전송 시작 · 선택 " + jobIds.length + "상품 · 최대 3상품/18채널 병렬";
    await refreshQueueStatus();
  } catch (error) {
    queueRunning = false;
    statusNode.textContent = "대량전송 시작 실패: " + text(error?.message || error);
    updateStartButton();
  }
});
`,
  );
  output["popup.js"] = popup;

  let html = output["popup.html"];
  html = html.replaceAll("Shopling Market Sender v0.3.39", "Shopling Market Sender v0.3.39 · 안전 대량전송");
  html = html.replace(
    "Commerce OS SEO 대량등록 → Shopling 업로드 완료 목록에서 직접 선택합니다. A18 화면에 보이는 상품은 대상 선정에 사용하지 않습니다.",
    "최신 SEO 대량등록 중 fresh pending만 선택합니다. 최대 3상품/18채널씩 순차 병렬 처리하고 결과 프레임 성공을 서버 원장에 자동 마감합니다.",
  );
  output["popup.html"] = html;

  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.39";
  manifest.description = "Shopling 결과 프레임을 local assignment와 무관하게 서버 submit_armed 원장과 재결합해 자동 마감하고, fresh pending 상품을 최대 3상품/18채널씩 안전 대량전송합니다.";
  manifest.action.default_title = "Shopling Market Sender v0.3.39 · 결과회수 + 안전 대량전송";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["VERSION.txt"] = "Shopling Market Sender v0.3.39\nReliable positive-result readback + bounded bulk (3 products / 18 channels per wave).\nPost-submit uncertainty never becomes plain pending.\n";
  output["README.txt"] = "v0.3.39 RELIABLE READBACK + BOUNDED BULK\n- Shopling 결과 탭이 local worker assignment를 잃어도 live submit_armed 서버 context와 정확히 재결합합니다.\n- 결과 iframe에서 성공 1건 이상을 얻으면 goods_key 기준으로 즉시 sent 자동마감합니다.\n- post-submit 결과 미확정은 pending으로 되돌리지 않고 confirm_needed로 잠급니다.\n- 실제 전송은 최신 SEO Shopling 6/6 중 fresh pending만 허용합니다.\n- sent/already_registered/confirm_needed/legacy_ignored/stale-uncertain는 재송신하지 않습니다.\n- 선택 상품은 최대 3상품/18채널씩 처리하고 이전 wave 상태를 확인한 뒤 다음 wave를 시작합니다.\n";

  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "recovery.mjs"]) {
    new Function(output[name]);
  }
  return output;
}
