import {
  CdpSession,
  fetchJson,
  withBrowserCdpTarget,
} from "./chrome-cdp.mjs";

const SHOPLING_ORIGIN = "https://a.shopling.co.kr";
const POPUP_PATH = "/order/order_detail_popup.phtml";
const DEFAULT_TIMEOUT_MS = 15_000;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function popupUrl(orderNo) {
  const normalized = clean(orderNo);
  if (!/^\d+$/.test(normalized)) fail("SHOPLING_MEMO_ORDER_NUMBER_INVALID", "A numeric Shopling order number is required.");
  return `${SHOPLING_ORIGIN}${POPUP_PATH}?ord_no=${encodeURIComponent(normalized)}&csViewMode=y#csViewMode`;
}

function captureMemoPopupState(input) {
  const form = document.forms.namedItem("csform");
  const orderNo = String(form?.elements?.namedItem("ord_no")?.value || "").trim();
  const reply = form?.elements?.namedItem("reply_cnts");
  const category = form?.elements?.namedItem("cs_tp");
  const complete = form?.elements?.namedItem("cs_status");
  const saveButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
    .filter((element) => String(element.textContent || element.value || "").replace(/\s+/g, "").trim() === "C/S저장");
  return {
    readyState: document.readyState,
    path: location.pathname,
    orderNo,
    formReady: Boolean(form && reply && category),
    memoCategoryAvailable: Array.from(category?.options || [])
      .some((option) => option.value === "R" && String(option.textContent || "").trim() === "메모"),
    saveButtonCount: saveButtons.length,
    completionChecked: complete?.checked === true,
    memoPresent: Boolean(input?.memo) && String(document.body?.innerText || "").includes(input.memo),
  };
}

function prepareReturnInvoiceMemo(input) {
  const form = document.forms.namedItem("csform");
  const orderNo = String(form?.elements?.namedItem("ord_no")?.value || "").trim();
  if (!form || orderNo !== input.orderNo) return { error: "SHOPLING_MEMO_ORDER_MISMATCH", orderNo };
  const reply = form.elements.namedItem("reply_cnts");
  const category = form.elements.namedItem("cs_tp");
  const complete = form.elements.namedItem("cs_status");
  if (!reply || !category) return { error: "SHOPLING_MEMO_FORM_CHANGED" };
  const memoOption = Array.from(category.options || [])
    .find((option) => option.value === "R" && String(option.textContent || "").trim() === "메모");
  if (!memoOption) return { error: "SHOPLING_MEMO_CATEGORY_MISSING" };
  category.value = "R";
  category.dispatchEvent(new Event("change", { bubbles: true }));
  reply.value = input.memo;
  reply.dispatchEvent(new Event("input", { bubbles: true }));
  reply.dispatchEvent(new Event("change", { bubbles: true }));
  if (complete) complete.checked = false;
  return {
    prepared: true,
    orderNo,
    category: category.value,
    memoLength: String(reply.value || "").length,
    completionChecked: complete?.checked === true,
  };
}

function clickReturnInvoiceMemoSave(input) {
  const form = document.forms.namedItem("csform");
  const orderNo = String(form?.elements?.namedItem("ord_no")?.value || "").trim();
  const reply = form?.elements?.namedItem("reply_cnts");
  const category = form?.elements?.namedItem("cs_tp");
  const complete = form?.elements?.namedItem("cs_status");
  if (orderNo !== input.orderNo || String(reply?.value || "") !== input.memo
    || category?.value !== "R" || complete?.checked === true) {
    return { error: "SHOPLING_MEMO_PREPARED_STATE_CHANGED" };
  }
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
    .filter((element) => String(element.textContent || element.value || "").replace(/\s+/g, "").trim() === "C/S저장");
  if (buttons.length !== 1) return { error: "SHOPLING_MEMO_SAVE_BUTTON_COUNT_INVALID", count: buttons.length };
  buttons[0].click();
  return { clicked: true };
}

export const SHOPLING_RETURN_MEMO_POPUP_PROBE_SOURCE = captureMemoPopupState.toString();
export const SHOPLING_RETURN_MEMO_PREPARE_SOURCE = prepareReturnInvoiceMemo.toString();
export const SHOPLING_RETURN_MEMO_SAVE_SOURCE = clickReturnInvoiceMemoSave.toString();

async function evaluate(session, expression, timeoutMs) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    fail("SHOPLING_MEMO_BROWSER_EVALUATION_FAILED", result.exceptionDetails.exception?.description
      || result.exceptionDetails.text || "Shopling memo browser evaluation failed.");
  }
  return result.result?.value;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPopup(session, input, options = {}, dependencies = {}) {
  const wait = dependencies.sleep || sleep;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + (options.navigationTimeoutMs || 20_000);
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(
      session,
      `(${SHOPLING_RETURN_MEMO_POPUP_PROBE_SOURCE})(${JSON.stringify(input)})`,
      timeoutMs,
    ).catch(() => null);
    if (last?.readyState === "complete" && last.path === POPUP_PATH && last.formReady) return last;
    await wait(options.pollMs || 300);
  }
  fail("SHOPLING_MEMO_POPUP_TIMEOUT", "Shopling order C/S popup did not become ready.", { last });
}

export function createShoplingReturnMemoBrowserAdapter(session, orderNo, options = {}, dependencies = {}) {
  const normalizedOrderNo = clean(orderNo);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  return {
    async inspect(memo = "") {
      return waitForPopup(session, { orderNo: normalizedOrderNo, memo }, options, dependencies);
    },

    async recordReturnInvoiceMemo(memo) {
      const normalizedMemo = clean(memo);
      if (!normalizedMemo || normalizedMemo.length > 500) {
        fail("SHOPLING_MEMO_CONTENT_INVALID", "A concise return-invoice memo is required.");
      }
      const input = { orderNo: normalizedOrderNo, memo: normalizedMemo };
      const before = await waitForPopup(session, input, options, dependencies);
      if (before.orderNo !== normalizedOrderNo || before.saveButtonCount !== 1
        || !before.memoCategoryAvailable) {
        fail("SHOPLING_MEMO_POPUP_CHANGED", "Shopling order C/S controls changed or the order does not match.");
      }
      if (before.memoPresent) {
        return { changed: false, alreadyRecorded: true, orderNo: normalizedOrderNo, category: "R" };
      }
      const prepared = await evaluate(
        session,
        `(${SHOPLING_RETURN_MEMO_PREPARE_SOURCE})(${JSON.stringify(input)})`,
        timeoutMs,
      );
      if (prepared?.error || !prepared?.prepared || prepared.category !== "R"
        || prepared.completionChecked) {
        fail(prepared?.error || "SHOPLING_MEMO_PREPARATION_FAILED", "Shopling return-invoice memo could not be prepared.");
      }
      const saved = await evaluate(
        session,
        `(${SHOPLING_RETURN_MEMO_SAVE_SOURCE})(${JSON.stringify(input)})`,
        timeoutMs,
      );
      if (saved?.error || !saved?.clicked) {
        fail(saved?.error || "SHOPLING_MEMO_SAVE_FAILED", "Shopling C/S save was not triggered.");
      }
      await (dependencies.sleep || sleep)(options.saveDelayMs || 1_000);
      await session.send("Page.reload", { ignoreCache: true }, timeoutMs);
      const after = await waitForPopup(session, input, options, dependencies);
      if (!after.memoPresent || after.orderNo !== normalizedOrderNo) {
        fail("SHOPLING_MEMO_READBACK_FAILED", "Shopling did not read back the exact return-invoice memo.");
      }
      return { changed: true, alreadyRecorded: false, orderNo: normalizedOrderNo, category: "R" };
    },
  };
}

async function createTarget(config, url, dependencies = {}) {
  const timeoutMs = dependencies.options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const version = await (dependencies.fetchJson || fetchJson)(`${config.chromeDebugBaseUrl}/json/version`, timeoutMs);
  if (!version.webSocketDebuggerUrl) fail("CDP_BROWSER_WEBSOCKET_MISSING", "Chrome does not expose a browser WebSocket URL.");
  const session = new CdpSession(version.webSocketDebuggerUrl, dependencies.options);
  await session.connect(timeoutMs);
  try {
    const created = await session.send("Target.createTarget", { url }, timeoutMs);
    if (!created.targetId) fail("SHOPLING_MEMO_TARGET_CREATE_FAILED", "The Shopling C/S tab could not be created.");
    return { id: created.targetId, type: "page", url };
  } finally {
    await session.close();
  }
}

async function closeTarget(config, targetId, dependencies = {}) {
  const timeoutMs = dependencies.options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const version = await (dependencies.fetchJson || fetchJson)(`${config.chromeDebugBaseUrl}/json/version`, timeoutMs);
  const session = new CdpSession(version.webSocketDebuggerUrl, dependencies.options);
  await session.connect(timeoutMs);
  try {
    await session.send("Target.closeTarget", { targetId }, timeoutMs);
  } finally {
    await session.close();
  }
}

export async function withShoplingReturnMemoBrowserAdapter(config, orderNo, handler, dependencies = {}) {
  const url = popupUrl(orderNo);
  const target = await (dependencies.createTarget || createTarget)(config, url, dependencies);
  const connect = dependencies.withCdpTarget
    || ((selected, callback, options) => withBrowserCdpTarget(config, selected, callback, options));
  try {
    return await connect(target, async (session) => {
      await session.send("Page.enable", {}, dependencies.options?.timeoutMs || DEFAULT_TIMEOUT_MS);
      const adapter = createShoplingReturnMemoBrowserAdapter(
        session,
        orderNo,
        dependencies.options,
        dependencies,
      );
      await adapter.inspect();
      return handler(adapter);
    }, { timeoutMs: dependencies.options?.timeoutMs || DEFAULT_TIMEOUT_MS });
  } finally {
    await (dependencies.closeTarget || closeTarget)(config, target.id, dependencies).catch(() => null);
  }
}

export const SHOPLING_RETURN_MEMO_RULES = Object.freeze({
  path: POPUP_PATH,
  form: "csform",
  categoryValue: "R",
  categoryLabel: "메모",
  completionUnchecked: true,
  exactOrderRequired: true,
  readbackRequired: true,
});
