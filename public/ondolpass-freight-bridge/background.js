"use strict";

const FETCH_TYPE = "COMMERCE_OS_ONDOLPASS_FETCH_V1";
const CAPTURE_TYPE = "COMMERCE_OS_ONDOLPASS_CAPTURE_V1";
const APPLICATION_NO_PATTERN = /^\d{4,20}$/;
const PAGE_TIMEOUT_MS = 25_000;
let activeImport;

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isAllowedCommerceSender(sender) {
  try {
    const url = new URL(String(sender.url || ""));
    const allowedOrigin =
      url.origin === "https://commerce-os-ops-center.vercel.app" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost";
    return allowedOrigin && url.pathname === "/freight-barcode-request";
  } catch {
    return false;
  }
}

function applicationNoFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const allowedHost =
      url.hostname === "ondolpass.co.kr" ||
      url.hostname === "www.ondolpass.co.kr";
    return url.protocol === "https:" &&
      allowedHost &&
      url.pathname === "/order/order_view.php"
      ? url.searchParams.get("order_no") || ""
      : "";
  } catch {
    return "";
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => finish(makeError("ONDOLPASS_PAGE_TIMEOUT")), PAGE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function finish(error, tab) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(tab);
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish(undefined, tab);
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId === tabId) finish(makeError("ONDOLPASS_PAGE_TIMEOUT"));
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish(undefined, tab);
      })
      .catch(() => finish(makeError("ONDOLPASS_PAGE_TIMEOUT")));
  });
}

async function sendCaptureWithRetry(tabId, applicationNo) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: CAPTURE_TYPE,
        applicationNo,
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw makeError("APPLICATION_NOT_FOUND_OR_EMPTY");
}

async function captureWithReadOnlyInjection(tabId, applicationNo) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["ondolpass-extractor.js", "ondolpass-capture.js"],
    });
  } catch {
    throw makeError("ONDOLPASS_CAPTURE_UNAVAILABLE");
  }

  const capture = results && results[0] && results[0].result;
  if (!capture || !capture.ok) {
    throw makeError(
      capture && typeof capture.errorCode === "string"
        ? capture.errorCode
        : "APPLICATION_NOT_FOUND_OR_EMPTY",
    );
  }
  if (
    !capture.payload ||
    capture.payload.applicationNo !== applicationNo
  ) {
    throw makeError("APPLICATION_NUMBER_MISMATCH");
  }
  return capture;
}

async function focusTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // The tab may have been closed by the operator.
  }
}

async function findOrOpenApplicationTab(applicationNo) {
  const existingTabs = await chrome.tabs.query({
    url: [
      "https://ondolpass.co.kr/order/order_view.php*",
      "https://www.ondolpass.co.kr/order/order_view.php*",
    ],
  });
  const existing = existingTabs
    .filter((tab) => applicationNoFromUrl(tab.url) === applicationNo && tab.id)
    .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  if (existing && existing.id) return { tab: existing, created: false };

  const url = `https://www.ondolpass.co.kr/order/order_view.php?order_no=${encodeURIComponent(applicationNo)}`;
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw makeError("ONDOLPASS_PAGE_TIMEOUT");
  return { tab, created: true };
}

async function importApplication(applicationNo) {
  const opened = await findOrOpenApplicationTab(applicationNo);
  const tabId = opened.tab.id;
  try {
    const loadedTab = await waitForTabComplete(tabId);
    if (applicationNoFromUrl(loadedTab.url) !== applicationNo) {
      await focusTab(tabId);
      throw makeError("ONDOLPASS_LOGIN_REQUIRED");
    }
    let capture;
    try {
      capture = await captureWithReadOnlyInjection(tabId, applicationNo);
    } catch (error) {
      if (!error || error.code !== "ONDOLPASS_CAPTURE_UNAVAILABLE") throw error;
      capture = await sendCaptureWithRetry(tabId, applicationNo);
    }
    if (!capture || !capture.ok) {
      throw makeError(
        capture && typeof capture.errorCode === "string"
          ? capture.errorCode
          : "APPLICATION_NOT_FOUND_OR_EMPTY",
      );
    }
    if (opened.created) await chrome.tabs.remove(tabId);
    return capture.payload;
  } catch (error) {
    if (error && error.code === "ONDOLPASS_LOGIN_REQUIRED") {
      await focusTab(tabId);
    } else if (opened.created) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // The tab may already be closed.
      }
    }
    throw error;
  }
}

async function runSerializedImport(applicationNo) {
  if (activeImport) {
    if (activeImport.applicationNo === applicationNo) return activeImport.promise;
    throw makeError("BRIDGE_BUSY");
  }

  const promise = importApplication(applicationNo).finally(() => {
    if (activeImport && activeImport.promise === promise) activeImport = undefined;
  });
  activeImport = { applicationNo, promise };
  return promise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !message ||
    message.type !== FETCH_TYPE ||
    !isAllowedCommerceSender(sender)
  ) {
    return false;
  }

  const applicationNo = String(message.applicationNo || "").trim();
  if (!APPLICATION_NO_PATTERN.test(applicationNo)) {
    sendResponse({ ok: false, errorCode: "APPLICATION_NUMBER_MISMATCH" });
    return false;
  }

  runSerializedImport(applicationNo)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) =>
      sendResponse({
        ok: false,
        errorCode:
          error && typeof error.code === "string"
            ? error.code
            : "BRIDGE_UNKNOWN_ERROR",
      }),
    );
  return true;
});
