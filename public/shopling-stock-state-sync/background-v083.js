importScripts("background-v082.js");

// HF61: make the Lane 1 terminal -> Lane 2 start handoff durable.
//
// HF51's alarm only woke the MV3 worker and assumed HF28's 200 ms boot timer
// would always re-enter the coordinator. Chrome may suspend the worker after the
// first Shopling acceptance has been persisted but before that timer runs. The
// two-lane checkpoint then stays RUNNING with no active job and Lane 2 never
// starts. HF61 claims the second-lane start in persisted storage, owns a separate
// recovery alarm while that claim is in flight, and resumes the exact saved job
// once. No completed B-code is replayed.
(() => {
  const VERSION_V083 = chrome.runtime.getManifest().version;
  const PARALLEL_STATE_KEY = "commerceOsShoplingStockParallelV028";
  const WORKSPACE_KEY = "commerceStockWorkspaceV030";
  const LEGACY_RESUME_ALARM = "commerce-os-shopling-stock-parallel-resume-hf51";
  const SECOND_RESUME_ALARM =
    "commerce-os-shopling-stock-second-lane-resume-hf61";
  const STARTING_PHASE = "STARTING_SECOND_HF61";
  const RECOVERY_LEASE_MS = 20_000;
  const FRESH_ANCHOR_READY_MS = 1_000;
  const recoveringBatches = new Set();
  const legacyFinishV083 = finish;

  const terminalOutcomeV083 = (value) =>
    ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(
      String(value || "").toUpperCase(),
    );

  async function loadParallelV083() {
    const stored = await chrome.storage.local
      .get(PARALLEL_STATE_KEY)
      .catch(() => ({}));
    return stored?.[PARALLEL_STATE_KEY] || null;
  }

  async function saveParallelV083(state) {
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [PARALLEL_STATE_KEY]: state });
    return state;
  }

  async function publishParallelV083(state, extra = {}) {
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
      extensionVersion: VERSION_V083,
      ...extra,
    }).catch(() => null);
  }

  async function syncSecondResumeAlarmV083() {
    const state = await loadParallelV083();
    const required = Boolean(
      state &&
        state.status === "RUNNING" &&
        state.phase === STARTING_PHASE &&
        state.secondStarted === true,
    );
    if (!required) {
      await chrome.alarms.clear(SECOND_RESUME_ALARM).catch(() => null);
      return false;
    }
    await chrome.alarms
      .create(SECOND_RESUME_ALARM, {
        delayInMinutes: 0.5,
        periodInMinutes: 0.5,
      })
      .catch(() => null);
    return true;
  }

  async function ensureSecondAnchorV083(state) {
    if (Number.isInteger(state.secondAnchorTabId)) {
      const existing = await chrome.tabs
        .get(state.secondAnchorTabId)
        .catch(() => null);
      if (existing) {
        await chrome.tabs
          .update(state.secondAnchorTabId, { active: true })
          .catch(() => null);
        if (Number.isInteger(existing.windowId)) {
          await chrome.windows
            .update(existing.windowId, { focused: true })
            .catch(() => null);
        }
        return { ok: true, reused: true };
      }
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
      return { ok: false, code: "HF61_SECOND_WINDOW_CREATE_FAILED" };
    }
    const anchorTab = Array.isArray(created.tabs)
      ? created.tabs.find((tab) => Number.isInteger(tab?.id))
      : null;
    state.secondAnchorWindowId = created.id;
    state.secondAnchorTabId = anchorTab?.id ?? null;
    state.secondAnchorCreatedBy = "HF61_DURABLE_SECOND_LANE_RESUME";
    await saveParallelV083(state);
    // Preserve HF28's proven fresh-window readiness gap before A6/A21
    // preflight. If Chrome sleeps here, STARTING_PHASE + the recovery alarm
    // safely resume this exact second job after the persisted lease expires.
    await new Promise((resolve) => setTimeout(resolve, FRESH_ANCHOR_READY_MS));
    if (Number.isInteger(state.secondAnchorTabId)) {
      await chrome.tabs
        .update(state.secondAnchorTabId, { active: true })
        .catch(() => null);
    }
    await chrome.windows
      .update(created.id, { focused: true })
      .catch(() => null);
    return { ok: true, reused: false };
  }

  async function confirmSecondStartedV083(state, active, trigger) {
    state.secondStarted = true;
    state.phase = "PARALLEL_RUNNING";
    state.secondStartedAt = Number(state.secondStartedAt || Date.now());
    state.secondRecoveredAt = Date.now();
    state.secondRecoveredBy = "HF61_DURABLE_SECOND_LANE_RESUME";
    state.secondRecoveryTrigger = trigger;
    await saveParallelV083(state);
    await chrome.alarms.clear(SECOND_RESUME_ALARM).catch(() => null);
    await publishParallelV083(state, {
      secondRecoveryTrigger: trigger,
      activeJobId: active?.job?.jobId || state.secondJobId,
      durableSecondLaneResume: true,
      shoplingMutationBeforeRecovery: false,
    });
    return { recovered: true, batchId: state.batchId };
  }

  async function failSecondStartV083(state, response, trigger) {
    const secondJob = state.jobs?.[1];
    state.status = "FAILED";
    state.phase = "SECOND_START_FAILED_HF61";
    state.secondStarted = false;
    state.results = {
      ...(state.results || {}),
      [state.secondJobId]: {
        outcome: "FAILED",
        message:
          response?.message ||
          `${secondJob?.barcode || "Lane 2"} Shopling 시작에 실패했습니다.`,
        finishedAt: Date.now(),
      },
    };
    await saveParallelV083(state);
    await chrome.alarms.clear(SECOND_RESUME_ALARM).catch(() => null);
    await publishParallelV083(state, {
      ok: false,
      code: response?.code || "HF61_SECOND_START_FAILED",
      message: state.results[state.secondJobId].message,
      secondRecoveryTrigger: trigger,
      durableSecondLaneResume: true,
    });
    return { recovered: false, reason: "SECOND_START_FAILED" };
  }

  async function recoverSecondLaneV083(trigger, batchIdHint = "") {
    const initial = await loadParallelV083();
    if (
      !initial ||
      initial.status !== "RUNNING" ||
      (batchIdHint && initial.batchId !== batchIdHint) ||
      !initial.secondJobId ||
      !Array.isArray(initial.jobs) ||
      initial.jobs[1]?.jobId !== initial.secondJobId
    ) {
      return { recovered: false, reason: "NO_RUNNING_TWO_LANE_CHECKPOINT" };
    }
    if (recoveringBatches.has(initial.batchId)) {
      return { recovered: false, reason: "IN_MEMORY_LEASE" };
    }

    const active = await loadActive().catch(() => null);
    if (active?.status === "RUNNING") {
      if (active.job?.jobId === initial.secondJobId) {
        return confirmSecondStartedV083(initial, active, trigger);
      }
      return { recovered: false, reason: "OTHER_ACTIVE_JOB_EXISTS" };
    }

    const last = await loadLastResult().catch(() => null);
    if (
      last?.jobId === initial.secondJobId &&
      terminalOutcomeV083(last.outcome)
    ) {
      initial.results = {
        ...(initial.results || {}),
        [initial.secondJobId]: {
          outcome: last.outcome,
          message: last.message,
          finishedAt: last.finishedAt,
        },
      };
      const firstOutcome = String(
        initial.results?.[initial.firstJobId]?.outcome || "",
      ).toUpperCase();
      initial.status =
        firstOutcome === "SUCCEEDED" && last.outcome === "SUCCEEDED"
          ? "SUCCEEDED"
          : "FAILED";
      initial.phase = "DONE";
      await saveParallelV083(initial);
      await chrome.alarms.clear(SECOND_RESUME_ALARM).catch(() => null);
      await publishParallelV083(initial, {
        secondRecoveryTrigger: trigger,
        recoveredTerminalSecondResult: true,
      });
      return { recovered: true, terminal: true };
    }

    const firstOutcome = String(
      initial.results?.[initial.firstJobId]?.outcome ||
        (last?.jobId === initial.firstJobId ? last.outcome : ""),
    ).toUpperCase();
    const resumingClaim =
      initial.phase === STARTING_PHASE && initial.secondStarted === true;
    if (!resumingClaim && firstOutcome !== "SUCCEEDED") {
      return { recovered: false, reason: "FIRST_JOB_NOT_SUCCEEDED" };
    }
    if (initial.secondStarted === true && !resumingClaim) {
      return { recovered: false, reason: "SECOND_ALREADY_STARTED" };
    }

    const now = Date.now();
    const leaseAt = Number(initial.secondRecoveryLeaseAt || 0);
    if (
      resumingClaim &&
      leaseAt > 0 &&
      now - leaseAt < RECOVERY_LEASE_MS &&
      trigger !== "FIRST_FINISH_HF61"
    ) {
      return { recovered: false, reason: "PERSISTED_LEASE_ACTIVE" };
    }

    recoveringBatches.add(initial.batchId);
    try {
      initial.secondStarted = true;
      initial.phase = STARTING_PHASE;
      initial.secondRecoveryLeaseAt = now;
      initial.secondRecoveryAttempts =
        Number(initial.secondRecoveryAttempts || 0) + 1;
      initial.secondRecoveryTrigger = trigger;
      await saveParallelV083(initial);
      await syncSecondResumeAlarmV083();

      const anchor = await ensureSecondAnchorV083(initial);
      if (!anchor.ok) {
        return failSecondStartV083(initial, anchor, trigger);
      }

      const response = await start(initial.jobs[1]);
      if (!response?.ok) {
        const activeAfterFailure = await loadActive().catch(() => null);
        if (activeAfterFailure?.job?.jobId === initial.secondJobId) {
          return confirmSecondStartedV083(
            initial,
            activeAfterFailure,
            `${trigger}:ACTIVE_AFTER_START_RESPONSE`,
          );
        }
        return failSecondStartV083(initial, response, trigger);
      }
      return confirmSecondStartedV083(initial, response.active, trigger);
    } finally {
      recoveringBatches.delete(initial.batchId);
    }
  }

  finish = async function finishV083(active, outcome, message, evidence = {}) {
    const result = await legacyFinishV083(active, outcome, message, evidence);
    const batchId = String(active?.job?.parallelBatchId || "");
    if (
      batchId &&
      Number(active?.job?.parallelLane || 0) === 1 &&
      String(result?.outcome || outcome).toUpperCase() === "SUCCEEDED"
    ) {
      await recoverSecondLaneV083("FIRST_FINISH_HF61", batchId);
    }
    return result;
  };

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (
      alarm?.name !== LEGACY_RESUME_ALARM &&
      alarm?.name !== SECOND_RESUME_ALARM
    ) {
      return;
    }
    void recoverSecondLaneV083(`ALARM:${alarm.name}`);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[PARALLEL_STATE_KEY]) return;
    void syncSecondResumeAlarmV083();
  });

  void syncSecondResumeAlarmV083();
  void loadParallelV083().then((state) => {
    if (
      state?.status === "RUNNING" &&
      state?.phase === STARTING_PHASE &&
      state?.secondStarted === true
    ) {
      void recoverSecondLaneV083("SERVICE_WORKER_BOOT_HF61");
    }
  });
})();
