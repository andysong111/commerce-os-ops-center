importScripts("background-v066.js");

// HF26 root-cause fix from live HF25 diagnostics:
// The real aapi result navigation appears within seconds, but Shopling can take >2 minutes
// before the terminal footer finishes rendering. The base watchdog gives A21_POPUP only 90s.
// RESULT_WAIT has a 30-minute limit. When the objective /prod_a/prod_status_trsmt.phtml
// navigation appears, submission is already proven, so immediately promote SINGLE from
// A21_LIST/A21_POPUP to WAIT_A21_RESULT. This prevents the legitimate long Shopling result
// from being marked FAILED before HF25 can read the terminal footer and close the window.
(() => {
  const VERSION_V067 = chrome.runtime.getManifest().version;
  const TAG_V067 = "[CommerceOS Stock HF26]";
  const promotedKeysV067 = new Set();

  const logV067 = (...args) => console.log(TAG_V067, new Date().toISOString(), ...args);
  const warnV067 = (...args) => console.warn(TAG_V067, new Date().toISOString(), ...args);

  function exactResultUrlV067(raw) {
    try {
      const url = new URL(String(raw || ""));
      const hostOk = url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
      return hostOk && /\/prod_a\/prod_status_trsmt\.phtml$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function promoteObjectiveResultV067(trigger, tabId, url, windowId = null) {
    if (!exactResultUrlV067(url)) return false;
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE") {
      logV067("exact result seen but no running SINGLE", { trigger, tabId, windowId, url, status: active?.status, kind: active?.job?.productKind, stage: active?.stage });
      return false;
    }

    const stage = String(active.stage || "");
    if (stage === "WAIT_A21_RESULT") {
      active.singleObservedResultTabId = Number.isInteger(tabId) ? tabId : active.singleObservedResultTabId || null;
      active.singleObservedResultWindowId = Number.isInteger(windowId) ? windowId : active.singleObservedResultWindowId || null;
      active.singleObservedResultUrl = String(url || active.singleObservedResultUrl || "");
      await saveActive(active);
      return true;
    }

    if (!["A21_LIST", "A21_POPUP"].includes(stage)) {
      logV067("exact result seen outside promotable stage", { trigger, tabId, windowId, url, stage, status: active.status });
      return false;
    }

    const key = `${active.job?.jobId || "none"}:${Number(active.goodsKeyIndex || 0)}:${tabId ?? "none"}`;
    if (promotedKeysV067.has(key)) return true;
    promotedKeysV067.add(key);

    try {
      const priorPopupTabId = Number.isInteger(active.singlePopupTabId) ? active.singlePopupTabId : null;
      const priorPopupWindowId = Number.isInteger(active.singlePopupWindowId) ? active.singlePopupWindowId : null;
      active.singleOriginalPopupTabId = Number.isInteger(active.singleOriginalPopupTabId)
        ? active.singleOriginalPopupTabId
        : priorPopupTabId;
      active.singleOriginalPopupWindowId = Number.isInteger(active.singleOriginalPopupWindowId)
        ? active.singleOriginalPopupWindowId
        : priorPopupWindowId;
      active.singleObservedResultTabId = Number.isInteger(tabId) ? tabId : null;
      active.singleObservedResultWindowId = Number.isInteger(windowId) ? windowId : null;
      active.singleObservedResultUrl = String(url || "");
      active.singleResultNavigationObservedAt = Date.now();
      active.stage = "WAIT_A21_RESULT";
      active.stageStartedAt = Date.now();
      await saveActive(active);

      logV067("RESULT NAVIGATION => WAIT_A21_RESULT", {
        trigger,
        jobId: active.job?.jobId,
        barcode: active.job?.barcode,
        goodsKeyIndex: active.goodsKeyIndex,
        fromStage: stage,
        priorPopupTabId,
        priorPopupWindowId,
        resultTabId: tabId,
        resultWindowId: windowId,
        resultUrl: url,
        basePopupTimeoutMs: 90_000,
        resultTimeoutMs: 30 * 60 * 1000,
      });

      await progress(
        active,
        `A21 단품 · 실제 Shopling 결과페이지 진입 확인 → 송신 접수 객관확정 · 90초 팝업 제한 해제 후 최종 결과 대기`,
        {
          completionWatcher: "HF26_OBJECTIVE_RESULT_NAVIGATION_PROMOTION",
          resultNavigationTrigger: trigger,
          resultTabId: tabId,
          resultWindowId: windowId,
          resultUrl: url,
          priorStage: stage,
          priorPopupTabId,
          priorPopupWindowId,
          resultWaitTimeoutMinutes: 30,
          extensionVersion: VERSION_V067,
        },
      );
      return true;
    } catch (error) {
      warnV067("promotion failed", { trigger, tabId, windowId, url, error: String(error?.message || error) });
      return false;
    } finally {
      setTimeout(() => promotedKeysV067.delete(key), 10_000);
    }
  }

  chrome.tabs.onCreated.addListener((tab) => {
    const url = String(tab?.pendingUrl || tab?.url || "");
    if (!Number.isInteger(tab?.id) || !exactResultUrlV067(url)) return;
    setTimeout(() => void promoteObjectiveResultV067("tabs.onCreated", tab.id, url, tab.windowId), 0);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = String(changeInfo.url || tab?.url || tab?.pendingUrl || "");
    if (!Number.isInteger(tabId) || !exactResultUrlV067(url)) return;
    setTimeout(() => void promoteObjectiveResultV067("tabs.onUpdated", tabId, url, tab?.windowId ?? null), 0);
  });

  if (chrome.webNavigation?.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (!Number.isInteger(details?.tabId) || !exactResultUrlV067(details?.url)) return;
      void chrome.tabs.get(details.tabId).then((tab) =>
        promoteObjectiveResultV067("webNavigation.onCommitted", details.tabId, details.url, tab?.windowId ?? null),
      ).catch(() => promoteObjectiveResultV067("webNavigation.onCommitted", details.tabId, details.url, null));
    });
  }

  if (chrome.webNavigation?.onCompleted) {
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (!Number.isInteger(details?.tabId) || !exactResultUrlV067(details?.url)) return;
      void chrome.tabs.get(details.tabId).then((tab) =>
        promoteObjectiveResultV067("webNavigation.onCompleted", details.tabId, details.url, tab?.windowId ?? null),
      ).catch(() => promoteObjectiveResultV067("webNavigation.onCompleted", details.tabId, details.url, null));
    });
  }

  async function recoverAlreadyOpenResultV067(trigger) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE" || !["A21_LIST", "A21_POPUP"].includes(String(active.stage || ""))) return false;
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const candidates = tabs
      .filter((tab) => Number.isInteger(tab?.id) && exactResultUrlV067(tab.url || tab.pendingUrl))
      .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
    const candidate = candidates[0];
    if (!candidate) return false;
    return promoteObjectiveResultV067(trigger, candidate.id, String(candidate.url || candidate.pendingUrl || ""), candidate.windowId);
  }

  logV067("SERVICE WORKER HF26 PROMOTION LAYER BOOT", { version: VERSION_V067, background: "background-v067.js" });
  setTimeout(() => void recoverAlreadyOpenResultV067("serviceWorkerBootRecovery"), 100);
  chrome.runtime.onStartup?.addListener(() => setTimeout(() => void recoverAlreadyOpenResultV067("runtime.onStartupRecovery"), 100));
})();
