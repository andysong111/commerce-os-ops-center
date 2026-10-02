import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  shoplingTargets,
  withBrowserCdpTarget,
} from "./chrome-cdp.mjs";
import { acceptExpectedShoplingInvoiceDeletionFlow } from "./shopling-browser-dialog.mjs";
import {
  SHOPLING_B12_COMPLETED_LABEL,
  SHOPLING_B12_PENDING_LABEL,
} from "./shopling-b12-invoice-deletion.mjs";
import { normalizeTrackingNumber } from "./shopling-unshipped-reconciliation.mjs";

const B12_PATH = "/order/dlvy_list.phtml";
const SEARCH_INVOICE_LABEL = "운송장번호";
const SEARCH_ORDER_LABEL = "샵플링주문번호";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function b12PageProbe() {
  return {
    isB12: location.pathname === "/order/dlvy_list.phtml"
      && Boolean(document.querySelector("#dlvy_status_tp"))
      && Boolean(document.querySelector("#row_cnt")),
    url: location.href,
  };
}

function applyB12Filter(input) {
  const clean = (value) => String(value || "").replace(/\s+/g, "").trim();
  const choose = (select, label) => {
    const option = Array.from(select?.options || []).find((item) =>
      clean(item.textContent) === clean(label) || clean(item.value) === clean(label));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const status = document.querySelector("#dlvy_status_tp");
  const rowCount = document.querySelector("#row_cnt");
  const searchSelect = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options || []).some((option) => clean(option.textContent) === clean(input.searchLabel)));
  const searchRow = searchSelect?.closest("tr") || searchSelect?.parentElement?.parentElement;
  const searchInput = Array.from(searchRow?.querySelectorAll('input[type="text"], input:not([type])') || [])
    .find((field) => !field.disabled);
  const searchButton = Array.from(searchRow?.querySelectorAll('button, input[type="button"], input[type="submit"]') || [])
    .find((button) => clean(button.textContent || button.value) === "검색");

  if (!choose(status, input.statusLabel)) return { error: "B12_STATUS_OPTION_NOT_FOUND" };
  if (rowCount && !choose(rowCount, "1000")) return { error: "B12_ROW_COUNT_OPTION_NOT_FOUND" };
  if (!searchSelect || !choose(searchSelect, input.searchLabel)) return { error: "B12_SEARCH_OPTION_NOT_FOUND" };
  if (!searchInput) return { error: "B12_SEARCH_INPUT_NOT_FOUND" };
  if (!searchButton) return { error: "B12_SEARCH_BUTTON_NOT_FOUND" };
  searchInput.value = input.searchValue;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  searchInput.dispatchEvent(new Event("change", { bubbles: true }));
  searchButton.click();
  return { submitted: true };
}

function captureB12SafeSnapshot() {
  const clean = (value, limit = 120) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const selectedText = (select) => clean(select?.selectedOptions?.[0]?.textContent || "");
  const statusSelect = document.querySelector("#dlvy_status_tp");
  const statusLabel = selectedText(statusSelect);
  const searchSelect = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options || []).some((option) => clean(option.textContent).replace(/\s+/g, "") === "운송장번호"));
  const searchRow = searchSelect?.closest("tr") || searchSelect?.parentElement?.parentElement;
  const searchInput = Array.from(searchRow?.querySelectorAll('input[type="text"], input:not([type])') || [])
    .find((field) => !field.disabled);
  const completed = statusLabel.replace(/\s+/g, "") === "택배사전송완료";
  const rows = Array.from(document.querySelectorAll('input[name="chk[]"]')).map((checkbox) => {
    const row = checkbox.closest("tr");
    const shoplingOrderNo = clean(checkbox.value, 30);
    return {
      shoplingOrderNo,
      orderStatus: clean(row?.querySelector(`input[name="ord_status_${CSS.escape(shoplingOrderNo)}"]`)?.value, 20),
      invoiceText: completed ? clean(row?.cells?.[11]?.innerText, 100) : "",
      selected: Boolean(checkbox.checked),
    };
  }).filter((row) => row.shoplingOrderNo);
  return {
    readyState: document.readyState,
    url: location.href,
    resultCount: Number(document.querySelector('input[name="srch_t_cnt"]')?.value || rows.length),
    filters: {
      statusLabel,
      rowCount: clean(document.querySelector("#row_cnt")?.value, 20),
      searchLabel: selectedText(searchSelect),
      searchValue: clean(searchInput?.value, 100),
    },
    rows,
  };
}

function prepareExactInvoiceRows(input) {
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const expectedOrders = [...new Set(input.shoplingOrderNos.map(String))];
  const expectedSet = new Set(expectedOrders);
  const all = Array.from(document.querySelectorAll('input[name="chk[]"]'));
  const matched = all.filter((checkbox) => {
    const invoice = digits(checkbox.closest("tr")?.cells?.[11]?.innerText);
    return invoice.includes(input.invoiceNo);
  });
  const actualOrders = matched.map((checkbox) => String(checkbox.value || "").trim());
  const exact = actualOrders.length === expectedOrders.length
    && new Set(actualOrders).size === actualOrders.length
    && actualOrders.every((orderNo) => expectedSet.has(orderNo));
  if (!exact) {
    return {
      error: "B12_INVOICE_ORDER_SET_CHANGED",
      expectedOrderCount: expectedOrders.length,
      actualOrderCount: actualOrders.length,
    };
  }
  for (const checkbox of all) checkbox.checked = false;
  for (const checkbox of matched) checkbox.checked = true;
  const selectedOrders = all.filter((checkbox) => checkbox.checked).map((checkbox) => String(checkbox.value || "").trim());
  return {
    prepared: selectedOrders.length === expectedOrders.length
      && selectedOrders.every((orderNo) => expectedSet.has(orderNo)),
    selectedOrderCount: selectedOrders.length,
  };
}

function clickPreparedInvoiceDeletion(input) {
  const expectedSet = new Set(input.shoplingOrderNos.map(String));
  const selected = Array.from(document.querySelectorAll('input[name="chk[]"]:checked'))
    .map((checkbox) => String(checkbox.value || "").trim());
  if (selected.length !== expectedSet.size || !selected.every((orderNo) => expectedSet.has(orderNo))) {
    throw new Error("B12_SELECTED_ORDER_SET_CHANGED");
  }
  const clean = (value) => String(value || "").replace(/\s+/g, "").trim();
  const button = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
    .find((element) => clean(element.textContent || element.value) === "송장번호삭제");
  if (!button) throw new Error("B12_DELETE_BUTTON_NOT_FOUND");
  button.click();
  return { clicked: true };
}

export const SHOPLING_B12_PAGE_PROBE_EXPRESSION = `(${b12PageProbe.toString()})()`;
export const SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION = `(${captureB12SafeSnapshot.toString()})()`;
export const SHOPLING_B12_PREPARE_SELECTION_SOURCE = prepareExactInvoiceRows.toString();
export const SHOPLING_B12_DELETE_CLICK_SOURCE = clickPreparedInvoiceDeletion.toString();

async function expressionInB12Frame(session, expression, options = {}) {
  const results = await evaluateCdpExpressionAcrossFrames(session, expression, {
    timeoutMs: options.timeoutMs || 8_000,
  });
  const matches = results.filter((entry) => {
    try {
      return new URL(entry.frame.url).pathname === B12_PATH;
    } catch {
      return entry.value?.url && new URL(entry.value.url).pathname === B12_PATH;
    }
  });
  if (matches.length !== 1) {
    fail("SHOPLING_B12_FRAME_COUNT_INVALID", `Expected one Shopling B12 frame, found ${matches.length}.`);
  }
  return matches[0].value;
}

async function callInB12Frame(session, browserFunction, input, options = {}) {
  const expression = `(${browserFunction.toString()})(${JSON.stringify(input)})`;
  return expressionInB12Frame(session, expression, options);
}

export async function selectLiveShoplingB12Target(config, dependencies = {}) {
  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const connect = dependencies.withBrowserCdpTarget
    || ((target, handler) => withBrowserCdpTarget(config, target, handler, { timeoutMs: 10_000 }));
  const listed = await listTargets(config);
  if (!listed.available) fail("CHROME_DEBUG_UNAVAILABLE", listed.error?.message || "Chrome DevTools is unavailable.");

  const matches = [];
  for (const target of shoplingTargets(listed.targets, config.shoplingOrigins)) {
    const found = await connect(target, async (session) => {
      const results = await evaluateCdpExpressionAcrossFrames(session, SHOPLING_B12_PAGE_PROBE_EXPRESSION, {
        timeoutMs: 8_000,
      });
      return results.some((entry) => entry.value?.isB12 === true);
    }).catch(() => false);
    if (found) matches.push(target);
  }
  if (matches.length !== 1) {
    fail("SHOPLING_B12_TARGET_COUNT_INVALID", `Expected one browser tab containing B12, found ${matches.length}.`);
  }
  return matches[0];
}

function normalizeSnapshot(snapshot) {
  return {
    resultCount: Number(snapshot?.resultCount || 0),
    filters: snapshot?.filters || {},
    rows: (snapshot?.rows || []).map((row) => ({
      shoplingOrderNo: String(row.shoplingOrderNo || ""),
      orderStatus: String(row.orderStatus || ""),
      invoiceNo: normalizeTrackingNumber(row.invoiceText),
      selected: row.selected === true,
    })),
  };
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function filterAndCapture(session, input, options = {}) {
  const submitted = await callInB12Frame(session, applyB12Filter, input, options).catch((error) => {
    if (error.code === "SHOPLING_B12_FRAME_COUNT_INVALID"
      || /context|navigation|destroyed/i.test(error.message)) return { submitted: true };
    throw error;
  });
  if (submitted?.error) fail(submitted.error, "Shopling B12 filter controls were not found.");

  const timeoutMs = options.navigationTimeoutMs || 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    await sleep(options.pollIntervalMs || 300);
    try {
      lastSnapshot = await expressionInB12Frame(session, SHOPLING_B12_SAFE_SNAPSHOT_EXPRESSION, options);
      const statusMatches = String(lastSnapshot?.filters?.statusLabel || "").replace(/\s+/g, "")
        === input.statusLabel.replace(/\s+/g, "");
      const searchMatches = String(lastSnapshot?.filters?.searchLabel || "").replace(/\s+/g, "")
        === input.searchLabel.replace(/\s+/g, "");
      if (lastSnapshot?.readyState === "complete" && statusMatches && searchMatches) {
        return normalizeSnapshot(lastSnapshot);
      }
    } catch {
      // The frame is briefly unavailable while the legacy Shopling page reloads.
    }
  }
  fail("SHOPLING_B12_FILTER_TIMEOUT", "Shopling B12 did not finish applying the requested filter.");
}

export function createShoplingB12BrowserAdapter(session, options = {}) {
  return {
    async findCompletedByInvoice(invoiceNo) {
      return filterAndCapture(session, {
        statusLabel: SHOPLING_B12_COMPLETED_LABEL,
        searchLabel: SEARCH_INVOICE_LABEL,
        searchValue: invoiceNo,
      }, options);
    },
    async findPendingByOrder(shoplingOrderNo) {
      return filterAndCapture(session, {
        statusLabel: SHOPLING_B12_PENDING_LABEL,
        searchLabel: SEARCH_ORDER_LABEL,
        searchValue: shoplingOrderNo,
      }, options);
    },
    async deleteExactInvoiceRows(expected) {
      const prepared = await callInB12Frame(session, prepareExactInvoiceRows, expected, options);
      if (prepared?.error) fail(prepared.error, "The approved B12 order set changed before deletion.");
      if (!prepared?.prepared) fail("B12_INVOICE_SELECTION_FAILED", "B12 invoice rows could not be selected exactly.");
      return acceptExpectedShoplingInvoiceDeletionFlow(
        session,
        () => callInB12Frame(session, clickPreparedInvoiceDeletion, expected, options),
        {
          timeoutMs: options.dialogTimeoutMs || 8_000,
          followupTimeoutMs: options.followupTimeoutMs || 8_000,
        },
      );
    },
  };
}

export async function withShoplingB12BrowserAdapter(config, handler, dependencies = {}) {
  const target = await selectLiveShoplingB12Target(config, dependencies);
  const connect = dependencies.withBrowserCdpTarget
    || ((selected, next) => withBrowserCdpTarget(config, selected, next, { timeoutMs: 15_000 }));
  return connect(target, async (session) => handler(createShoplingB12BrowserAdapter(session, dependencies.options)));
}
