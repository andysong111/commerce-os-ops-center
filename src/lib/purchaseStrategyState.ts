import { createHash, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
  MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
  MONTHLY_REVENUE_THRESHOLD_STEP_KRW,
} from "@/lib/productDecisionEngine/purchaseStrategyPolicy";

export const PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE =
  "PURCHASE_STRATEGY_CONFIG_EVENT";
export const PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE =
  "PURCHASE_STRATEGY_PRODUCT_STATUS_EVENT";
export const PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION = 1;
export const PURCHASE_STRATEGY_READ_LIMIT = 1_000;
export const PURCHASE_STRATEGY_MAX_EVENT_ROWS = 20_000;

const SOURCE = "ops-center-purchase-strategy";
const BARCODE_PATTERN = /^B[A-Z]{2}\d+-\d+$/;
const CONFIG_REQUEST_KEYS = [
  "monthlyRevenueThresholdKrw",
  "newProductProtectionDays",
  "baseCoverMonths",
  "risingCoverMonths",
  "automaticMaxCoverMonths",
  "manualHeroMaxCoverMonths",
] as const;

export type PurchaseStrategyConfig = {
  version: number;
  monthlyRevenueThresholdKrw: number;
  newProductProtectionDays: number;
  baseCoverMonths: number;
  risingCoverMonths: {
    weak: number;
    medium: number;
    strong: number;
  };
  automaticMaxCoverMonths: number;
  manualHeroMaxCoverMonths: number;
};

export type PurchaseStrategyProductStatus = "ACTIVE" | "DISCONTINUED";

export type PurchaseStrategyProductState = {
  barcode: string;
  status: PurchaseStrategyProductStatus;
  discontinuedReason: string | null;
  discontinuedAt: string | null;
  discontinuedBy: string | null;
  restoredAt: string | null;
  restoredBy: string | null;
  restoreReason: string | null;
  updatedAt: string;
};

export type PurchaseStrategyConfigEvent = {
  schemaVersion: 1;
  action: "UPDATE_CONFIG";
  actor: string;
  occurredAt: string;
  config: PurchaseStrategyConfig;
};

export type PurchaseStrategyProductEvent = {
  schemaVersion: 1;
  action: "DISCONTINUE" | "RESTORE";
  barcode: string;
  reason: string;
  actor: string;
  occurredAt: string;
};

export type PurchaseStrategyConfigHistoryEntry = PurchaseStrategyConfigEvent & {
  sourceEventId: string;
};

export type PurchaseStrategyProductHistoryEntry = PurchaseStrategyProductEvent & {
  sourceEventId: string;
};

export type PurchaseStrategyState = {
  config: PurchaseStrategyConfig;
  states: PurchaseStrategyProductState[];
  configHistory: PurchaseStrategyConfigHistoryEntry[];
  productHistory: PurchaseStrategyProductHistoryEntry[];
  readLimitPerOperationType: number;
  configHistoryMayBeTruncated: boolean;
  productHistoryMayBeTruncated: boolean;
};

type StoredOperationRow = {
  operation_type?: unknown;
  source_event_id?: unknown;
  input_snapshot?: unknown;
  started_at?: unknown;
};

export class PurchaseStrategyError extends Error {
  public readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "PurchaseStrategyError";
    this.code = code;
  }
}

export const DEFAULT_PURCHASE_STRATEGY_CONFIG: PurchaseStrategyConfig = {
  version: 1,
  monthlyRevenueThresholdKrw: 40_000,
  newProductProtectionDays: 365,
  baseCoverMonths: 1.5,
  risingCoverMonths: {
    weak: 2,
    medium: 3,
    strong: 4,
  },
  automaticMaxCoverMonths: 4,
  manualHeroMaxCoverMonths: 6,
};

function fail(code: string, message: string): never {
  throw new PurchaseStrategyError(code, message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("PURCHASE_STRATEGY_OBJECT_REQUIRED", "객체 형식이 필요합니다.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  code: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code, `필드는 ${expected.join(", ")}만 허용됩니다.`);
  }
}

function strictNumber(
  value: unknown,
  field: string,
  options: { min: number; max: number; integer?: boolean },
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(
      "PURCHASE_STRATEGY_NUMBER_INVALID",
      `${field} 값은 유한한 숫자여야 합니다.`,
    );
  }
  if (options.integer && !Number.isInteger(value)) {
    fail(
      "PURCHASE_STRATEGY_NUMBER_INVALID",
      `${field} 값은 정수여야 합니다.`,
    );
  }
  if (value < options.min || value > options.max) {
    fail(
      "PURCHASE_STRATEGY_NUMBER_OUT_OF_RANGE",
      `${field} 값은 ${options.min} 이상 ${options.max} 이하여야 합니다.`,
    );
  }
  return value;
}

function iso(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    fail("PURCHASE_STRATEGY_DATE_INVALID", `${field} 시각이 필요합니다.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    fail("PURCHASE_STRATEGY_DATE_INVALID", `${field} 시각이 올바르지 않습니다.`);
  }
  return new Date(time).toISOString();
}

function actor(value: unknown) {
  if (typeof value !== "string") {
    fail("PURCHASE_STRATEGY_ACTOR_INVALID", "작업자 정보가 필요합니다.");
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    fail(
      "PURCHASE_STRATEGY_ACTOR_INVALID",
      "작업자는 2~120자의 일반 문자열이어야 합니다.",
    );
  }
  return normalized;
}

function reason(value: unknown) {
  if (typeof value !== "string") {
    fail("PURCHASE_STRATEGY_REASON_INVALID", "변경 사유가 필요합니다.");
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length < 2 ||
    normalized.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    fail(
      "PURCHASE_STRATEGY_REASON_INVALID",
      "변경 사유는 2~300자의 일반 문자열이어야 합니다.",
    );
  }
  return normalized;
}

export function normalizePurchaseStrategyBarcode(value: unknown) {
  if (typeof value !== "string") {
    fail("PURCHASE_STRATEGY_BARCODE_INVALID", "B코드가 필요합니다.");
  }
  const normalized = value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  if (!BARCODE_PATTERN.test(normalized)) {
    fail(
      "PURCHASE_STRATEGY_BARCODE_INVALID",
      `관리 가능한 B코드 형식이 아닙니다: ${normalized || "(빈값)"}`,
    );
  }
  return normalized;
}

function normalizeRisingCoverMonths(value: unknown) {
  const row = object(value);
  exactKeys(
    row,
    ["weak", "medium", "strong"],
    "PURCHASE_STRATEGY_RISING_FIELDS_INVALID",
  );
  return {
    weak: strictNumber(row.weak, "risingCoverMonths.weak", {
      min: 0.5,
      max: 4,
    }),
    medium: strictNumber(row.medium, "risingCoverMonths.medium", {
      min: 0.5,
      max: 4,
    }),
    strong: strictNumber(row.strong, "risingCoverMonths.strong", {
      min: 0.5,
      max: 4,
    }),
  };
}

export function normalizePurchaseStrategyConfig(
  value: unknown,
): PurchaseStrategyConfig {
  const row = object(value);
  exactKeys(
    row,
    ["version", ...CONFIG_REQUEST_KEYS],
    "PURCHASE_STRATEGY_CONFIG_FIELDS_INVALID",
  );
  const config: PurchaseStrategyConfig = {
    version: strictNumber(row.version, "version", {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    }),
    monthlyRevenueThresholdKrw: strictNumber(
      row.monthlyRevenueThresholdKrw,
      "monthlyRevenueThresholdKrw",
      {
        min: MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
        max: MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
        integer: true,
      },
    ),
    newProductProtectionDays: strictNumber(
      row.newProductProtectionDays,
      "newProductProtectionDays",
      { min: 1, max: 1_095, integer: true },
    ),
    baseCoverMonths: strictNumber(row.baseCoverMonths, "baseCoverMonths", {
      min: 0.5,
      max: 4,
    }),
    risingCoverMonths: normalizeRisingCoverMonths(row.risingCoverMonths),
    automaticMaxCoverMonths: strictNumber(
      row.automaticMaxCoverMonths,
      "automaticMaxCoverMonths",
      { min: 0.5, max: 4 },
    ),
    manualHeroMaxCoverMonths: strictNumber(
      row.manualHeroMaxCoverMonths,
      "manualHeroMaxCoverMonths",
      { min: 0.5, max: 6 },
    ),
  };
  if (
    config.monthlyRevenueThresholdKrw %
      MONTHLY_REVENUE_THRESHOLD_STEP_KRW !==
    0
  ) {
    fail(
      "PURCHASE_STRATEGY_THRESHOLD_STEP_INVALID",
      `monthlyRevenueThresholdKrw 값은 ${MONTHLY_REVENUE_THRESHOLD_STEP_KRW.toLocaleString("ko-KR")}원 단위여야 합니다.`,
    );
  }
  const { weak, medium, strong } = config.risingCoverMonths;
  if (
    config.baseCoverMonths > weak ||
    weak > medium ||
    medium > strong ||
    strong > config.automaticMaxCoverMonths ||
    config.automaticMaxCoverMonths > config.manualHeroMaxCoverMonths
  ) {
    fail(
      "PURCHASE_STRATEGY_COVER_ORDER_INVALID",
      "재고개월은 기본 ≤ Rising 약/중/강 ≤ 자동 최대 ≤ 수동 효자 최대 순서여야 합니다.",
    );
  }
  return config;
}

/**
 * Keeps the persisted operator field names separate from the calculation
 * engine contract in one place. Callers must not reimplement this mapping.
 */
export function purchaseStrategyPolicyInput(config: PurchaseStrategyConfig) {
  return {
    monthlyRevenueThresholdKrw: config.monthlyRevenueThresholdKrw,
    newProductProtectionDays: config.newProductProtectionDays,
    baseCoverageMonths: config.baseCoverMonths,
    risingCoverageMonths: {
      MILD: config.risingCoverMonths.weak,
      MODERATE: config.risingCoverMonths.medium,
      STRONG: config.risingCoverMonths.strong,
    },
    automaticCoverageCapMonths: config.automaticMaxCoverMonths,
    manualHeroMaxCoverageMonths: config.manualHeroMaxCoverMonths,
  };
}

export function purchaseStrategyCalculationRevision(
  state: Pick<PurchaseStrategyState, "config" | "states">,
) {
  const calculationState = {
    config: state.config,
    states: [...state.states]
      .map((row) => ({
        barcode: row.barcode,
        status: row.status,
        updatedAt: row.updatedAt,
      }))
      .sort((left, right) => left.barcode.localeCompare(right.barcode)),
  };
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(calculationState))
    .digest("hex")}`;
}

export function buildPurchaseStrategyConfigUpdate(
  value: unknown,
  currentVersion: number,
): PurchaseStrategyConfig {
  const row = object(value);
  exactKeys(
    row,
    CONFIG_REQUEST_KEYS,
    "PURCHASE_STRATEGY_CONFIG_FIELDS_INVALID",
  );
  return normalizePurchaseStrategyConfig({
    version: currentVersion + 1,
    ...row,
  });
}

export function normalizePurchaseStrategyProductEvent(
  value: unknown,
): PurchaseStrategyProductEvent {
  const row = object(value);
  exactKeys(
    row,
    ["schemaVersion", "action", "barcode", "reason", "actor", "occurredAt"],
    "PURCHASE_STRATEGY_PRODUCT_EVENT_FIELDS_INVALID",
  );
  if (row.schemaVersion !== PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION) {
    fail(
      "PURCHASE_STRATEGY_SCHEMA_VERSION_INVALID",
      "지원하지 않는 영구 발주 상태 이벤트 버전입니다.",
    );
  }
  if (row.action !== "DISCONTINUE" && row.action !== "RESTORE") {
    fail(
      "PURCHASE_STRATEGY_ACTION_INVALID",
      "영구 발주 상태 작업은 DISCONTINUE 또는 RESTORE여야 합니다.",
    );
  }
  return {
    schemaVersion: PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION,
    action: row.action,
    barcode: normalizePurchaseStrategyBarcode(row.barcode),
    reason: reason(row.reason),
    actor: actor(row.actor),
    occurredAt: iso(row.occurredAt, "occurredAt"),
  };
}

export function normalizePurchaseStrategyConfigEvent(
  value: unknown,
): PurchaseStrategyConfigEvent {
  const row = object(value);
  exactKeys(
    row,
    ["schemaVersion", "action", "actor", "occurredAt", "config"],
    "PURCHASE_STRATEGY_CONFIG_EVENT_FIELDS_INVALID",
  );
  if (row.schemaVersion !== PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION) {
    fail(
      "PURCHASE_STRATEGY_SCHEMA_VERSION_INVALID",
      "지원하지 않는 정책 설정 이벤트 버전입니다.",
    );
  }
  if (row.action !== "UPDATE_CONFIG") {
    fail(
      "PURCHASE_STRATEGY_ACTION_INVALID",
      "정책 설정 작업은 UPDATE_CONFIG여야 합니다.",
    );
  }
  return {
    schemaVersion: PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION,
    action: "UPDATE_CONFIG",
    actor: actor(row.actor),
    occurredAt: iso(row.occurredAt, "occurredAt"),
    config: normalizePurchaseStrategyConfig(row.config),
  };
}

function storedSourceEventId(row: StoredOperationRow) {
  if (typeof row.source_event_id !== "string" || !row.source_event_id.trim()) {
    fail(
      "PURCHASE_STRATEGY_STORED_EVENT_INVALID",
      "저장 이벤트 식별자가 없습니다.",
    );
  }
  return row.source_event_id.trim();
}

function sortByOccurredAt<T extends { occurredAt: string; sourceEventId: string }>(
  left: T,
  right: T,
) {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.sourceEventId.localeCompare(right.sourceEventId)
  );
}

export function foldPurchaseStrategyState(
  configRows: StoredOperationRow[],
  productRows: StoredOperationRow[],
): PurchaseStrategyState {
  const seenSourceEventIds = new Set<string>();
  const configHistory = configRows.map((row) => {
    if (
      row.operation_type !== undefined &&
      row.operation_type !== PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE
    ) {
      fail(
        "PURCHASE_STRATEGY_OPERATION_TYPE_INVALID",
        "정책 설정 원장에 다른 종류의 이벤트가 포함되었습니다.",
      );
    }
    const sourceEventId = storedSourceEventId(row);
    if (seenSourceEventIds.has(sourceEventId)) {
      fail(
        "PURCHASE_STRATEGY_SOURCE_EVENT_DUPLICATED",
        `중복 저장 이벤트입니다: ${sourceEventId}`,
      );
    }
    seenSourceEventIds.add(sourceEventId);
    return {
      ...normalizePurchaseStrategyConfigEvent(row.input_snapshot),
      sourceEventId,
    };
  });
  const versions = new Set<number>();
  for (const event of configHistory) {
    if (versions.has(event.config.version)) {
      fail(
        "PURCHASE_STRATEGY_CONFIG_VERSION_CONFLICT",
        `정책 설정 버전 ${event.config.version}이 중복되었습니다.`,
      );
    }
    versions.add(event.config.version);
  }
  const configAscending = [...configHistory].sort(
    (left, right) =>
      left.config.version - right.config.version ||
      sortByOccurredAt(left, right),
  );
  const config = configAscending.at(-1)?.config ?? {
    ...DEFAULT_PURCHASE_STRATEGY_CONFIG,
    risingCoverMonths: {
      ...DEFAULT_PURCHASE_STRATEGY_CONFIG.risingCoverMonths,
    },
  };

  const productHistory = productRows.map((row) => {
    if (
      row.operation_type !== undefined &&
      row.operation_type !== PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE
    ) {
      fail(
        "PURCHASE_STRATEGY_OPERATION_TYPE_INVALID",
        "영구 발주 상태 원장에 다른 종류의 이벤트가 포함되었습니다.",
      );
    }
    const sourceEventId = storedSourceEventId(row);
    if (seenSourceEventIds.has(sourceEventId)) {
      fail(
        "PURCHASE_STRATEGY_SOURCE_EVENT_DUPLICATED",
        `중복 저장 이벤트입니다: ${sourceEventId}`,
      );
    }
    seenSourceEventIds.add(sourceEventId);
    return {
      ...normalizePurchaseStrategyProductEvent(row.input_snapshot),
      sourceEventId,
    };
  });
  const states = new Map<string, PurchaseStrategyProductState>();
  for (const event of [...productHistory].sort(sortByOccurredAt)) {
    const previous = states.get(event.barcode);
    if (event.action === "DISCONTINUE") {
      if (previous?.status === "DISCONTINUED") {
        fail(
          "PURCHASE_STRATEGY_ALREADY_DISCONTINUED",
          `${event.barcode}는 이미 영구 발주 제외 상태입니다.`,
        );
      }
      states.set(event.barcode, {
        barcode: event.barcode,
        status: "DISCONTINUED",
        discontinuedReason: event.reason,
        discontinuedAt: event.occurredAt,
        discontinuedBy: event.actor,
        restoredAt: null,
        restoredBy: null,
        restoreReason: null,
        updatedAt: event.occurredAt,
      });
      continue;
    }
    if (!previous || previous.status !== "DISCONTINUED") {
      fail(
        "PURCHASE_STRATEGY_NOT_DISCONTINUED",
        `${event.barcode}는 복구할 영구 발주 제외 상태가 없습니다.`,
      );
    }
    states.set(event.barcode, {
      ...previous,
      status: "ACTIVE",
      restoredAt: event.occurredAt,
      restoredBy: event.actor,
      restoreReason: event.reason,
      updatedAt: event.occurredAt,
    });
  }

  return {
    config,
    states: [...states.values()].sort((left, right) =>
      left.barcode.localeCompare(right.barcode),
    ),
    configHistory: [...configHistory].sort((left, right) =>
      right.config.version - left.config.version,
    ),
    productHistory: [...productHistory].sort(
      (left, right) => -sortByOccurredAt(left, right),
    ),
    readLimitPerOperationType: PURCHASE_STRATEGY_READ_LIMIT,
    // The storage reader returns a count-verified complete ledger or throws.
    // These fields remain in the API contract for older clients.
    configHistoryMayBeTruncated: false,
    productHistoryMayBeTruncated: false,
  };
}

async function readOperationRows(operationType: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    fail(
      "SUPABASE_ADMIN_NOT_CONFIGURED",
      "영구 발주 정책 원장 연결이 설정되지 않았습니다.",
    );
  }
  const rows: StoredOperationRow[] = [];
  const seenSourceEventIds = new Set<string>();
  let expectedCount: number | null = null;

  for (
    let offset = 0;
    offset < PURCHASE_STRATEGY_MAX_EVENT_ROWS;
    offset += PURCHASE_STRATEGY_READ_LIMIT
  ) {
    const result = await admin
      .from("commerce_operation_runs")
      .select("operation_type,source_event_id,input_snapshot,started_at", {
        count: "exact",
      })
      .eq("operation_type", operationType)
      .order("started_at", { ascending: true })
      .order("source_event_id", { ascending: true })
      .range(offset, offset + PURCHASE_STRATEGY_READ_LIMIT - 1);
    if (result.error) {
      fail(
        "PURCHASE_STRATEGY_READ_FAILED",
        `영구 발주 정책 원장을 읽지 못했습니다: ${result.error.message}`,
      );
    }
    if (
      !Number.isSafeInteger(result.count) ||
      Number(result.count) < 0
    ) {
      fail(
        "PURCHASE_STRATEGY_READ_UNVERIFIED",
        "영구 발주 정책 원장의 전체 건수를 검증하지 못했습니다.",
      );
    }
    const count = Number(result.count);
    if (count > PURCHASE_STRATEGY_MAX_EVENT_ROWS) {
      fail(
        "PURCHASE_STRATEGY_READ_LIMIT",
        `영구 발주 정책 원장이 안전한 읽기 한도 ${PURCHASE_STRATEGY_MAX_EVENT_ROWS.toLocaleString("ko-KR")}건을 넘었습니다.`,
      );
    }
    expectedCount ??= count;
    if (count !== expectedCount) {
      fail(
        "PURCHASE_STRATEGY_CHANGED_DURING_READ",
        "영구 발주 정책 원장이 조회 중 변경되었습니다. 다시 계산하세요.",
      );
    }

    const page = (Array.isArray(result.data)
      ? result.data
      : []) as StoredOperationRow[];
    const expectedPageLength = Math.min(
      PURCHASE_STRATEGY_READ_LIMIT,
      expectedCount - offset,
    );
    if (expectedPageLength < 0 || page.length !== expectedPageLength) {
      fail(
        "PURCHASE_STRATEGY_PARTIAL_PAGE",
        "영구 발주 정책 원장을 빠짐없이 읽지 못했습니다.",
      );
    }
    for (const row of page) {
      const sourceEventId = storedSourceEventId(row);
      if (seenSourceEventIds.has(sourceEventId)) {
        fail(
          "PURCHASE_STRATEGY_PAGE_DRIFT",
          "영구 발주 정책 원장 페이지가 조회 중 겹쳤습니다. 다시 계산하세요.",
        );
      }
      seenSourceEventIds.add(sourceEventId);
    }
    rows.push(...page);
    if (rows.length === expectedCount) return rows;
  }

  fail(
    "PURCHASE_STRATEGY_READ_LIMIT",
    "영구 발주 정책 원장을 안전한 읽기 한도 안에서 모두 읽지 못했습니다.",
  );
}

export async function loadPurchaseStrategyState() {
  const [configRows, productRows] = await Promise.all([
    readOperationRows(PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE),
    readOperationRows(PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE),
  ]);
  return foldPurchaseStrategyState(configRows, productRows);
}

async function appendEvent(input: {
  operationType: string;
  sourceEventPrefix: string;
  sourceEventId?: string;
  correlationId: string;
  occurredAt: string;
  event: PurchaseStrategyConfigEvent | PurchaseStrategyProductEvent;
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    fail(
      "SUPABASE_ADMIN_NOT_CONFIGURED",
      "영구 발주 정책 원장 연결이 설정되지 않았습니다.",
    );
  }
  const sourceEventId =
    input.sourceEventId ?? `${input.sourceEventPrefix}:${randomUUID()}`;
  const result = await admin.from("commerce_operation_runs").insert({
    operation_type: input.operationType,
    status: "SUCCEEDED",
    source: SOURCE,
    source_event_id: sourceEventId,
    correlation_id: input.correlationId,
    actor_type: "OPS_OPERATOR",
    input_snapshot: input.event,
    result_snapshot: {
      accepted: true,
      scope: "PERMANENT_PURCHASE_STRATEGY",
      action: input.event.action,
    },
    error_message: null,
    started_at: input.occurredAt,
    finished_at: input.occurredAt,
    updated_at: input.occurredAt,
  });
  if (result.error) {
    const errorCode = String(result.error.code ?? "");
    const errorMessage = String(result.error.message ?? "");
    if (
      errorCode === "23505" ||
      /duplicate key|unique constraint/i.test(errorMessage)
    ) {
      fail(
        "PURCHASE_STRATEGY_WRITE_CONFLICT",
        "다른 저장이 먼저 반영되었습니다. 최신 정책을 다시 읽고 시도하세요.",
      );
    }
    fail(
      "PURCHASE_STRATEGY_APPEND_FAILED",
      `영구 발주 정책 이벤트를 저장하지 못했습니다: ${errorMessage}`,
    );
  }
  return sourceEventId;
}

export async function appendPurchaseStrategyConfigEvent(input: {
  actor: unknown;
  config: PurchaseStrategyConfig;
  now?: Date;
}) {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const event = normalizePurchaseStrategyConfigEvent({
    schemaVersion: PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION,
    action: "UPDATE_CONFIG",
    actor: input.actor,
    occurredAt,
    config: input.config,
  });
  const sourceEventId = await appendEvent({
    operationType: PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE,
    sourceEventPrefix: "purchase-strategy-config",
    // One immutable row per policy version makes concurrent saves fail closed
    // at the existing unique source_event_id constraint.
    sourceEventId: `purchase-strategy-config:v${event.config.version}`,
    correlationId: "purchase-strategy:config",
    occurredAt,
    event,
  });
  return { sourceEventId, event };
}

export async function appendPurchaseStrategyProductEvent(input: {
  action: "DISCONTINUE" | "RESTORE";
  barcode: unknown;
  reason: unknown;
  actor: unknown;
  expectedPreviousSourceEventId?: string | null;
  now?: Date;
}) {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const event = normalizePurchaseStrategyProductEvent({
    schemaVersion: PURCHASE_STRATEGY_EVENT_SCHEMA_VERSION,
    action: input.action,
    barcode: input.barcode,
    reason: input.reason,
    actor: input.actor,
    occurredAt,
  });
  const sourceEventId = await appendEvent({
    operationType: PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE,
    sourceEventPrefix: "purchase-strategy-product-status",
    // Two operators acting from the same prior state share this id; exactly
    // one insert can win. A later restore/discontinue uses the new prior id.
    sourceEventId:
      input.expectedPreviousSourceEventId === undefined
        ? undefined
        : `purchase-strategy-product-status:${event.barcode}:${createHash(
            "sha256",
          )
            .update(
              JSON.stringify({
                action: event.action,
                previousSourceEventId:
                  input.expectedPreviousSourceEventId ?? "ROOT",
              }),
            )
            .digest("hex")}`,
    correlationId: `purchase-strategy:barcode:${event.barcode}`,
    occurredAt,
    event,
  });
  return { sourceEventId, event };
}
