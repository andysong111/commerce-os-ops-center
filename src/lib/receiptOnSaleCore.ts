import type { InventoryStockControlReport } from "./inventoryStockControl";
import { receiptFollowupBundle, receiptRecord, type ReceiptStoredRow } from "./internalChinaReceiptFollowupCore";

export type ReceiptOnSaleRow = {
  barcode: string; receiptId: string; quantity: number; jobId: string;
  state: "PENDING" | "STARTED" | "ACCEPTED" | "HELD"; message: string; canStart: boolean; canHold?: boolean;
};
type ReceiptTarget = Pick<ReceiptOnSaleRow, "barcode" | "receiptId" | "quantity" | "jobId">;

export function receiptOnSaleTargets(draftId: string, rows: ReceiptStoredRow[]) {
  const batches = new Map<string, ReceiptStoredRow[]>();
  for (const row of rows) {
    const r = receiptRecord(row.result_snapshot);
    if (r.actualOrderEvidenceReconciled === true && !r.receiptId) continue;
    const input = receiptRecord(row.input_snapshot);
    if (r.draftId !== draftId || input.sourceRunId !== draftId || receiptRecord(input.payload).draftId !== draftId || r.accepted !== true) throw new Error("입고 원장의 차시와 승인 상태를 확인하세요.");
    const id = String(r.receiptId ?? "");
    const batch = batches.get(id) ?? [];
    batch.push(row); batches.set(id, batch);
  }
  const targets = new Map<string, ReceiptTarget & { receivedAt: number }>();
  for (const [receiptId, rows] of batches) {
    const bundle = receiptFollowupBundle(receiptId, rows);
    for (const line of bundle.lines) {
      const old = targets.get(line.barcode);
      const receivedAt = Date.parse(line.receivedAt);
      const latest = !old || receivedAt > old.receivedAt || (receivedAt === old.receivedAt && receiptId > old.receiptId);
      const id = latest ? receiptId : old.receiptId;
      targets.set(line.barcode, { barcode: line.barcode, receiptId: id, receivedAt: Math.max(old?.receivedAt ?? 0, receivedAt),
        quantity: (old?.quantity ?? 0) + line.quantity, jobId: `receipt-onsale:${id}:${line.barcode}` });
    }
  }
  return [...targets.values()].sort((a, b) => a.barcode.localeCompare(b.barcode));
}

export function receiptOnSaleState(target: ReceiptTarget, report: InventoryStockControlReport | undefined,
  events: Record<string, unknown>[]): ReceiptOnSaleRow {
  const matching = events.filter(e => e.jobId === target.jobId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  const end = matching.find(e => e.outcome === "SUCCEEDED") ?? matching.find(e => ["FAILED", "UNCERTAIN"].includes(String(e.outcome)));
  const start = matching.find(e => e.outcome === "STARTED");
  const held = (message: string, canStart = false): ReceiptOnSaleRow => ({ ...target, state: "HELD", message, canStart });
  if (end && start) {
    if (end.outcome === "SUCCEEDED" && receiptRecord(end.evidence).stockPlanComplete === true) {
      const failures = Number(receiptRecord(end.evidence).marketFailureCount);
      if (failures > 0) return held(`Shopling 접수 완료 · 마켓 실패 표시 ${failures}건 확인 필요`);
      return { ...target, state: "ACCEPTED", message: "Shopling 전송 접수 확인", canStart: false };
    }
    return held(String(end.message || "전송 결과 확인 필요"));
  }
  if (start) return { ...target, state: "STARTED", canHold: Date.now() - Date.parse(String(start.occurredAt)) >= 31 * 60_000, message: "시작 기록 있음 · 원래 전송의 접수 결과 확인 대기", canStart: false };
  const older = events.filter(e => e.barcode === target.barcode && e.jobId !== target.jobId);
  const unresolved = older.find(e => e.outcome === "STARTED" && !older.some(other => other.jobId === e.jobId && other.outcome === "SUCCEEDED"));
  if (unresolved) {
    const stopped = older.some(e => e.jobId === unresolved.jobId && ["FAILED","UNCERTAIN"].includes(String(e.outcome)));
    return { ...target, jobId: String(unresolved.jobId), state: stopped ? "HELD" : "STARTED", canStart: false, canHold: !stopped && Date.now() - Date.parse(String(unresolved.occurredAt)) >= 31 * 60_000,
      message: "이 B코드의 이전 입고 전송 결과 확인 필요" };
  }
  const row = report?.rows.find(r => r.barcode === target.barcode);
  if (!row || report?.state !== "READY" || !row.salesCoverageReady || row.inventoryQuantityKnown === false || row.manualStatusOnly) return held("판매 내역과 현재 정확재고 확인 필요");
  if (row.syncBlocked || row.latestSyncOutcome === "STARTED" || row.latestSyncOutcome === "UNCERTAIN") return held(row.syncBlockReason || "이전 전송 결과 확인 필요");
  if (row.desiredStatus !== "ON_SALE" || !Number.isSafeInteger(row.exactInventoryQuantity) || row.exactInventoryQuantity <= 0) return held("현재 판매 가능 재고 없음");
  const problem = matching.filter(e => e.outcome === "PREFLIGHT_HELD").at(-1);
  if (problem) return held(String(problem.message), true);
  return { ...target, state: "PENDING", canStart: true, message: row.syncNeeded ? "판매중 전송 대기" : "판매중 덮어쓰기 전송 대기" };
}

// Every active listing in the signed single-B-code plan needs its original
// A21 submit receipt. An ended-only plan or a per-popup success is not a send.
export function receiptOnSaleProof(evidence: unknown, expected: string[], jobId: string) {
  const e = receiptRecord(evidence);
  if (e.stockPlanComplete !== true || !expected.length || !Array.isArray(e.stockStateGroupReceipts)) return false;
  const seen = new Set<string>(), popups = new Set<number>();
  for (const raw of e.stockStateGroupReceipts) {
    const leg = receiptRecord(raw), proof = receiptRecord(receiptRecord(leg.evidence).originalSubmitReceipt);
    const keys = leg.goodsKeys;
    if (!Array.isArray(keys) || !keys.length || proof.goodsKeyQuery !== keys.join(",") ||
      proof.desiredStatus !== "ON_SALE" || !Number.isInteger(proof.popupTabId) || Number(proof.popupTabId) <= 0 ||
      leg.acceptedPopupTabId !== proof.popupTabId || popups.has(Number(proof.popupTabId)) ||
      proof.submitDispatchMethod !== "ORIGINAL_SHOPLING_FUNCTION" || proof.shoplingSubmitInvoked !== true ||
      proof.submitConfirmSeen !== true || proof.submitControlVerified !== true ||
      !Number.isInteger(proof.popupFrameId) || Number(proof.popupFrameId) < 0 ||
      proof.targetChecked !== true || proof.topChecked !== true ||
      proof.productKind !== (leg.transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE") ||
      typeof proof.receiptKey !== "string" || proof.receiptKey !== proof.assignmentOwnerKey ||
      !proof.receiptKey.startsWith(jobId + ":") || !proof.receiptKey.endsWith(":" + proof.productKind + ":" + proof.goodsKeyQuery)) return false;
    popups.add(Number(proof.popupTabId));
    for (const key of keys) {
      const entry = leg.transmissionKind + ":" + key;
      if (seen.has(entry)) return false;
      seen.add(entry);
    }
  }
  return seen.size === expected.length && expected.every(key => seen.has(key));
}
