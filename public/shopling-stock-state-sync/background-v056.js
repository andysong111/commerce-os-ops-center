importScripts("background-v055.js");

// HF11 SINGLE flow hardening.
// Keep the live-verified HF10 OPTION path untouched. SINGLE still performs its A4
// product-state mutation first, but its A21 list selection now delegates to the exact
// same literal price-extension content-a21.js engine that fixed OPTION row selection.
// The real A21 popup is then claimed by a dedicated SINGLE worker which selects only
// 상품판매상태송신 + 품절/판매중, and the result popup is closed only after the
// Shopling product-completion footer is stable.
(() => {
  const VERSION_V056 = chrome.runtime.getManifest().version;
  const CANONICAL_LIST_SCRIPT = "content-a21-canonical-v014.js";
  const CANONICAL_IDENTIFY = "A21_IDENTIFY";
  const CANONICAL_ASSIGN = "A21_LIST_ASSIGNMENT";
  const CANONICAL_STAGE = "A21_STAGE";
  const CANONICAL_FAILURE = "A21_JOB_FAILURE";
  const SINGLE_CLAIM = "STOCK_SINGLE_POPUP_CLAIM_V011";
  const SINGLE_STAGE = "STOCK_SINGLE_POPUP_STAGE_V011";
  const SINGLE_FAILURE = "STOCK_SINGLE_POPUP_FAILURE_V011";
  const POPUP_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const STABLE_MS = 2_500;
  const POLL_MS = 450;
  const STABLE_WAIT_MS = 30_000;

  const legacyDispatchToTargetV056 = dispatchToTarget;
  const legacyDispatchCurrentV056 = dispatchCurrent;
  const legacyHandleEvidenceV056 = handleEvidence;
  const singleResultWatchers = new Set();

  function isSingleA21List(active) {
    return Boolean(active && active.status === "RUNNING" && active.job?.productKind === "SINGLE" && active.stage === "A21_LIST");
  }

  function singleRunId(active) {
    return String(active?.job?.executionId || active?.job?.jobId || "");
  }

  function singleCanonicalStage(active) {
    return String(active?.singleA21CanonicalStage || `SINGLE_LIST_START_${Number(active?.goodsKeyIndex || 0)}_${singleRunId(active)}`);
  }

  function exactPopupUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === POPUP_PATH.toLowerCase();
    } catch {
      return false;
    }
  }

  async function ensureCanonicalListWorker(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs.sendMessage(target.tabId, { type: CANONICAL_IDENTIFY }, options).catch(() => null);
    if (probe?.ok && probe.role === "A21_LIST") return true;
    await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [CANONICAL_LIST_SCRIPT],
    }).catch(() => null);
    await sleep(140);
    probe = await chrome.tabs.sendMessage(target.tabId, { type: CANONICAL_IDENTIFY }, options).catch(() => null);
    return Boolean(probe?.ok && probe.role === "A21_LIST");
  }

  async function dispatchSingleCanonicalList(active, target, { focus = false } = {}) {
    if (!isSingleA21List(active) || !target) return false;
    const goodsKey = currentGoodsKey(active);
    if (!goodsKey) return false;
    if (focus) {
      await chrome.tabs.update(target.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(target.windowId)) await chrome.windows.update(target.windowId, { focused: true }).catch(() => null);
    }
    if (!(await ensureCanonicalListWorker(target))) {
      await progress(active, `${active.job.barcode} · 단품 A21 가격조정 원본 목록 엔진 연결 대기`, {
        code: "SINGLE_A21_CANONICAL_LIST_WORKER_NOT_READY",
        goodsKey,
      });
      return false;
    }
    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = { ...(active.workTabs || {}), A21_LIST: { tabId: target.tabId, frameId: target.frameId } };
    await saveActive(active);
    const response = await chrome.tabs.sendMessage(
      target.tabId,
      {
        type: CANONICAL_ASSIGN,
        jobId: active.job.jobId,
        // The literal list engine accepts PRICE/OPTION as transport modes. Popup
        // configuration is NOT delegated to it for SINGLE, so OPTION is list-only.
        mode: "OPTION",
        goodsKeys: [goodsKey],
        stage: singleCanonicalStage(active),
        runId: singleRunId(active),
        version: VERSION_V056,
      },
      { frameId: target.frameId },
    ).catch(() => null);
    return Boolean(response?.ok && response?.accepted);
  }

  dispatchToTarget = async function dispatchToTargetV056(active, target) {
    if (isSingleA21List(active)) return dispatchSingleCanonicalList(active, target);
    return legacyDispatchToTargetV056(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV056(active, options = {}) {
    if (!isSingleA21List(active)) return legacyDispatchCurrentV056(active, options);
    const target = await findExactRoleTarget("A21_LIST");
    if (!target) return false;
    return dispatchSingleCanonicalList(active, target, options);
  };

  async function canonicalSingleStage(message) {
    const active = await loadActive();
    if (!isSingleA21List(active)) return { ok: false, ignored: true };
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) return { ok: false, stale: true };
    const next = String(message?.stage || "");
    active.singleA21CanonicalStage = next;
    active.singleA21CanonicalStageAt = Date.now();
    await saveActive(active);

    if (next === "SEARCH_SUBMITTED") {
      await progress(active, `A21 단품 goods key ${currentGoodsKey(active)} · 가격조정 원본 검색 제출 → 전체 정확일치 행 선택`, {
        canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL_SINGLE_LIST_ONLY",
        canonicalStage: next,
      });
      setTimeout(() => {
        void (async () => {
          const latest = await loadActive();
          if (!isSingleA21List(latest) || latest.singleA21CanonicalStage !== "SEARCH_SUBMITTED") return;
          await dispatchCurrent(latest);
        })();
      }, 700);
      return { ok: true };
    }

    if (next === "POPUP_OPENING") {
      await progress(active, `A21 단품 goods key ${currentGoodsKey(active)} · 정확일치 행 전건 체크 완료 → 상품 수정전송 클릭 · 실제 판매상태 송신창 연결 대기`, {
        canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL_SINGLE_LIST_ONLY",
        selectedRowCount: Number(message?.selectedRowCount || 0),
        totalResultCount: Number(message?.totalResultCount || 0),
        canonicalStage: next,
      });
      const markerAt = active.singleA21CanonicalStageAt;
      setTimeout(() => {
        void (async () => {
          const latest = await loadActive();
          if (!isSingleA21List(latest) || latest.singleA21CanonicalStage !== "POPUP_OPENING" || latest.singleA21CanonicalStageAt !== markerAt) return;
          latest.singleA21CanonicalStage = `SINGLE_LIST_RETRY_${Date.now()}`;
          latest.singleA21CanonicalStageAt = Date.now();
          latest.attempts = {};
          await saveActive(latest);
          await progress(latest, `단품 A21 수정전송 팝업이 6초 내 연결되지 않아 목록 선택부터 안전 재시도`, {
            code: "SINGLE_A21_POPUP_OPENING_STALE_RETRY",
            goodsKey: currentGoodsKey(latest),
          });
          await dispatchCurrent(latest, { focus: true });
        })();
      }, 6_200);
      return { ok: true };
    }
    return { ok: true, ignored: true };
  }

  async function canonicalSingleFailure(message) {
    const active = await loadActive();
    if (!isSingleA21List(active)) return { ok: false, ignored: true };
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) return { ok: false, stale: true };
    return {
      ok: true,
      result: await finish(active, "FAILED", String(message?.message || "단품 A21 가격조정 원본 목록 엔진 실행 실패"), {
        code: String(message?.code || "SINGLE_A21_CANONICAL_LIST_FAILED"),
        goodsKey: currentGoodsKey(active),
        canonicalStage: active.singleA21CanonicalStage || null,
      }),
    };
  }

  async function claimSinglePopup(message, sender) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE") {
      return { ok: false, error: "stock_single_popup_no_active_job" };
    }
    if (active.stage !== "A21_LIST" || active.singleA21CanonicalStage !== "POPUP_OPENING") {
      return { ok: false, error: "stock_single_popup_not_ready" };
    }
    const tabId = sender?.tab?.id;
    const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
    const href = String(message?.href || sender?.tab?.url || "");
    if (!Number.isInteger(tabId) || !exactPopupUrl(href)) return { ok: false, error: "stock_single_popup_target_mismatch" };
    const goodsKey = currentGoodsKey(active);
    if (!goodsKey) return { ok: false, error: "stock_single_popup_goods_key_missing" };

    active.stage = "A21_POPUP";
    active.stageStartedAt = Date.now();
    active.shoplingTabId = tabId;
    active.shoplingFrameId = frameId;
    active.singlePopupTabId = tabId;
    active.singlePopupWindowId = sender?.tab?.windowId ?? null;
    active.workTabs = { ...(active.workTabs || {}), A21_POPUP: { tabId, frameId } };
    await saveActive(active);
    await progress(active, `A21 단품 goods key ${goodsKey} · 실제 수정전송 팝업 연결 → 상품판매상태 ${statusKorean(active.job.desiredStatus)}만 송신`, {
      popupEngine: "STOCK_SINGLE_SALE_STATUS_V011",
      popupTabId: tabId,
      popupFrameId: frameId,
    });
    return {
      ok: true,
      assignment: {
        jobId: active.job.jobId,
        goodsKey,
        desiredStatus: active.job.desiredStatus,
      },
      version: VERSION_V056,
    };
  }

  async function singlePopupStage(message) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE") return { ok: false, ignored: true };
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) return { ok: false, stale: true };
    const next = String(message?.stage || "");
    if (next === "RESULT_WAIT") {
      active.stage = "WAIT_A21_RESULT";
      active.stageStartedAt = Date.now();
      await saveActive(active);
      await progress(active, `A21 단품 goods key ${currentGoodsKey(active)} · 상품판매상태 ${statusKorean(active.job.desiredStatus)} 송신 접수 → 최종 완료문구 확인`, {
        popupEngine: "STOCK_SINGLE_SALE_STATUS_V011",
        submit: message,
      });
      return { ok: true };
    }
    await progress(active, `A21 단품 팝업 단계 · ${next || "미확인"}`, { popupEngine: "STOCK_SINGLE_SALE_STATUS_V011" });
    return { ok: true };
  }

  async function singlePopupFailure(message) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE") return { ok: false, ignored: true };
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) return { ok: false, stale: true };
    return {
      ok: true,
      result: await finish(active, "FAILED", String(message?.message || "단품 A21 상품판매상태 팝업 처리 실패"), {
        code: String(message?.code || "SINGLE_A21_POPUP_FAILED"),
        goodsKey: currentGoodsKey(active),
        detail: message?.evidence || null,
      }),
    };
  }

  async function inspectSingleResult(tabId) {
    if (!Number.isInteger(tabId)) return { ok: false, code: "SINGLE_RESULT_TAB_MISSING" };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, code: "SINGLE_RESULT_TAB_GONE" };
    const rows = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
        return {
          processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
          productComplete: /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text) || /상품판매상태\s*송신이\s*완료되었습니다/i.test(text),
          readyState: String(document.readyState || ""),
        };
      },
    }).catch(() => []);
    const values = rows.map((row) => row?.result).filter(Boolean);
    return {
      ok: values.length > 0,
      processing: values.some((row) => row.processing),
      productComplete: values.some((row) => row.productComplete),
      documentComplete: values.some((row) => row.productComplete && row.readyState === "complete"),
    };
  }

  async function waitStableSingleResult(tabId, active) {
    const startedAt = Date.now();
    let stableSince = 0;
    while (Date.now() - startedAt < STABLE_WAIT_MS) {
      const latest = await loadActive();
      if (!latest || latest.status !== "RUNNING" || latest.job?.jobId !== active.job?.jobId || latest.stage !== "WAIT_A21_RESULT" || currentGoodsKey(latest) !== currentGoodsKey(active)) {
        return { ok: false, code: "SINGLE_RESULT_STALE_JOB" };
      }
      const probe = await inspectSingleResult(tabId);
      if (!probe.ok || probe.processing || !probe.productComplete || !probe.documentComplete) {
        stableSince = 0;
        await sleep(POLL_MS);
        continue;
      }
      if (!stableSince) stableSince = Date.now();
      const stableMs = Date.now() - stableSince;
      if (stableMs >= STABLE_MS) return { ok: true, stableMs, probe };
      await sleep(POLL_MS);
    }
    return { ok: false, code: "SINGLE_RESULT_STABILITY_TIMEOUT" };
  }

  async function closeManagedSinglePopup(active, fallbackTabId) {
    const tabId = Number.isInteger(active?.singlePopupTabId) ? active.singlePopupTabId : fallbackTabId;
    const windowId = Number.isInteger(active?.singlePopupWindowId) ? active.singlePopupWindowId : null;
    if (Number.isInteger(windowId)) {
      const window = await chrome.windows.get(windowId, { populate: true }).catch(() => null);
      const tabs = Array.isArray(window?.tabs) ? window.tabs.filter((tab) => Number.isInteger(tab?.id)) : [];
      if (tabs.length === 1 && tabs[0].id === tabId) {
        await chrome.windows.remove(windowId).catch(() => null);
        return "WINDOW";
      }
    }
    if (Number.isInteger(tabId)) {
      await chrome.tabs.remove(tabId).catch(() => null);
      return "TAB";
    }
    return "NONE";
  }

  handleEvidence = async function handleEvidenceV056(message, sender) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE" || active.stage !== "WAIT_A21_RESULT") {
      return legacyHandleEvidenceV056(message, sender);
    }
    const evidence = message?.evidence || {};
    if (evidence.processing || !evidence.productComplete || evidence.readyState !== "complete") {
      return legacyHandleEvidenceV056(message, sender);
    }
    const resultTabId = sender?.tab?.id;
    if (!Number.isInteger(resultTabId)) return legacyHandleEvidenceV056(message, sender);
    if (Number.isInteger(active.singlePopupTabId) && active.singlePopupTabId !== resultTabId) return { ok: true, ignored: true };
    const watcherKey = `${active.job.jobId}:${currentGoodsKey(active)}:${resultTabId}`;
    if (singleResultWatchers.has(watcherKey)) return { ok: true, stabilizing: true };
    singleResultWatchers.add(watcherKey);
    try {
      await progress(active, `A21 단품 goods key ${currentGoodsKey(active)} · 상품판매상태 완료문구 확인 → ${STABLE_MS}ms 안정화`, {
        completionWatcher: "SINGLE_PRODUCT_STATUS_STABLE_AUTOCLOSE_HF11",
        resultTabId,
      });
      const stable = await waitStableSingleResult(resultTabId, active);
      const latest = await loadActive();
      if (!stable.ok || !latest || latest.status !== "RUNNING" || latest.job?.jobId !== active.job?.jobId || latest.stage !== "WAIT_A21_RESULT") {
        if (latest?.status === "RUNNING") {
          await progress(latest, `단품 상품판매상태 완료화면 안정화를 확정하지 못해 자동닫기 보류`, {
            code: stable.code || "SINGLE_RESULT_STABILITY_NOT_VERIFIED",
            resultTabId,
          });
        }
        return { ok: true, autoCloseDeferred: true };
      }
      const closeSnapshot = {
        singlePopupTabId: latest.singlePopupTabId,
        singlePopupWindowId: latest.singlePopupWindowId,
      };
      const handled = await legacyHandleEvidenceV056({
        ...message,
        evidence: {
          ...evidence,
          processing: false,
          productComplete: true,
          readyState: "complete",
          stableCompletionVerified: true,
          stableCompletionMs: stable.stableMs,
        },
      }, sender);
      const closeMode = await closeManagedSinglePopup(closeSnapshot, resultTabId);
      const remaining = await loadActive();
      if (remaining?.status === "RUNNING" && remaining.job?.jobId === active.job?.jobId) {
        remaining.singlePopupTabId = null;
        remaining.singlePopupWindowId = null;
        remaining.singleA21CanonicalStage = null;
        remaining.singleA21CanonicalStageAt = 0;
        await saveActive(remaining);
      }
      return { ...(handled || {}), autoClosedSingleResult: closeMode !== "NONE", closeMode };
    } finally {
      singleResultWatchers.delete(watcherKey);
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;
    if (message.type === CANONICAL_STAGE) {
      void canonicalSingleStage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message.type === CANONICAL_FAILURE) {
      void canonicalSingleFailure(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message.type === SINGLE_CLAIM) {
      void claimSinglePopup(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message.type === SINGLE_STAGE) {
      void singlePopupStage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message.type === SINGLE_FAILURE) {
      void singlePopupFailure(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
  });
})();
