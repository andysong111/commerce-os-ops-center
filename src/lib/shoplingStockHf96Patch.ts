const HANDOFF_MARKER =
  `  globalThis.__commerceOsHf84ExplicitPopupHandoff = async function explicitPopupHandoffHf92(input) {`;

const OWNER_HELPER = `  // HF96: HF90 already bound the exact popup before submit. A duplicate
  // preparation of the same assignment can re-arm HF81 and put that already
  // owned popup into baselineTabIds. Recover only when every durable identity
  // field still proves the same job, list tab, popup and canonical assignment.
  function exactPopupOwnerAtCommitHf96(active, popupTabId, receiptKey) {
    if (!active || active.status !== "RUNNING" || receiptKeyHf84(active) !== receiptKey) {
      return { ok: false, code: "HF96_ACTIVE_ASSIGNMENT_CHANGED" };
    }
    if (bindingMatchesHf84(active, popupTabId)) {
      return { ok: true, sameAssignmentRearmReconciled: false };
    }

    const binding = active.a21PopupOwnershipHf81;
    const dispatchReceipt = active.shoplingDispatchReceiptHf90;
    const popupWork = active.workTabs?.A21_POPUP;
    const productKind = String(active?.job?.productKind || "").toUpperCase();
    const goodsKeyQuery = batchQueryHf84(active);
    const canonicalOwnerKey = receiptKeyHf84(active);
    const claimedTabId = binding?.claimedTabId == null
      ? null
      : Number(binding.claimedTabId);
    const baseline = new Set(
      (binding?.baselineTabIds || []).map(Number).filter(Number.isInteger),
    );
    const listTabId = Number(binding?.listTabId);
    const receiptListTabId = Number(dispatchReceipt?.expectedListTabId);
    const workListTabId = Number(active?.workTabs?.A21_LIST?.tabId);
    const recordedAt = Number(dispatchReceipt?.recordedAt);
    const receiptAgeMs = Date.now() - recordedAt;

    const sameAssignmentRearm = Boolean(
      binding &&
      ["OPTION", "SINGLE"].includes(productKind) &&
      goodsKeyQuery &&
      binding.productKind === productKind &&
      binding.goodsKeyQuery === goodsKeyQuery &&
      binding.assignmentOwnerKey === canonicalOwnerKey &&
      baseline.has(popupTabId) &&
      (!Number.isInteger(claimedTabId) || claimedTabId === popupTabId) &&
      Number.isInteger(listTabId) &&
      listTabId === receiptListTabId &&
      listTabId === workListTabId &&
      dispatchReceipt?.jobId === String(active?.job?.jobId || "") &&
      Number(dispatchReceipt?.popupTabId) === popupTabId &&
      dispatchReceipt?.exactOwnerBound === true &&
      dispatchReceipt?.externalWriteConfirmed === false &&
      dispatchReceipt?.code === "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT" &&
      Number(popupWork?.tabId) === popupTabId &&
      Number(popupWork?.openerTabId) === listTabId &&
      popupWork?.assignmentOwnerKey === canonicalOwnerKey &&
      popupWork?.establishedBy === "HF90_EXACT_TRUSTED_POPUP_HANDOFF" &&
      Number.isFinite(recordedAt) &&
      receiptAgeMs >= -5000 &&
      receiptAgeMs <= 120000
    );
    if (!sameAssignmentRearm) {
      return { ok: false, code: "HF96_EXACT_POPUP_OWNER_PROOF_MISMATCH" };
    }
    return {
      ok: true,
      sameAssignmentRearmReconciled: true,
      code: "HF96_SAME_ASSIGNMENT_REARM_RECONCILED",
      canonicalOwnerKey,
      popupTabId,
      listTabId,
    };
  }

`;

const FINAL_OWNER_CHECK = `        const latest = await loadActive().catch(() => null);
        if (!latest || latest.status !== "RUNNING" || receiptKeyHf84(latest) !== receiptKey || !bindingMatchesHf84(latest, popupTabId)) {
          return { ok: false, code: "HF92_EXACT_POPUP_OWNER_CHANGED", message: "파란 전송 직전에 팝업 소유 작업이 달라져 전송하지 않았습니다." };
        }
        const latestBinding = latest.a21PopupOwnershipHf81;`;

const FINAL_OWNER_RECONCILIATION = `        const latest = await loadActive().catch(() => null);
        const ownershipHf96 = exactPopupOwnerAtCommitHf96(
          latest,
          popupTabId,
          receiptKey,
        );
        if (!ownershipHf96.ok) {
          return {
            ok: false,
            code: "HF92_EXACT_POPUP_OWNER_CHANGED",
            message: "파란 전송 직전에 팝업 소유 작업이 달라져 전송하지 않았습니다.",
            ownershipCodeHf96: ownershipHf96.code,
          };
        }
        if (ownershipHf96.sameAssignmentRearmReconciled) {
          latest.shoplingPopupReconciliationHf96 = {
            code: ownershipHf96.code,
            canonicalOwnerKey: ownershipHf96.canonicalOwnerKey,
            popupTabId,
            listTabId: ownershipHf96.listTabId,
            recordedAt: Date.now(),
          };
        }
        const latestBinding = latest.a21PopupOwnershipHf81;`;

const RECEIPT_MARKER = `            exactDirectHandoffHf92: true,
            recordedAt: Date.now(),`;

const RECEIPT_PATCH = `            exactDirectHandoffHf92: true,
            sameAssignmentRearmReconciledHf96:
              ownershipHf96.sameAssignmentRearmReconciled === true,
            ownershipCodeHf96: ownershipHf96.code || null,
            recordedAt: Date.now(),`;

const PROGRESS_CODE_MARKER =
  `              code: "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED",`;

const PROGRESS_CODE_PATCH = `              code: ownershipHf96.sameAssignmentRearmReconciled
                ? "SHOPLING_HF96_REARM_RECONCILED_AND_COMMITTED"
                : "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED",`;

const RESULT_CODE_MARKER =
  `            code: "HF92_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",`;

const RESULT_CODE_PATCH = `            code: ownershipHf96.sameAssignmentRearmReconciled
              ? "HF96_REARM_RECONCILED_BLUE_SUBMIT_COMMITTED"
              : "HF92_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",`;

export function patchHf96SameAssignmentPopupRearm(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  for (const marker of [
    HANDOFF_MARKER,
    FINAL_OWNER_CHECK,
    RECEIPT_MARKER,
    PROGRESS_CODE_MARKER,
    RESULT_CODE_MARKER,
  ]) {
    if (!normalized.includes(marker)) {
      throw new Error("shopling_stock_hf96_patch_checkpoint_mismatch");
    }
  }

  const patched = normalized
    .replace(HANDOFF_MARKER, `${OWNER_HELPER}${HANDOFF_MARKER}`)
    .replace(FINAL_OWNER_CHECK, FINAL_OWNER_RECONCILIATION)
    .replace(RECEIPT_MARKER, RECEIPT_PATCH)
    .replace(PROGRESS_CODE_MARKER, PROGRESS_CODE_PATCH)
    .replace(RESULT_CODE_MARKER, RESULT_CODE_PATCH);

  for (const guard of [
    "exactPopupOwnerAtCommitHf96",
    "HF96_SAME_ASSIGNMENT_REARM_RECONCILED",
    "HF96_EXACT_POPUP_OWNER_PROOF_MISMATCH",
    "SHOPLING_HF96_REARM_RECONCILED_AND_COMMITTED",
    "HF96_REARM_RECONCILED_BLUE_SUBMIT_COMMITTED",
    "sameAssignmentRearmReconciledHf96",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf96_guard_missing:${guard}`);
    }
  }
  return patched;
}
