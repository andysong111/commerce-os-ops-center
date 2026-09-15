importScripts("background-v070.js");

// HF29 OPTION A21 batching overlay.
// The proven A6 read-only resolver and per-goods-key Commerce OS -> Shopling API
// option-state mutation stay unchanged. Only the A21 transmission stage is grouped:
// up to 20 already-verified Shopling goods keys are placed into the existing canonical
// A21 multi-search input as one comma-separated batch, every visible result row must
// match one of those exact keys, and only then is the existing OPTION resend popup used.
// The canonical worker remains fail-closed when the visible result set is too large or
// incomplete; HF29 never silently falls back to repeated single-key sends.
(() => {
  const VERSION_V071 = chrome.runtime.getManifest().version;
  const OPTION_BATCH_MAX_V071 = 20;
  const CANONICAL_LIST_SCRIPT_V071 = "content-a21-canonical-v014.js";
  const CANONICAL_IDENTIFY_V071 = "A21_IDENTIFY";
  const CANONICAL_ASSIGN_V071 = "A21_LIST_ASSIGNMENT";
  const legacyDispatchToTargetV071 = dispatchToTarget;
  const legacyDispatchCurrentV071 = dispatchCurrent;
  const legacyContinueNextGoodsKeyV071 = continueNextGoodsKey;

  function isOptionBatchA21V071(active) {
    return Boolean(
      active &&
        active.status === "RUNNING" &&
        active.job?.productKind === "OPTION" &&
        active.job?.optionApiApplied === true &&
        active.stage === "A21_LIST" &&
        Array.isArray(active.job?.goodsKeys) &&
        active.job.goodsKeys.length > 0,
    );
  }

  function optionBatchLimitV071(active) {
    const requested = Number(active?.optionBatchLimit || OPTION_BATCH_MAX_V071);
    if (!Number.isFinite(requested)) return OPTION_BATCH_MAX_V071;
    return Math.max(1, Math.min(OPTION_BATCH_MAX_V071, Math.floor(requested)));
  }

  function optionBatchKeysV071(active) {
    const keys = Array.isArray(active?.job?.goodsKeys) ? active.job.goodsKeys : [];
    const start = Math.max(0, Number(active?.goodsKeyIndex || 0));
    return keys.slice(start, start + optionBatchLimitV071(active));
  }

  function optionRunIdV071(active) {
    return String(active?.job?.executionId || active?.job?.jobId || "");
  }

  function optionCanonicalStageV071(active) {
    return String(
      active?.a21CanonicalStage ||
        `OPTION_BATCH_START_${Number(active?.goodsKeyIndex || 0)}_${optionBatchLimitV071(active)}_${optionRunIdV071(active)}`,
    );
  }

  async function ensureCanonicalListWorkerV071(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs
      .sendMessage(target.tabId, { type: CANONICAL_IDENTIFY_V071 }, options)
      .catch(() => null);
    if (probe?.ok && probe.role === "A21_LIST") return true;

    await chrome.scripting
      .executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        files: [CANONICAL_LIST_SCRIPT_V071],
      })
      .catch(() => null);
    await sleep(140);
    probe = await chrome.tabs
      .sendMessage(target.tabId, { type: CANONICAL_IDENTIFY_V071 }, options)
      .catch(() => null);
    return Boolean(probe?.ok && probe.role === "A21_LIST");
  }

  async function dispatchOptionBatchV071(active, target, { focus = false } = {}) {
    if (!isOptionBatchA21V071(active) || !target) return false;
    const batch = optionBatchKeysV071(active);
    if (!batch.length) return false;

    if (focus) {
      await chrome.tabs.update(target.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(target.windowId)) {
        await chrome.windows.update(target.windowId, { focused: true }).catch(() => null);
      }
    }

    if (!(await ensureCanonicalListWorkerV071(target))) {
      await progress(active, `${active.job.barcode} · 옵션 A21 콤마 일괄검색 엔진 연결 대기`, {
        code: "OPTION_A21_BATCH_CANONICAL_WORKER_NOT_READY_HF29",
        batch,
        batchSize: batch.length,
        batchStart: Number(active.goodsKeyIndex || 0),
        batchMode: "A21_COMMA_MULTI_GOODS_KEY",
        extensionVersion: VERSION_V071,
      });
      return false;
    }

    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: { tabId: target.tabId, frameId: target.frameId },
    };
    active.optionBatchLimit = optionBatchLimitV071(active);
    active.optionCurrentBatchKeys = [...batch];
    active.optionCurrentBatchStart = Math.max(0, Number(active.goodsKeyIndex || 0));
    active.optionBatchMode = "A21_COMMA_MULTI_GOODS_KEY";
    await saveActive(active);

    const searchToken = batch.join(",");
    await progress(
      active,
      `${active.job.barcode} · A21 상품코드 ${batch.length}건 콤마 일괄검색 → 결과 전건 검증 후 옵션송신 1회`,
      {
        batch,
        batchSize: batch.length,
        batchStart: active.optionCurrentBatchStart,
        batchLimit: active.optionBatchLimit,
        batchMode: "A21_COMMA_MULTI_GOODS_KEY",
        searchToken,
        optionApiMutation: "ALREADY_VERIFIED_PER_GOODS_KEY",
        extensionVersion: VERSION_V071,
      },
    );

    const response = await chrome.tabs
      .sendMessage(
        target.tabId,
        {
          type: CANONICAL_ASSIGN_V071,
          jobId: active.job.jobId,
          mode: "OPTION",
          goodsKeys: batch,
          stage: optionCanonicalStageV071(active),
          runId: optionRunIdV071(active),
          version: VERSION_V071,
        },
        { frameId: target.frameId },
      )
      .catch(() => null);
    return Boolean(response?.ok && response?.accepted);
  }

  dispatchToTarget = async function dispatchToTargetV071(active, target) {
    if (isOptionBatchA21V071(active)) return dispatchOptionBatchV071(active, target);
    return legacyDispatchToTargetV071(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV071(active, options = {}) {
    if (!isOptionBatchA21V071(active)) return legacyDispatchCurrentV071(active, options);
    const target = await findExactRoleTarget("A21_LIST");
    if (!target) return false;
    return dispatchOptionBatchV071(active, target, options);
  };

  continueNextGoodsKey = async function continueNextGoodsKeyV071(active, sender, evidence) {
    if (
      active?.job?.productKind !== "OPTION" ||
      active?.job?.optionApiApplied !== true ||
      !Array.isArray(active?.optionCurrentBatchKeys) ||
      active.optionCurrentBatchKeys.length < 1
    ) {
      return legacyContinueNextGoodsKeyV071(active, sender, evidence);
    }

    const currentBatch = [...active.optionCurrentBatchKeys];
    const batchStart = Math.max(
      0,
      Number(active.optionCurrentBatchStart ?? active.goodsKeyIndex ?? 0),
    );
    const nextStart = batchStart + currentBatch.length;
    const total = Number(active.job?.goodsKeys?.length || 0);
    active.optionCompletedBatches = Number(active.optionCompletedBatches || 0) + 1;
    active.a21CanonicalStage = null;
    active.a21CanonicalStageAt = 0;

    if (nextStart >= total) {
      return {
        ok: true,
        result: await finish(
          active,
          "SUCCEEDED",
          `${active.job.barcode} Shopling ${statusKorean(active.job.desiredStatus)} 반영 완료 · goods key ${total}건을 ${active.optionCompletedBatches}개 콤마 묶음으로 옵션송신 확인`,
          {
            result: evidence,
            resultTabId: sender?.tab?.id,
            resultFrameId: sender?.frameId,
            batchMode: "A21_COMMA_MULTI_GOODS_KEY",
            completedBatchKeys: currentBatch,
            completedBatchSize: currentBatch.length,
            completedBatches: active.optionCompletedBatches,
            totalGoodsKeys: total,
            batchLimit: optionBatchLimitV071(active),
            optionApiMutation: "UNCHANGED_PER_GOODS_KEY_EXACT_BEFORE_A21",
            extensionVersion: VERSION_V071,
          },
        ),
      };
    }

    active.goodsKeyIndex = nextStart;
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    active.optionCurrentBatchKeys = [];
    active.optionCurrentBatchStart = nextStart;
    await saveActive(active);
    await progress(
      active,
      `${active.job.barcode} · 옵션 콤마 묶음 ${active.optionCompletedBatches}개 완료 → 다음 goods key ${nextStart + 1}/${total}부터 최대 ${optionBatchLimitV071(active)}개 일괄검색`,
      {
        completedBatchKeys: currentBatch,
        completedBatchSize: currentBatch.length,
        completedBatches: active.optionCompletedBatches,
        nextStart,
        totalGoodsKeys: total,
        batchLimit: optionBatchLimitV071(active),
        batchMode: "A21_COMMA_MULTI_GOODS_KEY",
        extensionVersion: VERSION_V071,
      },
    );

    await sleep(350);
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (dispatched) return { ok: true, continuing: true, nextStart };
    return {
      ok: false,
      result: await finish(
        active,
        "UNCERTAIN",
        `다음 옵션 goods key 묶음 ${nextStart + 1}/${total} 처리용 A21 작업창을 찾지 못했습니다. 이미 송신된 묶음은 재전송하지 말고 결과를 확인하세요.`,
        {
          code: "SHOPLING_OPTION_BATCH_NEXT_DISPATCH_LOST_HF29",
          batchMode: "A21_COMMA_MULTI_GOODS_KEY",
          completedBatches: active.optionCompletedBatches,
          nextStart,
          totalGoodsKeys: total,
          extensionVersion: VERSION_V071,
        },
      ),
    };
  };
})();
