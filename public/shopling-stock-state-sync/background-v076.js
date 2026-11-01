importScripts("background-v075.js");

// HF52: recover the exact write-free gap before Lane 1 becomes active.
//
// HF28 persists STARTING_FIRST before start(job) performs its Shopling work-tab
// preflight. If MV3 suspends the worker during that awaited preflight, there is
// no active job and no result to drive the inherited coordinator. HF51 keeps
// waking the worker, but the coordinator only waits for those two signals and
// therefore leaves the batch stuck for its full result timeout.
//
// Re-entering start(job) is safe only in this exact checkpoint: start() saves
// the active job before dispatchCurrent() can mutate a Shopling product. A
// missing active job therefore proves that no stock-state write was dispatched.
// The stale-age and persisted lease guards also prevent racing a legitimate,
// still-running preflight or starting the same Lane twice after another wake.
(() => {
  const PARALLEL_STATE_KEY = "commerceOsShoplingStockParallelV028";
  const RESUME_ALARM = "commerce-os-shopling-stock-parallel-resume-hf51";
  const STARTING_FIRST_STALE_MS = 3 * 60 * 1000;
  const RECOVERY_LEASE_MS = 75 * 1000;
  const VERSION_V076 = chrome.runtime.getManifest().version;
  let recoveringFirst = false;

  const terminalOutcome = (value) =>
    ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(
      String(value || "").toUpperCase(),
    );

  async function loadParallel() {
    const stored = await chrome.storage.local
      .get(PARALLEL_STATE_KEY)
      .catch(() => ({}));
    return stored?.[PARALLEL_STATE_KEY] || null;
  }

  async function saveParallel(state) {
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [PARALLEL_STATE_KEY]: state });
    return state;
  }

  async function reportStatus(state, phase, extra = {}) {
    await broadcast("STOCK_SYNC_PARALLEL_STATUS", {
      batchId: state.batchId,
      status: state.status,
      phase,
      firstJobId: state.firstJobId,
      secondJobId: state.secondJobId,
      secondStarted: Boolean(state.secondStarted),
      detachedFirst: Boolean(state.detachedFirst),
      results: state.results || {},
      ignoreWindowClose: true,
      extensionVersion: VERSION_V076,
      ...extra,
    }).catch(() => null);
  }

  function eligibleCheckpoint(state, now) {
    if (
      !state ||
      state.status !== "RUNNING" ||
      state.secondStarted === true ||
      !["STARTING_FIRST", "RECOVERING_FIRST_HF52"].includes(state.phase) ||
      !state.firstJobId ||
      !Array.isArray(state.jobs) ||
      state.jobs[0]?.jobId !== state.firstJobId
    ) {
      return false;
    }
    const startingAt = Number(state.startedAt || state.updatedAt || 0);
    if (
      state.phase === "STARTING_FIRST" &&
      (!Number.isFinite(startingAt) || now - startingAt < STARTING_FIRST_STALE_MS)
    ) {
      return false;
    }
    const leaseAt = Number(state.firstRecoveryLeaseAt || 0);
    if (
      state.phase === "RECOVERING_FIRST_HF52" &&
      Number.isFinite(leaseAt) &&
      leaseAt > 0 &&
      now - leaseAt < RECOVERY_LEASE_MS
    ) {
      return false;
    }
    return true;
  }

  async function recoverStartingFirst(trigger) {
    if (recoveringFirst) return { recovered: false, reason: "IN_MEMORY_LEASE" };
    const now = Date.now();
    const state = await loadParallel();
    if (!eligibleCheckpoint(state, now)) {
      return { recovered: false, reason: "CHECKPOINT_NOT_ELIGIBLE" };
    }

    const active = await loadActive().catch(() => null);
    if (active?.status === "RUNNING") {
      if (active.job?.jobId === state.firstJobId) {
        state.phase = "FIRST_RUNNING_UNTIL_RESULT_WAIT";
        state.firstRecoveredFromActive = true;
        await saveParallel(state);
        await reportStatus(state, state.phase, {
          recoveryTrigger: trigger,
          activeJobId: state.firstJobId,
        });
      }
      return { recovered: false, reason: "ACTIVE_JOB_EXISTS" };
    }

    const last = await loadLastResult().catch(() => null);
    if (last?.jobId === state.firstJobId && terminalOutcome(last.outcome)) {
      return { recovered: false, reason: "TERMINAL_RESULT_EXISTS" };
    }

    recoveringFirst = true;
    try {
      state.phase = "RECOVERING_FIRST_HF52";
      state.firstRecoveryLeaseAt = now;
      state.firstRecoveryAttempts = Number(state.firstRecoveryAttempts || 0) + 1;
      await saveParallel(state);
      await reportStatus(state, state.phase, {
        recoveryTrigger: trigger,
        recoveryAttempt: state.firstRecoveryAttempts,
        shoplingMutationBeforeRecovery: false,
      });

      const response = await start(state.jobs[0]);
      const latest = await loadParallel();
      if (!latest || latest.batchId !== state.batchId || latest.status !== "RUNNING") {
        return { recovered: false, reason: "BATCH_CHANGED" };
      }
      if (!response?.ok) {
        latest.status = "FAILED";
        latest.phase = "FIRST_START_FAILED";
        latest.firstRecoveryFailure = {
          code: response?.code || "HF52_FIRST_RECOVERY_START_FAILED",
          message:
            response?.message ||
            `${latest.jobs[0]?.barcode || "Lane 1"} 첫 작업 복구 시작에 실패했습니다.`,
          at: Date.now(),
        };
        await saveParallel(latest);
        await reportStatus(latest, latest.phase, latest.firstRecoveryFailure);
        return { recovered: false, reason: latest.firstRecoveryFailure.code };
      }

      latest.phase = "FIRST_RUNNING_UNTIL_RESULT_WAIT";
      latest.firstRecoveredAt = Date.now();
      latest.firstRecoveredBy = "HF52_STARTING_FIRST_CHECKPOINT";
      await saveParallel(latest);
      await reportStatus(latest, latest.phase, {
        recoveryTrigger: trigger,
        activeJobId: response.active?.job?.jobId || latest.firstJobId,
        shoplingMutationBeforeRecovery: false,
      });
      return { recovered: true, batchId: latest.batchId };
    } finally {
      recoveringFirst = false;
    }
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== RESUME_ALARM) return;
    void recoverStartingFirst("HF51_RESUME_ALARM");
  });

  setTimeout(() => {
    void recoverStartingFirst("SERVICE_WORKER_BOOT");
  }, 250);
})();
