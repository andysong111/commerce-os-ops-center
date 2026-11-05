export type Hf72TransmissionKind =
  | "OPTION_SEND"
  | "PRODUCT_SALE_STATUS_SEND";

export type Hf72Transmission = {
  goodsKey: string;
  transmissionKind: Hf72TransmissionKind;
  effectiveProductKind: "OPTION" | "SINGLE";
  optionCount: number;
};

export type Hf72TransmissionGroup = {
  transmissionKind: Hf72TransmissionKind;
  effectiveProductKind: "OPTION" | "SINGLE";
  goodsKeys: string[];
  chunks: string[][];
};

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

function normalizeGoodsKey(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function buildHf72TransmissionGroups(
  rows: Array<{
    goodsKey?: unknown;
    transmissionKind?: unknown;
    effectiveProductKind?: unknown;
    optionCount?: unknown;
  }>,
  maxBatchSize = 200,
): Hf72TransmissionGroup[] {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 200) {
    throw new Error("HF72_BATCH_SIZE_INVALID");
  }
  const seen = new Set<string>();
  const normalized: Hf72Transmission[] = rows.map((row) => {
    const goodsKey = normalizeGoodsKey(row.goodsKey);
    const transmissionKind = String(row.transmissionKind || "").toUpperCase();
    const expectedProductKind =
      transmissionKind === "OPTION_SEND"
        ? "OPTION"
        : transmissionKind === "PRODUCT_SALE_STATUS_SEND"
          ? "SINGLE"
          : "";
    const effectiveProductKind = String(row.effectiveProductKind || "").toUpperCase();
    const optionCount = Number(row.optionCount);
    if (!/^\d+$/.test(goodsKey) || seen.has(goodsKey)) {
      throw new Error(`HF72_GOODS_KEY_INVALID_OR_DUPLICATE:${goodsKey}`);
    }
    if (!expectedProductKind || effectiveProductKind !== expectedProductKind) {
      throw new Error(`HF72_TRANSMISSION_KIND_MISMATCH:${goodsKey}`);
    }
    if (!Number.isInteger(optionCount) || optionCount < 1) {
      throw new Error(`HF72_OPTION_COUNT_INVALID:${goodsKey}`);
    }
    seen.add(goodsKey);
    return {
      goodsKey,
      transmissionKind: transmissionKind as Hf72TransmissionKind,
      effectiveProductKind: effectiveProductKind as "OPTION" | "SINGLE",
      optionCount,
    };
  });

  return (["OPTION_SEND", "PRODUCT_SALE_STATUS_SEND"] as const).flatMap(
    (transmissionKind) => {
      const goodsKeys = normalized
        .filter((row) => row.transmissionKind === transmissionKind)
        .map((row) => row.goodsKey);
      if (!goodsKeys.length) return [];
      const chunks: string[][] = [];
      for (let index = 0; index < goodsKeys.length; index += maxBatchSize) {
        chunks.push(goodsKeys.slice(index, index + maxBatchSize));
      }
      return [
        {
          transmissionKind,
          effectiveProductKind:
            transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE",
          goodsKeys,
          chunks,
        } satisfies Hf72TransmissionGroup,
      ];
    },
  );
}

export function patchHf72OptionClaimSource(source: string) {
  const before = `  async function exactFreshOwnedPopupV070(active, tabId) {
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
  const after = `  async function exactFreshOwnedPopupV070(active, tabId) {
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
    const fresh = (await chrome.tabs.query({
      url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
    }).catch(() => []))
      .filter((tab) => Number.isInteger(tab?.id) && !baseline.has(Number(tab.id)) && exactPopupUrl(tab.url || tab.pendingUrl));
    if (fresh.length !== 1 || Number(fresh[0]?.id) !== tabId) return false;
    const openerTabId = Number(fresh[0]?.openerTabId);
    if (!Number.isInteger(openerTabId)) return true;
    if (openerTabId === listTabId) return true;
    let cursor = openerTabId;
    for (let depth = 0; depth < 4; depth += 1) {
      const opener = await chrome.tabs.get(cursor).catch(() => null);
      if (!opener) return true;
      if (Number(opener.id) === listTabId) return true;
      const next = Number(opener.openerTabId);
      if (!Number.isInteger(next)) return false;
      cursor = next;
    }
    return false;
  }`;
  return replaceOnce(source, before, after, "hf72_option_fresh_popup_owner");
}

export function patchHf72SingleClaimSource(source: string) {
  const before = `  async function exactFreshOwnedSinglePopupV070(active, tabId) {
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
  const after = `  async function exactFreshOwnedSinglePopupV070(active, tabId) {
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
    const fresh = (await chrome.tabs.query({
      url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
    }).catch(() => []))
      .filter((tab) => Number.isInteger(tab?.id) && !baseline.has(Number(tab.id)) && exactPopupUrlV059(tab.url || tab.pendingUrl));
    if (fresh.length !== 1 || Number(fresh[0]?.id) !== tabId) return false;
    const openerTabId = Number(fresh[0]?.openerTabId);
    if (!Number.isInteger(openerTabId)) return true;
    if (openerTabId === listTabId) return true;
    let cursor = openerTabId;
    for (let depth = 0; depth < 4; depth += 1) {
      const opener = await chrome.tabs.get(cursor).catch(() => null);
      if (!opener) return true;
      if (Number(opener.id) === listTabId) return true;
      const next = Number(opener.openerTabId);
      if (!Number.isInteger(next)) return false;
      cursor = next;
    }
    return false;
  }`;
  return replaceOnce(source, before, after, "hf72_single_fresh_popup_owner");
}

export function patchHf72PopupPreflightSource(source: string) {
  let next = replaceOnce(
    source,
    `    const ignoredForeignPopupTabIds = allTabs
      .filter((tab) => Number(tab?.openerTabId) !== ownerA21ListTabId)
      .map((tab) => tab.id)
      .filter(Number.isInteger);
    const closedTabIds = [];`,
    `    const ignoredForeignPopupTabIds = allTabs
      .filter((tab) => Number(tab?.openerTabId) !== ownerA21ListTabId)
      .map((tab) => tab.id)
      .filter(Number.isInteger);
    const acceptedPopupTabIdsHf72 = new Set(
      (Array.isArray(active?.stockStateAcceptedPopupTabIdsHf72)
        ? active.stockStateAcceptedPopupTabIdsHf72
        : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    const retiredAcceptedPopupTabIdsHf72 = tabs
      .map((tab) => Number(tab?.id))
      .filter((tabId) => Number.isInteger(tabId) && acceptedPopupTabIdsHf72.has(tabId));
    const closedTabIds = [];`,
    "hf72_popup_preflight_accepted_ids",
  );
  next = replaceOnce(
    next,
    `    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      const inspection = await inspectPopup(tab.id);`,
    `    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      if (acceptedPopupTabIdsHf72.has(tab.id)) continue;
      const inspection = await inspectPopup(tab.id);`,
    "hf72_popup_preflight_skip_accepted",
  );
  next = replaceOnce(
    next,
    `    const remaining = remainingAll.filter(
      (tab) => Number(tab?.openerTabId) === ownerA21ListTabId,
    );`,
    `    const remaining = remainingAll.filter(
      (tab) =>
        Number(tab?.openerTabId) === ownerA21ListTabId &&
        !acceptedPopupTabIdsHf72.has(Number(tab?.id)),
    );`,
    "hf72_popup_preflight_ignore_accepted_remaining",
  );
  next = replaceOnce(
    next,
    `      ignoredForeignPopupTabIds,
      popupOwnershipScope: "EXACT_OPENER_TAB_HF58",`,
    `      ignoredForeignPopupTabIds,
      retiredAcceptedPopupTabIdsHf72,
      popupOwnershipScope: "EXACT_OPENER_TAB_WITH_ACCEPTED_HANDOFF_HF72",`,
    "hf72_popup_preflight_receipt",
  );
  return next;
}

export function patchHf72ResultObserverSource(source: string) {
  let next = replaceOnce(
    source,
    `    return (
      goodsKeys.length > 0 &&
      currentBatch.length > 0 &&
      batchStart + currentBatch.length >= goodsKeys.length
    );`,
    `    return (
      goodsKeys.length > 0 &&
      currentBatch.length > 0 &&
      batchStart >= 0 &&
      batchStart + currentBatch.length <= goodsKeys.length
    );`,
    "hf72_current_option_batch_is_dispatchable",
  );
  next = replaceOnce(
    next,
    `    const candidateUrl = String(candidate.url || candidate.pendingUrl || "");
    const isResult = exactResultUrl(candidateUrl);
    if (!isResult && processing !== true) return null;`,
    `    const candidateUrl = String(candidate.url || candidate.pendingUrl || "");
    const isResult = exactResultUrl(candidateUrl);
    if (!isResult && processing !== true) return null;
    const resultBaseline = new Set(
      (Array.isArray(active?.shoplingResultBaselineTabIdsHf72)
        ? active.shoplingResultBaselineTabIdsHf72
        : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    if (resultBaseline.has(candidateTabId)) return null;`,
    "hf72_reject_prior_batch_result_tab",
  );
  next = replaceOnce(
    next,
    `    if (candidateTabId === popupTabId) {
      if (Number(candidate.openerTabId) !== listTabId) return null;
      return {
        candidate,
        listTabId,
        popupTabId,
        scope: "SAME_OWNER_POPUP_HF60",
      };
    }`,
    `    if (candidateTabId === popupTabId) {
      return {
        candidate,
        listTabId,
        popupTabId,
        scope: "PERSISTED_CLAIMED_POPUP_HF72",
      };
    }`,
    "hf72_trust_persisted_claimed_popup",
  );
  next = replaceOnce(
    next,
    `    if (Number(candidate.openerTabId) === popupTabId) {
      const popup = await chrome.tabs.get(popupTabId).catch(() => null);
      if (popup && Number(popup.openerTabId) !== listTabId) return null;
      return {`,
    `    if (Number(candidate.openerTabId) === popupTabId) {
      const popup = await chrome.tabs.get(popupTabId).catch(() => null);
      return {`,
    "hf72_trust_result_child_of_claimed_popup",
  );
  next = replaceOnce(
    next,
    '    const key = `${active.job?.jobId || "unknown"}:${tabId}`;',
    '    const key = `${active.job?.jobId || "unknown"}:${Number(active.stockStateGroupIndexHf72 || 0)}:${Number(active.goodsKeyIndex || 0)}:${tabId}`;',
    "hf72_acceptance_key_per_group_batch",
  );
  next = replaceOnce(
    next,
    `      await finish(
        latest,
        "SUCCEEDED",
        \`${"${latest.job.barcode}"} · Shopling 처리화면 진입을 확인해 전송 접수를 완료했습니다. 마켓별 최종 결과는 Shopling에서 계속 처리됩니다.\`,
        {
          code: "SHOPLING_NESTED_RESULT_ACCEPTED_HF60",
          stage: "WAIT_A21_RESULT",
          shoplingDispatchAccepted: true,
          processingScreenOrResultPageAccepted: true,
          commerceOsResponsibilityComplete: true,
          marketplaceCompletionRequired: false,
          marketFailuresAdvisory: true,
          popupOwnershipScope: latestOwner.scope,
          exactOwnerA21ListTabId: latestOwner.listTabId,
          exactOwnerA21PopupTabId: latestOwner.popupTabId,
          exactOwnerResultTabId: tabId,
          acceptanceTrigger: trigger,
          extensionVersion: VERSION_V082,
          observedEvidence: evidence,
        },
      );
      return true;`,
    `      const advanced = await continueNextGoodsKey(
        latest,
        { tab: { id: tabId, windowId: latestOwner.candidate?.windowId }, frameId: 0 },
        {
          code: "SHOPLING_PROCESSING_OR_RESULT_ACCEPTED_HF72",
          stage: "WAIT_A21_RESULT",
          shoplingDispatchAccepted: true,
          processingScreenOrResultPageAccepted: true,
          marketplaceCompletionRequired: false,
          marketFailuresAdvisory: true,
          popupOwnershipScope: latestOwner.scope,
          exactOwnerA21ListTabId: latestOwner.listTabId,
          exactOwnerA21PopupTabId: latestOwner.popupTabId,
          exactOwnerResultTabId: tabId,
          acceptanceTrigger: trigger,
          extensionVersion: VERSION_V082,
          observedEvidence: evidence,
        },
      );
      return advanced?.ok === true;`,
    "hf72_continue_after_each_group_batch",
  );
  return next;
}

export function patchHf72LegacyResultNavigationObserverSource(source: string) {
  return replaceOnce(
    source,
    `  async function acknowledgeDispatch(trigger, tabId, rawUrl, windowId = null) {
    if (!Number.isInteger(tabId) || !exactResultUrl(rawUrl)) return false;`,
    `  async function acknowledgeDispatch(trigger, tabId, rawUrl, windowId = null) {
    const groupedActive = await loadActive();
    if (
      Array.isArray(groupedActive?.job?.stockStateTransmissionGroupsHf72) &&
      groupedActive.job.stockStateTransmissionGroupsHf72.length > 0
    ) {
      return false;
    }
    if (!Number.isInteger(tabId) || !exactResultUrl(rawUrl)) return false;`,
    "hf72_disable_legacy_result_navigation_terminal_observer",
  );
}

export function patchHf72LegacyProcessingObserverSource(source: string) {
  return replaceOnce(
    source,
    `  async function acceptProcessingScreen(active, tabId, trigger, evidence = {}) {
    if (`,
    `  async function acceptProcessingScreen(active, tabId, trigger, evidence = {}) {
    if (
      Array.isArray(active?.job?.stockStateTransmissionGroupsHf72) &&
      active.job.stockStateTransmissionGroupsHf72.length > 0
    ) {
      return false;
    }
    if (`,
    "hf72_disable_legacy_processing_terminal_observer",
  );
}

export function patchHf72LegacySingleResultScannerSource(source: string) {
  return replaceOnce(
    source,
    `  function eligible(active) {
    return Boolean(
      active && active.status === "RUNNING" && active.job?.productKind === "SINGLE" &&
      ["A21_LIST", "A21_POPUP", "WAIT_A21_RESULT"].includes(String(active.stage || ""))
    );
  }`,
    `  function eligible(active) {
    if (
      Array.isArray(active?.job?.stockStateTransmissionGroupsHf72) &&
      active.job.stockStateTransmissionGroupsHf72.length > 0
    ) {
      return false;
    }
    return Boolean(
      active && active.status === "RUNNING" && active.job?.productKind === "SINGLE" &&
      ["A21_LIST", "A21_POPUP", "WAIT_A21_RESULT"].includes(String(active.stage || ""))
    );
  }`,
    "hf72_disable_legacy_single_result_scanner",
  );
}
