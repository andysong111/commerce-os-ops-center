const TRUSTED_DISPATCH_CATCH = `    } catch (error) {
      return {
        ok: false,
        code: "HF86_TRUSTED_CLICK_DISPATCH_FAILED",
        message: normHf86(error?.message || error || "Chrome 신뢰 클릭 실패"),
      };
    } finally {`;

const TRUSTED_DISPATCH_RECONCILIATION = `    } catch (error) {
      // Chrome can detach the A21 list target while the trusted click is being
      // handled. The click may already have opened the exact new popup, so the
      // popup receipt is authoritative and must be checked before reporting a
      // retryable failure. This prevents a successful external action from
      // being repeated merely because CDP lost its source target.
      const popup = await waitForNewPopupHf86(tabId, baseline);
      if (popup) {
        return {
          ok: true,
          trustedClick: true,
          popupObserved: true,
          popupTabId: popup.id,
          popupWindowId: popup.windowId,
          dispatchDetachedRecovered: true,
          dispatchError: normHf86(error?.message || error || "Chrome 대상 분리"),
          code: "HF92_TRUSTED_CLICK_DETACHED_POPUP_CONFIRMED",
        };
      }
      return {
        ok: false,
        code: "HF86_TRUSTED_CLICK_DISPATCH_FAILED",
        message: normHf86(error?.message || error || "Chrome 신뢰 클릭 실패"),
        retrySafe: true,
        popupObserved: false,
      };
    } finally {`;

const TRUSTED_TEST_HOOK_MARKER = `  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {`;

const TRUSTED_TEST_HOOK = `  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF92_TRUSTED_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf92TrustedTestHooks = {
      trustedClickHf86,
      waitForNewPopupHf86,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {`;

export function patchHf92TrustedClickDetachedReceipt(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (!normalized.includes(TRUSTED_DISPATCH_CATCH)) {
    throw new Error("shopling_stock_hf92_trusted_dispatch_catch_missing");
  }
  if (!normalized.includes(TRUSTED_TEST_HOOK_MARKER)) {
    throw new Error("shopling_stock_hf92_trusted_listener_missing");
  }
  const patched = normalized
    .replace(TRUSTED_DISPATCH_CATCH, TRUSTED_DISPATCH_RECONCILIATION)
    .replace(TRUSTED_TEST_HOOK_MARKER, TRUSTED_TEST_HOOK);
  for (const guard of [
    "HF92_TRUSTED_CLICK_DETACHED_POPUP_CONFIRMED",
    "const popup = await waitForNewPopupHf86(tabId, baseline)",
    "dispatchDetachedRecovered: true",
    "popupObserved: false",
    "__commerceOsStockHf92TrustedTestHooks",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf92_trusted_guard_missing:${guard}`);
    }
  }
  return patched;
}

const EXACT_HANDOFF_START =
  `  globalThis.__commerceOsHf84ExplicitPopupHandoff = async function explicitPopupHandoffHf89(input) {`;
const EXACT_HANDOFF_END = `

  function scheduleHf84(tabId, tabUrl) {`;

const EXACT_DIRECT_HANDOFF = `  globalThis.__commerceOsHf84ExplicitPopupHandoff = async function explicitPopupHandoffHf92(input) {
    const popupTabId = Number(input?.popupTabId);
    const jobId = String(input?.jobId || "");
    if (!Number.isInteger(popupTabId) || !jobId) {
      return { ok: false, code: "HF92_EXACT_POPUP_INPUT_INVALID", message: "새 Shopling 팝업 식별값이 올바르지 않습니다." };
    }
    let active = await loadActive().catch(() => null);
    if (!active || active.status !== "RUNNING" || String(active.job?.jobId || "") !== jobId) {
      return { ok: false, code: "HF92_ACTIVE_JOB_MISMATCH", message: "현재 Commerce OS 작업과 새 Shopling 팝업이 일치하지 않습니다." };
    }
    const popup = await chrome.tabs.get(popupTabId).catch(() => null);
    if (!popup || !exactPopupUrlHf84(popup.url || popup.pendingUrl)) {
      return { ok: false, code: "HF92_EXACT_POPUP_NOT_FOUND", message: "방금 열린 Shopling 수정전송 팝업을 다시 확인하지 못했습니다." };
    }
    const binding = active.a21PopupOwnershipHf81;
    const claimed = binding?.claimedTabId == null ? null : Number(binding.claimedTabId);
    if (!binding || (Number.isInteger(claimed) && claimed !== popupTabId) || !bindingMatchesHf84(active, popupTabId)) {
      return { ok: false, code: "HF92_EXACT_POPUP_OWNER_MISMATCH", message: "방금 열린 팝업의 작업 소유권이 현재 B코드와 일치하지 않습니다." };
    }

    binding.claimedTabId = popupTabId;
    binding.claimedAt = Date.now();
    active.a21PopupOwnershipHf81 = binding;
    await saveActive(active);

    const receiptKey = receiptKeyHf84(active);
    const deadline = Date.now() + READY_TIMEOUT_MS_HF84 + 2500;
    let lastFrameDiagnostics = [];
    while (Date.now() < deadline) {
      active = await loadActive().catch(() => null);
      if (!active || active.status !== "RUNNING" || String(active.job?.jobId || "") !== jobId) {
        return {
          ok: false,
          code: String(active?.lastError?.code || active?.error?.code || "HF92_ACTIVE_JOB_ENDED"),
          message: String(active?.message || "새 Shopling 팝업 처리 전에 현재 작업이 종료되었습니다."),
        };
      }
      const currentPopup = await chrome.tabs.get(popupTabId).catch(() => null);
      if (!currentPopup || !exactPopupUrlHf84(currentPopup.url || currentPopup.pendingUrl)) {
        return { ok: false, code: "HF92_EXACT_POPUP_DISAPPEARED", message: "파란 전송 처리 전에 정확한 Shopling 팝업이 사라졌습니다." };
      }

      const probes = await chrome.scripting.executeScript({
        target: { tabId: popupTabId, allFrames: true },
        world: "MAIN",
        func: probeLastMileHf84,
        args: [{ productKind: active.job.productKind, desiredStatus: active.job.desiredStatus }],
      }).catch(() => []);
      lastFrameDiagnostics = probes.map((entry) => ({
        frameId: Number(entry?.frameId),
        result: entry?.result || null,
      }));
      const eligible = probes.filter((entry) => entry?.result?.eligible === true);
      if (eligible.length > 1) {
        return {
          ok: false,
          code: "HF92_EXACT_POPUP_AMBIGUOUS_FRAMES",
          message: "방금 열린 Shopling 팝업 안에 실행 가능한 선택 구조가 둘 이상이라 전송하지 않았습니다.",
          frameDiagnostics: lastFrameDiagnostics,
        };
      }
      if (eligible.length === 1) {
        const frameId = Number(eligible[0]?.frameId);
        const latest = await loadActive().catch(() => null);
        if (!latest || latest.status !== "RUNNING" || receiptKeyHf84(latest) !== receiptKey || !bindingMatchesHf84(latest, popupTabId)) {
          return { ok: false, code: "HF92_EXACT_POPUP_OWNER_CHANGED", message: "파란 전송 직전에 팝업 소유 작업이 달라져 전송하지 않았습니다." };
        }
        const latestBinding = latest.a21PopupOwnershipHf81;
        latestBinding.claimedTabId = popupTabId;
        latestBinding.claimedFrameId = frameId;
        latestBinding.claimedAt = Date.now();
        latest.stage = "A21_POPUP";
        latest.stageStartedAt = Date.now();
        latest.workTabs = {
          ...(latest.workTabs || {}),
          A21_POPUP: {
            ...(latest.workTabs?.A21_POPUP || {}),
            tabId: popupTabId,
            frameId,
          },
        };
        latest.shoplingTabId = popupTabId;
        latest.shoplingFrameId = frameId;
        await saveActive(latest);

        const committed = await chrome.scripting.executeScript({
          target: { tabId: popupTabId, frameIds: [frameId] },
          world: "MAIN",
          func: commitLastMileHf84,
          args: [{
            productKind: latest.job.productKind,
            desiredStatus: latest.job.desiredStatus,
            receiptKey,
          }],
        }).catch(() => []);
        const receipt = committed.map((entry) => entry?.result)
          .find((entry) => entry?.receiptKey === receiptKey) || committed[0]?.result || null;
        if (
          receipt?.ok === true &&
          receipt?.shoplingSubmitInvoked === true &&
          receipt?.topChecked === true &&
          receipt?.targetChecked === true &&
          (receipt?.targetEnabledAfterMode === true || receipt?.duplicate === true) &&
          receipt?.submitDispatchMethod === "ORIGINAL_SHOPLING_FUNCTION"
        ) {
          committedHf84.add(receiptKey);
          readinessHf84.delete(receiptKey);
          const current = await loadActive().catch(() => null);
          if (!current || current.status !== "RUNNING" || String(current.job?.jobId || "") !== jobId) {
            return { ok: false, code: "HF92_COMMIT_OWNER_LOST", message: "Shopling 송신 직후 현재 작업 영수증 소유권을 확인하지 못했습니다." };
          }
          current.lastMileReceiptHf84 = {
            ...receipt,
            popupTabId,
            popupFrameId: frameId,
            goodsKeyQuery: batchQueryHf84(current),
            assignmentOwnerKey: current.a21PopupOwnershipHf81?.assignmentOwnerKey || null,
            exactDirectHandoffHf92: true,
            recordedAt: Date.now(),
          };
          current.stage = "WAIT_A21_RESULT";
          current.stageStartedAt = Date.now();
          await saveActive(current);
          await progress(
            current,
            String(current.job?.barcode || "") + " · 정확한 새 팝업에서 " + receipt.topLabel + " → " + receipt.targetLabel + " 선택 후 원본 파란 전송 실행 완료",
            {
              code: "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED",
              lastMileReceipt: current.lastMileReceiptHf84,
              extensionVersion: chrome.runtime.getManifest().version,
            },
          );
          return {
            ok: true,
            accepted: true,
            committed: true,
            code: "HF92_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",
            popupTabId,
            popupFrameId: frameId,
            receipt,
          };
        }
        if (receipt) {
          return {
            ok: false,
            code: String(receipt.code || "HF92_EXACT_POPUP_COMMIT_RECEIPT_INVALID"),
            message: "정확한 Shopling 팝업에서 파란 전송 실행 영수증을 확인하지 못했습니다.",
            receipt,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
      ok: false,
      code: "HF92_EXACT_POPUP_STRUCTURAL_TIMEOUT",
      message: "방금 열린 Shopling 팝업의 선택 구조가 제한시간 안에 준비되지 않았습니다.",
      frameDiagnostics: lastFrameDiagnostics,
    };
  };`;

export function patchHf92ExactPopupDirectCommit(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const start = normalized.indexOf(EXACT_HANDOFF_START);
  const end = normalized.indexOf(EXACT_HANDOFF_END, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("shopling_stock_hf92_exact_handoff_marker_missing");
  }
  const patched = `${normalized.slice(0, start)}${EXACT_DIRECT_HANDOFF}${normalized.slice(end)}`;
  for (const guard of [
    "explicitPopupHandoffHf92",
    "target: { tabId: popupTabId, allFrames: true }",
    "func: probeLastMileHf84",
    "func: commitLastMileHf84",
    "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED",
    "HF92_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",
    "current.stage = \"WAIT_A21_RESULT\"",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf92_exact_guard_missing:${guard}`);
    }
  }
  return patched;
}
