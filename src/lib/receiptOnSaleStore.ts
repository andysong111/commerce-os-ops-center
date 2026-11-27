import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { receiptRecord } from "./internalChinaReceiptFollowupCore";
import { purchaseRunDraftId } from "./monthlyPriceCore";
import { receiptOnSaleProof, receiptOnSaleState, receiptOnSaleTargets } from "./receiptOnSaleCore";
import { loadAuthoritativeInventoryStockReport } from "./inventoryStockAuthoritativeReport";
import { normalizeShoplingStockSyncInput, SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE, storeInventoryOperation } from "./inventoryStockControl";
import { planShoplingGoodsKeyTransmission } from "./shopling/shoplingGoodsKeyTransmission";
import { prepareShoplingStockBatch } from "./shopling/shoplingStockBatchService";

const preflightType = "RECEIPT_ONSALE_PREFLIGHT";
const receiptType = "CHINA_ORDER_COMMITMENT_EVENT";
export async function readReceiptJournal(draftId: string | undefined, receipts: boolean) {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("입고 원장 연결을 확인하세요.");
  const all: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 400) {
    const q = db.from("commerce_operation_runs").select("input_snapshot,result_snapshot,started_at").eq("status", "SUCCEEDED");
    if (!receipts && !draftId) throw new Error("판매중 전송 차시가 필요합니다.");
    const query = receipts ? q.eq("operation_type", receiptType).eq("source", "ops-center-internal-china-receipt")
      : q.eq("correlation_id", "receipt-onsale:" + draftId).in("operation_type", [SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE, preflightType]);
    if (receipts && draftId) query.eq("result_snapshot->>draftId", draftId);
    const { data, error } = await query.order("source_event_id").range(offset, offset + 399);
    if (error || !Array.isArray(data)) throw new Error("이번 차시의 입고·전송 원장을 읽지 못했습니다.");
    all.push(...data);
    if (data.length < 400) return all;
  }
}
async function loadState(input: unknown, refreshTail = false) {
  const draftId = purchaseRunDraftId(input);
  const [receipts, logs] = await Promise.all([readReceiptJournal(draftId, true), readReceiptJournal(draftId, false)]);
  const targets = receiptOnSaleTargets(draftId, receipts);
  const events = logs.map(r => receiptRecord(r.input_snapshot));
  const report = targets.length ? await loadAuthoritativeInventoryStockReport({ refreshTail })
    .then(result => result.report).catch(() => undefined) : undefined;
  const rows = targets.map(target => receiptOnSaleState(target, report, events));
  return { draftId, rows, events, report };
}
export async function readReceiptOnSaleStatus(draftId: unknown, refreshTail = false) {
  const { rows } = await loadState(draftId, refreshTail);
  return rows;
}
export async function claimReceiptOnSale(input: unknown, jobId: unknown) {
  const { draftId, rows, events, report } = await loadState(input, true);
  const target = rows.find(r => r.jobId === jobId);
  if (!target || !target.canStart) throw new Error(target?.message || "이번 차시의 입고 대상이 변경됐습니다.");
  const starts = events.filter(e => e.outcome === "STARTED");
  if (starts.some(start => !events.some(e => e.jobId === start.jobId && ["SUCCEEDED","FAILED","UNCERTAIN"].includes(String(e.outcome))))) {
    throw new Error("이 차시에서 진행 중인 전송의 접수 결과를 먼저 확인하세요.");
  }
  const row = report!.rows.find(r => r.barcode === target.barcode)!;
  const job = { jobId: target.jobId, barcode: row.barcode, modelNo: row.modelNo, productName: row.productName,
    productKind: row.productKind, desiredStatus: "ON_SALE" as const, exactInventoryQuantity: row.exactInventoryQuantity,
    goodsKeys: row.goodsKeys, resetAt: row.resetAt, desiredSince: row.desiredSince, operationalQueue: true, inboundAutoOnSale: true };
  const correlationId = "receipt-onsale:" + draftId;
  let prepared, expected;
  try {
    prepared = await prepareShoplingStockBatch([job]);
    expected = prepared.products.filter(p => p.productSaleStatus !== "E").flatMap(p => {
      if (p.finalizeBarcode !== job.barcode || p.parentDesiredStatus !== "ON_SALE") throw new Error("입고 B코드와 최종 판매중 전송 대상이 일치하지 않습니다.");
      const plan = planShoplingGoodsKeyTransmission(job.productKind, { goodsKey: p.goodsKey, optionCount: p.options.length });
      const keys = [plan.transmissionKind + ":" + p.goodsKey];
      if (plan.transmissionKind === "OPTION_SEND") keys.push("PRODUCT_SALE_STATUS_SEND:" + p.goodsKey);
      return keys;
    });
    if (!expected.length) throw new Error("전송할 판매 상품이 없습니다. 종료 상품과 B코드 매핑을 확인하세요.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopling 상품·옵션 확인 필요";
    await storeInventoryOperation({ operationType: preflightType, correlationId, sourceEventId: "receipt-onsale-check:" + job.jobId + ":" + crypto.randomUUID(),
      snapshot: { jobId, barcode: job.barcode, outcome: "PREFLIGHT_HELD", occurredAt: new Date().toISOString(), message } });
    return { job: null, message };
  }
  const snapshot = normalizeShoplingStockSyncInput({ ...job, eventId: job.jobId + ":start", outcome: "STARTED",
    message: "입고 판매중 전송 시작", evidence: { expected, receiptId: target.receiptId, draftId } });
  // Two concurrent tabs observing the same journal length compete for ONE slot,
  // even when requesting different barcodes. A lost response never permits replay.
  const stored = await storeInventoryOperation({ operationType: SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
    correlationId, sourceEventId: correlationId + ":dispatch:" + starts.length, snapshot });
  if (stored.duplicate) throw new Error("다른 창에서 이미 전송을 시작했습니다. 기존 접수 결과를 확인하세요.");
  return { job: { ...job, stockBatchPlan: prepared.items[0].stockBatchPlan }, message: "" };
}

export async function finishReceiptOnSale(input: unknown, raw: Record<string, unknown>) {
  const draftId = purchaseRunDraftId(input);
  const events = (await readReceiptJournal(draftId, false)).map(r => receiptRecord(r.input_snapshot));
  const start = events.find(e => e.outcome === "STARTED" && e.jobId === raw.jobId);
  if (!start || start.barcode !== raw.barcode || !["SUCCEEDED","UNCERTAIN","FAILED"].includes(String(raw.outcome))) throw new Error("원래 전송과 결과가 일치하지 않습니다.");
  if (raw.holdDetached && !(Date.now() - Date.parse(String(start.occurredAt)) >= 31 * 60_000)) throw new Error("진행 중인 전송의 결과를 기다려 주세요.");
  const proof = receiptRecord(raw.evidence);
  const expected = receiptRecord(start.evidence).expected;
  const accepted = raw.outcome === "SUCCEEDED" && Array.isArray(expected) && receiptOnSaleProof(proof, expected, String(start.jobId));
  const prior = events.find(e => e.jobId === raw.jobId && e.outcome === "SUCCEEDED");
  if (prior) return { outcome: "SUCCEEDED" };
  const outcome = accepted ? "SUCCEEDED" : raw.outcome === "FAILED" ? "FAILED" : "UNCERTAIN";
  const message = accepted ? "Shopling 전송 접수 확인" : raw.outcome === "SUCCEEDED" ? "계획 전체의 원본 접수 영수증 확인 필요" : String(raw.message || "원래 전송 결과 확인 필요");
  const event = normalizeShoplingStockSyncInput({ ...start, outcome, message, occurredAt: new Date().toISOString(),
    eventId: start.jobId + ":" + outcome, evidence: { ...proof, stockPlanComplete: accepted } });
  await storeInventoryOperation({ operationType: SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
    correlationId: "receipt-onsale:" + draftId, sourceEventId: event.eventId, snapshot: event });
  return { outcome };
}
