importScripts("background-v085.js");

// HF64 makes the dedicated A6 tab the owner while allowing the exact result
// document inside that tab to change after Shopling search navigation. A21
// remains protected by HF36's exact tab+frame ownership because it can write.
(() => {
  const VERSION_V086 = chrome.runtime.getManifest().version;
  const EVIDENCE_PROBE = "STOCK_SYNC_A6_FRAME_EVIDENCE_HF64";
  const successClaims = new Set();
  const legacyHandlePageReadyV086 = handlePageReady;
  const legacyHandleStepResultV086 = handleStepResult;

  const isActiveA6V086 = (active) =>
    active?.status === "RUNNING" && active?.stage === "A6";

  function assignedA6TabIdV086(active) {
    const tabId = active?.workTabs?.A6?.tabId;
    return Number.isInteger(tabId) ? tabId : null;
  }

  function scoreEvidenceV086(item) {
    const evidence = item?.evidence || {};
    return (
      Number(evidence.exactResultRowCount || 0) * 10_000 +
      Number(evidence.hasFreshSubmittedTicket === true) * 1_000 +
      Number(evidence.controlsEchoExactBarcode === true) * 250 +
      Number(evidence.hasExactSearchControl === true) * 50 +
      Number(evidence.role === "A6") * 10
    );
  }

  async function probeA6FramesV086(active) {
    const tabId = assignedA6TabIdV086(active);
    if (!Number.isInteger(tabId)) return [];
    const frames = await chrome.webNavigation
      .getAllFrames({ tabId })
      .catch(() => []);
    const candidates = await Promise.all(
      (frames || [])
        .filter((frame) => Number.isInteger(frame?.frameId))
        .map(async (frame) => {
          const evidence = await chrome.tabs
            .sendMessage(
              tabId,
              {
                type: EVIDENCE_PROBE,
                barcode: active?.job?.barcode || "",
                jobId: active?.job?.jobId || "",
              },
              { frameId: frame.frameId },
            )
            .catch(() => null);
          return evidence?.ok
            ? { tabId, frameId: frame.frameId, evidence }
            : null;
        }),
    );
    return candidates
      .filter(Boolean)
      .sort(
        (left, right) =>
          scoreEvidenceV086(right) - scoreEvidenceV086(left) ||
          Number(left.frameId) - Number(right.frameId),
      );
  }

  async function bestExactA6FrameV086(active, attempts = 1) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidates = await probeA6FramesV086(active);
      const exact = candidates.find(
        (candidate) =>
          Number(candidate?.evidence?.exactResultRowCount || 0) > 0,
      );
      if (exact) return exact;
      if (attempt + 1 < attempts) await sleep(350);
    }
    return null;
  }

  async function bindA6FrameV086(active, target, reason) {
    const tabId = assignedA6TabIdV086(active);
    if (
      !isActiveA6V086(active) ||
      !Number.isInteger(tabId) ||
      target?.tabId !== tabId ||
      !Number.isInteger(target?.frameId)
    ) {
      return false;
    }
    const previousFrameId = active?.workTabs?.A6?.frameId ?? null;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    active.shoplingTabId = tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = {
      ...(active.workTabs || {}),
      A6: {
        ...(active.workTabs?.A6 || {}),
        tabId,
        windowId: tab?.windowId ?? active.workTabs?.A6?.windowId ?? null,
        frameId: target.frameId,
      },
    };
    active.watchdogHeartbeatStage = "A6";
    active.watchdogHeartbeatAt = Date.now();
    active.watchdogHeartbeatSource = "HF64_EXACT_BCODE_RESULT_FRAME";
    active.a6OwnerRebind = {
      previousFrameId,
      frameId: target.frameId,
      tabId,
      reboundAt: Date.now(),
      reason,
      exactResultRowCount: Number(
        target?.evidence?.exactResultRowCount || 0,
      ),
      mutationAttempted: false,
    };
    await saveActive(active);
    return true;
  }

  handlePageReady = async function handlePageReadyV086(message, sender) {
    const active = await loadActive();
    const tabId = assignedA6TabIdV086(active);
    if (
      isActiveA6V086(active) &&
      sender?.tab?.id === tabId &&
      message?.page?.role === "A6"
    ) {
      const exact = await bestExactA6FrameV086(active, 6);
      if (exact) {
        await bindA6FrameV086(
          active,
          exact,
          "SAME_TAB_EXACT_BCODE_RESULT_FRAME_READY",
        );
        if (exact.frameId !== sender?.frameId) {
          return dispatchToTarget(active, {
            ...exact,
            windowId: sender?.tab?.windowId,
            page: { role: "A6", href: exact.evidence?.href || "" },
          }).then((dispatched) => ({
            ok: true,
            dispatched,
            ownerFrameId: exact.frameId,
            code: "HF64_EXACT_A6_RESULT_FRAME_SELECTED",
          }));
        }
      }
    }
    return legacyHandlePageReadyV086(message, sender);
  };

  handleStepResult = async function handleStepResultV086(message, sender) {
    if (message?.stage !== "A6") {
      return legacyHandleStepResultV086(message, sender);
    }
    const active = await loadActive();
    const tabId = assignedA6TabIdV086(active);
    const belongsToActiveA6 = Boolean(
      isActiveA6V086(active) &&
        String(message?.jobId || "") ===
          String(active?.job?.jobId || "") &&
        sender?.tab?.id === tabId &&
        Number.isInteger(sender?.frameId),
    );
    if (!belongsToActiveA6) {
      return legacyHandleStepResultV086(message, sender);
    }

    const result = message?.result || {};
    const exactSuccess = Boolean(
      result.ok === true &&
        result.completed === true &&
        Number(result?.evidence?.matchedRows || 0) > 0 &&
        Array.isArray(result?.evidence?.discoveredGoodsKeys) &&
        result.evidence.discoveredGoodsKeys.length > 0,
    );
    if (exactSuccess) {
      const claimKey = String(active.job.jobId);
      if (
        successClaims.has(claimKey) ||
        active?.a6SuccessClaim?.jobId === claimKey
      ) {
        return {
          ok: true,
          ignored: true,
          code: "HF64_DUPLICATE_A6_SUCCESS_IGNORED",
        };
      }
      successClaims.add(claimKey);
      active.a6SuccessClaim = {
        jobId: claimKey,
        tabId,
        frameId: sender.frameId,
        claimedAt: Date.now(),
        matchedRows: Number(result.evidence.matchedRows || 0),
      };
      await bindA6FrameV086(
        active,
        {
          tabId,
          frameId: sender.frameId,
          evidence: {
            exactResultRowCount: Number(result.evidence.matchedRows || 0),
          },
        },
        "SAME_TAB_SUCCESSFUL_EXACT_BCODE_RESULT",
      );
      await saveActive(active);
      try {
        return await legacyHandleStepResultV086(message, sender);
      } finally {
        successClaims.delete(claimKey);
      }
    }

    if (result.ok !== true) {
      const exact = await bestExactA6FrameV086(active, 12);
      if (exact && exact.frameId !== sender.frameId) {
        await bindA6FrameV086(
          active,
          exact,
          "IGNORE_EARLY_FAILURE_AND_USE_EXACT_BCODE_RESULT_FRAME",
        );
        const dispatched = await dispatchToTarget(active, {
          ...exact,
          windowId: active?.workTabs?.A6?.windowId ?? null,
          page: { role: "A6", href: exact.evidence?.href || "" },
        });
        return {
          ok: true,
          ignored: true,
          retrying: dispatched,
          code: "HF64_STALE_A6_FRAME_FAILURE_IGNORED",
          ownerFrameId: exact.frameId,
        };
      }
    }

    return legacyHandleStepResultV086(message, sender);
  };

  console.log(
    "[CommerceOS Stock HF64]",
    new Date().toISOString(),
    "same-tab exact B-code A6 result ownership enabled; A21 remains strict",
    VERSION_V086,
  );
})();
