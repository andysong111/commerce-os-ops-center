importScripts("background-v081.js");

// HF60: Shopling's OPTION flow opens a nested result tab in production:
// A21 list -> goods_mallMdfy_trsmt popup -> oapi1 result tab. HF58/HF59 only
// recognized a direct A21-list child or a same-popup result, so the real nested
// result could be delivered to Shopling while Commerce OS stayed in RESULT_WAIT.
// Bind dispatch completion to the current job's persisted popup id and accept the
// exact result tab when it is that popup's child. Marketplace completion remains
// outside the Commerce OS responsibility boundary.
(() => {
  const VERSION_V082 = chrome.runtime.getManifest().version;
  const RESULT_PATH = "/prod_a/prod_status_trsmt.phtml";
  const RESULT_MATCH = [
    "https://shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
    "https://*.shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
  ];
  const accepting = new Set();

  function exactResultUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      return (
        (url.hostname === "shopling.co.kr" ||
          url.hostname.endsWith(".shopling.co.kr")) &&
        url.pathname.toLowerCase() === RESULT_PATH
      );
    } catch {
      return false;
    }
  }

  function finalOptionBatchSubmitted(active) {
    if (String(active?.job?.productKind || "").toUpperCase() !== "OPTION") {
      return true;
    }
    if (active?.job?.optionApiApplied !== true) return false;
    const goodsKeys = Array.isArray(active?.job?.goodsKeys)
      ? active.job.goodsKeys
      : [];
    const currentBatch = Array.isArray(active?.optionCurrentBatchKeys)
      ? active.optionCurrentBatchKeys
      : [];
    const batchStart = Math.max(
      0,
      Number(active?.optionCurrentBatchStart ?? active?.goodsKeyIndex ?? 0),
    );
    return (
      goodsKeys.length > 0 &&
      currentBatch.length > 0 &&
      batchStart + currentBatch.length >= goodsKeys.length
    );
  }

  function ownerListTabId(active) {
    const candidate = Number(
      active?.workTabs?.A21_LIST?.tabId ?? active?.shoplingTabId,
    );
    return Number.isInteger(candidate) ? candidate : null;
  }

  function ownerPopupTabId(active) {
    const candidates = [
      active?.workTabs?.A21_POPUP?.tabId,
      active?.singlePopupTabId,
    ];
    const candidate = candidates.map(Number).find(Number.isInteger);
    return Number.isInteger(candidate) ? candidate : null;
  }

  async function exactOwnerChain(active, candidateTabId, { processing = false } = {}) {
    if (!Number.isInteger(candidateTabId)) return null;
    const listTabId = ownerListTabId(active);
    const popupTabId = ownerPopupTabId(active);
    if (!Number.isInteger(listTabId) || !Number.isInteger(popupTabId)) return null;

    const candidate = await chrome.tabs.get(candidateTabId).catch(() => null);
    if (!candidate) return null;
    const candidateUrl = String(candidate.url || candidate.pendingUrl || "");
    const isResult = exactResultUrl(candidateUrl);
    if (!isResult && processing !== true) return null;

    if (candidateTabId === popupTabId) {
      if (Number(candidate.openerTabId) !== listTabId) return null;
      return {
        candidate,
        listTabId,
        popupTabId,
        scope: "SAME_OWNER_POPUP_HF60",
      };
    }

    if (Number(candidate.openerTabId) === popupTabId) {
      const popup = await chrome.tabs.get(popupTabId).catch(() => null);
      if (popup && Number(popup.openerTabId) !== listTabId) return null;
      return {
        candidate,
        listTabId,
        popupTabId,
        scope: popup
          ? "A21_LIST_TO_POPUP_TO_RESULT_HF60"
          : "PERSISTED_OWNER_POPUP_TO_RESULT_HF60",
      };
    }

    if (isResult && Number(candidate.openerTabId) === listTabId) {
      return {
        candidate,
        listTabId,
        popupTabId,
        scope: "DIRECT_A21_LIST_TO_RESULT_HF60",
      };
    }
    return null;
  }

  async function acceptDispatch(active, tabId, trigger, evidence = {}) {
    if (
      !active ||
      active.status !== "RUNNING" ||
      !["A21_POPUP", "WAIT_A21_RESULT"].includes(String(active.stage || "")) ||
      !finalOptionBatchSubmitted(active)
    ) {
      return false;
    }
    const owner = await exactOwnerChain(active, tabId, {
      processing: evidence.processing === true,
    });
    if (!owner) return false;

    const key = `${active.job?.jobId || "unknown"}:${tabId}`;
    if (accepting.has(key)) return true;
    accepting.add(key);
    try {
      const latest = await loadActive();
      if (
        !latest ||
        latest.status !== "RUNNING" ||
        latest.job?.jobId !== active.job?.jobId ||
        !["A21_POPUP", "WAIT_A21_RESULT"].includes(String(latest.stage || "")) ||
        !finalOptionBatchSubmitted(latest)
      ) {
        return false;
      }
      const latestOwner = await exactOwnerChain(latest, tabId, {
        processing: evidence.processing === true,
      });
      if (!latestOwner) return false;

      latest.stage = "WAIT_A21_RESULT";
      latest.stageStartedAt = Date.now();
      latest.shoplingDispatchAcceptedAt = Date.now();
      latest.shoplingDispatchResultTabId = tabId;
      latest.shoplingDispatchResultWindowId = Number.isInteger(
        latestOwner.candidate?.windowId,
      )
        ? latestOwner.candidate.windowId
        : null;
      latest.shoplingDispatchResultUrl = String(
        latestOwner.candidate?.url || latestOwner.candidate?.pendingUrl || "",
      );
      await saveActive(latest);

      await finish(
        latest,
        "SUCCEEDED",
        `${latest.job.barcode} · Shopling 처리화면 진입을 확인해 전송 접수를 완료했습니다. 마켓별 최종 결과는 Shopling에서 계속 처리됩니다.`,
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
      return true;
    } finally {
      setTimeout(() => accepting.delete(key), 30_000);
    }
  }

  const legacyHandleEvidenceV082 = handleEvidence;
  handleEvidence = async function handleEvidenceV082(message, sender) {
    const active = await loadActive();
    const evidence = message?.evidence || {};
    const senderTabId = Number.isInteger(sender?.tab?.id)
      ? sender.tab.id
      : null;
    if (
      evidence.processing === true &&
      Number.isInteger(senderTabId) &&
      (await acceptDispatch(
        active,
        senderTabId,
        "owner-chain-processing-evidence",
        evidence,
      ))
    ) {
      return { ok: true, processingScreenAccepted: true };
    }
    return legacyHandleEvidenceV082(message, sender);
  };

  async function recoverOwnerResult(trigger, hintedTabId = null) {
    const active = await loadActive();
    if (
      !active ||
      active.status !== "RUNNING" ||
      !["A21_POPUP", "WAIT_A21_RESULT"].includes(String(active.stage || "")) ||
      !finalOptionBatchSubmitted(active)
    ) {
      return false;
    }

    const candidates = [];
    if (Number.isInteger(hintedTabId)) candidates.push(hintedTabId);
    const resultTabs = await chrome.tabs.query({ url: RESULT_MATCH }).catch(() => []);
    for (const tab of resultTabs) {
      if (Number.isInteger(tab?.id) && !candidates.includes(tab.id)) {
        candidates.push(tab.id);
      }
    }
    for (const tabId of candidates) {
      if (
        await acceptDispatch(active, tabId, trigger, {
          recoveredOwnerChain: true,
          resultPage: true,
        })
      ) {
        return true;
      }
    }

    const popupTabId = ownerPopupTabId(active);
    if (!Number.isInteger(popupTabId)) return false;
    const frames = await chrome.scripting
      .executeScript({
        target: { tabId: popupTabId, allFrames: true },
        func: () => {
          const text = String(
            document.body?.innerText ||
              document.body?.textContent ||
              document.documentElement?.innerText ||
              "",
          ).normalize("NFKC");
          return {
            processing:
              /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text),
          };
        },
      })
      .catch(() => []);
    if (!frames.some((frame) => frame.result?.processing === true)) return false;
    return acceptDispatch(active, popupTabId, trigger, {
      recoveredOwnerChain: true,
      processing: true,
    });
  }

  function schedule(trigger, tabId, rawUrl) {
    if (!Number.isInteger(tabId) || !exactResultUrl(rawUrl)) return;
    setTimeout(() => void recoverOwnerResult(trigger, tabId), 80);
  }

  chrome.tabs.onCreated.addListener((tab) =>
    schedule(
      "tabs.onCreated-owner-chain",
      tab?.id,
      String(tab?.pendingUrl || tab?.url || ""),
    ),
  );
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
    schedule(
      "tabs.onUpdated-owner-chain",
      tabId,
      String(changeInfo?.url || tab?.url || tab?.pendingUrl || ""),
    ),
  );
  chrome.webNavigation?.onCommitted?.addListener((details) =>
    schedule(
      "webNavigation.onCommitted-owner-chain",
      details?.tabId,
      String(details?.url || ""),
    ),
  );
  chrome.webNavigation?.onCompleted?.addListener((details) =>
    schedule(
      "webNavigation.onCompleted-owner-chain",
      details?.tabId,
      String(details?.url || ""),
    ),
  );

  setTimeout(() => void recoverOwnerResult("worker-start-250ms"), 250);
  setTimeout(() => void recoverOwnerResult("worker-start-2000ms"), 2_000);
  chrome.runtime.onInstalled?.addListener(() =>
    setTimeout(() => void recoverOwnerResult("extension-installed"), 500),
  );
})();
