import { createHash, randomUUID } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { koreanMonthLabel, seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import type { PriceAdjustmentReceipt } from "@/lib/priceAdjustmentReceiptCache";
import { retryInternalChinaReceiptFollowup } from "@/lib/internalChinaReceiptFollowup";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const RECEIPT_SOURCE = "ops-center-internal-china-receipt";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MAX_RECEIPT_LINES = 100;

type ReceiptLineInput = { barcode?: unknown; quantity?: unknown };
export type InternalChinaReceiptInput = {
  draftId?: unknown;
  cycleMonth?: unknown;
  lines?: ReceiptLineInput[];
};
export type InternalChinaReceiptResult = {
  receiptId: string; draftId: string; cycleMonth: string; lineCount: number;
  receivedNow: number; fullyReceivedCount: number; partiallyReceivedCount: number;
  productMasterSynced: boolean; productMasterError: string | null;
};
function text(value: unknown) { return String(value ?? "").normalize("NFKC").trim(); }
function barcode(value: unknown) { return text(value).toUpperCase().replace(/\s+/g, ""); }
function quantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}
function validDraftId(value: unknown) {
  const candidate = text(value);
  if (!DRAFT_ID.test(candidate)) throw new Error("CHINA_RECEIPT_DRAFT_INVALID");
  return candidate;
}
function validCycleMonth(value: unknown) {
  const candidate = text(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)) throw new Error("CHINA_RECEIPT_CYCLE_MONTH_INVALID");
  return candidate;
}
function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}
function lineReceiptEventId(receiptId: string, code: string) { return `receipt:${receiptId}:${code}`; }
function orderItemId(draftId: string, code: string) {
  return parseInt(createHash("sha256").update(`${draftId}:${code}`).digest("hex").slice(0, 7), 16);
}
function batchId(cycleMonth: string) { return Number(cycleMonth.replace("-", "")); }

export async function recordInternalChinaReceipt(input: InternalChinaReceiptInput): Promise<InternalChinaReceiptResult> {
  const draftId = validDraftId(input.draftId);
  const requestedCycleMonth = validCycleMonth(input.cycleMonth);
  if (!Array.isArray(input.lines) || !input.lines.length) throw new Error("CHINA_RECEIPT_LINES_REQUIRED");
  if (input.lines.length > MAX_RECEIPT_LINES) throw new Error("CHINA_RECEIPT_LINES_EXCEEDED");
  const byBarcode = new Map<string, number>();
  for (const line of input.lines) {
    const code = barcode(line.barcode);
    const receivedNow = quantity(line.quantity);
    if (!BARCODE.test(code) || receivedNow <= 0) continue;
    byBarcode.set(code, receivedNow);
  }
  if (!byBarcode.size) throw new Error("CHINA_RECEIPT_POSITIVE_QUANTITY_REQUIRED");

  const ledger = await loadChinaOrderLedger();
  if (ledger.error) throw new Error(`CHINA_ORDER_LEDGER_UNAVAILABLE:${ledger.error}`);
  const commitments = ledger.commitments.filter((row) => row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draftId);
  if (!commitments.length) throw new Error("CHINA_RECEIPT_DRAFT_NOT_FOUND");
  const actualCycleMonth = seoulCalendarMonth(commitments.reduce((earliest, row) => {
    const candidate = row.reservedAt || row.updatedAt;
    if (!earliest) return candidate;
    return Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest;
  }, ""));
  if (actualCycleMonth !== requestedCycleMonth) throw new Error(`CHINA_RECEIPT_CYCLE_MONTH_CONFLICT:${requestedCycleMonth}:${actualCycleMonth}`);
  const commitmentByBarcode = new Map(commitments.map((row) => [row.barcode, row] as const));
  for (const [code, receivedNow] of byBarcode) {
    const commitment = commitmentByBarcode.get(code);
    if (!commitment) throw new Error(`CHINA_RECEIPT_BARCODE_NOT_IN_DRAFT:${code}`);
    if (commitment.openQuantity <= 0) throw new Error(`CHINA_RECEIPT_ALREADY_CLOSED:${code}`);
    if (receivedNow > commitment.openQuantity) throw new Error(`CHINA_RECEIPT_QUANTITY_EXCEEDED:${code}:${receivedNow}:${commitment.openQuantity}`);
  }
  const baseDraft = await loadInternalChinaPurchaseDraft(draftId);
  const draft = await loadInternalChinaDraftWithQuantityOverrides(baseDraft);
  const draftByBarcode = new Map(draft.lines.map((line) => [line.barcode, line] as const));
  const groupStats = new Map<string, { quantity: number; freight: number }>();
  for (const line of draft.lines) {
    const key = line.freightGroupId.trim() || `__${line.barcode}`;
    const current = groupStats.get(key) ?? { quantity: 0, freight: 0 };
    current.quantity += line.quantity;
    current.freight += Math.max(0, Number(line.domesticChinaFreightCny) || 0);
    groupStats.set(key, current);
  }
  const receiptId = randomUUID();
  const now = new Date().toISOString();
  const operations: Record<string, unknown>[] = [];
  const receiptCosts: PriceAdjustmentReceipt[] = [];
  let fullyReceivedCount = 0, partiallyReceivedCount = 0, receivedNowTotal = 0;
  for (const [code, receivedNow] of byBarcode) {
    const commitment = commitmentByBarcode.get(code)!;
    const line = draftByBarcode.get(code);
    if (!line) throw new Error(`CHINA_RECEIPT_DRAFT_LINE_MISSING:${code}`);
    const cumulativeReceived = commitment.receivedQuantity + receivedNow;
    const receivableTotal = Math.max(0, commitment.committedQuantity - commitment.cancelledQuantity);
    const finished = cumulativeReceived >= receivableTotal;
    if (finished) fullyReceivedCount += 1;
    else partiallyReceivedCount += 1;
    receivedNowTotal += receivedNow;
    const event = normalizeChinaOrderCommitmentEvent({
      sourceSystem: commitment.sourceSystem, sourceLineId: commitment.sourceLineId,
      sourceRunId: draftId, sourceEventId: lineReceiptEventId(receiptId, code), barcode: code,
      status: finished ? "RECEIVED" : "PARTIALLY_RECEIVED", receivedQuantity: cumulativeReceived,
      occurredAt: now, note: `${koreanMonthLabel(actualCycleMonth)} 입고확정 · 이번 ${receivedNow.toLocaleString("ko-KR")}개`,
      payload: { receiptId, draftId, cycleMonth: actualCycleMonth, receivedNow, cumulativeReceived, externalOrderExecuted: false },
    });
    const groupKey = line.freightGroupId.trim() || `__${line.barcode}`;
    const group = groupStats.get(groupKey) ?? { quantity: line.quantity, freight: 0 };
    const freightPerUnitCny = group.quantity > 0 ? group.freight / group.quantity : 0;
    const actualUnitCny = Math.max(0, Number(line.unitPriceCny) || 0) + freightPerUnitCny;
    // 배송대행지 청구액은 별도 원가 마감에서 처리한다. 입고 시점의 상품대금과
    // 중국내 운임에 1.45 추정계수를 섞지 않는 기존 계산을 유지한다.
    const unitCostKrw = Math.max(1, Math.round(actualUnitCny * draft.exchangeRateKrwPerCny));
    const receiptCost: PriceAdjustmentReceipt = {
      id: `china-receipt:${receiptId}:${code}`, receiptId,
      batchId: batchId(actualCycleMonth), orderItemId: orderItemId(draftId, code),
      barcode: code, modelNumber: line.modelNo, optionName: line.saleOption,
      quantity: receivedNow, unitCostKrw, receivedAt: now,
    };
    receiptCosts.push(receiptCost);
    operations.push({
      operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE, status: "SUCCEEDED", source: RECEIPT_SOURCE,
      source_event_id: `china-order:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceEventId)}`,
      correlation_id: `china-order-line:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceLineId)}`,
      actor_type: "OPS_OPERATOR", input_snapshot: event,
      result_snapshot: {
        accepted: true, receiptId, draftId, cycleMonth: actualCycleMonth, barcode: code,
        receivedNow, cumulativeReceived, fullyReceived: finished,
        // Durable recovery source is written with the quantity event, before any
        // downstream cache/network work. Replays cannot invent or re-add quantity.
        followupVersion: 1, receiptLineCount: byBarcode.size, receiptCost,
      },
      error_message: null, started_at: now, finished_at: now, updated_at: now,
    });
  }
  if (receiptCosts.length !== operations.length) throw new Error("CHINA_RECEIPT_COST_CAPTURE_INCOMPLETE");
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(`${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`, {
    method: "POST",
    headers: { ...createSupabaseAdminHeaders(secret), Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(operations), cache: "no-store",
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`CHINA_RECEIPT_STORE_FAILED:${response.status}:${responseBody.slice(0, 400)}`);

  let productMasterSynced = false;
  let productMasterError: string | null = null;
  try {
    const followup = await retryInternalChinaReceiptFollowup(receiptId);
    productMasterSynced = followup.state === "VERIFIED";
  } catch (error) {
    const raw = error instanceof Error ? error.message.split(":", 1)[0] : "";
    productMasterError = /^[A-Z0-9_]+$/.test(raw) ? raw : "PRODUCT_MASTER_RECEIPT_SYNC_FAILED";
  }
  return { receiptId, draftId, cycleMonth: actualCycleMonth, lineCount: byBarcode.size,
    receivedNow: receivedNowTotal, fullyReceivedCount, partiallyReceivedCount,
    productMasterSynced, productMasterError };
}
