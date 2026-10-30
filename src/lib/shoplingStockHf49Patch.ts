function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const OPTION_BATCH_ASSIGNMENT_BEFORE = `          mode: "OPTION",
          goodsKeys: batch,
          stage: optionCanonicalStageV071(active),`;

const OPTION_BATCH_ASSIGNMENT_AFTER = `          mode: "OPTION",
          stockProductKindHf48: "OPTION",
          goodsKeys: batch,
          stage: optionCanonicalStageV071(active),`;

const SINGLE_BATCH_ASSIGNMENT_BEFORE = `        mode: "OPTION",
        goodsKeys: batch,`;

const SINGLE_BATCH_ASSIGNMENT_AFTER = `        mode: "OPTION",
        stockProductKindHf48: "SINGLE",
        goodsKeys: batch,`;

const SINGLE_SPLIT_LISTENER_BEFORE = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CANONICAL_SPLIT) return;`;

const SINGLE_SPLIT_LISTENER_AFTER = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CANONICAL_SPLIT) return;
    if (String(message?.stockProductKindHf48 || "") !== "SINGLE") return;`;

const OPTION_LISTENER_ROUTE_BEFORE = `    if (![CANONICAL_STAGE, CANONICAL_FAILURE, CANONICAL_SUCCESS, CANONICAL_SPLIT].includes(message?.type)) return;
    if (String(message?.stockProductKindHf48 || "") === "SINGLE") return;`;

const OPTION_LISTENER_ROUTE_AFTER = `    if (![CANONICAL_STAGE, CANONICAL_FAILURE, CANONICAL_SUCCESS, CANONICAL_SPLIT].includes(message?.type)) return;
    if (String(message?.stockProductKindHf48 || "") !== "OPTION") return;`;

const SINGLE_STAGE_ROUTE_BEFORE = `    if (message.type === CANONICAL_STAGE) {
      if (String(message?.stockProductKindHf48 || "") === "OPTION") return;`;

const SINGLE_STAGE_ROUTE_AFTER = `    if (message.type === CANONICAL_STAGE) {
      if (String(message?.stockProductKindHf48 || "") !== "SINGLE") return;`;

const SINGLE_FAILURE_ROUTE_BEFORE = `    if (message.type === CANONICAL_FAILURE) {
      if (String(message?.stockProductKindHf48 || "") === "OPTION") return;`;

const SINGLE_FAILURE_ROUTE_AFTER = `    if (message.type === CANONICAL_FAILURE) {
      if (String(message?.stockProductKindHf48 || "") !== "SINGLE") return;`;

const WORKER_MARKER_ENCODE_BEFORE = `      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({ jobId: String(message.jobId), mode: String(message.mode), runId: String(message.runId || "") }));`;

const WORKER_MARKER_ENCODE_AFTER = `      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({
        jobId: String(message.jobId),
        mode: String(message.mode),
        runId: String(message.runId || ""),
        stockProductKindHf48: String(message.stockProductKindHf48 || ""),
      }));`;

const WORKER_MARKER_DECODE_BEFORE = `      return { jobId: String(parsed.jobId), mode: String(parsed.mode), runId: String(parsed.runId || "") };`;

const WORKER_MARKER_DECODE_AFTER = `      return {
        jobId: String(parsed.jobId),
        mode: String(parsed.mode),
        runId: String(parsed.runId || ""),
        stockProductKindHf48: String(parsed.stockProductKindHf48 || ""),
      };`;

const WORKER_RESULT_BEFORE = `  async function waitForResult(assignment) {
    // Monthly runs require the background CDP verifier`;

const WORKER_RESULT_AFTER = `  async function waitForResult(assignment) {
    stockProductKindsHf48.set(String(assignment.jobId), String(assignment.stockProductKindHf48 || ""));
    // Monthly runs require the background CDP verifier`;

const WORKER_POPUP_BEFORE = `  async function configureAndSubmitPopup(assignment) {
    if (role() !== "A21_POPUP")`;

const WORKER_POPUP_AFTER = `  async function configureAndSubmitPopup(assignment) {
    stockProductKindsHf48.set(String(assignment.jobId), String(assignment.stockProductKindHf48 || ""));
    if (role() !== "A21_POPUP")`;

export function patchShoplingStockHf49OptionBatch(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    OPTION_BATCH_ASSIGNMENT_BEFORE,
    OPTION_BATCH_ASSIGNMENT_AFTER,
    "shopling_hf49_option_batch_owner",
  );
}

export function patchShoplingStockHf49SingleBatch(source: string) {
  let output = source.replace(/\r\n/g, "\n");
  output = replaceOnce(
    output,
    SINGLE_BATCH_ASSIGNMENT_BEFORE,
    SINGLE_BATCH_ASSIGNMENT_AFTER,
    "shopling_hf49_single_batch_owner",
  );
  return replaceOnce(
    output,
    SINGLE_SPLIT_LISTENER_BEFORE,
    SINGLE_SPLIT_LISTENER_AFTER,
    "shopling_hf49_single_split_owner",
  );
}

export function patchShoplingStockHf49OptionBackground(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    OPTION_LISTENER_ROUTE_BEFORE,
    OPTION_LISTENER_ROUTE_AFTER,
    "shopling_hf49_option_listener_exact_owner",
  );
}

export function patchShoplingStockHf49SingleBackground(source: string) {
  let output = source.replace(/\r\n/g, "\n");
  output = replaceOnce(
    output,
    SINGLE_STAGE_ROUTE_BEFORE,
    SINGLE_STAGE_ROUTE_AFTER,
    "shopling_hf49_single_stage_exact_owner",
  );
  return replaceOnce(
    output,
    SINGLE_FAILURE_ROUTE_BEFORE,
    SINGLE_FAILURE_ROUTE_AFTER,
    "shopling_hf49_single_failure_exact_owner",
  );
}

export function patchShoplingStockHf49CanonicalWorker(source: string) {
  let output = source.replace(/\r\n/g, "\n");
  output = replaceOnce(
    output,
    WORKER_MARKER_ENCODE_BEFORE,
    WORKER_MARKER_ENCODE_AFTER,
    "shopling_hf49_worker_marker_encode_owner",
  );
  output = replaceOnce(
    output,
    WORKER_MARKER_DECODE_BEFORE,
    WORKER_MARKER_DECODE_AFTER,
    "shopling_hf49_worker_marker_decode_owner",
  );
  output = replaceOnce(
    output,
    WORKER_RESULT_BEFORE,
    WORKER_RESULT_AFTER,
    "shopling_hf49_worker_result_owner",
  );
  return replaceOnce(
    output,
    WORKER_POPUP_BEFORE,
    WORKER_POPUP_AFTER,
    "shopling_hf49_worker_popup_owner",
  );
}
