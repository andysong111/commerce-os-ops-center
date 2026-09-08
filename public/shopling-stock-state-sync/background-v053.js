importScripts("background-v052.js");

// HF8: OPTION A21 no longer uses the stock worker's list-click implementation.
// It delegates the A21 list stage to the price-adjustment extension's content-a21.js
// copied byte-for-byte into the stock package. Only the background transport/state
// adapter below is stock-specific; row selection and the red 상품 수정전송 click are
// executed by the proven price extension code itself.
(() => {
  const VERSION_V053 = chrome.runtime.getManifest().version;
  const CANONICAL_LIST_SCRIPT = "content-a21-canonical-v014.js";
  const CANONICAL_IDENTIFY = "A21_IDENTIFY";
  const CANONICAL_ASSIGN = "A21_LIST_ASSIGNMENT";
  const CANONICAL_STAGE = "A21_STAGE";
  const CANONICAL_FAILURE = "A21_JOB_FAILURE";
  const CANONICAL_SUCCESS = "A21_JOB_SUCCESS";
  const CANONICAL_SPLIT = "A21_SPLIT_REQUIRED";
  const POPUP_MATCH = "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";
  const legacyDispatchToTargetV053 = dispatchToTarget;
  const legacyDispatchCurrentV053 = dispatchCurrent;
  const legacyContinueNextGoodsKeyV053 = continueNextGoodsKey;
  let bootstrapRunning = false;

  function isCanonicalA21(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "OPTION" &&
      active.stage === "A21_LIST",
    );
  }

  function canonicalRunId(active) {
    return String(active?.job?.executionId || active?.job?.jobId || "");
  }

  function canonicalStage(active) {
    return String(
      active?.a21CanonicalStage ||
      `LIST_START_${Number(active?.goodsKeyIndex || 0)}_${canonicalRunId(active)}`,
    );
  }

  async function ensureCanonicalListWorker(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs.sendMessage(
      target.tabId,
      { type: CANONICAL_IDENTIFY },
      options,
    ).catch(() => null);
    if (probe?.ok && probe.role === "A21_LIST") return true;

    await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [CANONICAL_LIST_SCRIPT],
    }).catch(() => null);
    await sleep(140);
    probe = await chrome.tabs.sendMessage(
      target.tabId,
      { type: CANONICAL_IDENTIFY },
      options,
    ).catch(() => null);
    return Boolean(probe?.ok && probe.role === "A21_LIST");
  }

  async function resetStaleCanonicalOpening(active, trigger) {
    if (!isCanonicalA21(active) || active.a21CanonicalStage !== "POPUP_OPENING") return active;
    const ageMs = Date.now() - Number(active.a21CanonicalStageAt || active.stageStartedAt || 0);
    if (ageMs < 5_000) return active;
    const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    if (popupTabs.some((tab) => Number.isInteger(tab?.id))) return active;

    active.a21CanonicalStage = `LIST_RETRY_${Date.now()}`;
    active.a21CanonicalStageAt = Date.now();
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await saveActive(active);
    await progress(
      active,
      `${active.job.barcode} · 실제 수정전송 팝업이 생성되지 않아 가격조정 원본 A21 엔진을 처음부터 재실행`,
      {
        code: "A21_CANONICAL_POPUP_OPENING_STALE_RETRY",
        trigger,
        goodsKey: currentGoodsKey(active),
        staleAgeMs: ageMs,
        canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      },
    );
    return active;
  }

  async function dispatchCanonicalList(active, target, { focus = false } = {}) {
    if (!isCanonicalA21(active) || !target) return false;
    active = await resetStaleCanonicalOpening(active, "dispatch");
    const goodsKey = currentGoodsKey(active);
    if (!goodsKey) return false;

    if (focus) {
      await chrome.tabs.update(target.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(target.windowId)) {
        await chrome.windows.update(target.windowId, { focused: true }).catch(() => null);
      }
    }

    if (!(await ensureCanonicalListWorker(target))) {
      await progress(active, `${active.job.barcode} · 가격조정 원본 A21 목록 엔진 연결 대기`, {
        code: "A21_CANONICAL_LIST_WORKER_NOT_READY",
        goodsKey,
        target,
      });
      return false;
    }

    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: { tabId: target.tabId, frameId: target.frameId },
    };
    await saveActive(active);

    const assignment = {
      type: CANONICAL_ASSIGN,
      jobId: active.job.jobId,
      mode: "OPTION",
      goodsKeys: [goodsKey],
      stage: canonicalStage(active),
      runId: canonicalRunId(active),
      version: VERSION_V053,
    };
    const response = await chrome.tabs.sendMessage(
      target.tabId,
      assignment,
      { frameId: target.frameId },
    ).catch(() => null);
    return Boolean(response?.ok && response?.accepted);
  }

  dispatchToTarget = async function dispatchToTargetV053(active, target) {
    if (isCanonicalA21(active)) return dispatchCanonicalList(active, target);
    return legacyDispatchToTargetV053(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV053(active, options = {}) {
    if (!isCanonicalA21(active)) return legacyDispatchCurrentV053(active, options);
    const target = await findExactRoleTarget("A21_LIST");
    if (!target) return false;
    return dispatchCanonicalList(active, target, options);
  };

  continueNextGoodsKey = async function continueNextGoodsKeyV053(active, sender, evidence) {
    if (active?.job?.productKind === "OPTION") {
      active.a21CanonicalStage = null;
      active.a21CanonicalStageAt = 0;
      await saveActive(active);
    }
    return legacyContinueNextGoodsKeyV053(active, sender, evidence);
  };

  async function handleCanonicalStage(message) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "OPTION") {
      return { ok: false, error: "stock_canonical_no_active_option_job" };
    }
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) {
      return { ok: false, error: "stock_canonical_stale_job" };
    }
    if (active.stage !== "A21_LIST") {
      return { ok: false, error: "stock_canonical_not_a21_list" };
    }

    const next = String(message?.stage || "");
    active.a21CanonicalStage = next;
    active.a21CanonicalStageAt = Date.now();
    await saveActive(active);

    if (next === "SEARCH_SUBMITTED") {
      await progress(
        active,
        `A21 goods key ${currentGoodsKey(active)} · 가격조정 원본 엔진 검색 제출 완료 → 실제 결과행 checkbox.click() 단계`,
        {
          canonicalStage: next,
          canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
          goodsKey: currentGoodsKey(active),
        },
      );
      setTimeout(() => {
        void (async () => {
          const latest = await loadActive();
          if (!isCanonicalA21(latest) || latest.a21CanonicalStage !== "SEARCH_SUBMITTED") return;
          await dispatchCurrent(latest, { focus: false });
        })();
      }, 700);
      setTimeout(() => {
        void (async () => {
          const latest = await loadActive();
          if (!isCanonicalA21(latest) || latest.a21CanonicalStage !== "SEARCH_SUBMITTED") return;
          await dispatchCurrent(latest, { focus: false });
        })();
      }, 1_800);
      return { ok: true, accepted: true };
    }

    if (next === "POPUP_OPENING") {
      await progress(
        active,
        `A21 goods key ${currentGoodsKey(active)} · 가격조정 원본 엔진이 실제 결과행 전건 체크 완료 → 빨간 상품 수정전송 클릭 실행 중`,
        {
          canonicalStage: next,
          selectedRowCount: Number(message?.selectedRowCount || 0),
          totalResultCount: Number(message?.totalResultCount || 0),
          canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
          popupStateTransition: "WAIT_FOR_REAL_POPUP_CLAIM",
        },
      );
      setTimeout(() => {
        void (async () => {
          const latest = await loadActive();
          if (!isCanonicalA21(latest) || latest.a21CanonicalStage !== "POPUP_OPENING") return;
          const ageMs = Date.now() - Number(latest.a21CanonicalStageAt || 0);
          if (ageMs < 5_000) return;
          const recovered = await resetStaleCanonicalOpening(latest, "popupOpeningTimer");
          if (isCanonicalA21(recovered)) await dispatchCurrent(recovered, { focus: true });
        })();
      }, 5_300);
      return { ok: true, accepted: true };
    }

    await progress(active, `A21 가격조정 원본 엔진 단계 · ${next || "미확인"}`, {
      canonicalStage: next,
      canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
    });
    return { ok: true, accepted: true };
  }

  async function handleCanonicalFailure(message) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "OPTION") {
      return { ok: false, error: "stock_canonical_no_active_option_job" };
    }
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) {
      return { ok: false, error: "stock_canonical_stale_job" };
    }
    const code = String(message?.code || "A21_CANONICAL_PRICE_ENGINE_FAILED");
    const text = String(message?.message || "가격조정 원본 A21 엔진 실행 실패");
    const result = await finish(active, "FAILED", text, {
      code,
      canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      canonicalStage: active.a21CanonicalStage || null,
      goodsKey: currentGoodsKey(active),
    });
    return { ok: true, result };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (![CANONICAL_STAGE, CANONICAL_FAILURE, CANONICAL_SUCCESS, CANONICAL_SPLIT].includes(message?.type)) return;
    void (async () => {
      if (message.type === CANONICAL_STAGE) {
        sendResponse(await handleCanonicalStage(message));
        return;
      }
      if (message.type === CANONICAL_FAILURE) {
        sendResponse(await handleCanonicalFailure(message));
        return;
      }
      if (message.type === CANONICAL_SPLIT) {
        sendResponse(await handleCanonicalFailure({
          ...message,
          code: "A21_CANONICAL_SPLIT_REQUIRED",
          message: `A21 조회결과 ${Number(message?.totalResultCount || 0)}건으로 가격조정 원본 엔진 단일 처리한도를 초과했습니다.`,
        }));
        return;
      }
      // Final completion remains authoritative through the stock PriceCore + result observer.
      sendResponse({ ok: true, ignored: true, reason: "stock_result_observer_authoritative" });
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error || "stock_canonical_adapter_failed") });
    });
    return true;
  });

  async function recoverPersistedFalsePopupState(trigger) {
    if (bootstrapRunning) return;
    bootstrapRunning = true;
    try {
      const active = await loadActive();
      if (!active || active.status !== "RUNNING" || active.job?.productKind !== "OPTION") return;
      if (active.stage !== "A21_POPUP") return;
      const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
      if (popupTabs.some((tab) => Number.isInteger(tab?.id))) return;
      active.stage = "A21_LIST";
      active.stageStartedAt = Date.now();
      active.a21CanonicalStage = `LIST_RECOVER_${Date.now()}`;
      active.a21CanonicalStageAt = Date.now();
      active.attempts = {};
      active.shoplingTabId = active.workTabs?.A21_LIST?.tabId || null;
      active.shoplingFrameId = active.workTabs?.A21_LIST?.frameId || null;
      await saveActive(active);
      await progress(active, `${active.job.barcode} · 실제 팝업 없는 기존 대기상태 제거 → 가격조정 원본 A21 엔진으로 재시작`, {
        code: "A21_FALSE_POPUP_STATE_RECOVERED_TO_CANONICAL_LIST",
        trigger,
        canonicalEngine: "PRICE_EXTENSION_CONTENT_A21_LITERAL",
      });
      await sleep(200);
      await dispatchCurrent(active, { focus: true });
    } finally {
      bootstrapRunning = false;
    }
  }

  setTimeout(() => void recoverPersistedFalsePopupState("serviceWorkerStart"), 900);
  chrome.runtime.onInstalled.addListener(() => {
    setTimeout(() => void recoverPersistedFalsePopupState("onInstalled"), 900);
  });
})();
