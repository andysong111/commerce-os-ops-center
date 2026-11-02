function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export function patchShoplingStockHf58PopupOwnership(source: string) {
  let patched = source.replace(/\r\n/g, "\n");
  patched = replaceOnce(
    patched,
    "async function exactResultTabIds() {",
    "async function exactResultTabIds(ownerA21ListTabId = null) {",
    "shopling_stock_hf58_result_ids_owner_argument",
  );
  patched = replaceOnce(
    patched,
    `          Number.isInteger(tab?.id) &&
          exactResultUrl(tab.url || tab.pendingUrl),`,
    `          Number.isInteger(tab?.id) &&
          exactResultUrl(tab.url || tab.pendingUrl) &&
          (!Number.isInteger(ownerA21ListTabId) ||
            Number(tab?.openerTabId) === ownerA21ListTabId),`,
    "shopling_stock_hf58_result_ids_owner_scope",
  );
  patched = replaceOnce(
    patched,
    "async function finishMissingPopup(jobId, beforeResultTabIds) {",
    "async function finishMissingPopup(jobId, beforeResultTabIds, ownerA21ListTabId) {",
    "shopling_stock_hf58_missing_popup_owner_argument",
  );
  patched = replaceOnce(
    patched,
    `    const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    if (newResultIds.length || popupTabs.length) {`,
    `    const popupTabsAll = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const popupTabs = popupTabsAll.filter(
      (tab) => Number(tab?.openerTabId) === ownerA21ListTabId,
    );
    if (newResultIds.length || popupTabs.length) {`,
    "shopling_stock_hf58_missing_popup_owner_scope",
  );
  patched = replaceOnce(
    patched,
    "    const resultIds = await exactResultTabIds();",
    "    const resultIds = await exactResultTabIds(ownerA21ListTabId);",
    "shopling_stock_hf58_missing_popup_result_owner_scope",
  );
  patched = replaceOnce(
    patched,
    "async function preflight(message) {",
    "async function preflight(message, sender) {",
    "shopling_stock_hf58_preflight_sender",
  );
  patched = replaceOnce(
    patched,
    `    const beforeResultTabIds = await exactResultTabIds();
    const tabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const closedTabIds = [];`,
    `    const ownerA21ListTabId = Number.isInteger(sender?.tab?.id)
      ? sender.tab.id
      : null;
    const expectedOwnerA21ListTabId = Number(
      active.workTabs?.A21_LIST?.tabId ?? active.shoplingTabId,
    );
    if (
      !Number.isInteger(ownerA21ListTabId) ||
      ownerA21ListTabId !== expectedOwnerA21ListTabId
    ) {
      return {
        ok: false,
        code: "A21_POPUP_OWNER_TAB_MISMATCH_HF58",
        message: "현재 작업에 배정된 A21 목록 탭 소유권을 확인하지 못해 상품 수정전송을 클릭하지 않았습니다.",
      };
    }
    const beforeResultTabIds = await exactResultTabIds(ownerA21ListTabId);
    const allTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const tabs = allTabs.filter(
      (tab) => Number(tab?.openerTabId) === ownerA21ListTabId,
    );
    const ignoredForeignPopupTabIds = allTabs
      .filter((tab) => Number(tab?.openerTabId) !== ownerA21ListTabId)
      .map((tab) => tab.id)
      .filter(Number.isInteger);
    const closedTabIds = [];`,
    "shopling_stock_hf58_owner_scoped_popup_query",
  );
  patched = replaceOnce(
    patched,
    `    const remaining = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    if (remaining.length) {`,
    `    const remainingAll = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const remaining = remainingAll.filter(
      (tab) => Number(tab?.openerTabId) === ownerA21ListTabId,
    );
    if (remaining.length) {`,
    "shopling_stock_hf58_owner_scoped_remaining_query",
  );
  patched = replaceOnce(
    patched,
    `      () => void finishMissingPopup(jobId, beforeResultTabIds),`,
    `      () => void finishMissingPopup(jobId, beforeResultTabIds, ownerA21ListTabId),`,
    "shopling_stock_hf58_missing_popup_owner_timeout",
  );
  patched = replaceOnce(
    patched,
    `      beforeResultTabIds,
      extensionVersion: VERSION_V077,`,
    `      beforeResultTabIds,
      ownerA21ListTabId,
      ignoredForeignPopupTabIds,
      popupOwnershipScope: "EXACT_OPENER_TAB_HF58",
      extensionVersion: VERSION_V077,`,
    "shopling_stock_hf58_owner_scope_evidence",
  );
  patched = replaceOnce(
    patched,
    `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== PREFLIGHT) return;
    void preflight(message)`,
    `  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== PREFLIGHT) return;
    void preflight(message, sender)`,
    "shopling_stock_hf58_preflight_listener_sender",
  );
  return patched;
}

export function patchShoplingStockHf58DispatchAcceptance(source: string) {
  let patched = source.replace(/\r\n/g, "\n");
  patched = replaceOnce(
    patched,
    'importScripts("background-v078.js")',
    'importScripts("background-v078-hf58.js")',
    "shopling_stock_hf58_dispatch_import",
  );
  patched = replaceOnce(
    patched,
    `    if (!finalOptionBatchSubmitted(active)) return false;

    const key =`,
    `    if (!finalOptionBatchSubmitted(active)) return false;

    const expectedOwnerA21ListTabId = Number(
      active.workTabs?.A21_LIST?.tabId ?? active.shoplingTabId,
    );
    const resultTab = await chrome.tabs.get(tabId).catch(() => null);
    if (
      !Number.isInteger(expectedOwnerA21ListTabId) ||
      Number(resultTab?.openerTabId) !== expectedOwnerA21ListTabId
    ) {
      return false;
    }

    const key =`,
    "shopling_stock_hf58_result_owner_guard",
  );
  patched = replaceOnce(
    patched,
    'code: "SHOPLING_DISPATCH_ACCEPTED_HF57"',
    'code: "SHOPLING_PROCESSING_SCREEN_ACCEPTED_HF58"',
    "shopling_stock_hf58_processing_screen_code",
  );
  patched = replaceOnce(
    patched,
    "          shoplingDispatchAccepted: true,",
    `          shoplingDispatchAccepted: true,
          processingScreenOrResultPageAccepted: true,
          popupOwnershipScope: "EXACT_OPENER_TAB_HF58",
          ownerA21ListTabId: expectedOwnerA21ListTabId,`,
    "shopling_stock_hf58_processing_screen_evidence",
  );
  return patched;
}
