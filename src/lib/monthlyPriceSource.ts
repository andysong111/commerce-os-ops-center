import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { InternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { applyInternalChinaActualPurchaseCosts, applyInternalChinaQuantityOverrides, type InternalChinaQuantityOverride } from "@/lib/internalChinaDraftQuantityOverride";
import { buildInternalChinaMonthlyPurchaseSummaryFromRows } from "@/lib/internalChinaMonthlyPurchaseSummary";
import { buildInternalChinaForwarderCostSummaryFromDraft } from "@/lib/internalChinaForwarderCost";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadShoplingProductGroupsByGoodsKey } from "@/lib/shopling/shoplingProductGroupRegistry";
import { monthlyCostsFromEvidence, monthlyHash, monthlyRecord, monthlyMonth, monthlyProtectedCosts, MONTHLY_PRICE_POLICY, type MonthlyCost, type MonthlyPriceCandidate } from "@/lib/monthlyPriceCore";

export type MonthlyPriceSources = { month: string; sourceHash: string; candidates: MonthlyPriceCandidate[]; costs: MonthlyCost[]; warnings: string[]; scope: string[]; evidenceVersion: string };
const LIMIT = 500;
async function allOperations(operation: string, source?: string) {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("MONTHLY_PRICE_DATABASE_REQUIRED");
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 10000; offset += LIMIT) {
    let query = db.from("commerce_operation_runs").select("source_event_id,input_snapshot,result_snapshot,started_at,updated_at")
      .eq("operation_type", operation).eq("status", "SUCCEEDED").order("source_event_id").range(offset, offset + LIMIT - 1);
    if (source) query = query.eq("source", source);
    const result = await query;
    if (result.error) throw new Error("MONTHLY_PRICE_SOURCE_READ_FAILED");
    if (!Array.isArray(result.data)) throw new Error("MONTHLY_PRICE_SOURCE_SHAPE_INVALID");
    rows.push(...result.data.map(monthlyRecord));
    if (result.data.length < LIMIT) return rows;
  }
  throw new Error("MONTHLY_PRICE_SOURCE_TRUNCATED");
}
export async function loadMonthlyPriceSources(monthInput: unknown): Promise<MonthlyPriceSources> {
  const month = monthlyMonth(monthInput);
  const [receipts, closes, preps, overrides, planning] = await Promise.all([
    allOperations("CHINA_ORDER_COMMITMENT_EVENT", "ops-center-internal-china-receipt"),
    allOperations("INTERNAL_CHINA_FORWARDER_COST_CLOSE"),
    allOperations("INTERNAL_CHINA_PURCHASE_PREP"),
    allOperations("INTERNAL_CHINA_PURCHASE_QUANTITY_OVERRIDE"),
    loadProductPlanningSnapshot(),
  ]);
  const currentReceipts = receipts.filter((row) => monthlyRecord(row.result_snapshot).cycleMonth === month);
  if (!currentReceipts.length) throw new Error("MONTHLY_PRICE_RECEIPT_REQUIRED");
  const scope = [...new Set(currentReceipts.map((row) => String(monthlyRecord(row.result_snapshot).barcode ?? "")))].sort();
  const scopeSet = new Set(scope);
  const currentCosts: MonthlyCost[] = [], history: MonthlyCost[] = [];
  const invalidCurrent = new Set<string>();
  const warnings: string[] = [];
  const sourceProofs: unknown[] = [];
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of receipts) {
    const r = monthlyRecord(row.result_snapshot);
    const id = String(r.draftId ?? "");
    grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  // Historical maxima use confirmed evidence, never raw sales or inferred inventory.
  for (const [draftId, rows] of grouped) {
    const relevant = rows.some((row) => scopeSet.has(String(monthlyRecord(row.result_snapshot).barcode)));
    if (!relevant) continue;
    const monthOfDraft = String(monthlyRecord(rows[0].result_snapshot).cycleMonth);
    if (monthOfDraft > month) continue;
    const closeRows = closes.filter((row) => monthlyRecord(row.result_snapshot).draftId === draftId);
    if (closeRows.length !== 1) { warnings.push(`${draftId}:MONTHLY_PRICE_FINAL_COST_REQUIRED`); if (monthOfDraft === month) rows.forEach((row) => invalidCurrent.add(String(monthlyRecord(row.result_snapshot).barcode))); continue; }
    const storedClose = monthlyRecord(closeRows[0].result_snapshot);
    try {
      const saved = preps.filter((row) => monthlyRecord(monthlyRecord(row.result_snapshot).snapshot).draftId === draftId);
      if (saved.length !== 1) throw new Error("MONTHLY_PRICE_SAVED_DRAFT_REQUIRED");
      const snapshot = monthlyRecord(monthlyRecord(saved[0].result_snapshot).snapshot);
      const overrideMap = new Map<string, InternalChinaQuantityOverride>();
      for (const raw of [...overrides].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))) {
        const o = monthlyRecord(raw.input_snapshot);
        if (o.draftId === draftId && !overrideMap.has(String(o.barcode))) overrideMap.set(String(o.barcode), { barcode: String(o.barcode), targetQuantity: Number(o.targetQuantity), savedAt: String(o.savedAt ?? raw.started_at) });
      }
      const draft = applyInternalChinaActualPurchaseCosts(applyInternalChinaQuantityOverrides({ ...snapshot, savedAt: String(saved[0].updated_at || snapshot.savedAt) } as InternalChinaPurchaseDraft, overrideMap), buildInternalChinaMonthlyPurchaseSummaryFromRows(preps, monthOfDraft));
      const storedActualCostKrw = Number(storedClose.actualCostKrw);
      const storedClosedAt = String(storedClose.closedAt ?? "");
      if (!Number.isSafeInteger(storedActualCostKrw) || storedActualCostKrw <= 0 || !Number.isFinite(Date.parse(storedClosedAt))) {
        throw new Error("MONTHLY_PRICE_FINAL_COST_REQUIRED");
      }
      const close = buildInternalChinaForwarderCostSummaryFromDraft(
        draft,
        monthOfDraft,
        storedActualCostKrw,
        storedClosedAt,
      );
      if (
        Number(storedClose.productPurchaseCostKrw) !== close.productPurchaseCostKrw ||
        Number(storedClose.domesticChinaFreightKrw) !== close.domesticChinaFreightKrw ||
        Number(storedClose.actualTotalOutflowKrw) !== close.actualTotalOutflowKrw ||
        Number(storedClose.actualMultiplier) !== close.actualMultiplier
      ) {
        warnings.push(`${draftId}:MONTHLY_PRICE_LEGACY_CLOSE_REBASED`);
      }
      const costs = monthlyCostsFromEvidence({ draft, close, receiptRows: rows });
      sourceProofs.push({ draftId, storedClose, effectiveClose: close, draft, receiptRows: rows.map((row) => ({ input: row.input_snapshot, result: row.result_snapshot })) });
      history.push(...costs);
      if (monthOfDraft === month) currentCosts.push(...costs);
    } catch (error) {
      const message = error instanceof Error ? error.message.split(":", 1)[0] : "MONTHLY_PRICE_COST_UNVERIFIED";
      warnings.push(`${draftId}:${message}`);
      if (monthOfDraft === month) rows.forEach((row) => invalidCurrent.add(String(monthlyRecord(row.result_snapshot).barcode)));
    }
  }
  const current = scope.flatMap((barcode) => {
    if (invalidCurrent.has(barcode)) return [];
    const choices = currentCosts.filter((row) => row.barcode === barcode);
    if (!choices.length) return [];
    // Multiple receipts in the selected month: take the highest confirmed cost,
    // not an invented weighted average of unknown old and known new stock.
    return [choices.reduce((a, b) => a.unitCostKrw >= b.unitCostKrw ? a : b)];
  });
  const costsByCode = new Map(current.map((row) => [row.barcode, row]));
  const protectedCosts = monthlyProtectedCosts(current, history);
  const products = planning.products.filter((product) => product.skuActive !== false);
  const keys = [...new Set(products.filter((p) => scopeSet.has(p.barcode)).flatMap((p) => (p.listings ?? []).filter((l) => l.active !== false).map((l) => String(l.goodsKey ?? ""))).filter((key) => /^\d{5,9}$/.test(key)))].sort();
  const groups = await loadShoplingProductGroupsByGoodsKey(keys);
  const candidates: MonthlyPriceCandidate[] = keys.map((goodsKey) => {
    const owners = products.flatMap((product) => (product.listings ?? []).filter((listing) => listing.active !== false && String(listing.goodsKey) === goodsKey).map((listing) => ({ product, listing })));
    let reason: string | null = null;
    if (owners.some(({ product }) => !scopeSet.has(product.barcode))) reason = "MONTHLY_PRICE_SHARED_GOODSKEY_OUTSIDE_MONTH";
    else if (owners.some(({ product }) => !costsByCode.has(product.barcode))) reason = "MONTHLY_PRICE_CONFIRMED_COST_REQUIRED";
    else if (owners.some(({ listing }) => !Number.isSafeInteger(Number(listing.unitsPerOrder)) || Number(listing.unitsPerOrder) < 1)) reason = "MONTHLY_PRICE_UNITS_PER_ORDER_REQUIRED";
    return { goodsKey, productName: owners[0]?.product.productName || goodsKey, productGroup: groups.get(goodsKey) ?? "",
      inventoryCostBasis: reason === "MONTHLY_PRICE_CONFIRMED_COST_REQUIRED" ? "UNKNOWN_COST" : "LEGACY_MIXED_UNRESOLVED",
      options: owners.map(({ product, listing }) => ({ barcode: product.barcode, optionId: String(listing.optionId ?? ""), productName: product.productName || product.barcode, unitsPerOrder: Number(listing.unitsPerOrder), currentCostKrw: costsByCode.get(product.barcode)?.unitCostKrw ?? 0, protectedCostKrw: protectedCosts.get(product.barcode) ?? 0 })), reason };
  });
  for (const code of scope) {
    if (candidates.some((row) => row.options.some((opt) => opt.barcode === code))) continue;
    candidates.push({ goodsKey: `UNRESOLVED:${code}`, productName: code, productGroup: "", inventoryCostBasis: "UNKNOWN_COST", options: [{ barcode: code, optionId: "", productName: code, unitsPerOrder: 0, currentCostKrw: costsByCode.get(code)?.unitCostKrw ?? 0, protectedCostKrw: protectedCosts.get(code) ?? 0 }], reason: "MONTHLY_PRICE_LISTING_MAPPING_REQUIRED" });
  }
  candidates.sort((a, b) => a.goodsKey.localeCompare(b.goodsKey));
  const evidenceVersion = evidenceHash([receipts, closes, preps, overrides]);
  return { month, evidenceVersion, sourceHash: monthlyHash({ policy: MONTHLY_PRICE_POLICY, month, evidenceVersion, candidates, sourceProofs, warnings: [...warnings].sort() }), candidates, costs: current, warnings, scope };
}

function evidenceHash(groups: Record<string, unknown>[][]) {
  return monthlyHash(groups.map((rows) => rows.map((row) => ({ id: row.source_event_id, input: row.input_snapshot, result: row.result_snapshot })).sort((a, b) => String(a.id).localeCompare(String(b.id)))));
}
export async function assertMonthlyEvidenceUnchanged(expected: string) {
  const groups = await Promise.all([
    allOperations("CHINA_ORDER_COMMITMENT_EVENT", "ops-center-internal-china-receipt"),
    allOperations("INTERNAL_CHINA_FORWARDER_COST_CLOSE"),
    allOperations("INTERNAL_CHINA_PURCHASE_PREP"),
    allOperations("INTERNAL_CHINA_PURCHASE_QUANTITY_OVERRIDE"),
  ]);
  if (evidenceHash(groups) !== expected) throw new Error("MONTHLY_PRICE_SOURCE_CHANGED");
}
