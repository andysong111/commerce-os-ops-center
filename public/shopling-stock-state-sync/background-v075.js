importScripts("background-v074.js");

// HF51 durable parallel-resume wakeup.
//
// HF28 persists the two-lane checkpoint and resumes it whenever the MV3 service
// worker boots. The legacy watchdog alarm is tied to the single active slot,
// though, so it is cleared in the short gap after Lane 1 finishes and before
// Lane 2 starts. If Chrome suspends the worker in that gap, the persisted
// checkpoint has no event left to wake it. This alarm only wakes the worker;
// it never dispatches, clicks, navigates, or mutates a Shopling product. The
// inherited HF28 coordinator remains the sole owner of Lane 2 and keeps its
// existing secondStarted/job-id duplicate guards.
(() => {
  const PARALLEL_STATE_KEY = "commerceOsShoplingStockParallelV028";
  const RESUME_ALARM = "commerce-os-shopling-stock-parallel-resume-hf51";
  const WAKE_INTERVAL_MINUTES = 0.5;

  async function loadParallelState() {
    const stored = await chrome.storage.local
      .get(PARALLEL_STATE_KEY)
      .catch(() => ({}));
    return stored?.[PARALLEL_STATE_KEY] || null;
  }

  function needsWake(state) {
    return Boolean(
      state &&
        state.status === "RUNNING" &&
        state.secondStarted !== true,
    );
  }

  async function syncResumeAlarm() {
    const state = await loadParallelState();
    if (!needsWake(state)) {
      await chrome.alarms.clear(RESUME_ALARM).catch(() => null);
      return { armed: false, batchId: state?.batchId || null };
    }
    await chrome.alarms
      .create(RESUME_ALARM, {
        delayInMinutes: WAKE_INTERVAL_MINUTES,
        periodInMinutes: WAKE_INTERVAL_MINUTES,
      })
      .catch(() => null);
    return { armed: true, batchId: state.batchId };
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[PARALLEL_STATE_KEY]) return;
    void syncResumeAlarm();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== RESUME_ALARM) return;
    // Loading this service worker has already scheduled HF28's persisted
    // checkpoint coordinator. Keep or clear the wakeup according to the latest
    // checkpoint; do not invoke any Shopling write path here.
    void syncResumeAlarm();
  });

  void syncResumeAlarm();
})();
