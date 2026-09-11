import { createHash } from "node:crypto";
import type { PriceAdjustmentReceipt } from "./priceAdjustmentReceiptCache";

export type ReceiptStoredRow = { input_snapshot?: unknown; result_snapshot?: unknown; started_at?: unknown };
export type ReceiptFollowupLine = { barcode: string; quantity: number; receivedAt: string; captured: PriceAdjustmentReceipt | null };
export type ReceiptFollowupBundle = { receiptId: string; draftId: string; cycleMonth: string; lines: ReceiptFollowupLine[] };
export function receiptRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function validInternalReceiptId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function receiptFollowupBundle(receiptId: string, rows: ReceiptStoredRow[]): ReceiptFollowupBundle {
  if (!validInternalReceiptId(receiptId)) throw new Error("RECEIPT_FOLLOWUP_ID_INVALID");
  if (!rows.length || rows.length > 100) throw new Error("RECEIPT_FOLLOWUP_ROWS_INVALID");
  let draftId = "", cycleMonth = "";
  const codes = new Set<string>();
  const lines = rows.map((row) => {
    const result = receiptRecord(row.result_snapshot);
    const input = receiptRecord(row.input_snapshot);
    const payload = receiptRecord(input.payload);
    const code = String(result.barcode ?? "");
    const quantity = Number(result.receivedNow);
    const receivedAt = String(input.occurredAt ?? row.started_at ?? "");
    if (result.receiptId !== receiptId || payload.receiptId !== receiptId || input.barcode !== code || input.sourceSystem !== "fast-purchase-mvp" || !["RECEIVED", "PARTIALLY_RECEIVED"].includes(String(input.status))) throw new Error("RECEIPT_FOLLOWUP_SOURCE_CONFLICT");
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(code) || codes.has(code) || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(Date.parse(receivedAt))) throw new Error("RECEIPT_FOLLOWUP_LINE_INVALID");
    codes.add(code);
    const currentDraft = String(result.draftId ?? "");
    const currentMonth = String(result.cycleMonth ?? "");
    if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(currentDraft) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(currentMonth) || (draftId && currentDraft !== draftId) || (cycleMonth && currentMonth !== cycleMonth)) throw new Error("RECEIPT_FOLLOWUP_SCOPE_CONFLICT");
    draftId = currentDraft; cycleMonth = currentMonth;
    if (result.followupVersion !== undefined && (result.followupVersion !== 1 || result.receiptLineCount !== rows.length)) throw new Error("RECEIPT_FOLLOWUP_INCOMPLETE");
    const captured = result.receiptCost ? result.receiptCost as PriceAdjustmentReceipt : null;
    return { barcode: code, quantity, receivedAt, captured };
  });
  return { receiptId, draftId, cycleMonth, lines };
}
function validateCost(cost: PriceAdjustmentReceipt, bundle: ReceiptFollowupBundle, line: ReceiptFollowupLine) {
  const expectedId = `china-receipt:${bundle.receiptId}:${line.barcode}`;
  if (cost.id !== expectedId || cost.receiptId !== bundle.receiptId || cost.barcode !== line.barcode || cost.quantity !== line.quantity || Date.parse(cost.receivedAt) !== Date.parse(line.receivedAt) || !Number.isSafeInteger(cost.unitCostKrw) || cost.unitCostKrw <= 0) throw new Error("RECEIPT_FOLLOWUP_COST_CONFLICT");
}
export function selectReceiptFollowupCosts(bundle: ReceiptFollowupBundle, currentCosts: PriceAdjustmentReceipt[]) {
  const costs: PriceAdjustmentReceipt[] = [], missing: PriceAdjustmentReceipt[] = [];
  for (const line of bundle.lines) {
    const id = `china-receipt:${bundle.receiptId}:${line.barcode}`;
    const matches = currentCosts.filter((row) => row.id === id);
    if (matches.length > 1) throw new Error("RECEIPT_FOLLOWUP_CACHE_CONFLICT");
    // A later landed-cost adjustment in the cache wins. Never replay an older
    // captured purchase cost over a subsequently confirmed final cost.
    const selected = matches[0] ?? line.captured;
    if (!selected) throw new Error("RECEIPT_FOLLOWUP_SOURCE_COST_REQUIRED");
    validateCost(selected, bundle, line);
    costs.push(selected);
    if (!matches.length) missing.push(selected);
  }
  return { costs, missing };
}
export function compareReceiptFollowupReadback(costs: PriceAdjustmentReceipt[], payload: unknown) {
  const root = receiptRecord(payload);
  if (root.ok !== true || root.proof !== "PERSISTED_RECEIPT_COST_ROWS_ONLY" || !Array.isArray(root.rows) || !costs.length || root.receiptId !== costs[0].receiptId) throw new Error("RECEIPT_FOLLOWUP_READBACK_INVALID");
  const rows = root.rows.map(receiptRecord);
  if (rows.length !== costs.length) throw new Error("RECEIPT_FOLLOWUP_READBACK_MISSING");
  for (const cost of costs) {
    const matches = rows.filter((row) => row.externalId === cost.id);
    const row = matches[0];
    if (matches.length !== 1 || !row || !row.skuId || Number(row.quantity) !== cost.quantity || Number(row.unitCostKrw) !== cost.unitCostKrw || Date.parse(String(row.receivedAt)) !== Date.parse(cost.receivedAt)) throw new Error("RECEIPT_FOLLOWUP_READBACK_MISMATCH");
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(costs.map((row) => [row.id, row.quantity, row.unitCostKrw, Date.parse(row.receivedAt)]).sort())).digest("hex")}`;
}
