function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const WORKER_MAP_BEFORE = `  const handledListAssignments = new Set();
  const handledPopupAssignments = new Set();`;

const WORKER_MAP_AFTER = `  const handledListAssignments = new Set();
  const handledPopupAssignments = new Set();
  const stockProductKindsHf48 = new Map();`;

const WORKER_FAIL_BEFORE = `  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }`;

const WORKER_FAIL_AFTER = `  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({
      type: "A21_JOB_FAILURE",
      jobId,
      code,
      message,
      stockProductKindHf48: String(stockProductKindsHf48.get(String(jobId)) || ""),
    }).catch(() => null);
  }`;

const WORKER_STAGE_SEND_BEFORE = `.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, ...extra })`;
const WORKER_STAGE_SEND_AFTER = `.sendMessage({
          type: "A21_STAGE",
          jobId,
          stage: nextStage,
          ...extra,
          stockProductKindHf48: String(stockProductKindsHf48.get(String(jobId)) || ""),
        })`;

const WORKER_SUCCESS_BEFORE = `await chrome.runtime.sendMessage({ type: "A21_JOB_SUCCESS", jobId: assignment.jobId, message: \`${'${assignment.mode === "PRICE" ? "판매가" : assignment.mode === "OPTION" ? "옵션" : assignment.mode === "STATUS_SOLD_OUT" ? "판매상태 품절" : "판매상태 판매중"}'} 수정전송 성공 확인\` }).catch(() => null);`;
const WORKER_SUCCESS_AFTER = `await chrome.runtime.sendMessage({ type: "A21_JOB_SUCCESS", jobId: assignment.jobId, message: \`${'${assignment.mode === "PRICE" ? "판매가" : assignment.mode === "OPTION" ? "옵션" : assignment.mode === "STATUS_SOLD_OUT" ? "판매상태 품절" : "판매상태 판매중"}'} 수정전송 성공 확인\`, stockProductKindHf48: String(assignment.stockProductKindHf48 || "") }).catch(() => null);`;

const WORKER_SPLIT_BEFORE = `await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total, batchLimit: 200 }).catch(() => null);`;
const WORKER_SPLIT_AFTER = `await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total, batchLimit: 200, stockProductKindHf48: String(assignment.stockProductKindHf48 || "") }).catch(() => null);`;

const WORKER_ASSIGNMENT_BEFORE = `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          markWorker(message);`;
const WORKER_ASSIGNMENT_AFTER = `        if (message?.type === "A21_LIST_ASSIGNMENT") {
          stockProductKindsHf48.set(String(message.jobId), String(message.stockProductKindHf48 || ""));
          markWorker(message);`;

const OPTION_ASSIGNMENT_BEFORE = `      mode: "OPTION",
      goodsKeys: [goodsKey],`;
const OPTION_ASSIGNMENT_AFTER = `      mode: "OPTION",
      stockProductKindHf48: "OPTION",
      goodsKeys: [goodsKey],`;

const OPTION_LISTENER_BEFORE = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (![CANONICAL_STAGE, CANONICAL_FAILURE, CANONICAL_SUCCESS, CANONICAL_SPLIT].includes(message?.type)) return;`;
const OPTION_LISTENER_AFTER = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (![CANONICAL_STAGE, CANONICAL_FAILURE, CANONICAL_SUCCESS, CANONICAL_SPLIT].includes(message?.type)) return;
    if (String(message?.stockProductKindHf48 || "") === "SINGLE") return;`;

const SINGLE_ASSIGNMENT_BEFORE = `        mode: "OPTION",
        goodsKeys: [goodsKey],`;
const SINGLE_ASSIGNMENT_AFTER = `        mode: "OPTION",
        stockProductKindHf48: "SINGLE",
        goodsKeys: [goodsKey],`;

const SINGLE_STAGE_LISTENER_BEFORE = `    if (message.type === CANONICAL_STAGE) {
      void canonicalSingleStage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));`;
const SINGLE_STAGE_LISTENER_AFTER = `    if (message.type === CANONICAL_STAGE) {
      if (String(message?.stockProductKindHf48 || "") === "OPTION") return;
      void canonicalSingleStage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));`;

const SINGLE_FAILURE_LISTENER_BEFORE = `    if (message.type === CANONICAL_FAILURE) {
      void canonicalSingleFailure(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));`;
const SINGLE_FAILURE_LISTENER_AFTER = `    if (message.type === CANONICAL_FAILURE) {
      if (String(message?.stockProductKindHf48 || "") === "OPTION") return;
      void canonicalSingleFailure(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));`;

const SINGLE_SEARCH_ACK_BEFORE = `      return { ok: true };
    }

    if (next === "POPUP_OPENING") {`;
const SINGLE_SEARCH_ACK_AFTER = `      return { ok: true, accepted: true };
    }

    if (next === "POPUP_OPENING") {`;

const SINGLE_POPUP_ACK_BEFORE = `      return { ok: true };
    }
    return { ok: true, ignored: true };`;
const SINGLE_POPUP_ACK_AFTER = `      return { ok: true, accepted: true };
    }
    return { ok: true, accepted: true, ignored: true };`;

export function patchShoplingStockHf48CanonicalWorker(source: string) {
  let output = source.replace(/\r\n/g, "\n");
  output = replaceOnce(output, WORKER_MAP_BEFORE, WORKER_MAP_AFTER, "shopling_hf48_worker_kind_map");
  output = replaceOnce(output, WORKER_FAIL_BEFORE, WORKER_FAIL_AFTER, "shopling_hf48_worker_failure_kind");
  output = replaceOnce(output, WORKER_STAGE_SEND_BEFORE, WORKER_STAGE_SEND_AFTER, "shopling_hf48_worker_stage_kind");
  output = replaceOnce(output, WORKER_SUCCESS_BEFORE, WORKER_SUCCESS_AFTER, "shopling_hf48_worker_success_kind");
  output = replaceOnce(output, WORKER_SPLIT_BEFORE, WORKER_SPLIT_AFTER, "shopling_hf48_worker_split_kind");
  return replaceOnce(output, WORKER_ASSIGNMENT_BEFORE, WORKER_ASSIGNMENT_AFTER, "shopling_hf48_worker_assignment_kind");
}

export function patchShoplingStockHf48OptionBackground(source: string) {
  const normalized = source.replace(/\r\n/g, "\n");
  return replaceOnce(
    replaceOnce(normalized, OPTION_ASSIGNMENT_BEFORE, OPTION_ASSIGNMENT_AFTER, "shopling_hf48_option_assignment_kind"),
    OPTION_LISTENER_BEFORE,
    OPTION_LISTENER_AFTER,
    "shopling_hf48_option_listener_route",
  );
}

export function patchShoplingStockHf48SingleBackground(source: string) {
  let output = source.replace(/\r\n/g, "\n");
  output = replaceOnce(output, SINGLE_ASSIGNMENT_BEFORE, SINGLE_ASSIGNMENT_AFTER, "shopling_hf48_single_assignment_kind");
  output = replaceOnce(output, SINGLE_STAGE_LISTENER_BEFORE, SINGLE_STAGE_LISTENER_AFTER, "shopling_hf48_single_stage_route");
  output = replaceOnce(output, SINGLE_FAILURE_LISTENER_BEFORE, SINGLE_FAILURE_LISTENER_AFTER, "shopling_hf48_single_failure_route");
  output = replaceOnce(output, SINGLE_SEARCH_ACK_BEFORE, SINGLE_SEARCH_ACK_AFTER, "shopling_hf48_single_search_ack");
  return replaceOnce(output, SINGLE_POPUP_ACK_BEFORE, SINGLE_POPUP_ACK_AFTER, "shopling_hf48_single_popup_ack");
}
