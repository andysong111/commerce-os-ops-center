const VERSION = "0.2.0";
const PLAN_URL = "https://commerce-os-ops-center.vercel.app/api/shopling-a21-price-option-resend/plan";
const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
const MAX_SEARCH_CODES = 200;
const MAX_VISIBLE_RESULTS = 500;
const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";
const TARGET_POPUP_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
const FRAME_WAIT_MS = 45_000;
const RESULT_WAIT_MS = 180_000;
const RETRY_MS = 350;
const MODES = ["PRICE", "OPTION"];

const now = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = (prefix = "id") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const isShopling = (url) => String(url || "").startsWith(SHOPLING_ORIGIN);
const isTargetPopup = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_POPUP_PATH.toLowerCase();
  } catch {
    return String(url || "").toLowerCase().includes("goods_mallmdfy_trsmt.phtml");
  }
};

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || null;
}

async function saveState(state) {
  state.updatedAt = now();
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

function publicState(state) {
  if (!state) return { version: VERSION, state: "IDLE", jobs: [] };
  return {
    version: VERSION,
    runId: state.runId,
    state: state.state,
    testMode: Boolean(state.testMode),
    fingerprint: state.fingerprint,
    goodsKeyCount: state.goodsKeyCount,
    fullGoodsKeyCount: state.fullGoodsKeyCount,
    mallCheckCount: state.mallCheckCount,
    batchCount: state.batches?.length || 0,
    jobs: (state.jobs || []).map((job) => ({
      id: job.id,
      batchId: job.batchId,
      batchIndex: job.batchIndex,
      mode: job.mode,
      goodsKeyCount: job.goodsKeys.length,
      status: job.status,
      stage: job.stage,
      selectedRowCount: job.selectedRowCount || 0,
      totalResultCount: job.totalResultCount || 0,
      message: job.message || "",
      error: job.error || "",
    })),
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  };
}

async function fetchPlan() {
  const response = await fetch(PLAN_URL, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || `Commerce OS plan fetch failed (${response.status})`);
  if (body.readback?.state !== "VERIFIED"
      || Number(body.readback?.mallMismatchCount || 0) !== 0
      || Number(body.readback?.mallMissingCount || 0) !== 0
      || Number(body.readback?.mallMatchCount || 0) !== Number(body.readback?.mallCheckCount || 0)) {
    throw new Error("Shopling 쇼핑몰별 판매가 재조회가 100% 일치 상태가 아니어서 수정전송을 차단했습니다.");
  }
  if (!Array.isArray(body.rows) || !body.rows.length) throw new Error("수정전송 대상 GOODSKEY가 없습니다.");
  return body;
}

function buildBatches(rows) {
  const batches = [];
  for (let i = 0; i < rows.length; i += MAX_SEARCH_CODES) {
    batches.push({ id: uid("batch"), index: batches.length + 1, goodsKeys: rows.slice(i, i + MAX_SEARCH_CODES).map((row) => String(row.goodsKey)) });
  }
  return batches;
}

function addJobs(state, batch) {
  for (const mode of MODES) {
    state.jobs.push({
      id: uid(`job-${mode.toLowerCase()}`),
      batchId: batch.id,
      batchIndex: batch.index,
      mode,
      goodsKeys: [...batch.goodsKeys],
      status: "QUEUED",
      stage: "OPENING",
      workerWindowId: null,
      workerTabId: null,
      workerFrameId: null,
      popupWindowId: null,
      popupTabId: null,
      popupFrameId: null,
      selectedRowCount: 0,
      totalResultCount: 0,
      message: "대기 중",
      error: "",
      createdAt: now(),
      updatedAt: now(),
    });
  }
}

function rebuildIndexes(state) {
  state.batches.forEach((batch, index) => { batch.index = index + 1; });
  for (const job of state.jobs) {
    const batch = state.batches.find((item) => item.id === job.batchId);
    if (batch) job.batchIndex = batch.index;
  }
}

async function baselinePopupTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => Number.isInteger(tab.id) && isTargetPopup(tab.url)).map((tab) => tab.id);
}

async function startRun(sourceTabId, testMode = false) {
  if (!Number.isInteger(sourceTabId)) throw new Error("현재 Shopling 탭을 확인하지 못했습니다.");
  const sourceTab = await chrome.tabs.get(sourceTabId);
  if (!isShopling(sourceTab?.url)) throw new Error("Shopling 로그인 탭(A18/A21)에서 실행해주세요.");
  const plan = await fetchPlan();
  const rows = testMode ? plan.rows.slice(0, 1) : plan.rows;
  const batches = buildBatches(rows);
  const state = {
    version: VERSION,
    runId: uid("run"),
    state: "RUNNING",
    testMode: Boolean(testMode),
    fingerprint: plan.proposalFingerprint,
    goodsKeyCount: rows.length,
    fullGoodsKeyCount: plan.goodsKeyCount,
    mallCheckCount: plan.readback?.mallCheckCount || 0,
    sourceUrl: sourceTab.url || SHOPLING_ORIGIN,
    baselinePopupTabIds: await baselinePopupTabs(),
    batches,
    jobs: [],
    stopped: false,
    startedAt: now(),
    updatedAt: now(),
  };
  for (const batch of batches) addJobs(state, batch);
  await saveState(state);
  await pump();
  return publicState(await loadState());
}

async function executeAllFrames(tabId, func, args = []) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
  } catch {
    return [];
  }
}

async function identifyFrames(tabId) {
  return executeAllFrames(tabId, () => {
    const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const text = norm(document.body?.innerText || document.body?.textContent || "");
    const path = String(location.pathname || "").toLowerCase();
    const resultEvidence = /성공건수|실패건수|성공여부|수정\s*전송\s*결과|상품\s*등록\s*전송\s*결과|정상적으로.*처리/i.test(text);
    let role = "OTHER";
    if (resultEvidence) role = "A21_RESULT";
    else if (path === "/prodlinkage/goods_mallmdfy_trsmt.phtml" || /상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text)) role = "A21_POPUP";
    else if (/쇼핑몰상품수정/i.test(text) && /상품\s*수정전송/i.test(text) && /검색항목/i.test(text)) role = "A21_LIST";
    return { role, href: location.href, resultEvidence, text: text.slice(0, 1000) };
  });
}

function frameFor(results, role) {
  const row = (results || []).find((item) => item?.result?.role === role);
  return row ? row.frameId : null;
}

async function clickA21Menu(tabId) {
  const rows = await executeAllFrames(tabId, () => {
    const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const nodes = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"],input[type="image"],[onclick]')];
    const target = nodes.find((node) => {
      const text = norm(node instanceof HTMLInputElement ? `${node.value || ""} ${node.title || ""}` : `${node.textContent || ""} ${node.getAttribute("title") || ""}`);
      return /쇼핑몰상품수정/.test(text) || (/\[?21\]?/.test(text) && /상품수정/.test(text));
    });
    if (!target) return false;
    target.click();
    return true;
  });
  return rows.some((row) => row?.result === true);
}

async function waitForListFrame(tabId) {
  const deadline = now() + FRAME_WAIT_MS;
  let clicked = false;
  while (now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("A21 작업창이 닫혔습니다.");
    const frames = await identifyFrames(tabId);
    const frameId = frameFor(frames, "A21_LIST");
    if (Number.isInteger(frameId)) return frameId;
    if (!clicked && isShopling(tab.url)) clicked = await clickA21Menu(tabId);
    await sleep(clicked ? 550 : RETRY_MS);
  }
  throw new Error("A18/A21 화면에서 [21] 쇼핑몰상품수정으로 자동 진입하지 못했습니다.");
}

async function sendToFrame(tabId, frameId, message, file) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const probe = await chrome.tabs.sendMessage(tabId, { type: "A21_IDENTIFY" }, Number.isInteger(frameId) ? { frameId } : undefined).catch(() => null);
      if (!probe?.ok) {
        await chrome.scripting.executeScript({
          target: Number.isInteger(frameId) ? { tabId, frameIds: [frameId] } : { tabId },
          files: [file],
        });
        await sleep(120);
      }
      return await chrome.tabs.sendMessage(tabId, message, Number.isInteger(frameId) ? { frameId } : undefined);
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`content script unavailable: ${file}`);
}

async function launchJob(state, job) {
  const created = await chrome.windows.create({
    url: state.sourceUrl || SHOPLING_ORIGIN,
    type: "popup",
    width: 1420,
    height: 900,
    focused: false,
  });
  const tab = created.tabs?.[0];
  if (!tab?.id) throw new Error("A21 작업창을 만들지 못했습니다.");
  job.workerWindowId = created.id;
  job.workerTabId = tab.id;
  job.status = "RUNNING";
  job.stage = "A21_BOOTSTRAP";
  job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 작업창 준비 중`;
  job.updatedAt = now();
  await saveState(state);
  setTimeout(() => void assignWorker(job.id), 100);
}

async function assignWorker(jobId) {
  const state = await loadState();
  const job = state?.jobs?.find((item) => item.id === jobId);
  if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING" || !Number.isInteger(job.workerTabId)) return;
  if (job.assignmentBusy) return;
  job.assignmentBusy = true;
  await saveState(state);
  try {
    const frameId = await waitForListFrame(job.workerTabId);
    const latest = await loadState();
    const current = latest?.jobs?.find((item) => item.id === jobId);
    if (!latest || !current || current.status !== "RUNNING") return;
    current.workerFrameId = frameId;
    current.assignmentBusy = false;
    if (["OPENING", "A21_BOOTSTRAP", "SEARCH_CONFIG"].includes(current.stage)) current.stage = "SEARCH_CONFIG";
    current.message = `${current.mode === "PRICE" ? "판매가" : "옵션"} A21 목록 준비 완료`;
    await saveState(latest);
    await sendToFrame(current.workerTabId, frameId, {
      type: "A21_LIST_ASSIGNMENT",
      runId: latest.runId,
      jobId: current.id,
      mode: current.mode,
      goodsKeys: current.goodsKeys,
      stage: current.stage,
    }, "content-a21.js");
  } catch (error) {
    const latest = await loadState();
    const current = latest?.jobs?.find((item) => item.id === jobId);
    if (current) { current.assignmentBusy = false; await saveState(latest); }
    await failJob(jobId, "V020_WORKER_FAILED", error instanceof Error ? error.message : String(error));
  }
}

async function newPopupCandidates(state, job) {
  const tabs = await chrome.tabs.query({});
  const baseline = new Set(state.baselinePopupTabIds || []);
  const claimed = new Set(state.jobs.map((item) => item.popupTabId).filter(Number.isInteger));
  const exact = tabs.filter((tab) => Number.isInteger(tab.id) && isTargetPopup(tab.url) && !baseline.has(tab.id) && !claimed.has(tab.id));
  const opener = exact.filter((tab) => tab.openerTabId === job.workerTabId);
  return opener.length ? opener : exact;
}

async function bindPopup(jobId) {
  const deadline = now() + FRAME_WAIT_MS;
  while (now() < deadline) {
    const state = await loadState();
    const job = state?.jobs?.find((item) => item.id === jobId);
    if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING") return;
    let tab = Number.isInteger(job.popupTabId) ? await chrome.tabs.get(job.popupTabId).catch(() => null) : null;
    if (!tab) {
      const candidates = await newPopupCandidates(state, job);
      if (candidates.length === 1) tab = candidates[0];
      else if (candidates.length > 1) {
        await failJob(job.id, "V020_POPUP_AMBIGUOUS", `새 상품수정 송신창이 ${candidates.length}개라 안전하게 연결하지 못했습니다.`);
        return;
      }
    }
    if (tab?.id) {
      const latest = await loadState();
      const current = latest?.jobs?.find((item) => item.id === jobId);
      if (!latest || !current || current.status !== "RUNNING") return;
      current.popupTabId = tab.id;
      current.popupWindowId = tab.windowId;
      current.popupFrameId = 0;
      current.stage = "POPUP_CONFIG";
      current.message = `${current.mode === "PRICE" ? "판매가" : "옵션"} 송신창 연결 완료 · 실제 form 설정 중`;
      await saveState(latest);
      try {
        await sendToFrame(tab.id, 0, {
          type: "A21_POPUP_ASSIGNMENT",
          runId: latest.runId,
          jobId: current.id,
          mode: current.mode,
        }, "content-a21-v020.js");
      } catch (error) {
        await failJob(current.id, "V020_POPUP_CONTENT", error instanceof Error ? error.message : String(error));
      }
      return;
    }
    await sleep(RETRY_MS);
  }
  await failJob(jobId, "V020_POPUP_TIMEOUT", "상품수정 송신창이 열렸지만 자동화 작업과 연결하지 못했습니다.");
}

async function inspectResult(tabId) {
  const rows = await executeAllFrames(tabId, () => {
    const text = String(document.body?.innerText || document.body?.textContent || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const successMatch = text.match(/성공건수\s*[:：]?\s*([\d,]+)/i);
    const failMatch = text.match(/실패건수\s*[:：]?\s*([\d,]+)/i);
    const success = successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0;
    const failure = failMatch ? Number(failMatch[1].replace(/,/g, "")) : 0;
    return {
      success,
      failure,
      failed: failure > 0 || /성공여부\s*[:：]?\s*실패/i.test(text),
      succeeded: success > 0 || /성공여부\s*[:：]?\s*성공/i.test(text) || /정상적으로.*처리/i.test(text),
      text: text.slice(0, 1200),
    };
  });
  return rows.map((row) => row?.result).filter(Boolean);
}

async function monitorResult(jobId) {
  const deadline = now() + RESULT_WAIT_MS;
  while (now() < deadline) {
    const state = await loadState();
    const job = state?.jobs?.find((item) => item.id === jobId);
    if (!state || !job || job.status !== "RUNNING" || !Number.isInteger(job.popupTabId)) return;
    const tab = await chrome.tabs.get(job.popupTabId).catch(() => null);
    if (!tab) {
      await failJob(job.id, "V020_RESULT_WINDOW_CLOSED", "결과 확인 전에 송신창이 닫혀 성공 처리하지 않았습니다.");
      return;
    }
    const results = await inspectResult(tab.id);
    const failed = results.find((row) => row.failed);
    if (failed) {
      await failJob(job.id, "V020_RESULT_FAILURE", `Shopling 수정전송 실패 ${failed.failure || 1}건`);
      return;
    }
    const succeeded = results.find((row) => row.succeeded);
    if (succeeded) {
      await completeJob(job.id, `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인${succeeded.success ? ` · ${succeeded.success}건` : ""}`);
      return;
    }
    await sleep(750);
  }
  await failJob(jobId, "V020_RESULT_TIMEOUT", "상품수정 송신 후 결과를 180초 동안 확인하지 못했습니다.");
}

async function closeManaged(job) {
  const ids = [...new Set([job.popupWindowId, job.workerWindowId].filter(Number.isInteger))];
  for (const id of ids) await chrome.windows.remove(id).catch(() => null);
}

async function completeJob(jobId, message) {
  const state = await loadState();
  const job = state?.jobs?.find((item) => item.id === jobId);
  if (!state || !job || job.status !== "RUNNING") return;
  job.status = "SUCCEEDED";
  job.stage = "DONE";
  job.message = message || "수정전송 성공 확인";
  job.error = "";
  job.updatedAt = now();
  await saveState(state);
  await closeManaged(job);
  await finalizeOrPump();
}

async function failJob(jobId, code, message) {
  const state = await loadState();
  const job = state?.jobs?.find((item) => item.id === jobId);
  if (!state || !job || ["FAILED", "SUCCEEDED", "SUPERSEDED", "STOPPED"].includes(job.status)) return;
  job.status = "FAILED";
  job.stage = "FAILED";
  job.error = code || "V020_FAILED";
  job.message = message || "작업 실패";
  job.updatedAt = now();
  job.assignmentBusy = false;
  await saveState(state);
  await closeManaged(job);
  await finalizeOrPump();
}

async function splitBatch(jobId, totalResultCount) {
  const state = await loadState();
  const job = state?.jobs?.find((item) => item.id === jobId);
  if (!state || !job || state.state !== "RUNNING") return;
  const batch = state.batches.find((item) => item.id === job.batchId);
  if (!batch || batch.goodsKeys.length <= 1) {
    await failJob(jobId, "V020_TOO_MANY_ROWS", `1 GOODSKEY 결과가 ${totalResultCount}건으로 ${MAX_VISIBLE_RESULTS}건을 초과했습니다.`);
    return;
  }
  const related = state.jobs.filter((item) => item.batchId === batch.id && ["QUEUED", "RUNNING"].includes(item.status));
  for (const item of related) {
    item.status = "SUPERSEDED";
    item.stage = "SPLIT";
    item.message = `조회 ${totalResultCount}건 > ${MAX_VISIBLE_RESULTS}건 · 더 작은 묶음으로 자동 분할`;
    await closeManaged(item);
  }
  const mid = Math.ceil(batch.goodsKeys.length / 2);
  const left = { id: uid("batch"), goodsKeys: batch.goodsKeys.slice(0, mid) };
  const right = { id: uid("batch"), goodsKeys: batch.goodsKeys.slice(mid) };
  const index = state.batches.findIndex((item) => item.id === batch.id);
  state.batches.splice(index, 1, left, right);
  addJobs(state, left);
  addJobs(state, right);
  rebuildIndexes(state);
  await saveState(state);
  await pump();
}

async function finalizeOrPump() {
  const state = await loadState();
  if (!state) return;
  const active = state.jobs.some((job) => job.status === "RUNNING");
  const queued = state.jobs.some((job) => job.status === "QUEUED");
  if (!active && !queued) {
    const failed = state.jobs.some((job) => job.status === "FAILED");
    state.state = failed ? "PARTIAL_FAILURE" : "SUCCEEDED";
    await saveState(state);
    return;
  }
  await pump();
}

async function pump() {
  const state = await loadState();
  if (!state || state.state !== "RUNNING" || state.stopped) return;
  if (state.jobs.some((job) => job.status === "RUNNING")) return;
  const next = state.jobs.find((job) => job.status === "QUEUED");
  if (!next) return finalizeOrPump();
  try {
    await launchJob(state, next);
  } catch (error) {
    next.status = "FAILED";
    next.stage = "FAILED";
    next.error = "V020_WINDOW_CREATE";
    next.message = error instanceof Error ? error.message : String(error);
    await saveState(state);
    await finalizeOrPump();
  }
}

async function stopRun() {
  const state = await loadState();
  if (!state) return publicState(state);
  state.stopped = true;
  state.state = "STOPPED";
  for (const job of state.jobs) {
    if (["QUEUED", "RUNNING"].includes(job.status)) {
      job.status = "STOPPED";
      job.stage = "STOPPED";
      job.message = "사용자 안전중지";
      await closeManaged(job);
    }
  }
  await saveState(state);
  return publicState(state);
}

if (chrome.webNavigation?.onCreatedNavigationTarget) {
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    void (async () => {
      const state = await loadState();
      if (!state || state.state !== "RUNNING") return;
      const job = state.jobs.find((item) => item.status === "RUNNING" && item.workerTabId === details.sourceTabId && ["POPUP_OPENING", "POPUP_CONFIG"].includes(item.stage));
      if (!job || !Number.isInteger(details.tabId)) return;
      job.popupTabId = details.tabId;
      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      job.popupWindowId = tab?.windowId ?? null;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 송신창 생성 감지`;
      await saveState(state);
      setTimeout(() => void bindPopup(job.id), 120);
    })();
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    const state = await loadState();
    if (!state || state.state !== "RUNNING") return;
    const worker = state.jobs.find((job) => job.status === "RUNNING" && job.workerTabId === tabId);
    if (worker) setTimeout(() => void assignWorker(worker.id), 120);
    const popup = state.jobs.find((job) => job.status === "RUNNING" && job.popupTabId === tabId);
    if (popup && ["POPUP_OPENING", "POPUP_CONFIG"].includes(popup.stage)) setTimeout(() => void bindPopup(popup.id), 120);
    if (popup && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(popup.stage)) setTimeout(() => void monitorResult(popup.id), 250);
  })();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.storage.local.remove(STATE_KEY);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!String(message?.type || "").startsWith("A21_")) return false;
  void (async () => {
    try {
      if (message?.type === "A21_GET_PLAN") return sendResponse({ ok: true, plan: await fetchPlan() });
      if (message?.type === "A21_GET_STATE") return sendResponse({ ok: true, state: publicState(await loadState()) });
      if (message?.type === "A21_START") return sendResponse({ ok: true, state: await startRun(Number(message.sourceTabId), Boolean(message.testMode)) });
      if (message?.type === "A21_STOP") return sendResponse({ ok: true, state: await stopRun() });
      if (message?.type === "A21_STAGE") {
        const state = await loadState();
        const job = state?.jobs?.find((item) => item.id === String(message.jobId));
        if (state && job && job.status === "RUNNING") {
          job.stage = String(message.stage || job.stage);
          job.selectedRowCount = Number(message.selectedRowCount || job.selectedRowCount || 0);
          job.totalResultCount = Number(message.totalResultCount || job.totalResultCount || 0);
          job.message = String(message.message || job.message || "");
          job.assignmentBusy = false;
          job.updatedAt = now();
          await saveState(state);
          if (job.stage === "SEARCH_SUBMITTED") setTimeout(() => void assignWorker(job.id), 650);
          if (job.stage === "POPUP_OPENING") setTimeout(() => void bindPopup(job.id), 120);
          if (job.stage === "RESULT_WAIT") setTimeout(() => void monitorResult(job.id), 300);
        }
        return sendResponse({ ok: true });
      }
      if (message?.type === "A21_SPLIT_REQUIRED") {
        await splitBatch(String(message.jobId), Number(message.totalResultCount || 0));
        return sendResponse({ ok: true });
      }
      if (message?.type === "A21_JOB_SUCCESS") {
        await completeJob(String(message.jobId), String(message.message || "수정전송 성공 확인"));
        return sendResponse({ ok: true });
      }
      if (message?.type === "A21_JOB_FAILURE") {
        await failJob(String(message.jobId), String(message.code || "V020_FAILED"), String(message.message || "작업 실패"));
        return sendResponse({ ok: true });
      }
      if (message?.type === "A21_POPUP_CLAIM_V020") {
        const tabId = sender?.tab?.id;
        const state = await loadState();
        const candidates = state?.jobs?.filter((item) => item.status === "RUNNING" && ["POPUP_OPENING", "POPUP_CONFIG"].includes(item.stage)) || [];
        if (!state || state.state !== "RUNNING" || !Number.isInteger(tabId) || candidates.length !== 1) return sendResponse({ ok: false, error: "popup_claim_not_unique" });
        const job = candidates[0];
        if (!job.popupTabId) job.popupTabId = tabId;
        if (job.popupTabId !== tabId) return sendResponse({ ok: false, error: "popup_claim_tab_mismatch" });
        job.popupWindowId = sender?.tab?.windowId ?? null;
        job.popupFrameId = sender?.frameId ?? 0;
        job.stage = "POPUP_CONFIG";
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 송신창 self-claim 완료`;
        await saveState(state);
        return sendResponse({ ok: true, assignment: { runId: state.runId, jobId: job.id, mode: job.mode } });
      }
      return sendResponse({ ok: false, error: "unsupported_message" });
    } catch (error) {
      return sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});
