import { createHash } from "node:crypto";
import { previousCalendarMonth, seoulCalendarMonth } from "./monthlyPurchasePolicy.ts";

const DEFAULT_STORAGE_BASE_URL = "https://storage-organization.vercel.app";
const STORAGE_PATH = "/api/sourcing-intake";
const TIMEOUT_MS = 30_000;
const BUDGET_POLICY_VERSION = "spending-ratio-auto-revenue-v2";
const RATE_BPS = 1200;
const MAX_BPS = 1500;
const ITEM_CAP = 20;

type RevenueSnapshot = {
  month: string;
  revenueKrw: number;
  frozenAt: string | null;
  fetchedRows: number;
  chunkCount: number;
  cached: boolean;
};

type RevenueLoader = (month: string) => Promise<RevenueSnapshot>;

export type StorageSourcingBudgetSyncReceipt = {
  ok: true;
  action: "sync_previous_month_revenue";
  requestId: string;
  budgetMonth: string;
  sourceMonth: string;
  revenueKrw: number;
  availableSpendWon: number;
  allocationBps: number;
  maximumBps: number;
  monthlyBudgetWon: number;
  monthlyItemCap: number;
  version: number;
  budgetPolicyVersion: string;
  changed: boolean;
};

type Dependencies = {
  now?: Date;
  revenueLoader?: RevenueLoader;
  transport?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export class StorageSourcingBudgetSyncError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "StorageSourcingBudgetSyncError";
    this.code = code;
    this.status = status;
  }
}

function safeBaseUrl(env: NodeJS.ProcessEnv) {
  const raw = env.STORAGE_ORGANIZATION_BASE_URL?.trim() || DEFAULT_STORAGE_BASE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
    return parsed.origin;
  } catch {
    throw new StorageSourcingBudgetSyncError(
      "STORAGE_SOURCING_BASE_URL_INVALID",
      "창고 소싱예산 동기화 주소가 올바르지 않습니다.",
      503,
    );
  }
}

function integrationSecret(env: NodeJS.ProcessEnv) {
  return (
    env.STORAGE_INTEGRATION_SECRET?.trim() ||
    env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim() ||
    ""
  );
}

function deterministicUuid(value: string) {
  const chars = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function expectedAvailable(revenueKrw: number) {
  return Math.round(revenueKrw / 2);
}

function expectedBudget(availableWon: number) {
  return Math.floor((availableWon * RATE_BPS) / 10_000);
}

function parseFrozen(value: string | null) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new StorageSourcingBudgetSyncError(
      "SHOPLING_CLOSED_MONTH_EVIDENCE_MISSING",
      "전월 샵플링 매출의 고정 시각을 확인할 수 없습니다.",
      503,
    );
  }
  return new Date(parsed).toISOString();
}

async function rawRevenueLoader(month: string): Promise<RevenueSnapshot> {
  const { loadCalendarMonthNormalRevenue } = await import("./shopling/calendarMonthRevenue.ts");
  return loadCalendarMonthNormalRevenue(month);
}

/**
 * A newly computed Shopling value is not authoritative until the OPS ledger can read it back.
 * The first loader call may compute and attempt persistence; the second call must return cached=true.
 * If persistence/admin access failed, no Storage budget is allowed to be created from that value.
 */
export async function loadDurablyFrozenRevenue(
  month: string,
  loader: RevenueLoader = rawRevenueLoader,
): Promise<RevenueSnapshot> {
  const first = await loader(month);
  if (first.cached === true) return first;
  const persisted = await loader(month);
  if (persisted.cached !== true) {
    throw new StorageSourcingBudgetSyncError(
      "SHOPLING_CLOSED_MONTH_NOT_DURABLY_FROZEN",
      "전월 샵플링 매출이 OPS 원장에 저장되었는지 확인할 수 없어 소싱예산 동기화를 중지했습니다.",
      503,
    );
  }
  return persisted;
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function syncPreviousMonthRevenueToStorage({
  now = new Date(),
  revenueLoader = rawRevenueLoader,
  transport = fetch,
  env = process.env,
}: Dependencies = {}): Promise<StorageSourcingBudgetSyncReceipt> {
  const secret = integrationSecret(env);
  if (secret.length < 24) {
    throw new StorageSourcingBudgetSyncError(
      "STORAGE_SOURCING_INTEGRATION_NOT_CONFIGURED",
      "창고 소싱예산 서버 연동 비밀키가 설정되지 않았습니다.",
      503,
    );
  }
  const budgetMonth = seoulCalendarMonth(now);
  const sourceMonth = previousCalendarMonth(budgetMonth);
  const revenue = await loadDurablyFrozenRevenue(sourceMonth, revenueLoader);
  if (
    revenue.cached !== true ||
    revenue.month !== sourceMonth ||
    !Number.isSafeInteger(revenue.revenueKrw) ||
    revenue.revenueKrw < 0
  ) {
    throw new StorageSourcingBudgetSyncError(
      "SHOPLING_CLOSED_MONTH_REVENUE_INVALID",
      "전월 샵플링 매출 스냅샷이 현재 예산 기준월과 일치하지 않습니다.",
      503,
    );
  }
  const frozenAt = parseFrozen(revenue.frozenAt);
  const sourceEventId = `shopling-calendar-month-revenue:${sourceMonth}`;
  const stable = {
    action: "sync_previous_month_revenue",
    budgetMonth,
    sourceMonth,
    revenueKrw: revenue.revenueKrw,
    sourceEventId,
    sourceFrozenAt: frozenAt,
    sourceFetchedRows: revenue.fetchedRows,
    sourceChunkCount: revenue.chunkCount,
    sourceCached: true,
  } as const;
  // Retry identity is based only on the immutable canonical source event. Access-state metadata
  // (fresh/cached, fetch time) must never create a second request after a timeout-after-commit.
  const requestId = deterministicUuid(`storage-sourcing-budget:${sourceEventId}`);
  const body = { ...stable, requestId };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  let result: unknown;
  try {
    response = await transport(`${safeBaseUrl(env)}${STORAGE_PATH}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    try {
      result = await response.json();
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) {
        throw new StorageSourcingBudgetSyncError(
          "STORAGE_SOURCING_SYNC_TIMEOUT",
          "창고 소싱예산 동기화 응답 시간이 초과되었습니다.",
          504,
        );
      }
      throw new StorageSourcingBudgetSyncError(
        "STORAGE_SOURCING_SYNC_INVALID_RESPONSE",
        "창고 소싱예산 응답 형식을 확인할 수 없습니다.",
        502,
      );
    }
  } catch (error) {
    if (error instanceof StorageSourcingBudgetSyncError) throw error;
    if (isAbort(error) || controller.signal.aborted) {
      throw new StorageSourcingBudgetSyncError(
        "STORAGE_SOURCING_SYNC_TIMEOUT",
        "창고 소싱예산 동기화 응답 시간이 초과되었습니다.",
        504,
      );
    }
    throw new StorageSourcingBudgetSyncError(
      "STORAGE_SOURCING_SYNC_UNREACHABLE",
      "창고 소싱예산 서비스에 연결하지 못했습니다.",
      502,
    );
  } finally {
    // Keep the deadline active through response.json(), not just response headers.
    clearTimeout(timeout);
  }
  if (!response.ok || !result || typeof result !== "object") {
    const value = result as { error?: unknown; message?: unknown } | null;
    throw new StorageSourcingBudgetSyncError(
      String(value?.error || "STORAGE_SOURCING_SYNC_FAILED"),
      String(value?.message || "창고 소싱예산 동기화에 실패했습니다."),
      response.status || 502,
    );
  }
  const receipt = result as Partial<StorageSourcingBudgetSyncReceipt>;
  const availableSpendWon = expectedAvailable(revenue.revenueKrw);
  const monthlyBudgetWon = expectedBudget(availableSpendWon);
  if (
    receipt.ok !== true ||
    receipt.action !== "sync_previous_month_revenue" ||
    receipt.requestId !== requestId ||
    receipt.budgetMonth !== budgetMonth ||
    receipt.sourceMonth !== sourceMonth ||
    receipt.revenueKrw !== revenue.revenueKrw ||
    receipt.availableSpendWon !== availableSpendWon ||
    receipt.allocationBps !== RATE_BPS ||
    receipt.maximumBps !== MAX_BPS ||
    receipt.monthlyBudgetWon !== monthlyBudgetWon ||
    receipt.monthlyItemCap !== ITEM_CAP ||
    receipt.budgetPolicyVersion !== BUDGET_POLICY_VERSION ||
    !Number.isSafeInteger(receipt.version) ||
    typeof receipt.changed !== "boolean"
  ) {
    throw new StorageSourcingBudgetSyncError(
      "STORAGE_SOURCING_SYNC_ACK_MISMATCH",
      "창고가 저장한 전월매출·예산 계산 결과를 검증하지 못했습니다.",
      502,
    );
  }
  return receipt as StorageSourcingBudgetSyncReceipt;
}
