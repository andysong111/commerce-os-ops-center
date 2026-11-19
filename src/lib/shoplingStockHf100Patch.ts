const INITIAL_OWNER_GUARD = `    const binding = active.a21PopupOwnershipHf81;
    const claimed = binding?.claimedTabId == null ? null : Number(binding.claimedTabId);
    if (!binding || (Number.isInteger(claimed) && claimed !== popupTabId) || !bindingMatchesHf84(active, popupTabId)) {
      return { ok: false, code: "HF92_EXACT_POPUP_OWNER_MISMATCH", message: "방금 열린 팝업의 작업 소유권이 현재 B코드와 일치하지 않습니다." };
    }

    binding.claimedTabId = popupTabId;`;

const INITIAL_OWNER_RECONCILIATION = `    const binding = active.a21PopupOwnershipHf81;
    const initialOwnerKeyHf100 = receiptKeyHf84(active);
    const initialOwnershipHf100 = exactPopupOwnerAtCommitHf96(
      active,
      popupTabId,
      initialOwnerKeyHf100,
    );
    if (!binding || !initialOwnershipHf100.ok) {
      return {
        ok: false,
        code: "HF100_EXACT_POPUP_INITIAL_OWNER_MISMATCH",
        message: "방금 열린 팝업의 현재 B코드 소유권을 전송 전에 확인하지 못했습니다.",
        ownershipCodeHf100: initialOwnershipHf100.code || "HF100_BINDING_MISSING",
      };
    }
    if (initialOwnershipHf100.sameAssignmentRearmReconciled) {
      active.shoplingPopupInitialReconciliationHf100 = {
        code: "HF100_INITIAL_REARM_RECONCILED",
        canonicalOwnerKey: initialOwnershipHf100.canonicalOwnerKey,
        popupTabId,
        listTabId: initialOwnershipHf100.listTabId,
        recordedAt: Date.now(),
      };
    }

    binding.claimedTabId = popupTabId;`;

const RECEIPT_MARKER = `            sameAssignmentRearmReconciledHf96:
              ownershipHf96.sameAssignmentRearmReconciled === true,
            ownershipCodeHf96: ownershipHf96.code || null,`;

const RECEIPT_PATCH = `            sameAssignmentRearmReconciledHf96:
              ownershipHf96.sameAssignmentRearmReconciled === true,
            ownershipCodeHf96: ownershipHf96.code || null,
            initialOwnerReconciledHf100:
              initialOwnershipHf100.sameAssignmentRearmReconciled === true,
            initialOwnershipCodeHf100: initialOwnershipHf100.code || null,`;

export function patchHf100InitialPopupOwnerReconciliation(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  for (const marker of [INITIAL_OWNER_GUARD, RECEIPT_MARKER]) {
    if (!normalized.includes(marker)) {
      throw new Error("shopling_stock_hf100_patch_checkpoint_mismatch");
    }
  }

  const patched = normalized
    .replace(INITIAL_OWNER_GUARD, INITIAL_OWNER_RECONCILIATION)
    .replace(RECEIPT_MARKER, RECEIPT_PATCH);

  for (const guard of [
    "HF100_EXACT_POPUP_INITIAL_OWNER_MISMATCH",
    "HF100_INITIAL_REARM_RECONCILED",
    "initialOwnerReconciledHf100",
    "exactPopupOwnerAtCommitHf96",
    "HF96_EXACT_POPUP_OWNER_PROOF_MISMATCH",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf100_guard_missing:${guard}`);
    }
  }
  return patched;
}
