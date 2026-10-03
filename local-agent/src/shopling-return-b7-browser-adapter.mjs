import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  shoplingTargets,
  withBrowserCdpTarget,
} from "./chrome-cdp.mjs";

const B7_PATH = "/order/order_list.phtml";
const B7_URL = `https://a.shopling.co.kr${B7_PATH}`;
const SOURCE_STATUS = "A05";
const RETURN_RECEIVED_STATUS = "R01";
const STATUS_CONFIRMATION = "선택하신 주문 상태를 변경하시겠습니까?";
const DEFAULT_TIMEOUT_MS = 15_000;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function b7PageProbe() {
  return {
    isB7: location.pathname === "/order/order_list.phtml"
      && Boolean(document.querySelector('select[name="ordstat_tp"]'))
      && Boolean(document.querySelector('select[name="status"]')),
    path: location.pathname,
    readyState: document.readyState,
  };
}

function applyExactB7OrderSearch(input) {
  const choose = (name, value) => {
    const select = document.querySelector(`select[name="${name}"]`);
    if (!select || !Array.from(select.options).some((option) => option.value === value)) return false;
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  if (!choose("ordstat_tp", "")) return { error: "B7_ORDER_STATUS_FILTER_MISSING" };
  if (!choose("srch_tp1", "spl_code")) return { error: "B7_ORDER_SEARCH_FILTER_MISSING" };
  if (!choose("srch_tp2", "equal")) return { error: "B7_EXACT_SEARCH_FILTER_MISSING" };
  const rowCount = document.querySelector('select[name="row_cnt"], #row_cnt');
  if (rowCount && Array.from(rowCount.options).some((option) => option.value === "1000")) {
    rowCount.value = "1000";
    rowCount.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const noTerm = document.querySelector('input[name="all_srch_no_term_btn"]');
  if (noTerm) noTerm.checked = true;
  const searchInput = document.querySelector('input[name="srch_txt1"]');
  if (!searchInput) return { error: "B7_ORDER_SEARCH_INPUT_MISSING" };
  searchInput.value = input.orderNo;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  searchInput.dispatchEvent(new Event("change", { bubbles: true }));
  const row = searchInput.closest("tr") || searchInput.parentElement?.parentElement;
  const searchButton = Array.from(row?.querySelectorAll('button, input[type="button"], input[type="submit"]') || [])
    .find((element) => String(element.textContent || element.value || "").replace(/\s+/g, "").trim() === "검색");
  if (!searchButton) return { error: "B7_ORDER_SEARCH_BUTTON_MISSING" };
  searchButton.click();
  return { submitted: true };
}

function captureB7SafeSnapshot() {
  const selected = (name) => {
    const element = document.querySelector(`select[name="${name}"]`);
    return {
      value: String(element?.value || ""),
      label: String(element?.selectedOptions?.[0]?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  };
  const rows = Array.from(document.querySelectorAll('input[name="chk[]"]')).map((checkbox) => {
    const row = checkbox.closest("tr");
    const orderNo = String(checkbox.value || "").trim();
    const hiddenStatus = row?.querySelector(`input[name="ord_status_${CSS.escape(orderNo)}"]`)?.value;
    return {
      orderNo,
      statusCode: String(checkbox.getAttribute("stcd") || hiddenStatus || "").trim(),
      selected: checkbox.checked === true,
    };
  }).filter((row) => row.orderNo);
  return {
    path: location.pathname,
    readyState: document.readyState,
    filters: {
      orderStatus: selected("ordstat_tp"),
      searchType: selected("srch_tp1"),
      searchMatch: selected("srch_tp2"),
      searchValue: String(document.querySelector('input[name="srch_txt1"]')?.value || "").trim(),
    },
    resultCount: Number(document.querySelector('input[name="srch_t_cnt"]')?.value || rows.length),
    rows,
  };
}

function prepareExactReturnRegistration(input) {
  const all = Array.from(document.querySelectorAll('input[name="chk[]"]'));
  const matching = all.filter((checkbox) => String(checkbox.value || "").trim() === input.orderNo);
  if (!matching.length || matching.length !== all.length) {
    return {
      error: "B7_EXACT_ORDER_SET_CHANGED",
      resultCount: all.length,
      matchedCount: matching.length,
    };
  }
  const statuses = [...new Set(matching.map((checkbox) => String(checkbox.getAttribute("stcd") || "").trim()))];
  if (statuses.length !== 1 || statuses[0] !== input.expectedStatus) {
    return { error: "B7_SOURCE_STATUS_CHANGED", statuses };
  }
  for (const checkbox of all) checkbox.checked = false;
  for (const checkbox of matching) checkbox.checked = true;
  const status = document.querySelector('select[name="status"]');
  if (!status || !Array.from(status.options).some((option) => option.value === input.nextStatus)) {
    return { error: "B7_RETURN_STATUS_OPTION_MISSING" };
  }
  const claimContent = document.querySelector('input[name="status_claim_content"]');
  if (!claimContent) return { error: "B7_CLAIM_CONTENT_INPUT_MISSING" };
  status.value = input.nextStatus;
  status.dispatchEvent(new Event("change", { bubbles: true }));
  claimContent.value = input.claimContent;
  claimContent.dispatchEvent(new Event("input", { bubbles: true }));
  claimContent.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    prepared: true,
    selectedCount: matching.length,
    sourceStatus: statuses[0],
    nextStatus: status.value,
    claimContentPresent: Boolean(String(claimContent.value || "").trim()),
  };
}

function clickPreparedReturnRegistration(input) {
  const selected = Array.from(document.querySelectorAll('input[name="chk[]"]:checked'));
  if (!selected.length || selected.some((checkbox) => String(checkbox.value || "").trim() !== input.orderNo)) {
    throw new Error("B7_SELECTED_ORDER_SET_CHANGED");
  }
  if (selected.some((checkbox) => String(checkbox.getAttribute("stcd") || "").trim() !== input.expectedStatus)) {
    throw new Error("B7_SOURCE_STATUS_CHANGED");
  }
  if (document.querySelector('select[name="status"]')?.value !== input.nextStatus) {
    throw new Error("B7_TARGET_STATUS_CHANGED");
  }
  if (!String(document.querySelector('input[name="status_claim_content"]')?.value || "").trim()) {
    throw new Error("B7_CLAIM_CONTENT_MISSING");
  }
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
    .filter((element) => visible(element)
      && String(element.textContent || element.value || "").replace(/\s+/g, "").trim() === "주문상태변경");
  if (buttons.length !== 1) throw new Error(`B7_STATUS_BUTTON_COUNT_INVALID:${buttons.length}`);
  buttons[0].click();
  return { clicked: true };
}

export const SHOPLING_B7_PAGE_PROBE_EXPRESSION = `(${b7PageProbe.toString()})()`;
export const SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION = `(${captureB7SafeSnapshot.toString()})()`;
export const SHOPLING_B7_PREPARE_RETURN_SOURCE = prepareExactReturnRegistration.toString();
export const SHOPLING_B7_SUBMIT_RETURN_SOURCE = clickPreparedReturnRegistration.toString();

async function evaluateInFrame(session, frame, expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!frame?.id) {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      fail("SHOPLING_B7_BROWSER_EVALUATION_FAILED", result.exceptionDetails.exception?.description
        || result.exceptionDetails.text || "Shopling B7 browser evaluation failed.");
    }
    return result.result?.value;
  }
  const world = await session.send("Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: "commerce-os-shopling-return-b7",
    grantUniveralAccess: false,
  }, timeoutMs);
  const result = await session.send("Runtime.evaluate", {
    expression,
    contextId: world.executionContextId,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    fail("SHOPLING_B7_BROWSER_EVALUATION_FAILED", result.exceptionDetails.exception?.description
      || result.exceptionDetails.text || "Shopling B7 browser evaluation failed.");
  }
  return result.result?.value;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function selectShoplingB7Frame(results = []) {
  const matches = results.filter((entry) => entry?.value?.isB7 === true);
  if (matches.length !== 1) {
    fail("SHOPLING_B7_FRAME_COUNT_INVALID", "Exactly one Shopling B7 frame is required.", {
      matchCount: matches.length,
    });
  }
  return matches[0];
}

async function waitForB7(session, options = {}, dependencies = {}) {
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCdpExpressionAcrossFrames;
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.navigationTimeoutMs || 15_000);
  while (Date.now() < deadline) {
    const results = await evaluateAcross(session, SHOPLING_B7_PAGE_PROBE_EXPRESSION, {
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    }).catch(() => []);
    const matches = results.filter((entry) => entry?.value?.isB7 === true
      && entry.value.readyState === "complete");
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return selectShoplingB7Frame(matches);
    await wait(options.pollIntervalMs || 300);
  }
  fail("SHOPLING_B7_LOAD_TIMEOUT", "Shopling B7 did not finish loading.");
}

async function navigateB7(session, options = {}, dependencies = {}) {
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCdpExpressionAcrossFrames;
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const existing = await evaluateAcross(session, SHOPLING_B7_PAGE_PROBE_EXPRESSION, {
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
  }).catch(() => []);
  const current = existing.filter((entry) => entry?.value?.isB7 === true);
  if (current.length === 1 && current[0].value.readyState === "complete") return current[0];

  const navigationProbe = await evaluateAcross(session, `(() => ({
    path: location.pathname,
    readyState: document.readyState,
    bodyLength: String(document.body?.innerText || '').length,
  }))()`, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
  const mainFrames = navigationProbe.filter((entry) => entry.frame?.name === "main");
  const fallbackFrames = navigationProbe.filter((entry) => entry.value?.path === "/main.phtml"
    && entry.value.bodyLength > 0);
  const frame = mainFrames.length === 1 ? mainFrames[0] : fallbackFrames[0];
  if (!frame) {
    fail("SHOPLING_MAIN_FRAME_MISSING", "The authenticated Shopling main frame was not found.");
  }
  await evaluateFrame(
    session,
    frame.frame,
    `(() => { location.assign(${JSON.stringify(B7_URL)}); return { navigating: true }; })()`,
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  ).catch((error) => {
    if (!/context|navigation|destroyed/i.test(error.message)) throw error;
  });
  return waitForB7(session, options, dependencies);
}

function normalizeSnapshot(snapshot) {
  return {
    resultCount: Number(snapshot?.resultCount || 0),
    filters: snapshot?.filters || {},
    rows: (snapshot?.rows || []).map((row) => ({
      orderNo: clean(row.orderNo),
      statusCode: clean(row.statusCode),
      selected: row.selected === true,
    })),
  };
}

function assertExactSnapshot(snapshot, orderNo, allowedStatuses) {
  if (!snapshot.rows.length || snapshot.rows.some((row) => row.orderNo !== orderNo)) {
    fail("B7_EXACT_ORDER_NOT_FOUND", "The exact Shopling order was not found in B7.", {
      resultCount: snapshot.rows.length,
    });
  }
  const statuses = [...new Set(snapshot.rows.map((row) => row.statusCode))];
  if (statuses.some((status) => !allowedStatuses.includes(status))) {
    fail("B7_ORDER_STATUS_UNEXPECTED", "The Shopling order is not in an allowed B7 status.", { statuses });
  }
  return { ...snapshot, statuses };
}

async function searchAndCapture(session, orderNo, options = {}, dependencies = {}) {
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const wait = dependencies.sleep || sleep;
  let frame = await navigateB7(session, options, dependencies);
  const applied = await evaluateFrame(
    session,
    frame.frame,
    `(${applyExactB7OrderSearch.toString()})(${JSON.stringify({ orderNo })})`,
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  ).catch((error) => {
    if (/context|navigation|destroyed/i.test(error.message)) return { submitted: true };
    throw error;
  });
  if (applied?.error) fail(applied.error, "The exact B7 order search controls were not available.");
  await wait(options.initialSearchDelayMs || 500);
  frame = await waitForB7(session, options, dependencies);
  const deadline = Date.now() + (options.navigationTimeoutMs || 15_000);
  while (Date.now() < deadline) {
    const raw = await evaluateFrame(
      session,
      frame.frame,
      SHOPLING_B7_SAFE_SNAPSHOT_EXPRESSION,
      options.timeoutMs || DEFAULT_TIMEOUT_MS,
    ).catch(() => null);
    if (raw?.readyState === "complete"
      && raw.filters?.searchType?.value === "spl_code"
      && raw.filters?.searchMatch?.value === "equal"
      && raw.filters?.searchValue === orderNo) return { snapshot: normalizeSnapshot(raw), frame };
    await wait(options.pollIntervalMs || 300);
  }
  fail("SHOPLING_B7_SEARCH_TIMEOUT", "Shopling B7 did not finish the exact order search.");
}

export function createShoplingReturnB7BrowserAdapter(session, options = {}, dependencies = {}) {
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const handleStatusDialog = dependencies.acceptStatusDialog || acceptExpectedShoplingStatusDialog;
  return {
    async inspect() {
      const frame = await navigateB7(session, options, dependencies);
      return {
        ready: frame.value?.readyState === "complete",
        path: frame.value?.path || "",
        frameName: frame.frame?.name || "",
      };
    },

    async readExactOrder(orderNo) {
      const normalizedOrderNo = clean(orderNo);
      if (!normalizedOrderNo) fail("B7_ORDER_NUMBER_REQUIRED", "A Shopling order number is required.");
      const { snapshot } = await searchAndCapture(session, normalizedOrderNo, options, dependencies);
      return assertExactSnapshot(snapshot, normalizedOrderNo, [SOURCE_STATUS, RETURN_RECEIVED_STATUS]);
    },

    async registerReturnReceived(input) {
      const orderNo = clean(input?.orderNo);
      const claimContent = clean(input?.claimContent);
      if (!orderNo) fail("B7_ORDER_NUMBER_REQUIRED", "A Shopling order number is required.");
      if (!claimContent) fail("B7_CLAIM_CONTENT_REQUIRED", "Claim content is required for B7 return registration.");
      const searched = await searchAndCapture(session, orderNo, options, dependencies);
      const before = assertExactSnapshot(
        searched.snapshot,
        orderNo,
        [SOURCE_STATUS, RETURN_RECEIVED_STATUS],
      );
      if (before.statuses.length === 1 && before.statuses[0] === RETURN_RECEIVED_STATUS) {
        return { changed: false, alreadyRegistered: true, orderNo, statusCode: RETURN_RECEIVED_STATUS };
      }
      if (before.statuses.length !== 1 || before.statuses[0] !== SOURCE_STATUS) {
        fail("B7_SOURCE_STATUS_CHANGED", "All exact order rows must still be in A05 before registration.", {
          statuses: before.statuses,
        });
      }
      const operation = {
        orderNo,
        expectedStatus: SOURCE_STATUS,
        nextStatus: RETURN_RECEIVED_STATUS,
        claimContent,
        confirmation: STATUS_CONFIRMATION,
      };
      const prepared = await evaluateFrame(
        session,
        searched.frame.frame,
        `(${prepareExactReturnRegistration.toString()})(${JSON.stringify(operation)})`,
        options.timeoutMs || DEFAULT_TIMEOUT_MS,
      );
      if (prepared?.error) fail(prepared.error, "The exact B7 return registration could not be prepared.", prepared);
      await handleStatusDialog(session, async () => {
        const clicked = await evaluateFrame(
          session,
          searched.frame.frame,
          `(${clickPreparedReturnRegistration.toString()})(${JSON.stringify(operation)})`,
          options.timeoutMs || DEFAULT_TIMEOUT_MS,
        );
        if (!clicked?.clicked) fail("B7_STATUS_CLICK_FAILED", "The B7 status-change button was not clicked.");
      }, { timeoutMs: options.dialogTimeoutMs || 8_000 });
      await sleep(options.initialSearchDelayMs || 500);
      const afterSearch = await searchAndCapture(session, orderNo, options, dependencies);
      const after = assertExactSnapshot(
        afterSearch.snapshot,
        orderNo,
        [RETURN_RECEIVED_STATUS],
      );
      if (after.statuses.length !== 1 || after.statuses[0] !== RETURN_RECEIVED_STATUS) {
        fail("B7_RETURN_REGISTRATION_READBACK_FAILED", "B7 did not read back R01 for every exact order row.");
      }
      return {
        changed: true,
        alreadyRegistered: false,
        orderNo,
        statusCode: RETURN_RECEIVED_STATUS,
        selectedRowCount: prepared.selectedCount,
        confirmationVerified: true,
      };
    },
  };
}

export function isExpectedShoplingStatusDialog(dialog = {}) {
  return dialog.type === "confirm" && clean(dialog.message) === STATUS_CONFIRMATION;
}

export async function acceptExpectedShoplingStatusDialog(session, trigger, options = {}) {
  const timeoutMs = options.timeoutMs || 8_000;
  await session.send("Page.enable", {}, timeoutMs);
  let timer;
  let unsubscribe = () => {};
  const opened = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error("Shopling B7 status confirmation did not appear."),
      { code: "B7_STATUS_DIALOG_TIMEOUT" },
    )), timeoutMs);
    unsubscribe = session.on("Page.javascriptDialogOpening", (dialog) => {
      clearTimeout(timer);
      resolve(dialog);
    });
  });
  let triggered;
  try {
    triggered = Promise.resolve().then(trigger);
    const dialog = await Promise.race([
      opened,
      triggered.then(() => new Promise(() => {}), (error) => Promise.reject(error)),
    ]);
    if (!isExpectedShoplingStatusDialog(dialog)) {
      await session.send("Page.handleJavaScriptDialog", { accept: false }, timeoutMs).catch(() => null);
      fail("B7_STATUS_DIALOG_UNEXPECTED", "An unexpected Shopling B7 dialog was refused.");
    }
    await session.send("Page.handleJavaScriptDialog", { accept: true }, timeoutMs);
    await triggered;
    return { accepted: true, messageVerified: true, type: dialog.type };
  } finally {
    clearTimeout(timer);
    unsubscribe();
    if (triggered) await triggered.catch(() => null);
  }
}

export async function selectLiveShoplingB7Target(config, dependencies = {}) {
  const listing = await (dependencies.listChromeTargets || listChromeTargets)(config);
  if (!listing.available) fail("CHROME_CDP_UNAVAILABLE", listing.error?.message || "Chrome DevTools is unavailable.");
  const candidates = shoplingTargets(listing.targets || [], config.shoplingOrigins)
    .filter((target) => !/\/login\.phtml(?:[?#]|$)/i.test(target.url));
  const target = candidates.find((item) => new URL(item.url).pathname === B7_PATH) || candidates[0];
  if (!target) fail("SHOPLING_CONTROL_TARGET_MISSING", "A logged-in Shopling tab was not found in dedicated Chrome.");
  return target;
}

export async function withShoplingReturnB7BrowserAdapter(config, handler, dependencies = {}) {
  const target = await selectLiveShoplingB7Target(config, dependencies);
  const connect = dependencies.withCdpTarget
    || ((selected, callback, options) => withBrowserCdpTarget(
      config,
      selected,
      callback,
      options,
    ));
  return connect(target, async (session) => {
    await navigateB7(session, dependencies.options, dependencies);
    if (dependencies.expectedAccount) {
      const frames = await evaluateCdpExpressionAcrossFrames(session, `(() => ({
        path: location.pathname,
        header: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1000),
      }))()`, { timeoutMs: 5_000 });
      const marker = `[${clean(dependencies.expectedAccount)}]`;
      if (!frames.some((entry) => entry.value?.path !== "/login.phtml"
        && String(entry.value?.header || "").includes(marker))) {
        fail("SHOPLING_ACCOUNT_MISMATCH", `Shopling is not logged in as ${clean(dependencies.expectedAccount)}.`);
      }
    }
    return handler(createShoplingReturnB7BrowserAdapter(session, dependencies.options, dependencies));
  }, { timeoutMs: dependencies.options?.timeoutMs || 15_000 });
}

export const SHOPLING_RETURN_B7_RULES = Object.freeze({
  sourceStatus: SOURCE_STATUS,
  nextStatus: RETURN_RECEIVED_STATUS,
  exactConfirmation: STATUS_CONFIRMATION,
  searchType: "spl_code",
  searchMatch: "equal",
});
