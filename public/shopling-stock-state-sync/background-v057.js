importScripts("background-v056.js");

// HF13 SINGLE cutover:
// - Never enter A4 for single-product stock state changes.
// - Reuse the proven A6 read-only B-code resolver only to discover live Shopling goods keys.
// - Do not mutate option state/API for SINGLE.
// - Feed the discovered goods keys to the literal price-extension A21 list engine in batches
//   of at most 200 and send 상품판매상태송신 (품절/판매중) once per selected batch.
// - If one <=200-key query still returns >500 visible rows, shrink the batch adaptively and
//   retry. OPTION/HF10 and the dedicated HF11 SINGLE popup/completion worker stay untouched.
(() => {
  const VERSION_V057 = chrome.runtime.getManifest().version;
  const SINGLE_BATCH_MAX = 200;
  const CANONICAL_LIST_SCRIPT = "content-a21-canonical-v014.js";
  const CANONICAL_IDENTIFY = "A21_IDENTIFY";
  const CANONICAL_ASSIGN = "A21_LIST_ASSIGNMENT";
  const CANONICAL_SPLIT = "A21_SPLIT_REQUIRED";

  const legacyRequiredStagesV057 = requiredStages;
  const legacyStartV057 = start;
  const legacyHandleStepResultV057 = handleStepResult;
  const legacyDispatchToTargetV057 = dispatchToTarget;
  const legacyDispatchCurrentV057 = dispatchCurrent;
  const legacyContinueNextGoodsKeyV057 = continueNextGoodsKey;

  const singleNormV057 = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function isSingleA21ListV057(active) {
    return Boolean(active && active.status === "RUNNING" && active.job?.productKind === "SINGLE" && active.stage === "A21_LIST");
  }

  function singleRunIdV057(active) {
    return String(active?.job?.executionId || active?.job?.jobId || "");
  }

  function singleBatchLimitV057(active) {
    const candidate = Number(active?.singleBatchLimit || SINGLE_BATCH_MAX);
    if (!Number.isFinite(candidate)) return SINGLE_BATCH_MAX;
    return Math.max(1, Math.min(SINGLE_BATCH_MAX, Math.floor(candidate)));
  }

  function singleBatchKeysV057(active) {
    const start = Math.max(0, Number(active?.goodsKeyIndex || 0));
    const limit = singleBatchLimitV057(active);
    return Array.isArray(active?.job?.goodsKeys) ? active.job.goodsKeys.slice(start, start + limit) : [];
  }

  function singleBatchNumberV057(active) {
    const limit = singleBatchLimitV057(active);
    return Math.floor(Number(active?.goodsKeyIndex || 0) / limit) + 1;
  }

  function singleBatchCountV057(active) {
    const total = Number(active?.job?.goodsKeys?.length || 0);
    const limit = singleBatchLimitV057(active);
    return total > 0 ? Math.ceil(total / limit) : 0;
  }

  function singleCanonicalStageV057(active) {
    return String(
      active?.singleA21CanonicalStage ||
      `SINGLE_BATCH_START_${Number(active?.goodsKeyIndex || 0)}_${singleBatchLimitV057(active)}_${singleRunIdV057(active)}`,
    );
  }

  requiredStages = function requiredStagesV057(productKind) {
    return productKind === "SINGLE" ? ["A6", "A21_LIST"] : legacyRequiredStagesV057(productKind);
  };

  function normalizeSingleJobV057(input) {
    const jobId = singleNormV057(input?.jobId);
    const barcode = singleNormV057(input?.barcode).toUpperCase().replace(/\s+/g, "");
    const desiredStatus = singleNormV057(input?.desiredStatus).toUpperCase();
    const modelNo = singleNormV057(input?.modelNo) || null;
    if (!jobId) return { ok: false, code: "STOCK_SYNC_JOB_ID_REQUIRED", message: "작업 ID가 없습니다." };
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode)) {
      return { ok: false, code: "STOCK_SYNC_BARCODE_INVALID", message: "B코드 형식이 올바르지 않습니다." };
    }
    if (!["SOLD_OUT", "ON_SALE"].includes(desiredStatus)) {
      return { ok: false, code: "STOCK_SYNC_DESIRED_STATUS_INVALID", message: "목표상태는 품절 또는 판매중이어야 합니다." };
    }
    const initialGoodsKeys = Array.isArray(input?.goodsKeys)
      ? [...new Set(input.goodsKeys.map((value) => singleNormV057(value)).filter((value) => /^\d+$/.test(value)))]
      : [];
    return {
      ok: true,
      job: {
        ...input,
        jobId,
        barcode,
        productKind: "SINGLE",
        desiredStatus,
        modelNo,
        initialGoodsKeys,
        goodsKeys: [],
        discoveredGoodsKeys: [],
        goodsKeySource: "A6_LIVE_SINGLE_BARCODE",
        singleA4Bypassed: true,
        singleBatchMax: SINGLE_BATCH_MAX,
      },
    };
  }

  start = async function startV057(input) {
    if (singleNormV057(input?.productKind).toUpperCase() !== "SINGLE") return legacyStartV057(input);
    const normalized = normalizeSingleJobV057(input);
    if (!normalized.ok) return normalized;

    const existing = await loadActive();
    if (existing?.status === "RUNNING") {
      const opposite = existing.job?.barcode === normalized.job.barcode && existing.job?.desiredStatus !== normalized.job.desiredStatus;
      return {
        ok: false,
        code: opposite ? "STOCK_SYNC_OPPOSITE_JOB_BLOCKED" : "STOCK_SYNC_ALREADY_RUNNING",
        message: opposite
          ? `${normalized.job.barcode}의 반대 상태 작업이 이미 실행 중이라 중복·경합을 차단했습니다.`
          : `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`,
        active: existing,
      };
    }

    const preflight = await preflightWorkTabs(normalized.job);
    if (!preflight.ok) return preflight;
    const now = Date.now();
    const active = {
      status: "RUNNING",
      job: normalized.job,
      stage: "A6",
      stageStartedAt: now,
      startedAt: now,
      updatedAt: now,
      shoplingTabId: preflight.targets.A6?.tabId || null,
      shoplingFrameId: preflight.targets.A6?.frameId || null,
      workTabs: Object.fromEntries(
        Object.entries(preflight.targets).map(([stage, target]) => [stage, { tabId: target.tabId, frameId: target.frameId }]),
      ),
      goodsKeyIndex: 0,
      singleBatchLimit: SINGLE_BATCH_MAX,
      singleCompletedBatches: 0,
      attempts: {},
      evidence: [],
      message: `${normalized.job.barcode} · 단품 A4 생략 · A6 B코드 읽기전용 goods key 수집 준비`,
      extensionVersion: VERSION_V057,
    };
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await progress(active, `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} · A4 미사용 → A6 읽기전용 B코드 조회 → goods key 수집 → A21 최대 ${SINGLE_BATCH_MAX}개 묶음 상품판매상태 송신`, {
      preflightTabs: active.workTabs,
      a4Bypassed: true,
      a6Mutation: "NONE_READ_ONLY_RESOLVER",
      singleBatchMax: SINGLE_BATCH_MAX,
      initialCachedGoodsKeysIgnored: active.job.initialGoodsKeys,
      extensionVersion: VERSION_V057,
    });
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(active, "FAILED", "A6 옵션대량수정 작업창은 확인했지만 단품 B코드 읽기전용 조회를 시작하지 못했습니다.", {
        code: "SINGLE_A6_LIVE_DISPATCH_FAILED",
        a4Bypassed: true,
        extensionVersion: VERSION_V057,
      });
      return { ok: false, code: "SINGLE_A6_LIVE_DISPATCH_FAILED", message: result.message, result };
    }
    return { ok: true, active: await loadActive(), message: active.message };
  };

  handleStepResult = async function handleStepResultV057(message, sender) {
    const active = await loadActive();
    if (
      message?.stage !== "A6" ||
      !active ||
      active.status !== "RUNNING" ||
      active.job?.productKind !== "SINGLE" ||
      message.jobId !== active.job?.jobId ||
      active.stage !== "A6"
    ) {
      return legacyHandleStepResultV057(message, sender);
    }

    const result = message.result || {};
    if (!result.ok || !result.completed) return legacyHandleStepResultV057(message, sender);
    const discoveredGoodsKeys = Array.isArray(result?.evidence?.discoveredGoodsKeys)
      ? [...new Set(result.evidence.discoveredGoodsKeys.map((value) => singleNormV057(value)).filter((value) => /^\d+$/.test(value)))]
      : [];
    if (!discoveredGoodsKeys.length) {
      return {
        ok: false,
        result: await finish(active, "FAILED", `${active.job.barcode} A6 정확 검색결과에서 Shopling goods key를 1건도 확보하지 못해 단품 품절/판매중 송신을 차단했습니다.`, {
          code: "SINGLE_A6_BCODE_GOODSKEY_NOT_FOUND",
          a6Evidence: result.evidence || null,
          a4Bypassed: true,
          extensionVersion: VERSION_V057,
        }),
      };
    }

    active.job.goodsKeys = discoveredGoodsKeys;
    active.job.discoveredGoodsKeys = discoveredGoodsKeys;
    active.job.goodsKeySource = "A6_LIVE_SINGLE_BARCODE";
    active.goodsKeyIndex = 0;
    active.singleBatchLimit = SINGLE_BATCH_MAX;
    active.singleCompletedBatches = 0;
    active.singleA21CanonicalStage = `SINGLE_BATCH_START_0_${SINGLE_BATCH_MAX}_${singleRunIdV057(active)}`;
    active.singleA21CanonicalStageAt = Date.now();
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.shoplingTabId = active.workTabs?.A21_LIST?.tabId || null;
    active.shoplingFrameId = active.workTabs?.A21_LIST?.frameId || null;
    await saveActive(active);
    await progress(active, `${active.job.barcode} · A6 읽기전용 조회에서 goods key ${discoveredGoodsKeys.length}건 확보 · A4 없이 A21 상품판매상태 ${statusKorean(active.job.desiredStatus)} 송신 시작`, {
      discoveredGoodsKeys,
      goodsKeyCount: discoveredGoodsKeys.length,
      a6MatchedRows: Number(result?.evidence?.matchedRows || 0),
      a6TotalResultCount: Number(result?.evidence?.totalResultCount || 0),
      a6ReadOnly: true,
      checkboxTouched: false,
      a4Bypassed: true,
      singleBatchMax: SINGLE_BATCH_MAX,
      extensionVersion: VERSION_V057,
    });

    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      return {
        ok: false,
        result: await finish(active, "FAILED", "A6 goods key 수집은 완료됐지만 A21 작업창으로 단품 상품판매상태 묶음송신을 전달하지 못했습니다.", {
          code: "SINGLE_A21_BATCH_DISPATCH_FAILED_AFTER_A6",
          retrySafe: true,
          discoveredGoodsKeys,
          a4Bypassed: true,
          extensionVersion: VERSION_V057,
        }),
      };
    }
    return { ok: true, active: await loadActive() };
  };

  async function ensureCanonicalListWorkerV057(target) {
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

  async function dispatchSingleBatchV057(active, target, { focus = false } = {}) {
    if (!isSingleA21ListV057(active) || !target) return false;
    const batch = singleBatchKeysV057(active);
    if (!batch.length) return false;
    if (batch.length > SINGLE_BATCH_MAX) return false;

    if (focus) {
      await chrome.tabs.update(target.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(target.windowId)) await chrome.windows.update(target.windowId, { focused: true }).catch(() => null);
    }
    if (!(await ensureCanonicalListWorkerV057(target))) {
      await progress(active, `${active.job.barcode} · 단품 A21 묶음 목록 엔진 연결 대기`, {
        code: "SINGLE_A21_BATCH_CANONICAL_WORKER_NOT_READY",
        batch,
        batchSize: batch.length,
        extensionVersion: VERSION_V057,
      });
      return false;
    }

    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = { ...(active.workTabs || {}), A21_LIST: { tabId: target.tabId, frameId: target.frameId } };
    active.singleCurrentBatchKeys = [...batch];
    active.singleCurrentBatchStart = Number(active.goodsKeyIndex || 0);
    active.singleCurrentBatchLimit = singleBatchLimitV057(active);
    await saveActive(active);

    const response = await chrome.tabs.sendMessage(
      target.tabId,
      {
        type: CANONICAL_ASSIGN,
        jobId: active.job.jobId,
        mode: "OPTION",
        goodsKeys: batch,
        stage: singleCanonicalStageV057(active),
        runId: singleRunIdV057(active),
        version: VERSION_V057,
      },
      { frameId: target.frameId },
    ).catch(() => null);
    return Boolean(response?.ok && response?.accepted);
  }

  dispatchToTarget = async function dispatchToTargetV057(active, target) {
    if (isSingleA21ListV057(active)) return dispatchSingleBatchV057(active, target);
    return legacyDispatchToTargetV057(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV057(active, options = {}) {
    if (!isSingleA21ListV057(active)) return legacyDispatchCurrentV057(active, options);
    const target = await findExactRoleTarget("A21_LIST");
    if (!target) return false;
    return dispatchSingleBatchV057(active, target, options);
  };

  continueNextGoodsKey = async function continueNextGoodsKeyV057(active, sender, evidence) {
    if (active?.job?.productKind !== "SINGLE") return legacyContinueNextGoodsKeyV057(active, sender, evidence);

    const currentBatch = Array.isArray(active.singleCurrentBatchKeys) && active.singleCurrentBatchKeys.length
      ? [...active.singleCurrentBatchKeys]
      : singleBatchKeysV057(active);
    const batchStart = Math.max(0, Number(active.singleCurrentBatchStart ?? active.goodsKeyIndex ?? 0));
    const nextStart = batchStart + currentBatch.length;
    const total = Number(active.job?.goodsKeys?.length || 0);
    active.singleCompletedBatches = Number(active.singleCompletedBatches || 0) + 1;

    if (nextStart >= total) {
      return {
        ok: true,
        result: await finish(active, "SUCCESS", `${active.job.barcode} · A6에서 확보한 goods key ${total}건 전체를 A4 없이 A21 상품판매상태 ${statusKorean(active.job.desiredStatus)} 송신 완료`, {
          result: evidence,
          resultTabId: sender?.tab?.id,
          resultFrameId: sender?.frameId,
          a4Bypassed: true,
          a6ReadOnly: true,
          goodsKeyCount: total,
          completedBatches: active.singleCompletedBatches,
          batchLimit: singleBatchLimitV057(active),
          extensionVersion: VERSION_V057,
        }),
      };
    }

    active.goodsKeyIndex = nextStart;
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    active.singleCurrentBatchKeys = [];
    active.singleCurrentBatchStart = nextStart;
    active.singleA21CanonicalStage = `SINGLE_BATCH_START_${nextStart}_${singleBatchLimitV057(active)}_${Date.now()}`;
    active.singleA21CanonicalStageAt = Date.now();
    active.shoplingTabId = active.workTabs?.A21_LIST?.tabId || null;
    active.shoplingFrameId = active.workTabs?.A21_LIST?.frameId || null;
    await saveActive(active);
    await progress(active, `${active.job.barcode} · 단품 묶음 ${active.singleCompletedBatches}개 완료 → 다음 goods key ${nextStart + 1}/${total}부터 A21 최대 ${singleBatchLimitV057(active)}개 묶음 계속`, {
      completedBatchKeys: currentBatch,
      completedBatchSize: currentBatch.length,
      nextStart,
      totalGoodsKeys: total,
      batchLimit: singleBatchLimitV057(active),
      a4Bypassed: true,
      extensionVersion: VERSION_V057,
    });
    setTimeout(() => {
      void (async () => {
        const latest = await loadActive();
        if (!isSingleA21ListV057(latest) || Number(latest.goodsKeyIndex || 0) !== nextStart) return;
        await dispatchCurrent(latest, { focus: true });
      })();
    }, 700);
    return { ok: true, advanced: true, nextStart, totalGoodsKeys: total };
  };

  async function handleSingleSplitV057(message) {
    const active = await loadActive();
    if (!isSingleA21ListV057(active)) return { ok: false, ignored: true };
    if (String(message?.jobId || "") !== String(active.job?.jobId || "")) return { ok: false, stale: true };

    const currentBatch = Array.isArray(active.singleCurrentBatchKeys) && active.singleCurrentBatchKeys.length
      ? [...active.singleCurrentBatchKeys]
      : singleBatchKeysV057(active);
    if (currentBatch.length <= 1) {
      return {
        ok: false,
        result: await finish(active, "FAILED", `goods key 1건만 검색해도 A21 조회결과가 ${Number(message?.totalResultCount || 0)}건을 초과해 자동 묶음축소로 처리할 수 없습니다.`, {
          code: "SINGLE_A21_ONE_GOODSKEY_OVER_VISIBLE_LIMIT",
          goodsKey: currentBatch[0] || currentGoodsKey(active),
          totalResultCount: Number(message?.totalResultCount || 0),
          a4Bypassed: true,
          extensionVersion: VERSION_V057,
        }),
      };
    }

    const nextLimit = Math.max(1, Math.floor(currentBatch.length / 2));
    active.singleBatchLimit = nextLimit;
    active.singleCurrentBatchKeys = [];
    active.singleCurrentBatchStart = Number(active.goodsKeyIndex || 0);
    active.singleA21CanonicalStage = `SINGLE_SPLIT_RETRY_${Number(active.goodsKeyIndex || 0)}_${nextLimit}_${Date.now()}`;
    active.singleA21CanonicalStageAt = Date.now();
    active.attempts = {};
    await saveActive(active);
    await progress(active, `A21 조회 ${Number(message?.totalResultCount || 0)}건이 화면 안전한도 500건을 초과 → 단품 goods key 묶음을 ${currentBatch.length}개에서 ${nextLimit}개로 자동 축소 재시도`, {
      code: "SINGLE_A21_BATCH_ADAPTIVE_SPLIT",
      previousBatchSize: currentBatch.length,
      nextBatchLimit: nextLimit,
      totalResultCount: Number(message?.totalResultCount || 0),
      a4Bypassed: true,
      extensionVersion: VERSION_V057,
    });
    setTimeout(() => {
      void (async () => {
        const latest = await loadActive();
        if (!isSingleA21ListV057(latest) || singleBatchLimitV057(latest) !== nextLimit) return;
        await dispatchCurrent(latest, { focus: true });
      })();
    }, 350);
    return { ok: true, split: true, nextBatchLimit: nextLimit };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CANONICAL_SPLIT) return;
    void handleSingleSplitV057(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "single_batch_split_failed") }));
    return true;
  });
})();
