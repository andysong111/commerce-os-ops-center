const POPUP_HANDOFF_TYPE = "A21_EXACT_POPUP_HANDOFF_HF89";

const CANONICAL_CLOSE_MARKER = `    }
  }

  async function configureAndSubmitPopup(assignment) {`;

const CANONICAL_HANDOFF = `    }

    const popupHandoffHf89 = await chrome.runtime.sendMessage({
      type: "${POPUP_HANDOFF_TYPE}",
      jobId: String(assignment?.jobId || ""),
      runId: String(assignment?.runId || ""),
      stockProductKindHf48: String(assignment?.stockProductKindHf48 || ""),
      goodsKeys: Array.isArray(assignment?.goodsKeys)
        ? assignment.goodsKeys.map(normalize).filter(Boolean)
        : [],
      popupTabId: Number(modifySend?.popupTabId),
    }).catch((error) => ({
      ok: false,
      code: "HF89_POPUP_HANDOFF_CHANNEL_FAILED",
      message: normalize(error?.message || error || "팝업 직접 인계 실패"),
    }));
    if (
      popupHandoffHf89?.ok !== true ||
      popupHandoffHf89?.accepted !== true ||
      popupHandoffHf89?.committed !== true
    ) {
      return fail(
        assignment.jobId,
        popupHandoffHf89?.code || "HF89_POPUP_HANDOFF_NOT_COMMITTED",
        popupHandoffHf89?.message || "방금 열린 Shopling 팝업에서 파란 전송 버튼 완료를 확인하지 못했습니다.",
      );
    }
  }

  async function configureAndSubmitPopup(assignment) {`;

const BACKGROUND_SCHEDULE_MARKER = `  function scheduleHf84(tabId, tabUrl) {`;

const BACKGROUND_EXPLICIT_HANDOFF = `  globalThis.__commerceOsHf84ExplicitPopupHandoff = async function explicitPopupHandoffHf89(input) {
    const popupTabId = Number(input?.popupTabId);
    const jobId = String(input?.jobId || "");
    if (!Number.isInteger(popupTabId) || !jobId) {
      return { ok: false, code: "HF89_EXACT_POPUP_INPUT_INVALID", message: "새 Shopling 팝업 식별값이 올바르지 않습니다." };
    }
    let active = await loadActive().catch(() => null);
    if (!active || active.status !== "RUNNING" || String(active.job?.jobId || "") !== jobId) {
      return { ok: false, code: "HF89_ACTIVE_JOB_MISMATCH", message: "현재 Commerce OS 작업과 새 Shopling 팝업이 일치하지 않습니다." };
    }
    const popup = await chrome.tabs.get(popupTabId).catch(() => null);
    if (!popup || !exactPopupUrlHf84(popup.url || popup.pendingUrl)) {
      return { ok: false, code: "HF89_EXACT_POPUP_NOT_FOUND", message: "방금 열린 Shopling 수정전송 팝업을 다시 확인하지 못했습니다." };
    }
    const binding = active.a21PopupOwnershipHf81;
    const claimed = binding?.claimedTabId == null ? null : Number(binding.claimedTabId);
    if (!binding || (Number.isInteger(claimed) && claimed !== popupTabId) || !bindingMatchesHf84(active, popupTabId)) {
      return { ok: false, code: "HF89_EXACT_POPUP_OWNER_MISMATCH", message: "방금 열린 팝업의 작업 소유권이 현재 B코드와 일치하지 않습니다." };
    }

    // The trusted red-button click already proved this exact new popup. Claim it
    // before probing so stale windows from earlier attempts cannot compete.
    binding.claimedTabId = popupTabId;
    binding.claimedAt = Date.now();
    active.a21PopupOwnershipHf81 = binding;
    await saveActive(active);

    const deadline = Date.now() + READY_TIMEOUT_MS_HF84 + 2500;
    while (Date.now() < deadline) {
      await probeThenCommitHf84();
      active = await loadActive().catch(() => null);
      const receipt = active?.lastMileReceiptHf84;
      if (
        active?.status === "RUNNING" &&
        active?.stage === "WAIT_A21_RESULT" &&
        Number(receipt?.popupTabId) === popupTabId &&
        receipt?.shoplingSubmitInvoked === true &&
        receipt?.topChecked === true &&
        receipt?.targetChecked === true
      ) {
        return {
          ok: true,
          accepted: true,
          committed: true,
          code: "HF89_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",
          popupTabId,
          popupFrameId: Number(receipt?.popupFrameId ?? 0),
          receipt,
        };
      }
      if (!active || active.status !== "RUNNING") {
        return {
          ok: false,
          code: String(active?.lastError?.code || active?.error?.code || "HF89_EXACT_POPUP_COMMIT_FAILED"),
          message: String(active?.message || "새 Shopling 팝업에서 파란 전송 버튼 실행에 실패했습니다."),
        };
      }
      await sleep(250);
    }
    return {
      ok: false,
      code: "HF89_EXACT_POPUP_COMMIT_TIMEOUT",
      message: "방금 열린 Shopling 팝업에서 파란 전송 버튼 완료를 제한시간 안에 확인하지 못했습니다.",
    };
  };

  function scheduleHf84(tabId, tabUrl) {`;

export function patchHf89CanonicalPopupHandoff(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const clickStart = normalized.indexOf(
    "    const modifySend = await clickModifySend(assignment);",
  );
  const markerIndex = normalized.indexOf(CANONICAL_CLOSE_MARKER, clickStart);
  if (clickStart < 0 || markerIndex < 0) {
    throw new Error("shopling_stock_hf89_canonical_handoff_marker_missing");
  }
  const patched = `${normalized.slice(0, markerIndex)}${CANONICAL_HANDOFF}${normalized.slice(
    markerIndex + CANONICAL_CLOSE_MARKER.length,
  )}`;
  for (const guard of [
    POPUP_HANDOFF_TYPE,
    "popupHandoffHf89?.committed !== true",
    "popupTabId: Number(modifySend?.popupTabId)",
    "HF89_POPUP_HANDOFF_NOT_COMMITTED",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf89_canonical_guard_missing:${guard}`);
    }
  }
  return patched;
}
export function patchHf89BackgroundHf84ExplicitHandoff(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const markerIndex = normalized.indexOf(BACKGROUND_SCHEDULE_MARKER);
  if (markerIndex < 0 || !normalized.includes("async function probeThenCommitHf84()")) {
    throw new Error("shopling_stock_hf89_background_hf84_marker_missing");
  }
  const patched = `${normalized.slice(0, markerIndex)}${BACKGROUND_EXPLICIT_HANDOFF}${normalized.slice(
    markerIndex + BACKGROUND_SCHEDULE_MARKER.length,
  )}`;
  for (const guard of [
    "__commerceOsHf84ExplicitPopupHandoff",
    "binding.claimedTabId = popupTabId",
    "await probeThenCommitHf84()",
    "HF89_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf89_background_guard_missing:${guard}`);
    }
  }
  return patched;
}
