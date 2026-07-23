import type { KeywordPayloadPreviewItem, KeywordPayloadPreviewResult } from "./keywordReviewPayloadPreview";
import type { KeywordExecutionPreflightItem, KeywordExecutionPreflightResult } from "./keywordReviewExecutionPreflight";

export type ManualMallPreviewStatus = "not_generated" | "preview_only" | "preflight_ready";
export type ManualMallPreflightDisplayStatus = "pending" | "eligible" | "blocked";
export type ManualMallApplyDisplayStatus = "not_started" | "ready" | "preflight_pending" | "applied" | "verified" | "failed" | "blocked";

export type ManualMallPreviewDisplayRow = {
  goodsKey: string;
  productGroup: string;
  marketName: string;
  mallKey: string;
  finalTitle: string;
  finalSiteSrch: string;
  titleKeywordCount: number;
  titleIncludedKeywordCount: number;
  titleKeywordIntegrityOk: boolean;
  previewStatus: string;
  preflightStatus: ManualMallPreflightDisplayStatus;
  applyStatus: ManualMallApplyDisplayStatus;
  blocked: boolean;
  blockingReasons: string[];
  validationWarnings: string[];
  sourceRowIndex: number;
};

export type ManualMallPreviewRowsResult = {
  status: ManualMallPreviewStatus;
  rows: ManualMallPreviewDisplayRow[];
  summary: {
    totalCount: number;
    eligibleCount: number;
    blockedCount: number;
    appliedCount: number;
    failedCount: number;
  };
};

export type ManualMallCompactPlanIdentity = {
  goods_key: string;
  mall_key: string;
  final_title: string;
  final_site_srch: string;
};

type BuildManualMallPreviewRowsInput = {
  previewResult: KeywordPayloadPreviewResult | null;
  preflightResult: KeywordExecutionPreflightResult | null;
  applyResults?: unknown[];
  verifyResults?: unknown[];
};

type ResultMatch = {
  status: "success" | "verified" | "failed" | "unknown";
  reasons: string[];
};

const FAILED_STATUSES = new Set(["failed", "failure", "error", "blocked", "not_applied", "verification_failed"]);
const SUCCESS_STATUSES = new Set(["success", "succeeded", "applied", "complete", "completed", "normal", "정상"]);
const VERIFIED_STATUSES = new Set(["verified"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedStatus(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

function objectValue(row: unknown, key: string) {
  return row && typeof row === "object" && key in row ? (row as Record<string, unknown>)[key] : undefined;
}

function resultIdentity(row: unknown) {
  return `${text(objectValue(row, "goods_key") ?? objectValue(row, "goodsKey"))}\u0000${text(
    objectValue(row, "mall_key") ?? objectValue(row, "mallKey"),
  )}`;
}

function pushUnique(values: string[], value: string) {
  const normalized = value.trim();
  if (normalized && !values.includes(normalized)) values.push(normalized);
}

function addReasons(target: string[], values: unknown) {
  if (Array.isArray(values)) {
    for (const value of values) pushUnique(target, text(value));
    return;
  }
  pushUnique(target, text(values));
}

function resultStatus(row: unknown, verification: boolean): ResultMatch {
  const reasons: string[] = [];
  addReasons(reasons, objectValue(row, "block_reason"));
  addReasons(reasons, objectValue(row, "blocking_reason"));
  addReasons(reasons, objectValue(row, "error"));

  const statuses = ["status", "apply_status", "title_update_status", "verification_status"]
    .map((key) => normalizedStatus(objectValue(row, key)))
    .filter(Boolean);
  const failedStatus = statuses.find((status) => FAILED_STATUSES.has(status));
  if (failedStatus) pushUnique(reasons, failedStatus);
  if (reasons.length > 0 || failedStatus) return { status: "failed", reasons };
  if (statuses.some((status) => VERIFIED_STATUSES.has(status))) return { status: "verified", reasons };
  if (statuses.some((status) => SUCCESS_STATUSES.has(status))) return { status: verification ? "verified" : "success", reasons };
  return { status: "unknown", reasons };
}

function buildResultMap(applyResults: unknown[] = [], verifyResults: unknown[] = []) {
  const resultMap = new Map<string, ResultMatch>();
  for (const [rows, verification] of [[applyResults, false], [verifyResults, true]] as const) {
    for (const row of rows) {
      const identity = resultIdentity(row);
      if (identity === "\u0000") continue;
      const next = resultStatus(row, verification);
      const current = resultMap.get(identity);
      if (!current || next.status === "failed" || (next.status === "verified" && current.status !== "failed")) {
        resultMap.set(identity, { status: next.status, reasons: [...(current?.reasons ?? []), ...next.reasons] });
      }
    }
  }
  return resultMap;
}

export function buildManualMallCompactPlanIdentity(preflightResult: KeywordExecutionPreflightResult): ManualMallCompactPlanIdentity[] {
  return preflightResult.eligibleItems.map((item) => ({
    goods_key: item.goods_key,
    mall_key: item.mall_key,
    final_title: item.final_title,
    final_site_srch: item.final_site_srch,
  }));
}

function displayRow(item: KeywordPayloadPreviewItem | KeywordExecutionPreflightItem, options: { preflightStatus: ManualMallPreflightDisplayStatus; result?: ResultMatch }) {
  const blockingReasons: string[] = [];
  addReasons(blockingReasons, "block_reasons" in item ? item.block_reasons : []);
  addReasons(blockingReasons, item.validation_errors);
  addReasons(blockingReasons, options.result?.reasons ?? []);

  const preflightBlocked = options.preflightStatus === "blocked";
  const failed = options.result?.status === "failed";
  const blocked = preflightBlocked || failed || blockingReasons.length > 0;
  const applyStatus: ManualMallApplyDisplayStatus = preflightBlocked
    ? "blocked"
    : failed
      ? "failed"
      : options.result?.status === "verified"
        ? "verified"
        : options.result?.status === "success"
          ? "applied"
          : options.preflightStatus === "eligible"
            ? "ready"
            : "preflight_pending";

  return {
    goodsKey: item.goods_key,
    productGroup: item.product_group,
    marketName: item.market_name ?? "",
    mallKey: item.mall_key,
    finalTitle: item.final_title,
    finalSiteSrch: item.final_site_srch,
    titleKeywordCount: item.title_keyword_count ?? 0,
    titleIncludedKeywordCount: item.title_included_keyword_count ?? 0,
    titleKeywordIntegrityOk: item.title_keyword_integrity_ok ?? false,
    previewStatus: item.payload_status,
    preflightStatus: options.preflightStatus,
    applyStatus,
    blocked,
    blockingReasons,
    validationWarnings: item.validation_warnings,
    sourceRowIndex: item.source_row_index,
  };
}

export function buildManualMallPreviewRows(input: BuildManualMallPreviewRowsInput): ManualMallPreviewRowsResult {
  if (!input.previewResult) {
    return { status: "not_generated", rows: [], summary: { totalCount: 0, eligibleCount: 0, blockedCount: 0, appliedCount: 0, failedCount: 0 } };
  }
  const resultMap = buildResultMap(input.applyResults, input.verifyResults);
  const rowFor = (item: KeywordPayloadPreviewItem | KeywordExecutionPreflightItem, preflightStatus: ManualMallPreflightDisplayStatus) =>
    displayRow(item, { preflightStatus, result: resultMap.get(`${item.goods_key.trim()}\u0000${item.mall_key.trim()}`) });
  const rows = input.preflightResult
    ? [...input.preflightResult.eligibleItems.map((item) => rowFor(item, "eligible")), ...input.preflightResult.blockedItems.map((item) => rowFor(item, "blocked"))]
    : input.previewResult.items.map((item) => rowFor(item, "pending"));
  return {
    status: input.preflightResult ? "preflight_ready" : "preview_only",
    rows,
    summary: {
      totalCount: rows.length,
      eligibleCount: rows.filter((row) => row.preflightStatus === "eligible").length,
      blockedCount: rows.filter((row) => row.blocked).length,
      appliedCount: rows.filter((row) => row.applyStatus === "applied" || row.applyStatus === "verified").length,
      failedCount: rows.filter((row) => row.applyStatus === "failed").length,
    },
  };
}
