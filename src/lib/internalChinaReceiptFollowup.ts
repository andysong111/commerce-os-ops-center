import { CHINA_ORDER_EVENT_OPERATION_TYPE } from "@/lib/chinaOrderLedger";
import { readPriceAdjustmentReceiptCache, mergePriceAdjustmentReceiptCachePage, type PriceAdjustmentReceipt } from "@/lib/priceAdjustmentReceiptCache";
import { buildCanonicalProductMasterSnapshot } from "@/lib/productMasterCanonicalSync";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import { getProductLaunchAdminConfig, readProductLaunchState } from "@/lib/productLaunchTrackerServer";
import { loadStoredInternalChinaForwarderClose } from "@/lib/internalChinaForwarderStoredClose";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { receiptFollowupBundle, selectReceiptFollowupCosts, compareReceiptFollowupReadback, receiptRecord, validInternalReceiptId, type ReceiptStoredRow } from "@/lib/internalChinaReceiptFollowupCore";
import { missingReceiptCostRows, receiptCostOnlyPayload, validateReceiptReadbackIdentity } from "@/lib/internalChinaReceiptFollowupRepair";

export type InternalChinaReceiptFollowupStatus = {
  receiptId: string; draftId: string; cycleMonth: string; lineCount: number; barcodes: string[]; receivedQuantity: number;
  state: "VERIFIED" | "PENDING"; canRetry: boolean; errorCode: string | null;
  verifiedAt: string | null; fingerprint: string | null;
};
const SOURCE = "ops-center-internal-china-receipt";
const LIMIT = 1000;
function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  const base = (process.env.PRODUCT_MASTER_BASE_URL || "https://commerce-os-product-master.vercel.app").trim().replace(/\/$/, "");
  if (!secret || new URL(base).protocol !== "https:") throw new Error("RECEIPT_FOLLOWUP_CONNECTION_REQUIRED");
  return { base, secret };
}
async function admin() {
  const client = await createSupabaseAdminClient();
  if (!client) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return client;
}
function code(error: unknown) {
  const raw = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[A-Z0-9_]+$/.test(raw) ? raw : "RECEIPT_FOLLOWUP_FAILED";
}
async function pmRead(path: string) {
  const { base, secret } = connection();
  const response = await fetch(`${base}${path}`, { headers: { "x-commerce-os-integration-secret": secret }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`RECEIPT_FOLLOWUP_READBACK_HTTP_${response.status}`);
  return response.json();
}
const readback = (receiptId: string) => pmRead(`/api/integrations/internal-receipt-readback?receiptId=${encodeURIComponent(receiptId)}`);
async function storedRows(receiptId: string) {
  if (!validInternalReceiptId(receiptId)) throw new Error("RECEIPT_FOLLOWUP_ID_INVALID");
  const client = await admin();
  const result = await client.from("commerce_operation_runs").select("input_snapshot,result_snapshot,started_at")
    .eq("operation_type", CHINA_ORDER_EVENT_OPERATION_TYPE).eq("source", SOURCE).eq("status", "SUCCEEDED")
    .eq("result_snapshot->>receiptId", receiptId).order("source_event_id").limit(101);
  if (result.error) throw new Error("RECEIPT_FOLLOWUP_LEDGER_READ_FAILED");
  return (result.data ?? []) as ReceiptStoredRow[];
}
function cachedCosts(cache: Awaited<ReturnType<typeof readPriceAdjustmentReceiptCache>>) {
  return Object.values(cache?.receiptsByBarcode ?? {}).flat();
}
async function verifyRows(receiptId: string, rows: ReceiptStoredRow[], cache: Awaited<ReturnType<typeof readPriceAdjustmentReceiptCache>>): Promise<InternalChinaReceiptFollowupStatus> {
  const bundle = receiptFollowupBundle(receiptId, rows);
  const common = { receiptId, draftId: bundle.draftId, cycleMonth: bundle.cycleMonth, lineCount: bundle.lines.length, barcodes: bundle.lines.map((line) => line.barcode), receivedQuantity: bundle.lines.reduce((total, line) => total + line.quantity, 0) };
  let canRetry = false;
  try {
    const chosen = selectReceiptFollowupCosts(bundle, cachedCosts(cache));
    const payload = await readback(receiptId);
    const absent = missingReceiptCostRows(chosen.costs, payload);
    canRetry = absent.length > 0;
    const fingerprint = compareReceiptFollowupReadback(chosen.costs, payload);
    validateReceiptReadbackIdentity(chosen.costs, payload);
    return { ...common, state: "VERIFIED", canRetry: false, errorCode: null, verifiedAt: new Date().toISOString(), fingerprint };
  } catch (error) {
    return { ...common, state: "PENDING", canRetry, errorCode: code(error), verifiedAt: null, fingerprint: null };
  }
}
export async function loadInternalChinaReceiptFollowups(cycleMonth: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cycleMonth)) throw new Error("RECEIPT_FOLLOWUP_MONTH_INVALID");
  const client = await admin();
  const rows: ReceiptStoredRow[] = [];
  let complete = false;
  for (let offset = 0; offset < 10_000; offset += LIMIT) {
    const result = await client.from("commerce_operation_runs").select("input_snapshot,result_snapshot,started_at")
      .eq("operation_type", CHINA_ORDER_EVENT_OPERATION_TYPE).eq("source", SOURCE).eq("status", "SUCCEEDED")
      .eq("result_snapshot->>cycleMonth", cycleMonth).order("source_event_id").range(offset, offset + LIMIT - 1);
    if (result.error) throw new Error("RECEIPT_FOLLOWUP_LEDGER_READ_FAILED");
    const page = (result.data ?? []) as ReceiptStoredRow[];
    rows.push(...page);
    if (page.length < LIMIT) { complete = true; break; }
  }
  if (!complete) throw new Error("RECEIPT_FOLLOWUP_LEDGER_TRUNCATED");
  const grouped = new Map<string, ReceiptStoredRow[]>();
  for (const row of rows) {
    const id = String(receiptRecord(row.result_snapshot).receiptId ?? "");
    if (!validInternalReceiptId(id)) throw new Error("RECEIPT_FOLLOWUP_LEDGER_ID_INVALID");
    grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  if (grouped.size > 30) throw new Error("RECEIPT_FOLLOWUP_BATCH_REVIEW_REQUIRED");
  if (!grouped.size) return [] as InternalChinaReceiptFollowupStatus[];
  const cache = await readPriceAdjustmentReceiptCache();
  const entries = [...grouped.entries()];
  const result: InternalChinaReceiptFollowupStatus[] = [];
  for (let i = 0; i < entries.length; i += 3) result.push(...await Promise.all(entries.slice(i, i + 3).map(([id, values]) => verifyRows(id, values, cache))));
  return result;
}
async function pushOnlyReceiptCosts(costs: PriceAdjustmentReceipt[]) {
  if (!costs.length) return;
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error("RECEIPT_FOLLOWUP_TRACKER_CONFIG_REQUIRED");
  const stored = await readProductLaunchState(config.value, temporaryOpsIdentity().userId);
  if (!stored?.state_payload) throw new Error("RECEIPT_FOLLOWUP_TRACKER_REQUIRED");
  const byBarcode: Record<string, PriceAdjustmentReceipt[]> = {};
  for (const cost of costs) (byBarcode[cost.barcode] ??= []).push(cost);
  const built = buildCanonicalProductMasterSnapshot({ ...receiptRecord(stored.state_payload), priceAdjustmentReceiptCache: { receiptsByBarcode: byBarcode } });
  if (built.skipped.receiptWithoutSku || built.payload.receiptCosts.length !== costs.length) throw new Error("RECEIPT_FOLLOWUP_SKU_IDENTITY_REQUIRED");
  const body = receiptCostOnlyPayload(costs, built.payload.receiptCosts, await pmRead("/api/integrations/inventory-catalog"));
  const { base, secret } = connection();
  const response = await fetch(`${base}/api/integrations/internal-receipt-repair`, {
    method: "POST", headers: { "content-type": "application/json", "x-commerce-os-integration-secret": secret },
    body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || receiptRecord(payload).ok !== true) throw new Error("RECEIPT_FOLLOWUP_DELIVERY_FAILED");
}
export async function retryInternalChinaReceiptFollowup(receiptId: string) {
  const rows = await storedRows(receiptId);
  const bundle = receiptFollowupBundle(receiptId, rows);
  const currentCache = await readPriceAdjustmentReceiptCache();
  const already = await verifyRows(receiptId, rows, currentCache);
  if (already.state === "VERIFIED") return already;
  const selected = selectReceiptFollowupCosts(bundle, cachedCosts(currentCache));
  // Re-read before modifying the local cache. Never manufacture source costs
  // from today's draft when historical receipt evidence is missing.
  const absent = missingReceiptCostRows(selected.costs, await readback(receiptId));
  if (selected.missing.length) {
    if (await loadStoredInternalChinaForwarderClose(bundle.draftId)) throw new Error("RECEIPT_FOLLOWUP_FINAL_COST_SOURCE_REQUIRED");
    await mergePriceAdjustmentReceiptCachePage({ snapshotId: currentCache?.snapshotId || "ops-confirmed-receipts-live-v1", generatedAt: new Date().toISOString(), complete: currentCache?.complete ?? true, receipts: selected.missing });
  }
  const latest = selectReceiptFollowupCosts(bundle, cachedCosts(await readPriceAdjustmentReceiptCache()));
  const absentIds = new Set(absent.map((row) => row.id));
  await pushOnlyReceiptCosts(latest.costs.filter((row) => absentIds.has(row.id)));
  const status = await verifyRows(receiptId, rows, await readPriceAdjustmentReceiptCache());
  if (status.state !== "VERIFIED") throw new Error(status.errorCode || "RECEIPT_FOLLOWUP_NOT_VERIFIED");
  return status;
}
