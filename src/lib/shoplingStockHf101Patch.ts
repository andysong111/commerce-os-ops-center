const HANDOFF_MARKER =
  `  globalThis.__commerceOsHf84ExplicitPopupHandoff = async function explicitPopupHandoffHf92(input) {`;

const IN_FLIGHT_OWNER_HELPERS = `  // HF101: the exact HF90 owner proof can be overwritten by a stale duplicate
  // preparation while this same direct handoff is probing the popup frames. Keep
  // one immutable, function-local snapshot after the initial owner check, then
  // use it only when the live assignment still proves the same job, list tab,
  // popup and canonical goods-key batch.
  function captureInitialExactPopupOwnerHf101(active, popupTabId, receiptKey, initialOwnership) {
    const binding = active?.a21PopupOwnershipHf81;
    const dispatchReceipt = active?.shoplingDispatchReceiptHf90;
    const popupWork = active?.workTabs?.A21_POPUP;
    const listTabId = Number(binding?.listTabId);
    const workListTabId = Number(active?.workTabs?.A21_LIST?.tabId);
    const receiptListTabId = Number(dispatchReceipt?.expectedListTabId);
    const popupOpenerTabId = popupWork?.openerTabId == null
      ? null
      : Number(popupWork.openerTabId);
    const productKind = String(active?.job?.productKind || "").toUpperCase();
    const goodsKeyQuery = batchQueryHf84(active);
    const canonicalOwnerKey = receiptKeyHf84(active);
    const claimedTabId = binding?.claimedTabId == null
      ? null
      : Number(binding.claimedTabId);
    const recordedAt = Number(dispatchReceipt?.recordedAt);
    const receiptAgeMs = Date.now() - recordedAt;
    const exactInitialProof = Boolean(
      initialOwnership?.ok === true &&
      active?.status === "RUNNING" &&
      canonicalOwnerKey === receiptKey &&
      binding &&
      ["OPTION", "SINGLE"].includes(productKind) &&
      goodsKeyQuery &&
      binding.productKind === productKind &&
      binding.goodsKeyQuery === goodsKeyQuery &&
      binding.assignmentOwnerKey === canonicalOwnerKey &&
      (!Number.isInteger(claimedTabId) || claimedTabId === popupTabId) &&
      Number.isInteger(listTabId) &&
      listTabId === workListTabId &&
      listTabId === receiptListTabId &&
      dispatchReceipt?.jobId === String(active?.job?.jobId || "") &&
      Number(dispatchReceipt?.popupTabId) === popupTabId &&
      dispatchReceipt?.exactOwnerBound === true &&
      dispatchReceipt?.externalWriteConfirmed === false &&
      dispatchReceipt?.code === "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT" &&
      Number(popupWork?.tabId) === popupTabId &&
      (!Number.isInteger(popupOpenerTabId) || popupOpenerTabId === listTabId) &&
      popupWork?.assignmentOwnerKey === canonicalOwnerKey &&
      popupWork?.establishedBy === "HF90_EXACT_TRUSTED_POPUP_HANDOFF" &&
      Number.isFinite(recordedAt) &&
      receiptAgeMs >= -5000 &&
      receiptAgeMs <= 120000
    );
    if (!exactInitialProof) return null;
    return Object.freeze({
      code: "HF101_INITIAL_EXACT_POPUP_OWNER_SNAPSHOT",
      receiptKey,
      canonicalOwnerKey,
      jobId: String(active?.job?.jobId || ""),
      executionId: String(active?.job?.executionId || active?.job?.jobId || ""),
      productKind,
      goodsKeyQuery,
      popupTabId,
      listTabId,
      capturedAt: Date.now(),
    });
  }

  function exactPopupOwnerFromInitialSnapshotHf101(active, popupTabId, receiptKey, snapshot) {
    if (!snapshot) {
      return { ok: false, code: "HF101_INITIAL_OWNER_SNAPSHOT_MISSING" };
    }
    const binding = active?.a21PopupOwnershipHf81;
    const productKind = String(active?.job?.productKind || "").toUpperCase();
    const goodsKeyQuery = batchQueryHf84(active);
    const canonicalOwnerKey = receiptKeyHf84(active);
    const claimedTabId = binding?.claimedTabId == null
      ? null
      : Number(binding.claimedTabId);
    const listTabId = Number(binding?.listTabId);
    const workListTabId = Number(active?.workTabs?.A21_LIST?.tabId);
    const snapshotAgeMs = Date.now() - Number(snapshot.capturedAt);
    const sameInFlightAssignment = Boolean(
      active &&
      active.status === "RUNNING" &&
      binding &&
      receiptKeyHf84(active) === receiptKey &&
      snapshot.receiptKey === receiptKey &&
      snapshot.canonicalOwnerKey === canonicalOwnerKey &&
      snapshot.jobId === String(active?.job?.jobId || "") &&
      snapshot.executionId === String(active?.job?.executionId || active?.job?.jobId || "") &&
      snapshot.productKind === productKind &&
      snapshot.goodsKeyQuery === goodsKeyQuery &&
      Number(snapshot.popupTabId) === popupTabId &&
      binding.productKind === productKind &&
      binding.goodsKeyQuery === goodsKeyQuery &&
      binding.assignmentOwnerKey === canonicalOwnerKey &&
      (!Number.isInteger(claimedTabId) || claimedTabId === popupTabId) &&
      Number.isInteger(listTabId) &&
      listTabId === Number(snapshot.listTabId) &&
      listTabId === workListTabId &&
      Number.isFinite(snapshotAgeMs) &&
      snapshotAgeMs >= -5000 &&
      snapshotAgeMs <= 120000
    );
    if (!sameInFlightAssignment) {
      return { ok: false, code: "HF101_IN_FLIGHT_OWNER_SNAPSHOT_MISMATCH" };
    }
    return {
      ok: true,
      sameAssignmentRearmReconciled: true,
      initialOwnerSnapshotReconciledHf101: true,
      code: "HF101_IN_FLIGHT_INITIAL_OWNER_RECONCILED",
      canonicalOwnerKey,
      popupTabId,
      listTabId,
    };
  }

`;

const INITIAL_CAPTURE_MARKER = `    if (initialOwnershipHf100.sameAssignmentRearmReconciled) {
      active.shoplingPopupInitialReconciliationHf100 = {
        code: "HF100_INITIAL_REARM_RECONCILED",
        canonicalOwnerKey: initialOwnershipHf100.canonicalOwnerKey,
        popupTabId,
        listTabId: initialOwnershipHf100.listTabId,
        recordedAt: Date.now(),
      };
    }

    binding.claimedTabId = popupTabId;`;

const INITIAL_CAPTURE_PATCH = `    if (initialOwnershipHf100.sameAssignmentRearmReconciled) {
      active.shoplingPopupInitialReconciliationHf100 = {
        code: "HF100_INITIAL_REARM_RECONCILED",
        canonicalOwnerKey: initialOwnershipHf100.canonicalOwnerKey,
        popupTabId,
        listTabId: initialOwnershipHf100.listTabId,
        recordedAt: Date.now(),
      };
    }
    const initialOwnerSnapshotHf101 = captureInitialExactPopupOwnerHf101(
      active,
      popupTabId,
      initialOwnerKeyHf100,
      initialOwnershipHf100,
    );

    binding.claimedTabId = popupTabId;`;

const FINAL_OWNER_BLOCK = `        const ownershipHf96 = exactPopupOwnerAtCommitHf96(
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

const FINAL_OWNER_PATCH = `        let ownershipHf96 = exactPopupOwnerAtCommitHf96(
          latest,
          popupTabId,
          receiptKey,
        );
        const liveOwnershipCodeHf101 = ownershipHf96.code || null;
        if (!ownershipHf96.ok) {
          const inFlightOwnershipHf101 = exactPopupOwnerFromInitialSnapshotHf101(
            latest,
            popupTabId,
            receiptKey,
            initialOwnerSnapshotHf101,
          );
          if (!inFlightOwnershipHf101.ok) {
            return {
              ok: false,
              code: "HF101_IN_FLIGHT_POPUP_OWNER_CHANGED",
              message: "파란 전송 직전 현재 B코드·목록창·팝업의 동일 작업 증명이 달라져 전송하지 않았습니다. (" + inFlightOwnershipHf101.code + ")",
              ownershipCodeHf96: liveOwnershipCodeHf101,
              ownershipCodeHf101: inFlightOwnershipHf101.code,
            };
          }
          ownershipHf96 = inFlightOwnershipHf101;
        }
        if (ownershipHf96.initialOwnerSnapshotReconciledHf101) {
          latest.shoplingPopupInFlightReconciliationHf101 = {
            code: ownershipHf96.code,
            canonicalOwnerKey: ownershipHf96.canonicalOwnerKey,
            popupTabId,
            listTabId: ownershipHf96.listTabId,
            replacedLiveOwnershipCode: liveOwnershipCodeHf101,
            recordedAt: Date.now(),
          };
        } else if (ownershipHf96.sameAssignmentRearmReconciled) {
          latest.shoplingPopupReconciliationHf96 = {
            code: ownershipHf96.code,
            canonicalOwnerKey: ownershipHf96.canonicalOwnerKey,
            popupTabId,
            listTabId: ownershipHf96.listTabId,
            recordedAt: Date.now(),
          };
        }
        const latestBinding = latest.a21PopupOwnershipHf81;`;

const RECEIPT_MARKER = `            initialOwnerReconciledHf100:
              initialOwnershipHf100.sameAssignmentRearmReconciled === true,
            initialOwnershipCodeHf100: initialOwnershipHf100.code || null,`;

const RECEIPT_PATCH = `            initialOwnerReconciledHf100:
              initialOwnershipHf100.sameAssignmentRearmReconciled === true,
            initialOwnershipCodeHf100: initialOwnershipHf100.code || null,
            initialOwnerSnapshotReconciledHf101:
              ownershipHf96.initialOwnerSnapshotReconciledHf101 === true,
            ownershipCodeHf101: ownershipHf96.code || null,`;

export function patchHf101InFlightInitialOwnerSnapshot(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  for (const marker of [
    HANDOFF_MARKER,
    INITIAL_CAPTURE_MARKER,
    FINAL_OWNER_BLOCK,
    RECEIPT_MARKER,
  ]) {
    if (!normalized.includes(marker)) {
      throw new Error("shopling_stock_hf101_patch_checkpoint_mismatch");
    }
  }

  const patched = normalized
    .replace(HANDOFF_MARKER, `${IN_FLIGHT_OWNER_HELPERS}${HANDOFF_MARKER}`)
    .replace(INITIAL_CAPTURE_MARKER, INITIAL_CAPTURE_PATCH)
    .replace(FINAL_OWNER_BLOCK, FINAL_OWNER_PATCH)
    .replace(RECEIPT_MARKER, RECEIPT_PATCH);

  for (const guard of [
    "HF101_INITIAL_EXACT_POPUP_OWNER_SNAPSHOT",
    "HF101_IN_FLIGHT_INITIAL_OWNER_RECONCILED",
    "HF101_IN_FLIGHT_OWNER_SNAPSHOT_MISMATCH",
    "HF101_IN_FLIGHT_POPUP_OWNER_CHANGED",
    "initialOwnerSnapshotReconciledHf101",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf101_guard_missing:${guard}`);
    }
  }
  return patched;
}
