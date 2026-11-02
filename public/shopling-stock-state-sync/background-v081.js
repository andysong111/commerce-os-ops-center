importScripts("background-v080.js");

// HF59: Commerce OS owns delivery to Shopling's processing/result screen, not
// Shopling's marketplace-by-marketplace completion. HF58 accepted result-page
// navigation, but an OPTION popup can enter the same processing screen without
// emitting a usable URL navigation. Accept that exact owner popup's processing
// evidence immediately and recover the same state after an extension reload.
(() => {
  const VERSION_V081 = chrome.runtime.getManifest().version;
  const RESULT_PATH = "/prod_a/prod_status_trsmt.phtml";
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

  function ownerResultTabId(active) {
    const candidates = [
      active?.workTabs?.A21_POPUP?.tabId,
      active?.singlePopupTabId,
      active?.shoplingDispatchResultTabId,
    ];
    const candidate = candidates.map(Number).find(Number.isInteger);
    return Number.isInteger(candidate) ? candidate : null;
  }

  async function exactOwnerTab(active, tabId) {
    if (!Number.isInteger(tabId) || ownerResultTabId(active) !== tabId) {
      return null;
    }
    const expectedOwner = ownerListTabId(active);
    if (!Number.isInteger(expectedOwner)) return null;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    return Number(tab?.openerTabId) === expectedOwner ? tab : null;
  }

  async function acceptProcessingScreen(active, tabId, trigger, evidence = {}) {
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.stage !== "WAIT_A21_RESULT" ||
      !finalOptionBatchSubmitted(active) ||
      !(await exactOwnerTab(active, tabId))
    ) {
      return false;
    }

    const key = `${active.job?.jobId || "unknown"}:${tabId}`;
    if (accepting.has(key)) return true;
    accepting.add(key);
    try {
      const latest = await loadActive();
      if (
        !latest ||
        latest.status !== "RUNNING" ||
        latest.stage !== "WAIT_A21_RESULT" ||
        latest.job?.jobId !== active.job?.jobId ||
        !finalOptionBatchSubmitted(latest) ||
        !(await exactOwnerTab(latest, tabId))
      ) {
        return false;
      }

      latest.shoplingDispatchAcceptedAt = Date.now();
      latest.shoplingDispatchResultTabId = tabId;
      await saveActive(latest);
      await finish(
        latest,
        "SUCCEEDED",
        `${latest.job.barcode} · Shopling 처리화면 진입을 확인해 전송 접수를 완료했습니다. 마켓별 최종 결과는 Shopling에서 계속 처리됩니다.`,
        {
          code: "SHOPLING_PROCESSING_SCREEN_ACCEPTED_HF59",
          stage: "WAIT_A21_RESULT",
          shoplingDispatchAccepted: true,
          processingScreenOrResultPageAccepted: true,
          commerceOsResponsibilityComplete: true,
          marketplaceCompletionRequired: false,
          marketFailuresAdvisory: true,
          exactOwnerResultTabId: tabId,
          exactOwnerA21ListTabId: ownerListTabId(latest),
          acceptanceTrigger: trigger,
          extensionVersion: VERSION_V081,
          observedEvidence: evidence,
        },
      );
      return true;
    } finally {
      setTimeout(() => accepting.delete(key), 30_000);
    }
  }

  const legacyHandleEvidenceV081 = handleEvidence;
  handleEvidence = async function handleEvidenceV081(message, sender) {
    const active = await loadActive();
    const evidence = message?.evidence || {};
    const senderTabId = Number.isInteger(sender?.tab?.id)
      ? sender.tab.id
      : null;
    if (
      evidence.processing === true &&
      Number.isInteger(senderTabId) &&
      (await acceptProcessingScreen(
        active,
        senderTabId,
        "owner-processing-evidence",
        evidence,
      ))
    ) {
      return { ok: true, processingScreenAccepted: true };
    }
    return legacyHandleEvidenceV081(message, sender);
  };

  async function recoverVisibleProcessingScreen(trigger) {
    const active = await loadActive();
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.stage !== "WAIT_A21_RESULT" ||
      !finalOptionBatchSubmitted(active)
    ) {
      return false;
    }
    const tabId = ownerResultTabId(active);
    const tab = await exactOwnerTab(active, tabId);
    if (!tab) return false;

    const frames = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const text = String(
            document.body?.innerText ||
              document.body?.textContent ||
              document.documentElement?.innerText ||
              "",
          ).normalize("NFKC");
          return {
            href: String(location.href || ""),
            processing:
              /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text),
          };
        },
      })
      .catch(() => []);
    const processing = frames.some((frame) => frame.result?.processing === true);
    const resultPage = exactResultUrl(tab.url || tab.pendingUrl) ||
      frames.some((frame) => exactResultUrl(frame.result?.href));
    if (!processing && !resultPage) return false;
    return acceptProcessingScreen(active, tabId, trigger, {
      recoveredAfterWorkerStart: true,
      processing,
      resultPage,
    });
  }

  setTimeout(() => void recoverVisibleProcessingScreen("worker-start-250ms"), 250);
  setTimeout(() => void recoverVisibleProcessingScreen("worker-start-2000ms"), 2_000);
  chrome.runtime.onInstalled?.addListener(() =>
    setTimeout(() => void recoverVisibleProcessingScreen("extension-installed"), 500),
  );
  chrome.tabs.onUpdated.addListener((tabId) => {
    void loadActive().then((active) => {
      if (ownerResultTabId(active) !== tabId) return;
      setTimeout(() => void recoverVisibleProcessingScreen("owner-tab-updated"), 50);
    });
  });
})();
