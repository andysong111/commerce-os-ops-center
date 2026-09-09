importScripts("background-v061.js");

// HF21: close SINGLE sale-status results by the exact Shopling terminal footer that
// was used by the previously proven result-close path. HF20 could still miss this
// page because its normal scripting probe did not force the legacy result frame to
// scroll before reading, while its global processing aggregation could be kept true
// by an unrelated/stale frame. This layer is intentionally narrow:
// 1) only while a SINGLE job is WAIT_A21_RESULT,
// 2) programmatically scroll every accessible result frame and nested scroll area,
// 3) require the SAME frame to expose "상품상태 변경 전송이 완료되었습니다." with
//    no visible processing text and readyState=complete,
// 4) hold that exact footer stable, ACK Commerce OS, then close the managed result.
(() => {
  const VERSION_V062 = chrome.runtime.getManifest().version;
  const STABLE_MS_V062 = 1_800;
  const POLL_MS_V062 = 400;
  const WAIT_LIMIT_MS_V062 = 88_000;
  const SINGLE_STAGE_V062 = "STOCK_SINGLE_POPUP_STAGE_V011";
  const watchersV062 = new Set();

  function isSingleWaitV062(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "SINGLE" &&
      active.stage === "WAIT_A21_RESULT"
    );
  }

  function isShoplingTabV062(tab) {
    try {
      return new URL(String(tab?.url || "")).origin === "https://a.shopling.co.kr";
    } catch {
      return false;
    }
  }

  async function candidateTabsV062(active, hintTabId = null) {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const byId = new Map(allTabs.filter((tab) => Number.isInteger(tab?.id)).map((tab) => [tab.id, tab]));
    const out = [];
    const seen = new Set();
    const add = (tabId) => {
      if (!Number.isInteger(tabId) || seen.has(tabId)) return;
      const tab = byId.get(tabId);
      if (!tab || !isShoplingTabV062(tab)) return;
      seen.add(tabId);
      out.push(tab);
    };
    add(hintTabId);
    add(active?.singlePopupTabId);
    add(active?.workTabs?.A21_POPUP?.tabId);
    add(active?.shoplingTabId);
    for (const tab of allTabs) if (isShoplingTabV062(tab)) add(tab.id);
    return out.slice(0, 12);
  }

  async function exactFooterProbeV062(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, code: "HF21_TAB_GONE", tabId };
    const rows = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        try {
          const bottom = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
          window.scrollTo(0, bottom);
        } catch {}
        try {
          for (const element of document.querySelectorAll("*")) {
            if (!(element instanceof HTMLElement)) continue;
            if (element.scrollHeight > element.clientHeight + 12) element.scrollTop = element.scrollHeight;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 180));
        const text = norm(document.body?.innerText || document.documentElement?.innerText || document.body?.textContent || "");
        const exactFooter = /상품\s*상태\s*변경\s*전송이\s*완료되었습니다/i.test(text);
        const processing = /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
        const totals = [...text.matchAll(/총건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const successes = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const failures = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const totalSum = totals.reduce((sum, value) => sum + value, 0);
        const successSum = successes.reduce((sum, value) => sum + value, 0);
        const failureSum = failures.reduce((sum, value) => sum + value, 0);
        const countsBalanced = totals.length > 0 && successes.length > 0 && failures.length > 0 && totalSum === successSum + failureSum;
        return {
          exactFooter,
          processing,
          countsBalanced,
          totalSum,
          successSum,
          failureSum,
          readyState: String(document.readyState || ""),
          href: String(location.href || ""),
          title: String(document.title || ""),
          tail: text.slice(-900),
        };
      },
    }).catch(() => []);
    const values = rows.map((row) => row?.result).filter(Boolean);
    const completedFrame = values.find((row) => row.exactFooter && !row.processing && row.readyState === "complete") || null;
    return {
      ok: values.length > 0,
      tabId,
      windowId: tab.windowId,
      completedFrame,
      frameCount: values.length,
      exactFooterFrames: values.filter((row) => row.exactFooter).length,
      processingFrames: values.filter((row) => row.processing).length,
    };
  }

  async function protectedTabsV062(active) {
    const ids = new Set();
    for (const [stage, value] of Object.entries(active?.workTabs || {})) {
      if (stage === "A21_POPUP" || !Number.isInteger(value?.tabId)) continue;
      ids.add(value.tabId);
    }
    return ids;
  }

  async function closeExactResultV062(tabId, active) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { closed: true, mode: "ALREADY_GONE" };
    const protectedIds = await protectedTabsV062(active);
    if (protectedIds.has(tabId)) return { closed: false, mode: "PROTECTED_TAB", tabId };
    const tabs = Number.isInteger(tab.windowId) ? await chrome.tabs.query({ windowId: tab.windowId }).catch(() => []) : [];
    const protectedSameWindow = tabs.some((row) => protectedIds.has(row.id));
    if (Number.isInteger(tab.windowId) && tabs.length === 1 && !protectedSameWindow) {
      await chrome.windows.remove(tab.windowId).catch(() => null);
      return { closed: true, mode: "WINDOW", tabId, windowId: tab.windowId };
    }
    await chrome.tabs.remove(tabId).catch(() => null);
    return { closed: true, mode: "TAB", tabId, windowId: tab.windowId };
  }

  async function runExactFooterWatcherV062(trigger, hintTabId = null) {
    const initial = await loadActive();
    if (!isSingleWaitV062(initial)) return false;
    const goodsKey = currentGoodsKey(initial);
    const watcherKey = `${initial.job.jobId}:${goodsKey || "none"}`;
    if (watchersV062.has(watcherKey)) return true;
    watchersV062.add(watcherKey);
    const startedAt = Date.now();
    let stableTabId = null;
    let stableSince = 0;
    let lastDiagnostics = [];
    try {
      await progress(initial, `A21 단품 goods key ${goodsKey} · 실제 Shopling 완료문구까지 프레임 스크롤 후 확인`, {
        completionWatcher: "HF21_EXACT_PRODUCT_STATE_CHANGE_FOOTER_SCROLL_AUTOCLOSE",
        exactFooter: "상품상태 변경 전송이 완료되었습니다.",
        trigger,
        stableTargetMs: STABLE_MS_V062,
      });

      while (Date.now() - startedAt < WAIT_LIMIT_MS_V062) {
        const active = await loadActive();
        if (!isSingleWaitV062(active) || active.job?.jobId !== initial.job?.jobId || currentGoodsKey(active) !== goodsKey) return false;
        const candidates = await candidateTabsV062(active, hintTabId);
        let completed = null;
        const diagnostics = [];
        for (const tab of candidates) {
          const probe = await exactFooterProbeV062(tab.id);
          diagnostics.push({ tabId: tab.id, windowId: tab.windowId, exactFooterFrames: probe.exactFooterFrames || 0, processingFrames: probe.processingFrames || 0, frameCount: probe.frameCount || 0 });
          if (probe.completedFrame) {
            completed = probe;
            break;
          }
        }
        lastDiagnostics = diagnostics;
        if (!completed) {
          stableTabId = null;
          stableSince = 0;
          await sleep(POLL_MS_V062);
          continue;
        }
        if (stableTabId !== completed.tabId) {
          stableTabId = completed.tabId;
          stableSince = Date.now();
        }
        const stableMs = Date.now() - stableSince;
        if (stableMs < STABLE_MS_V062) {
          await sleep(POLL_MS_V062);
          continue;
        }

        const latest = await loadActive();
        if (!isSingleWaitV062(latest) || latest.job?.jobId !== initial.job?.jobId || currentGoodsKey(latest) !== goodsKey) return false;
        const resultTab = await chrome.tabs.get(completed.tabId).catch(() => null);
        if (!resultTab) {
          stableTabId = null;
          stableSince = 0;
          continue;
        }

        latest.singlePopupTabId = completed.tabId;
        latest.singlePopupWindowId = resultTab.windowId ?? null;
        latest.workTabs = { ...(latest.workTabs || {}), A21_POPUP: { tabId: completed.tabId, frameId: 0 } };
        await saveActive(latest);

        const frame = completed.completedFrame || {};
        const completionEvidence = {
          processing: false,
          productComplete: true,
          readyState: "complete",
          stableCompletionVerified: true,
          stableCompletionMs: stableMs,
          shoplingBatchComplete: true,
          exactProductStateFooterVerified: true,
          exactProductStateFooterText: "상품상태 변경 전송이 완료되었습니다.",
          countsBalanced: Boolean(frame.countsBalanced),
          successCount: Number(frame.successSum || 0),
          failureCount: Number(frame.failureSum || 0),
          marketFailureCount: Number(frame.failureSum || 0),
          marketFailuresAdvisory: Number(frame.failureSum || 0) > 0,
          explicitFailure: false,
          completionWatcher: "HF21_EXACT_PRODUCT_STATE_CHANGE_FOOTER_SCROLL_AUTOCLOSE",
        };

        await progress(latest, `A21 단품 goods key ${goodsKey} · '상품상태 변경 전송이 완료되었습니다.' ${stableMs}ms 확정 → 성공처리 후 창 닫기`, {
          completionWatcher: completionEvidence.completionWatcher,
          resultTabId: completed.tabId,
          resultWindowId: resultTab.windowId,
          countsBalanced: completionEvidence.countsBalanced,
          successCount: completionEvidence.successCount,
          failureCount: completionEvidence.failureCount,
          ackBeforeClose: true,
        });

        const advanced = await continueNextGoodsKey(
          latest,
          { tab: { id: completed.tabId, windowId: resultTab.windowId }, frameId: 0 },
          completionEvidence,
        );
        const closeResult = await closeExactResultV062(completed.tabId, latest);
        return { ok: true, advanced, closeResult };
      }

      const latest = await loadActive();
      if (isSingleWaitV062(latest) && latest.job?.jobId === initial.job?.jobId) {
        await progress(latest, `A21 단품 goods key ${goodsKey} · 정확 완료문구 스크롤 감지 시간초과`, {
          code: "HF21_EXACT_FOOTER_TIMEOUT",
          completionWatcher: "HF21_EXACT_PRODUCT_STATE_CHANGE_FOOTER_SCROLL_AUTOCLOSE",
          lastDiagnostics,
        });
      }
      return false;
    } finally {
      watchersV062.delete(watcherKey);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === SINGLE_STAGE_V062 && String(message?.stage || "") === "RESULT_WAIT") {
      const hintTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
      setTimeout(() => void runExactFooterWatcherV062("singleResultWait", hintTabId), 120);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !isShoplingTabV062(tab)) return;
    setTimeout(() => void runExactFooterWatcherV062("shoplingTabComplete", tabId), 100);
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (!Number.isInteger(tab?.id)) return;
    setTimeout(() => void runExactFooterWatcherV062("tabCreated", tab.id), 220);
  });
})();
