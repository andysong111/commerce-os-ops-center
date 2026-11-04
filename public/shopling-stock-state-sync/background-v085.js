importScripts("background-v084.js");

// HF63 fixes two independent handoff gaps found in the real BCD8/BDB2/BBD3 run.
//
// 1. Shopling destroys and recreates the nested A6 document after an exact search.
//    HF36 intentionally pinned results to one exact frame, but that also rejected the
//    replacement A6 frame before it could resume the submitted search. HF63 rebinds
//    only when the old A6 frame no longer answers and the replacement is in the same
//    dedicated worker tab. Write-capable A21 stages remain strictly pinned.
// 2. A failed/uncertain Lane 1 used to suppress Lane 2. HF63 durably claims and starts
//    the saved second B-code even when the first B-code fails. The first failure is
//    preserved; this changes continuation, not outcome reporting.
(() => {
  const VERSION_V085 = chrome.runtime.getManifest().version;
  const PARALLEL_STATE_KEY = "commerceOsShoplingStockParallelV028";
  const WORKSPACE_KEY = "commerceStockWorkspaceV030";
  const SECOND_RESUME_ALARM =
    "commerce-os-shopling-stock-second-lane-resume-hf61";
  const STARTING_PHASE = "STARTING_SECOND_HF61";
  const FRESH_ANCHOR_READY_MS = 1_000;
  const recoveringBatches = new Set();
  const legacyHandlePageReadyV085 = handlePageReady;
  const legacyFinishV085 = finish;

  const terminalNonSuccessV085 = (value) =>
    ["FAILED", "UNCERTAIN"].includes(String(value || "").toUpperCase());

  async function loadParallelV085() {
    const stored = await chrome.storage.local
      .get(PARALLEL_STATE_KEY)
      .catch(() => ({}));
    return stored?.[PARALLEL_STATE_KEY] || null;
  }

  async function saveParallelV085(state) {
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [PARALLEL_STATE_KEY]: state });
    return state;
  }

  async function publishParallelV085(state, extra = {}) {
    await broadcast("STOCK_SYNC_PARALLEL_STATUS", {
      batchId: state.batchId,
      status: state.status,
      phase: state.phase,
      firstJobId: state.firstJobId,
      secondJobId: state.secondJobId,
      secondStarted: Boolean(state.secondStarted),
      detachedFirst: Boolean(state.detachedFirst),
      results: state.results || {},
      ignoreWindowClose: true,
      extensionVersion: VERSION_V085,
      ...extra,
    }).catch(() => null);
  }

  async function probeAssignedA6V085(target) {
    if (!Number.isInteger(target?.tabId) || !Number.isInteger(target?.frameId)) {
      return null;
    }
    return chrome.tabs
      .sendMessage(
        target.tabId,
        { type: "STOCK_SYNC_PROBE", stage: "A6" },
        { frameId: target.frameId },
      )
      .catch(() => null);
  }

  handlePageReady = async function handlePageReadyV085(message, sender) {
    const active = await loadActive();
    const assigned = active?.workTabs?.A6;
    const senderTabId = sender?.tab?.id;
    const senderFrameId = sender?.frameId;
    const isReplacementA6 = Boolean(
      active?.status === "RUNNING" &&
        active?.stage === "A6" &&
        message?.page?.role === "A6" &&
        Number.isInteger(assigned?.tabId) &&
        Number.isInteger(assigned?.frameId) &&
        assigned.tabId === senderTabId &&
        assigned.frameId !== senderFrameId &&
        Number.isInteger(senderFrameId),
    );

    if (isReplacementA6) {
      const oldProbe = await probeAssignedA6V085(assigned);
      const oldOwnerStillHealthy = Boolean(
        oldProbe?.ok === true && oldProbe?.page?.role === "A6",
      );
      if (!oldOwnerStillHealthy) {
        const reboundAt = Date.now();
        const previousFrameId = assigned.frameId;
        active.shoplingTabId = senderTabId;
        active.shoplingFrameId = senderFrameId;
        active.workTabs = {
          ...(active.workTabs || {}),
          A6: {
            ...assigned,
            tabId: senderTabId,
            windowId: sender?.tab?.windowId ?? assigned.windowId ?? null,
            frameId: senderFrameId,
          },
        };
        active.watchdogHeartbeatStage = "A6";
        active.watchdogHeartbeatAt = reboundAt;
        active.watchdogHeartbeatSource =
          "HF63_EXACT_A6_NAVIGATION_OWNER_REBOUND";
        active.a6OwnerRebind = {
          previousFrameId,
          frameId: senderFrameId,
          tabId: senderTabId,
          reboundAt,
          reason: "OLD_ASSIGNED_A6_FRAME_GONE_AFTER_SEARCH_NAVIGATION",
        };
        await saveActive(active);
        await broadcast("STOCK_SYNC_PROGRESS", {
          jobId: active.job?.jobId,
          job: active.job,
          stage: "A6",
          message: `${active.job?.barcode || "B코드"} A6 검색 완료 페이지로 이어서 조회합니다.`,
          evidence: {
            code: "HF63_A6_OWNER_REBOUND_AFTER_NAVIGATION",
            previousFrameId,
            frameId: senderFrameId,
            tabId: senderTabId,
            commerceOsMutationBeforeRebind: false,
          },
          extensionVersion: VERSION_V085,
        }).catch(() => null);
      }
    }

    return legacyHandlePageReadyV085(message, sender);
  };

  async function claimSecondAfterFirstFailureV085(active, outcome) {
    const batchId = String(active?.job?.parallelBatchId || "");
    if (
      !batchId ||
      Number(active?.job?.parallelLane || 0) !== 1 ||
      !terminalNonSuccessV085(outcome)
    ) {
      return null;
    }

    const state = await loadParallelV085();
    if (
      !state ||
      state.batchId !== batchId ||
      !Array.isArray(state.jobs) ||
      state.jobs[1]?.jobId !== state.secondJobId ||
      state.results?.[state.secondJobId]?.outcome ||
      (state.secondStarted === true && state.phase !== STARTING_PHASE)
    ) {
      return null;
    }

    const now = Date.now();
    state.status = "RUNNING";
    state.secondStarted = true;
    state.phase = STARTING_PHASE;
    state.secondRecoveryLeaseAt = now;
    state.secondRecoveryAttempts =
      Number(state.secondRecoveryAttempts || 0) + 1;
    state.secondRecoveryTrigger = "HF63_FIRST_TERMINAL_NON_SUCCESS";
    state.continueAfterFirstFailure = true;
    state.firstTerminalOutcome = String(outcome || "").toUpperCase();
    await saveParallelV085(state);
    await chrome.alarms
      .create(SECOND_RESUME_ALARM, {
        delayInMinutes: 0.5,
        periodInMinutes: 0.5,
      })
      .catch(() => null);
    await publishParallelV085(state, {
      continueAfterFirstFailure: true,
      firstOutcome: state.firstTerminalOutcome,
      durableSecondLaneClaim: true,
    });
    return state;
  }

  async function ensureSecondAnchorV085(state) {
    if (Number.isInteger(state.secondAnchorTabId)) {
      const existing = await chrome.tabs
        .get(state.secondAnchorTabId)
        .catch(() => null);
      if (existing) return { ok: true, reused: true };
    }

    await chrome.storage.local.remove(WORKSPACE_KEY).catch(() => null);
    const created = await chrome.windows
      .create({
        url: "https://a.shopling.co.kr/",
        focused: true,
        type: "normal",
      })
      .catch(() => null);
    if (!created || !Number.isInteger(created.id)) {
      return { ok: false, code: "HF63_SECOND_WINDOW_CREATE_FAILED" };
    }
    const anchorTab = Array.isArray(created.tabs)
      ? created.tabs.find((tab) => Number.isInteger(tab?.id))
      : null;
    state.secondAnchorWindowId = created.id;
    state.secondAnchorTabId = anchorTab?.id ?? null;
    state.secondAnchorCreatedBy = "HF63_CONTINUE_AFTER_FIRST_FAILURE";
    await saveParallelV085(state);
    await new Promise((resolve) => setTimeout(resolve, FRESH_ANCHOR_READY_MS));
    if (Number.isInteger(state.secondAnchorTabId)) {
      await chrome.tabs
        .update(state.secondAnchorTabId, { active: true })
        .catch(() => null);
    }
    await chrome.windows.update(created.id, { focused: true }).catch(() => null);
    return { ok: true, reused: false };
  }

  async function confirmSecondStartedV085(state, active, trigger) {
    const latest = (await loadParallelV085()) || state;
    latest.status = "RUNNING";
    latest.secondStarted = true;
    latest.phase = "PARALLEL_RUNNING";
    latest.secondStartedAt = Number(latest.secondStartedAt || Date.now());
    latest.secondRecoveredAt = Date.now();
    latest.secondRecoveredBy = "HF63_CONTINUE_AFTER_FIRST_FAILURE";
    latest.secondRecoveryTrigger = trigger;
    await saveParallelV085(latest);
    await chrome.alarms.clear(SECOND_RESUME_ALARM).catch(() => null);
    await publishParallelV085(latest, {
      activeJobId: active?.job?.jobId || latest.secondJobId,
      continueAfterFirstFailure: true,
      durableSecondLaneResume: true,
    });
    return { recovered: true, batchId: latest.batchId };
  }

  async function failSecondStartV085(state, response, trigger) {
    const latest = (await loadParallelV085()) || state;
    const secondJob = latest.jobs?.[1];
    const message =
      response?.message ||
      `${secondJob?.barcode || "Lane 2"} Shopling 시작에 실패했습니다.`;
    const result = {
      jobId: latest.secondJobId,
      job: secondJob,
      outcome: "FAILED",
      message,
      evidence: {
        code: response?.code || "HF63_SECOND_START_FAILED",
        parallelVerification: true,
        parallelBatchId: latest.batchId,
        parallelLane: 2,
        continueAfterFirstFailure: true,
        trigger,
      },
      startedAt: Date.now(),
      finishedAt: Date.now(),
      version: VERSION_V085,
    };
    latest.status = "FAILED";
    latest.phase = "DONE";
    latest.secondStarted = true;
    latest.results = {
      ...(latest.results || {}),
      [latest.secondJobId]: {
        outcome: "FAILED",
        message,
        finishedAt: result.finishedAt,
      },
    };
    await saveParallelV085(latest);
    await chrome.alarms.clear(SECOND_RESUME_ALARM).catch(() => null);
    await broadcast("STOCK_SYNC_RESULT", result).catch(() => null);
    await publishParallelV085(latest, {
      ok: false,
      code: result.evidence.code,
      message,
      continueAfterFirstFailure: true,
    });
    return { recovered: false, reason: "SECOND_START_FAILED" };
  }

  async function resumeClaimedSecondV085(batchId, trigger) {
    if (recoveringBatches.has(batchId)) {
      return { recovered: false, reason: "IN_MEMORY_LEASE" };
    }
    const state = await loadParallelV085();
    if (
      !state ||
      state.batchId !== batchId ||
      state.status !== "RUNNING" ||
      state.phase !== STARTING_PHASE ||
      state.secondStarted !== true ||
      !Array.isArray(state.jobs) ||
      state.jobs[1]?.jobId !== state.secondJobId
    ) {
      return { recovered: false, reason: "NO_CLAIMED_SECOND_JOB" };
    }

    recoveringBatches.add(batchId);
    try {
      const active = await loadActive().catch(() => null);
      if (active?.status === "RUNNING") {
        if (active.job?.jobId === state.secondJobId) {
          return confirmSecondStartedV085(state, active, trigger);
        }
        return { recovered: false, reason: "OTHER_ACTIVE_JOB_EXISTS" };
      }

      const anchor = await ensureSecondAnchorV085(state);
      if (!anchor.ok) {
        return failSecondStartV085(state, anchor, trigger);
      }
      const response = await start(state.jobs[1]);
      if (!response?.ok) {
        const activeAfterFailure = await loadActive().catch(() => null);
        if (activeAfterFailure?.job?.jobId === state.secondJobId) {
          return confirmSecondStartedV085(
            state,
            activeAfterFailure,
            `${trigger}:ACTIVE_AFTER_START_RESPONSE`,
          );
        }
        return failSecondStartV085(state, response, trigger);
      }
      return confirmSecondStartedV085(state, response.active, trigger);
    } finally {
      recoveringBatches.delete(batchId);
    }
  }

  finish = async function finishV085(active, outcome, message, evidence = {}) {
    const claimed = await claimSecondAfterFirstFailureV085(active, outcome);
    const result = await legacyFinishV085(active, outcome, message, {
      ...evidence,
      continueRemainingBcodesAfterFailure: true,
      extensionVersion: VERSION_V085,
    });
    if (claimed) {
      await resumeClaimedSecondV085(
        claimed.batchId,
        "HF63_FIRST_FINISH_NON_SUCCESS",
      );
    }
    return result;
  };

  console.log(
    "[CommerceOS Stock HF63]",
    new Date().toISOString(),
    "A6 navigation owner handoff + continue every paired B-code enabled",
  );
})();
