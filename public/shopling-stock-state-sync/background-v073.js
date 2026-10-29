importScripts("background-v072.js");

// HF36 binds every A6/A21 step result to the exact worker frame selected during
// preflight. Shopling can expose the same menu text in more than one frame inside
// a worker tab. A late result from an unassigned frame must not finish the job while
// the assigned frame is still applying and transmitting the exact B-code.
(() => {
  const VERSION_V073 = chrome.runtime.getManifest().version;
  const legacyHandlePageReadyV073 = handlePageReady;
  const legacyHandleStepResultV073 = handleStepResult;

  function assignedTargetV073(active, stage) {
    const target = active?.workTabs?.[stage];
    if (!Number.isInteger(target?.tabId) || !Number.isInteger(target?.frameId)) return null;
    return { tabId: target.tabId, frameId: target.frameId };
  }

  function matchesAssignedTargetV073(active, stage, sender) {
    const target = assignedTargetV073(active, stage);
    if (!target) return true;
    return target.tabId === sender?.tab?.id && target.frameId === sender?.frameId;
  }

  function ignoredFrameV073(active, stage, sender) {
    const target = assignedTargetV073(active, stage);
    return {
      ok: true,
      ignored: true,
      code: "STOCK_SYNC_UNASSIGNED_FRAME_IGNORED_HF36",
      jobId: active?.job?.jobId || null,
      stage,
      assignedTabId: target?.tabId ?? null,
      assignedFrameId: target?.frameId ?? null,
      senderTabId: sender?.tab?.id ?? null,
      senderFrameId: sender?.frameId ?? null,
      extensionVersion: VERSION_V073,
    };
  }

  handlePageReady = async function handlePageReadyV073(message, sender) {
    const active = await loadActive();
    const stage = String(active?.stage || "");
    if (
      active?.status === "RUNNING" &&
      stage &&
      !matchesAssignedTargetV073(active, stage, sender)
    ) {
      return ignoredFrameV073(active, stage, sender);
    }
    return legacyHandlePageReadyV073(message, sender);
  };

  handleStepResult = async function handleStepResultV073(message, sender) {
    const active = await loadActive();
    const stage = String(message?.stage || "");
    const belongsToActiveJob = Boolean(
      active?.status === "RUNNING" &&
        stage &&
        stage === String(active?.stage || "") &&
        String(message?.jobId || "") === String(active?.job?.jobId || ""),
    );
    if (belongsToActiveJob && !matchesAssignedTargetV073(active, stage, sender)) {
      return ignoredFrameV073(active, stage, sender);
    }
    return legacyHandleStepResultV073(message, sender);
  };

  console.log(
    "[CommerceOS Stock HF36]",
    new Date().toISOString(),
    "exact tab+frame result ownership enabled",
  );
})();
