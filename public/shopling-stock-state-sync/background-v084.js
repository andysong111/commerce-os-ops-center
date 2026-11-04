importScripts("background-v083.js");

// HF62: storage rewrites and page reload redispatches are not forward progress.
// Only a stage change or an explicit operation heartbeat may extend the idle
// deadline. This makes a broken search continuation terminate predictably
// instead of remaining RUNNING forever.
(() => {
  const VERSION_V084 = chrome.runtime.getManifest().version;
  const WATCHDOG_ALARM_V084 = "commerce-os-shopling-stock-state-watchdog-v020";
  const PRE_SUBMIT_IDLE_TIMEOUT_MS_V084 = 3 * 60 * 1000;
  const PRE_SUBMIT_HARD_TIMEOUT_MS_V084 = 30 * 60 * 1000;
  const RESULT_TIMEOUT_MS_V084 = 30 * 60 * 1000;

  const numberV084 = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  function heartbeatAtV084(active, stage) {
    const stageStartedAt = numberV084(active?.stageStartedAt || active?.startedAt);
    const explicitHeartbeat =
      String(active?.watchdogHeartbeatStage || "") === stage
        ? numberV084(active?.watchdogHeartbeatAt)
        : 0;
    return Math.max(stageStartedAt, explicitHeartbeat);
  }

  watchdog = async function watchdogV084() {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING") {
      await chrome.alarms.clear(WATCHDOG_ALARM_V084).catch(() => null);
      return;
    }

    const now = Date.now();
    const stage = String(active.stage || "");
    const stageStartedAt = numberV084(active.stageStartedAt || active.startedAt || now);
    const stageAgeMs = Math.max(0, now - stageStartedAt);

    if (stage === "WAIT_A21_RESULT") {
      if (stageAgeMs <= RESULT_TIMEOUT_MS_V084) return;
      await finish(
        active,
        "UNCERTAIN",
        `${stageLabel(active.stage, active.job.productKind)}가 30분 동안 최종 완료 증거를 주지 않아 실제 Shopling 상태 확인이 필요합니다.`,
        {
          code: "STOCK_SYNC_RESULT_TIMEOUT",
          watchdogPolicy: "HF62_EXPLICIT_PROGRESS_ONLY",
          storageUpdatedAtIgnored: true,
          stageAgeMs,
          extensionVersion: VERSION_V084,
        },
      );
      return;
    }

    const activityAt = heartbeatAtV084(active, stage) || stageStartedAt;
    const idleMs = Math.max(0, now - activityAt);
    let targetPresent = null;
    try {
      targetPresent = Boolean(await findExactRoleTarget(stage));
    } catch {
      targetPresent = null;
    }

    if (
      idleMs <= PRE_SUBMIT_IDLE_TIMEOUT_MS_V084 &&
      stageAgeMs <= PRE_SUBMIT_HARD_TIMEOUT_MS_V084
    ) {
      console.debug("[CommerceOS Stock HF62 Watchdog]", "watch", {
        stage,
        idleMs,
        stageAgeMs,
        targetPresent,
        redispatched: false,
        storageUpdatedAtIgnored: true,
      });
      return;
    }

    const hardTimedOut = stageAgeMs > PRE_SUBMIT_HARD_TIMEOUT_MS_V084;
    const idleMinutes = Math.max(1, Math.round(idleMs / 60_000));
    const message = hardTimedOut
      ? `${stageLabel(active.stage, active.job.productKind)}가 30분을 넘어 안전상 중단했습니다. 화면 재로딩은 진행 신호로 계산하지 않았습니다.`
      : `${stageLabel(active.stage, active.job.productKind)}에서 ${idleMinutes}분 동안 실제 진행 신호가 없어 중단했습니다. 화면 재로딩은 진행 신호로 계산하지 않았습니다.`;

    await finish(active, "FAILED", message, {
      code: hardTimedOut ? "STOCK_SYNC_STAGE_HARD_TIMEOUT" : "STOCK_SYNC_IDLE_TIMEOUT",
      watchdogPolicy: "HF62_EXPLICIT_PROGRESS_ONLY",
      watchdogRedispatchOnTick: false,
      storageUpdatedAtIgnored: true,
      preSubmitIdleTimeoutMs: PRE_SUBMIT_IDLE_TIMEOUT_MS_V084,
      preSubmitHardTimeoutMs: PRE_SUBMIT_HARD_TIMEOUT_MS_V084,
      idleMs,
      stageAgeMs,
      targetPresent,
      heartbeatAt: activityAt,
      heartbeatSource: active.watchdogHeartbeatSource || null,
      extensionVersion: VERSION_V084,
    });
  };
})();
