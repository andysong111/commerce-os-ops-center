importScripts("background-v053.js");

// HF9: reuse the price-adjustment extension's proven completion pattern after HF8's
// literal A21 list engine succeeds: detect the real Shopling completion footer,
// require a short stable period with no processing state, finalize the stock job,
// then close only the result/popup tab. The working HF8 A21 selection/send core is
// intentionally untouched.
(() => {
  const VERSION_V054 = chrome.runtime.getManifest().version;
  const STABLE_MS_V054 = 1_800;
  const POLL_MS_V054 = 450;
  const WAIT_LIMIT_MS_V054 = 30_000;
  const resultWatchersV054 = new Set();
  const legacyHandleEvidenceV054 = handleEvidence;

  async function inspectResultTabV054(tabId) {
    if (!Number.isInteger(tabId)) return { ok: false, code: "RESULT_TAB_ID_MISSING" };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, code: "RESULT_TAB_GONE" };

    const rows = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
        const processing = /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
        const optionComplete =
          /상품\s*옵션\s*(?:수정\s*)?전송이\s*완료되었습니다/i.test(text) ||
          /상품옵션\s*전송이\s*완료되었습니다/i.test(text) ||
          /옵션\s*송신이\s*완료되었습니다/i.test(text);
        const successLabels = (text.match(/성공건수\s*[:：]?\s*[\d,]+/gi) || []).length;
        const failureLabels = (text.match(/실패건수\s*[:：]?\s*[\d,]+/gi) || []).length;
        return {
          processing,
          optionComplete,
          successLabels,
          failureLabels,
          readyState: String(document.readyState || ""),
          href: String(location.href || ""),
          title: String(document.title || ""),
          textSample: text.slice(-700),
        };
      },
    }).catch(() => []);

    const values = rows.map((row) => row?.result).filter(Boolean);
    if (!values.length) return { ok: false, code: "RESULT_TAB_UNREADABLE" };
    const processing = values.some((row) => row.processing);
    const completedFrames = values.filter((row) => row.optionComplete);
    const documentComplete = completedFrames.some((row) => row.readyState === "complete");
    return {
      ok: true,
      processing,
      optionComplete: completedFrames.length > 0,
      documentComplete,
      frameCount: values.length,
      completedFrameCount: completedFrames.length,
      successLabelCount: values.reduce((sum, row) => sum + Number(row.successLabels || 0), 0),
      failureLabelCount: values.reduce((sum, row) => sum + Number(row.failureLabels || 0), 0),
      href: String(tab.url || ""),
      title: String(tab.title || ""),
    };
  }

  async function waitForStableCompletionV054(tabId, active) {
    const startedAt = Date.now();
    let stableSince = 0;
    let lastProbe = null;

    while (Date.now() - startedAt < WAIT_LIMIT_MS_V054) {
      const latest = await loadActive();
      if (
        !latest ||
        latest.status !== "RUNNING" ||
        latest.job?.jobId !== active.job?.jobId ||
        latest.stage !== "WAIT_A21_RESULT" ||
        currentGoodsKey(latest) !== currentGoodsKey(active)
      ) {
        return { ok: false, code: "RESULT_WATCH_STALE_JOB", lastProbe };
      }

      const probe = await inspectResultTabV054(tabId);
      lastProbe = probe;
      if (!probe.ok) {
        stableSince = 0;
        if (probe.code === "RESULT_TAB_GONE") return { ok: false, code: probe.code, lastProbe: probe };
        await sleep(POLL_MS_V054);
        continue;
      }

      if (probe.processing || !probe.optionComplete || !probe.documentComplete) {
        stableSince = 0;
        await sleep(POLL_MS_V054);
        continue;
      }

      if (!stableSince) stableSince = Date.now();
      const stableMs = Date.now() - stableSince;
      if (stableMs >= STABLE_MS_V054) {
        return { ok: true, stableMs, probe };
      }
      await sleep(POLL_MS_V054);
    }

    return { ok: false, code: "RESULT_STABILITY_TIMEOUT", lastProbe };
  }

  function protectedWorkerTabsV054(active) {
    return new Set(
      Object.entries(active?.workTabs || {})
        .filter(([stage]) => stage !== "A21_POPUP")
        .map(([, value]) => value?.tabId)
        .filter(Number.isInteger),
    );
  }

  handleEvidence = async function handleEvidenceV054(message, sender) {
    const active = await loadActive();
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.job?.productKind !== "OPTION" ||
      active.stage !== "WAIT_A21_RESULT"
    ) {
      return legacyHandleEvidenceV054(message, sender);
    }

    const evidence = message?.evidence || {};
    if (evidence.processing || !evidence.optionComplete || evidence.readyState !== "complete") {
      return legacyHandleEvidenceV054(message, sender);
    }

    const resultTabId = sender?.tab?.id;
    if (!Number.isInteger(resultTabId)) return legacyHandleEvidenceV054(message, sender);

    const watcherKey = `${active.job.jobId}:${currentGoodsKey(active) || "none"}:${resultTabId}`;
    if (resultWatchersV054.has(watcherKey)) return { ok: true, stabilizing: true };
    resultWatchersV054.add(watcherKey);

    try {
      await progress(
        active,
        `A21 goods key ${currentGoodsKey(active)} · Shopling 옵션수정 완료문구 확인 → 가격조정 확장과 동일하게 ${STABLE_MS_V054}ms 안정화 검증 중`,
        {
          completionWatcher: "PRICE_STYLE_STABLE_RESULT_AUTOCLOSE_HF9",
          resultTabId,
          initialEvidence: evidence,
          stableTargetMs: STABLE_MS_V054,
          extensionVersion: VERSION_V054,
        },
      );

      const stable = await waitForStableCompletionV054(resultTabId, active);
      const latest = await loadActive();
      if (
        !latest ||
        latest.status !== "RUNNING" ||
        latest.job?.jobId !== active.job?.jobId ||
        latest.stage !== "WAIT_A21_RESULT" ||
        currentGoodsKey(latest) !== currentGoodsKey(active)
      ) {
        return { ok: true, stale: true };
      }

      if (!stable.ok) {
        // Do not manufacture success if the real result document was not stable.
        // The existing watchdog/result observer remains authoritative for retry/manual handling.
        await progress(
          latest,
          `A21 goods key ${currentGoodsKey(latest)} · 완료문구는 감지했지만 결과문서 안정화를 확정하지 못해 자동닫기를 보류`,
          {
            code: stable.code || "RESULT_STABILITY_NOT_VERIFIED",
            completionWatcher: "PRICE_STYLE_STABLE_RESULT_AUTOCLOSE_HF9",
            resultTabId,
            stableDetail: stable,
            extensionVersion: VERSION_V054,
          },
        );
        return { ok: true, stabilizing: false, autoCloseDeferred: true };
      }

      await progress(
        latest,
        `A21 goods key ${currentGoodsKey(latest)} · Shopling 완료화면 ${stable.stableMs}ms 안정화 확인 → 성공판정 후 결과창 자동닫기`,
        {
          completionWatcher: "PRICE_STYLE_STABLE_RESULT_AUTOCLOSE_HF9",
          resultTabId,
          stableMs: stable.stableMs,
          stableProbe: stable.probe,
          autoClosePlanned: true,
          extensionVersion: VERSION_V054,
        },
      );

      const normalizedMessage = {
        ...message,
        evidence: {
          ...evidence,
          processing: false,
          optionComplete: true,
          readyState: "complete",
          stableCompletionVerified: true,
          stableCompletionMs: stable.stableMs,
          completionWatcher: "PRICE_STYLE_STABLE_RESULT_AUTOCLOSE_HF9",
          stableProbe: stable.probe,
        },
      };
      const handled = await legacyHandleEvidenceV054(normalizedMessage, sender);

      const protectedTabs = protectedWorkerTabsV054(latest);
      if (!protectedTabs.has(resultTabId)) {
        await chrome.tabs.remove(resultTabId).catch(() => null);
      }
      return { ...(handled || {}), autoClosedResultTab: !protectedTabs.has(resultTabId), resultTabId };
    } finally {
      resultWatchersV054.delete(watcherKey);
    }
  };
})();
