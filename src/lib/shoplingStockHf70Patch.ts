function replaceOnce(source: string, before: string, after: string, code: string) {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const normalizedBefore = before.replace(/\r\n?/g, "\n");
  const first = normalizedSource.indexOf(normalizedBefore);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (normalizedSource.indexOf(normalizedBefore, first + normalizedBefore.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${normalizedSource.slice(0, first)}${after}${normalizedSource.slice(first + normalizedBefore.length)}`;
}

export function patchHf70A21ContentSource(source: string) {
  const next = replaceOnce(
    source,
    'const VERSION = "0.2.6";',
    'const VERSION = "0.2.7";',
    "hf70_content_version",
  );
  const before = `  function optionModeEvidence(control) {
    const chunks = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) chunks.push(label.textContent || "");
      }
    }
    const wrapping = control?.closest?.("label");
    if (wrapping) chunks.push(wrapping.textContent || "");
    for (const node of [
      control?.previousSibling,
      control?.nextSibling,
      control?.previousElementSibling,
      control?.nextElementSibling,
      control?.parentElement,
      control?.closest?.("td,th"),
      control?.closest?.("tr"),
    ]) {
      if (node) chunks.push(node.textContent || node.nodeValue || "");
    }
    return compact(chunks.join(" | "));
  }

  function isVisibleOptionModeEvidence(text) {
    const value = compact(text);
    return value.includes("옵션송신") &&
      !value.includes("선택") &&
      !value.includes("추가상품송신") &&
      !value.includes("옵션+추가상품송신");
  }

  function semanticOptionMode() {
    const candidates = uniqueControls([
      ...document.querySelectorAll('input[type="radio"]'),
    ]).filter((control) => isVisibleOptionModeEvidence(optionModeEvidence(control)));
    // This restores the proven pre-HF68 behavior: choose the visible top mode
    // control by page order, click it, then locate the lower option-only row.
    candidates.sort(
      (left, right) =>
        left.getBoundingClientRect().top - right.getBoundingClientRect().top ||
        left.getBoundingClientRect().left - right.getBoundingClientRect().left,
    );
    return candidates[0] || null;
  }`;
  const after = `  function exactOptionModeOwner(control) {
    const candidates = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) candidates.push(label);
      }
    }
    for (const node of [
      control?.closest?.("label"),
      control?.closest?.("td,th"),
      control?.parentElement,
    ]) {
      if (node) candidates.push(node);
    }
    return candidates.some((node) => {
      const controls = controlInsideLabelOrCell(node);
      return isExactOptionModeCell(node.textContent, controls.length) &&
        controls.length === 1 && controls[0] === control;
    });
  }

  function semanticOptionMode() {
    const candidates = uniqueControls([
      ...document.querySelectorAll('input[type="radio"]'),
    ]).filter((control) => visibleChoice(control) && exactOptionModeOwner(control));
    // Never inspect the whole top row here. That row contains all three mode
    // labels, which made the leftmost 일반내용수정 radio look like 옵션송신.
    return candidates.length === 1 ? candidates[0] : null;
  }`;
  return replaceOnce(next, before, after, "hf70_content_exact_mode_owner");
}

export function patchHf70A21MainSource(source: string) {
  const next = replaceOnce(
    source,
    'const VERSION = "0.2.6";',
    'const VERSION = "0.2.7";',
    "hf70_main_version",
  );
  const before = `  function semanticModeMatches(control) {
    const chunks = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) chunks.push(label.textContent || "");
      }
    }
    for (const node of [
      control?.closest?.("label"),
      control?.previousSibling,
      control?.nextSibling,
      control?.previousElementSibling,
      control?.nextElementSibling,
      control?.parentElement,
      control?.closest?.("td,th"),
      control?.closest?.("tr"),
    ]) {
      if (node) chunks.push(node.textContent || node.nodeValue || "");
    }
    const evidence = compact(chunks.join(" | "));
    return evidence.includes("옵션송신") &&
      !evidence.includes("선택") &&
      !evidence.includes("추가상품송신") &&
      !evidence.includes("옵션+추가상품송신");
  }`;
  const after = `  function semanticModeMatches(control) {
    const candidates = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) candidates.push(label);
      }
    }
    for (const node of [
      control?.closest?.("label"),
      control?.closest?.("td,th"),
      control?.parentElement,
    ]) {
      if (node) candidates.push(node);
    }
    return candidates.some((node) => {
      const controls = [...node.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      if (node instanceof HTMLLabelElement && node.htmlFor) {
        const target = document.getElementById(node.htmlFor);
        if (target) controls.push(target);
      }
      const unique = [...new Set(controls)];
      return compact(node.textContent) === "옵션송신" &&
        unique.length === 1 && unique[0] === control;
    });
  }`;
  return replaceOnce(next, before, after, "hf70_main_exact_mode_owner");
}

export function patchHf70OptionClaimSource(source: string) {
  const beforeHelper = `  function exactPopupUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();
    } catch {
      return false;
    }
  }`;
  const afterHelper = `${beforeHelper}

  async function exactFreshOwnedPopupV070(active, tabId) {
    const listTabId = Number(active?.workTabs?.A21_LIST?.tabId);
    if (!Number.isInteger(tabId) || !Number.isInteger(listTabId)) return false;
    const persistedPopupTabId = Number(active?.workTabs?.A21_POPUP?.tabId);
    if (active?.stage === "A21_POPUP") return persistedPopupTabId === tabId;
    if (active?.stage !== "A21_LIST" || active?.a21CanonicalStage !== "POPUP_OPENING") return false;
    const baseline = new Set(
      (Array.isArray(active?.a21PopupBaselineTabIds) ? active.a21PopupBaselineTabIds : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    if (baseline.has(tabId)) return false;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    return Number(tab?.openerTabId) === listTabId;
  }`;
  const next = replaceOnce(
    source,
    beforeHelper,
    afterHelper,
    "hf70_option_owner_helper",
  );
  const beforeGuard = `        if (!Number.isInteger(tabId) || !exactPopupUrl(href)) {
          sendResponse({ ok: false, error: "stock_price_core_popup_target_mismatch", version: VERSION });
          return;
        }

        // HF8: do not advance into A21_POPUP merely because the list worker says it`;
  const afterGuard = `        if (!Number.isInteger(tabId) || !exactPopupUrl(href)) {
          sendResponse({ ok: false, error: "stock_price_core_popup_target_mismatch", version: VERSION });
          return;
        }
        if (!(await exactFreshOwnedPopupV070(active, tabId))) {
          sendResponse({ ok: false, error: "stock_price_core_popup_owner_mismatch_hf70", version: VERSION });
          return;
        }

        // HF8: do not advance into A21_POPUP merely because the list worker says it`;
  return replaceOnce(next, beforeGuard, afterGuard, "hf70_option_owner_guard");
}

export function patchHf70OptionListSource(source: string) {
  let next = replaceOnce(
    source,
    `    const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    if (popupTabs.some((tab) => Number.isInteger(tab?.id))) return active;`,
    `    const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const baseline = new Set(
      (Array.isArray(active.a21PopupBaselineTabIds) ? active.a21PopupBaselineTabIds : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    const expectedListTabId = Number(active.a21ExpectedListTabId || active.workTabs?.A21_LIST?.tabId);
    if (popupTabs.some((tab) =>
      Number.isInteger(tab?.id) &&
      !baseline.has(Number(tab.id)) &&
      Number(tab.openerTabId) === expectedListTabId
    )) return active;`,
    "hf70_option_stale_popup_filter",
  );
  next = replaceOnce(
    next,
    `    if (next === "POPUP_OPENING") {
      await progress(`,
    `    if (next === "POPUP_OPENING") {
      const popupTabsBeforeClick = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
      active.a21PopupBaselineTabIds = popupTabsBeforeClick
        .map((tab) => Number(tab?.id))
        .filter(Number.isInteger);
      active.a21ExpectedListTabId = Number(active.workTabs?.A21_LIST?.tabId) || null;
      await saveActive(active);
      await progress(`,
    "hf70_option_popup_baseline",
  );
  return next;
}

export function patchHf70SingleListSource(source: string) {
  return replaceOnce(
    source,
    `    if (next === "POPUP_OPENING") {
      await progress(active,`,
    `    if (next === "POPUP_OPENING") {
      const popupTabsBeforeClick = await chrome.tabs.query({
        url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
      }).catch(() => []);
      active.singleA21PopupBaselineTabIds = popupTabsBeforeClick
        .map((tab) => Number(tab?.id))
        .filter(Number.isInteger);
      active.singleA21ExpectedListTabId = Number(active.workTabs?.A21_LIST?.tabId) || null;
      await saveActive(active);
      await progress(active,`,
    "hf70_single_popup_baseline",
  );
}

export function patchHf70SingleClaimSource(source: string) {
  const beforeHelper = `  function exactPopupUrlV059(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === POPUP_PATH.toLowerCase();
    } catch {
      return false;
    }
  }`;
  const afterHelper = `${beforeHelper}

  async function exactFreshOwnedSinglePopupV070(active, tabId) {
    const listTabId = Number(active?.singleA21ExpectedListTabId || active?.workTabs?.A21_LIST?.tabId);
    if (!Number.isInteger(tabId) || !Number.isInteger(listTabId)) return false;
    if (active?.stage === "A21_POPUP") return Number(active.singlePopupTabId) === tabId;
    if (active?.stage !== "A21_LIST" || active?.singleA21CanonicalStage !== "POPUP_OPENING") return false;
    const baseline = new Set(
      (Array.isArray(active?.singleA21PopupBaselineTabIds) ? active.singleA21PopupBaselineTabIds : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    if (baseline.has(tabId)) return false;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    return Number(tab?.openerTabId) === listTabId;
  }`;
  const next = replaceOnce(
    source,
    beforeHelper,
    afterHelper,
    "hf70_single_owner_helper",
  );
  const beforeGuard = `    if (!Number.isInteger(tabId) || !exactPopupUrlV059(href)) {
      return { ok: false, error: "stock_single_popup_target_mismatch" };
    }

    // Accept only the list->popup transition`;
  const afterGuard = `    if (!Number.isInteger(tabId) || !exactPopupUrlV059(href)) {
      return { ok: false, error: "stock_single_popup_target_mismatch" };
    }
    if (!(await exactFreshOwnedSinglePopupV070(active, tabId))) {
      return { ok: false, error: "stock_single_popup_owner_mismatch_hf70" };
    }

    // Accept only the list->popup transition`;
  return replaceOnce(next, beforeGuard, afterGuard, "hf70_single_owner_guard");
}
