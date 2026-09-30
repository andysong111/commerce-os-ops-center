import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  chinaOrderCommitmentCycleMonth,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import {
  loadInternalChinaMonthlyPurchaseSummary,
  loadRecentInternalChinaMonthlyPurchaseSummaries,
  type InternalChinaMonthlyPurchaseSummary,
} from "@/lib/internalChinaMonthlyPurchaseSummary";
import {
  previousCalendarMonth,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const INTERNAL_CHINA_MONTHLY_PURCHASE_CLOSE_OPERATION_TYPE =
  "INTERNAL_CHINA_MONTHLY_PURCHASE_CYCLE_CLOSE";

const LEGACY_ALIGNMENT_OPERATION_TYPE =
  "INTERNAL_CHINA_PURCHASE_ADMIN_ALIGNMENT";
const SOURCE = "ops-center-internal-china-monthly-close";
const SOURCE_SYSTEM = "fast-purchase-mvp";
const RECENT_LIMIT = 48;

export type InternalChinaMonthlyPurchaseCloseReason =
  | "CASHFLOW_LIMIT"
  | "NO_MORE_URGENT_ITEMS"
  | "OPERATOR_DECISION"
  | "OTHER";

export type InternalChinaMonthlyPurchaseCloseSource =
  | "MONTHLY_CLOSE_UI"
  | "LEGACY_ADMIN_ALIGNMENT"
  | "ACTUAL_ORDER_IMPORT";

export type InternalChinaMonthlyPurchaseCloseSummary = {
  cycleMonth: string;
  budgetMonth: string;
  budgetMonthRevenueKrw: number;
  totalSpendingBudgetKrw: number;
  recorded1688SpendKrw: number;
  unusedBudgetBeforeFinalCostsKrw: number;
  closeReasonCode: InternalChinaMonthlyPurchaseCloseReason;
  closeReason: string;
  releasedUnorderedLineCount: number;
  releasedUnorderedQuantity: number;
  purchaseCycleClosed: true;
  receiptsRemainActive: true;
  closedAt: string;
  source: InternalChinaMonthlyPurchaseCloseSource;
};

export type InternalChinaMonthlyPurchaseCloseInput = {
  cycleMonth?: unknown;
  closeReasonCode?: unknown;
  note?: unknown;
};

export type InternalChinaMonthlyPurchaseCloseResult = {
  summary: InternalChinaMonthlyPurchaseCloseSummary;
  duplicate: boolean;
};

type StoredRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validCycleMonth(value: unknown) {
  const cycleMonth = text(value);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("INTERNAL_CHINA_MONTHLY_CLOSE_CYCLE_INVALID");
  }
  return cycleMonth;
}

function validReason(value: unknown): InternalChinaMonthlyPurchaseCloseReason {
  const reason = text(value) as InternalChinaMonthlyPurchaseCloseReason;
  if (
    ![
      "CASHFLOW_LIMIT",
      "NO_MORE_URGENT_ITEMS",
      "OPERATOR_DECISION",
      "OTHER",
    ].includes(reason)
  ) {
    throw new Error("INTERNAL_CHINA_MONTHLY_CLOSE_REASON_REQUIRED");
  }
  return reason;
}

function storedReason(value: unknown): InternalChinaMonthlyPurchaseCloseReason {
  const reason = text(value) as InternalChinaMonthlyPurchaseCloseReason;
  return [
    "CASHFLOW_LIMIT",
    "NO_MORE_URGENT_ITEMS",
    "OPERATOR_DECISION",
    "OTHER",
  ].includes(reason)
    ? reason
    : "OTHER";
}

function reasonLabel(reason: InternalChinaMonthlyPurchaseCloseReason) {
  if (reason === "CASHFLOW_LIMIT") return "현금흐름 한도로 조기 마감";
  if (reason === "NO_MORE_URGENT_ITEMS") return "긴급 발주품 소진 후 마감";
  if (reason === "OPERATOR_DECISION") return "운영자 판단으로 마감";
  return "기타 사유로 마감";
}

function genericSourceEventId(cycleMonth: string) {
  return `internal-china-monthly-purchase-cycle-close:${cycleMonth}`;
}

function correlationId(cycleMonth: string) {
  return `internal-china-monthly-purchase:${cycleMonth}`;
}

function parseGeneric(row: StoredRow | undefined) {
  const snapshot = object(row?.result_snapshot);
  const cycleMonth = text(snapshot.cycleMonth);
  const budgetMonth = text(snapshot.budgetMonth);
  const closedAt =
    iso(snapshot.closedAt) || iso(row?.updated_at) || iso(row?.started_at);
  if (
    !/^\d{4}-\d{2}$/.test(cycleMonth) ||
    !/^\d{4}-\d{2}$/.test(budgetMonth) ||
    !closedAt ||
    snapshot.purchaseCycleClosed !== true
  ) {
    return null;
  }
  const closeReasonCode = storedReason(
    snapshot.closeReasonCode || "OPERATOR_DECISION",
  );
  return {
    cycleMonth,
    budgetMonth,
    budgetMonthRevenueKrw: integer(snapshot.budgetMonthRevenueKrw),
    totalSpendingBudgetKrw: integer(snapshot.totalSpendingBudgetKrw),
    recorded1688SpendKrw: integer(snapshot.recorded1688SpendKrw),
    unusedBudgetBeforeFinalCostsKrw: integer(
      snapshot.unusedBudgetBeforeFinalCostsKrw,
    ),
    closeReasonCode,
    closeReason: text(snapshot.closeReason) || reasonLabel(closeReasonCode),
    releasedUnorderedLineCount: integer(snapshot.releasedUnorderedLineCount),
    releasedUnorderedQuantity: integer(snapshot.releasedUnorderedQuantity),
    purchaseCycleClosed: true as const,
    receiptsRemainActive: true as const,
    closedAt,
    source: "MONTHLY_CLOSE_UI" as const,
  };
}

function parseLegacyCandidate(row: StoredRow) {
  const input = object(row.input_snapshot);
  const result = object(row.result_snapshot);
  const cycleMonth = text(input.cycleMonth || result.cycleMonth);
  const closedAt =
    iso(result.closedAt) || iso(row.updated_at) || iso(row.started_at);
  const purchaseCycleClosed =
    result.purchaseCycleClosed === true || input.purchaseCycleClosed === true;
  if (
    !/^\d{4}-\d{2}$/.test(cycleMonth) ||
    !closedAt ||
    !purchaseCycleClosed
  ) {
    return null;
  }
  const action = text(input.action || result.action);
  if (action && action !== "CASHFLOW_EARLY_CLOSE") return null;
  return {
    cycleMonth,
    closedAt,
    reason:
      text(input.reason || result.reason) || "현금흐름 한도로 조기 마감",
    recorded1688SpendKrw: integer(
      input.actualOrderPaidKrwAtInternalFx ||
        result.actualOrderPaidKrwAtInternalFx,
    ),
  };
}

async function adminClient() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return admin;
}

async function readGeneric(cycleMonth: string) {
  const admin = await adminClient();
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at,updated_at")
    .eq("operation_type", INTERNAL_CHINA_MONTHLY_PURCHASE_CLOSE_OPERATION_TYPE)
    .eq("source_event_id", genericSourceEventId(cycleMonth))
    .eq("status", "SUCCEEDED")
    .maybeSingle();
  if (result.error) {
    throw new Error(
      `INTERNAL_CHINA_MONTHLY_CLOSE_READ_FAILED:${result.error.message}`,
    );
  }
  return parseGeneric(result.data as StoredRow | undefined);
}

async function readLegacyCandidates(limit = RECENT_LIMIT) {
  const admin = await adminClient();
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at,updated_at")
    .eq("operation_type", LEGACY_ALIGNMENT_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (result.error) {
    throw new Error(
      `INTERNAL_CHINA_MONTHLY_CLOSE_LEGACY_READ_FAILED:${result.error.message}`,
    );
  }
  return ((result.data ?? []) as StoredRow[])
    .map(parseLegacyCandidate)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

async function budgetFor(cycleMonth: string) {
  const budgetMonth = previousCalendarMonth(cycleMonth);
  const revenue = await loadCalendarMonthNormalRevenue(budgetMonth);
  const budgetMonthRevenueKrw = integer(revenue.revenueKrw);
  const totalSpendingBudgetKrw = integer(budgetMonthRevenueKrw / 2);
  return { budgetMonth, budgetMonthRevenueKrw, totalSpendingBudgetKrw };
}

async function enrichLegacy(
  legacy: NonNullable<ReturnType<typeof parseLegacyCandidate>>,
): Promise<InternalChinaMonthlyPurchaseCloseSummary> {
  const [budget, purchase] = await Promise.all([
    budgetFor(legacy.cycleMonth),
    loadInternalChinaMonthlyPurchaseSummary(legacy.cycleMonth).catch(() => null),
  ]);
  const recorded1688SpendKrw =
    legacy.recorded1688SpendKrw ||
    purchase?.actualOrderPaidKrwAtInternalFx ||
    0;
  return {
    cycleMonth: legacy.cycleMonth,
    budgetMonth: budget.budgetMonth,
    budgetMonthRevenueKrw: budget.budgetMonthRevenueKrw,
    totalSpendingBudgetKrw: budget.totalSpendingBudgetKrw,
    recorded1688SpendKrw,
    unusedBudgetBeforeFinalCostsKrw: Math.max(
      0,
      budget.totalSpendingBudgetKrw - recorded1688SpendKrw,
    ),
    closeReasonCode: "CASHFLOW_LIMIT",
    closeReason: legacy.reason,
    releasedUnorderedLineCount: 0,
    releasedUnorderedQuantity: 0,
    purchaseCycleClosed: true,
    receiptsRemainActive: true,
    closedAt: legacy.closedAt,
    source: "LEGACY_ADMIN_ALIGNMENT",
  };
}

async function enrichActualOrderClose(
  purchase: InternalChinaMonthlyPurchaseSummary,
): Promise<InternalChinaMonthlyPurchaseCloseSummary> {
  const budget = await budgetFor(purchase.cycleMonth);
  const recorded1688SpendKrw = purchase.actualOrderPaidKrwAtInternalFx;
  return {
    cycleMonth: purchase.cycleMonth,
    budgetMonth: budget.budgetMonth,
    budgetMonthRevenueKrw: budget.budgetMonthRevenueKrw,
    totalSpendingBudgetKrw: budget.totalSpendingBudgetKrw,
    recorded1688SpendKrw,
    unusedBudgetBeforeFinalCostsKrw: Math.max(
      0,
      budget.totalSpendingBudgetKrw - recorded1688SpendKrw,
    ),
    closeReasonCode: "CASHFLOW_LIMIT",
    closeReason:
      "1688 실제 주문 가져오기에서 현금흐름 사유로 추가 발주 종료",
    releasedUnorderedLineCount: 0,
    releasedUnorderedQuantity: 0,
    purchaseCycleClosed: true,
    receiptsRemainActive: true,
    closedAt: purchase.latestRecordedAt || new Date().toISOString(),
    source: "ACTUAL_ORDER_IMPORT",
  };
}

export async function loadInternalChinaMonthlyPurchaseClose(
  cycleMonthInput: unknown,
): Promise<InternalChinaMonthlyPurchaseCloseSummary | null> {
  const cycleMonth = validCycleMonth(cycleMonthInput);
  const generic = await readGeneric(cycleMonth);
  if (generic) return generic;
  const legacy = (await readLegacyCandidates()).find(
    (row) => row.cycleMonth === cycleMonth,
  );
  if (legacy) return enrichLegacy(legacy);
  const purchase = await loadInternalChinaMonthlyPurchaseSummary(cycleMonth).catch(
    () => null,
  );
  return purchase?.cashFlowEarlyClose
    ? enrichActualOrderClose(purchase)
    : null;
}

export async function assertInternalChinaMonthlyPurchaseOpen(
  cycleMonthInput: unknown,
) {
  const cycleMonth = validCycleMonth(cycleMonthInput);
  const stored = await loadInternalChinaMonthlyPurchaseClose(cycleMonth);
  if (stored) {
    throw new Error(`INTERNAL_CHINA_MONTHLY_CLOSE_LOCKED:${cycleMonth}`);
  }
  return cycleMonth;
}

export async function loadRecentInternalChinaMonthlyPurchaseCloses(
  limitInput: unknown = 12,
): Promise<InternalChinaMonthlyPurchaseCloseSummary[]> {
  const parsedLimit = Math.round(Number(limitInput));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(24, Math.max(1, parsedLimit))
    : 12;
  const admin = await adminClient();
  const [genericResult, legacyRows, purchaseRows] = await Promise.all([
    admin
      .from("commerce_operation_runs")
      .select(
        "source_event_id,input_snapshot,result_snapshot,started_at,updated_at",
      )
      .eq("operation_type", INTERNAL_CHINA_MONTHLY_PURCHASE_CLOSE_OPERATION_TYPE)
      .eq("status", "SUCCEEDED")
      .order("started_at", { ascending: false })
      .limit(limit),
    readLegacyCandidates(limit),
    loadRecentInternalChinaMonthlyPurchaseSummaries(limit).catch(() => []),
  ]);
  if (genericResult.error) {
    throw new Error(
      `INTERNAL_CHINA_MONTHLY_CLOSE_RECENT_READ_FAILED:${genericResult.error.message}`,
    );
  }
  const generic = ((genericResult.data ?? []) as StoredRow[])
    .map(parseGeneric)
    .filter(
      (row): row is NonNullable<ReturnType<typeof parseGeneric>> => row !== null,
    );
  const byMonth = new Map<string, InternalChinaMonthlyPurchaseCloseSummary>();
  for (const row of generic) byMonth.set(row.cycleMonth, row);

  for (const legacyRow of legacyRows) {
    if (byMonth.has(legacyRow.cycleMonth)) continue;
    byMonth.set(legacyRow.cycleMonth, await enrichLegacy(legacyRow));
  }
  for (const purchase of purchaseRows) {
    if (!purchase.cashFlowEarlyClose || byMonth.has(purchase.cycleMonth)) {
      continue;
    }
    byMonth.set(
      purchase.cycleMonth,
      await enrichActualOrderClose(purchase),
    );
  }

  return [...byMonth.values()]
    .sort((left, right) => right.cycleMonth.localeCompare(left.cycleMonth))
    .slice(0, limit);
}

function cancellationOperation(
  row: Awaited<ReturnType<typeof loadChinaOrderLedger>>["commitments"][number],
  cycleMonth: string,
  occurredAt: string,
) {
  const event = normalizeChinaOrderCommitmentEvent({
    sourceSystem: row.sourceSystem,
    sourceLineId: row.sourceLineId,
    sourceRunId: row.sourceRunId,
    sourceEventId: `${row.sourceRunId}:${row.barcode}:monthly-close:${cycleMonth}`,
    barcode: row.barcode,
    status: "CANCELLED",
    cancelledQuantity: Math.max(
      0,
      row.committedQuantity - row.receivedQuantity,
    ),
    occurredAt,
    note: `${cycleMonth} 발주 사이클을 남은 예산 미사용 상태로 마감하여 미주문 약정을 해제했습니다.`,
    payload: {
      cycleMonth,
      monthlyPurchaseCycleClose: true,
      receiptsRemainActive: true,
      externalOrderExecuted: false,
    },
  });
  return {
    operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
    status: "SUCCEEDED",
    source: SOURCE_SYSTEM,
    source_event_id: `china-order:${encodeURIComponent(
      event.sourceSystem,
    )}:${encodeURIComponent(event.sourceEventId)}`,
    correlation_id: `china-order-line:${encodeURIComponent(
      event.sourceSystem,
    )}:${encodeURIComponent(event.sourceLineId)}`,
    actor_type: "OPS_OPERATOR",
    input_snapshot: event,
    result_snapshot: {
      accepted: true,
      monthlyPurchaseCycleClose: true,
      cycleMonth,
      draftId: event.sourceRunId,
      barcode: event.barcode,
      cancelledQuantity: event.cancelledQuantity,
      externalOrderExecuted: false,
    },
    error_message: null,
    started_at: occurredAt,
    finished_at: occurredAt,
    updated_at: occurredAt,
  };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export async function recordInternalChinaMonthlyPurchaseClose(
  input: InternalChinaMonthlyPurchaseCloseInput,
): Promise<InternalChinaMonthlyPurchaseCloseResult> {
  const cycleMonth = validCycleMonth(input.cycleMonth);
  if (cycleMonth !== seoulCalendarMonth(new Date())) {
    throw new Error("INTERNAL_CHINA_MONTHLY_CLOSE_CURRENT_ONLY");
  }
  const closeReasonCode = validReason(input.closeReasonCode);
  const note = text(input.note).slice(0, 500);
  const existing = await loadInternalChinaMonthlyPurchaseClose(cycleMonth);
  if (existing) return { summary: existing, duplicate: true };

  const [budget, purchase, ledger] = await Promise.all([
    budgetFor(cycleMonth),
    loadInternalChinaMonthlyPurchaseSummary(cycleMonth).catch(() => null),
    loadChinaOrderLedger(),
  ]);
  if (ledger.error) {
    throw new Error(
      `INTERNAL_CHINA_MONTHLY_CLOSE_LEDGER_UNAVAILABLE:${ledger.error}`,
    );
  }
  if (budget.totalSpendingBudgetKrw <= 0) {
    throw new Error("INTERNAL_CHINA_MONTHLY_CLOSE_BUDGET_UNAVAILABLE");
  }

  const cycleRows = ledger.commitments.filter(
    (row) =>
      row.sourceSystem === SOURCE_SYSTEM &&
      chinaOrderCommitmentCycleMonth(row) === cycleMonth,
  );
  const releasableRows = cycleRows.filter(
    (row) =>
      row.openQuantity > 0 &&
      row.orderedQuantity <= 0 &&
      row.receivedQuantity <= 0 &&
      (row.status === "RESERVED" || row.status === "EXPORTED"),
  );
  const releasedUnorderedQuantity = releasableRows.reduce(
    (sum, row) => sum + row.openQuantity,
    0,
  );
  const recorded1688SpendKrw =
    purchase?.actualOrderPaidKrwAtInternalFx ?? 0;
  const closedAt = new Date().toISOString();
  const closeReason = [reasonLabel(closeReasonCode), note]
    .filter(Boolean)
    .join(" · ");
  const summary: InternalChinaMonthlyPurchaseCloseSummary = {
    cycleMonth,
    budgetMonth: budget.budgetMonth,
    budgetMonthRevenueKrw: budget.budgetMonthRevenueKrw,
    totalSpendingBudgetKrw: budget.totalSpendingBudgetKrw,
    recorded1688SpendKrw,
    unusedBudgetBeforeFinalCostsKrw: Math.max(
      0,
      budget.totalSpendingBudgetKrw - recorded1688SpendKrw,
    ),
    closeReasonCode,
    closeReason,
    releasedUnorderedLineCount: releasableRows.length,
    releasedUnorderedQuantity,
    purchaseCycleClosed: true,
    receiptsRemainActive: true,
    closedAt,
    source: "MONTHLY_CLOSE_UI",
  };

  const closeOperation = {
    operation_type: INTERNAL_CHINA_MONTHLY_PURCHASE_CLOSE_OPERATION_TYPE,
    status: "SUCCEEDED",
    source: SOURCE,
    source_event_id: genericSourceEventId(cycleMonth),
    correlation_id: correlationId(cycleMonth),
    actor_type: "OPS_OPERATOR",
    input_snapshot: {
      cycleMonth,
      closeReasonCode,
      note,
    },
    result_snapshot: summary,
    error_message: null,
    started_at: closedAt,
    finished_at: closedAt,
    updated_at: closedAt,
  };
  const operations = [
    closeOperation,
    ...releasableRows.map((row) =>
      cancellationOperation(row, cycleMonth, closedAt),
    ),
  ];

  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_MONTHLY_CLOSE_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }

  const stored = await loadInternalChinaMonthlyPurchaseClose(cycleMonth);
  if (!stored) throw new Error("INTERNAL_CHINA_MONTHLY_CLOSE_VERIFY_FAILED");
  return { summary: stored, duplicate: false };
}
