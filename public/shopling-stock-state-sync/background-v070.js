importScripts("background-v069.js");

// HF28 watchdog stabilization overlay.
// The legacy 30-second alarm remains only as an observer. It must never re-dispatch
// the current Shopling step on every tick, because a slow but healthy A6/API/A21 flow
// can otherwise be clicked again and then be failed by the old absolute 60-second
// deadline while the browser is still making forward progress.
(() => {
  const VERSION_V070 = chrome.runtime.getManifest().version;
  const TAG_V070 = "[CommerceOS Stock HF28 Watchdog]";
  const HEARTBEAT_MESSAGE_V070 = "STOCK_SYNC_HEARTBEAT_V070";
  const WATCHDOG_ALARM_V070 = "commerce-os-shopling-stock-state-watchdog-v020";
  const PRE_SUBMIT_IDLE_TIMEOUT_MS_V070 = 3 * 60 * 1000;
  const PRE_SUBMIT_HARD_TIMEOUT_MS_V070 = 30 * 60 * 1000;
  const RESULT_TIMEOUT_MS_V070 = 30 * 60 * 1000;
  const legacyProgressV070 = progress;

  const numberV070 = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  function heartbeatAtV070(active, stage) {
    const stageStartedAt = numberV070(active?.stageStartedAt || active?.startedAt);
    const storedHeartbeat =
      String(active?.watchdogHeartbeatStage || "") === stage
        ? numberV070(active?.watchdogHeartbeatAt)
        : 0;
    const updatedAt = numberV070(active?.updatedAt);
    return Math.max(stageStartedAt, storedHeartbeat, updatedAt);
  }

  progress = async function progressV070(active, message, extra = {}) {
    if (active && typeof active === "object") {
      active.watchdogHeartbeatAt = Date.now();
      active.watchdogHeartbeatStage = String(active.stage || "");
      active.watchdogHeartbeatSource = String(extra?.watchdogHeartbeatSource || "BACKGROUND_PROGRESS");
    }
    return legacyProgressV070(active, message, {
      ...extra,
      watchdogPolicy: "HF28_HEARTBEAT_OBSERVE_ONLY",
      watchdogRedispatchOnTick: false,
      extensionVersion: extra?.extensionVersion || VERSION_V070,
    });
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== HEARTBEAT_MESSAGE_V070) return;
    void (async () => {
      const active = await loadActive();
      const jobId = String(message?.jobId || "");
      if (!active || active.status !== "RUNNING" || !jobId || jobId !== String(active.job?.jobId || "")) {
        sendResponse({ ok: false, ignored: true, version: VERSION_V070 });
        return;
      }
      active.watchdogHeartbeatAt = Date.now();
      active.watchdogHeartbeatStage = String(active.stage || "");
      active.watchdogHeartbeatSource = String(message?.source || message?.stage || "OPS_PROGRESS").slice(0, 120);
      active.watchdogHeartbeatGoodsKey = String(message?.goodsKey || "").slice(0, 80) || null;
      active.watchdogHeartbeatGoodsKeyIndex = Number.isFinite(Number(message?.goodsKeyIndex))
        ? Number(message.goodsKeyIndex)
        : null;
      await saveActive(active);
      sendResponse({ ok: true, version: VERSION_V070 });
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error || "watchdog_heartbeat_failed"), version: VERSION_V070 });
    });
    return true;
  });

  watchdog = async function watchdogV070() {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING") {
      await chrome.alarms.clear(WATCHDOG_ALARM_V070).catch(() => null);
      return;
    }

    const now = Date.now();
    const stage = String(active.stage || "");
    const stageStartedAt = numberV070(active.stageStartedAt || active.startedAt || now);
    const stageAgeMs = Math.max(0, now - stageStartedAt);

    // After Shopling submission we only wait for the actual result evidence. Never
    // re-dispatch a submitted job. Preserve the existing 30-minute uncertainty gate.
    if (stage === "WAIT_A21_RESULT") {
      if (stageAgeMs <= RESULT_TIMEOUT_MS_V070) return;
      await finish(
        active,
        "UNCERTAIN",
        `${stageLabel(active.stage, active.job.productKind)}가 30분 동안 최종 완료 증거를 주지 않아 실제 Shopling 상태 확인이 필요합니다.`,
        {
          code: "STOCK_SYNC_RESULT_TIMEOUT",
          watchdogPolicy: "HF28_HEARTBEAT_OBSERVE_ONLY",
          watchdogRedispatchOnTick: false,
          stageAgeMs,
          extensionVersion: VERSION_V070,
        },
      );
      return;
    }

    const activityAt = heartbeatAtV070(active, stage) || stageStartedAt;
    const idleMs = Math.max(0, now - activityAt);

    // The 30-second alarm is now read-only health observation. It may inspect whether
    // the expected Shopling frame still exists, but it never clicks, navigates or sends
    // STOCK_SYNC_EXECUTE again. Real progress/OPS API steps refresh the heartbeat.
    let targetPresent = null;
    try {
      targetPresent = Boolean(await findExactRoleTarget(stage));
    } catch {
      targetPresent = false;
    }

    if (
      idleMs <= PRE_SUBMIT_IDLE_TIMEOUT_MS_V070 &&
      stageAgeMs <= PRE_SUBMIT_HARD_TIMEOUT_MS_V070
    ) {
      console.debug(TAG_V070, "watch", {
        stage,
        idleMs,
        stageAgeMs,
        targetPresent,
        redispatched: false,
      });
      return;
    }

    const hardTimedOut = stageAgeMs > PRE_SUBMIT_HARD_TIMEOUT_MS_V070;
    const idleMinutes = Math.max(1, Math.round(idleMs / 60_000));
    const message = hardTimedOut
      ? `${stageLabel(active.stage, active.job.productKind)}가 30분을 넘어 안전상 중단했습니다. 30초 감시는 실행을 재클릭하지 않았습니다.`
      : `${stageLabel(active.stage, active.job.productKind)}에서 ${idleMinutes}분 동안 진행 신호가 없어 중단했습니다. 30초 감시는 상태만 확인하며 Shopling 실행을 다시 누르지 않습니다.`;

    await finish(active, "FAILED", message, {
      code: hardTimedOut ? "STOCK_SYNC_STAGE_HARD_TIMEOUT" : "STOCK_SYNC_IDLE_TIMEOUT",
      watchdogPolicy: "HF28_HEARTBEAT_OBSERVE_ONLY",
      watchdogRedispatchOnTick: false,
      preSubmitIdleTimeoutMs: PRE_SUBMIT_IDLE_TIMEOUT_MS_V070,
      preSubmitHardTimeoutMs: PRE_SUBMIT_HARD_TIMEOUT_MS_V070,
      idleMs,
      stageAgeMs,
      targetPresent,
      heartbeatAt: activityAt,
      heartbeatSource: active.watchdogHeartbeatSource || null,
      heartbeatGoodsKey: active.watchdogHeartbeatGoodsKey || null,
      heartbeatGoodsKeyIndex: active.watchdogHeartbeatGoodsKeyIndex ?? null,
      extensionVersion: VERSION_V070,
    });
  };
})();
