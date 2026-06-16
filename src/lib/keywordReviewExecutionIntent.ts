import type {
  KeywordExecutionPreflightConfig,
  KeywordExecutionPreflightItem,
  KeywordExecutionPreflightResult,
} from "./keywordReviewExecutionPreflight";

export const DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION =
  "I understand this is only an execution intent. No Shopling API execution will be performed.";

export type KeywordExecutionIntentConfig = {
  requiredConfirmationText: string;
};

export type KeywordExecutionIntentInput = {
  confirmationText: string;
  confirmationAccepted: boolean;
  preflightConfig: KeywordExecutionPreflightConfig;
  createdAt?: string;
  randomSuffix?: string;
};

export type KeywordExecutionIntentItem = {
  goods_key: string;
  mall_key: string;
  final_title: string;
  final_site_srch: string;
  source_row_index: number;
  classification: KeywordExecutionPreflightItem["classification"];
  review_status: KeywordExecutionPreflightItem["review_status"];
  block_reason: string;
  warning_flags: string;
  payload_preview_snapshot: KeywordExecutionPreflightItem["preview_payload"];
  xml_preview_fragment_snapshot: string | null;
};

export type KeywordExecutionIntentResult = {
  intentId: string;
  createdAt: string;
  mode: "preview_only_execution_intent";
  status: "intent_created";
  source: "keyword_review_queue";
  preflightSummarySnapshot: KeywordExecutionPreflightResult["summary"];
  preflightConfigSnapshot: KeywordExecutionPreflightConfig;
  eligibleItemsSnapshot: KeywordExecutionIntentItem[];
  blockedItemsSnapshot: KeywordExecutionPreflightItem[];
  confirmationText: string;
  confirmationAccepted: true;
  executionDisabled: true;
  notExecuted: true;
  noShoplingApiCall: true;
  futureExecutionRequired: true;
  futureExecutionRequiresSeparatePR: true;
  warnings: string[];
  errors: string[];
};

export const DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIG: KeywordExecutionIntentConfig =
  {
    requiredConfirmationText:
      DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION,
  };

function keywordCount(value: string) {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean).length;
}

function intentId(createdAt: string, randomSuffix?: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Execution intent createdAt must be a valid date.");
  }
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const suffix =
    randomSuffix?.trim() ||
    Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `keyword-intent-${timestamp}-${suffix}`;
}

function snapshotItem(
  item: KeywordExecutionPreflightItem,
): KeywordExecutionIntentItem {
  return {
    goods_key: item.goods_key.trim(),
    mall_key: item.mall_key.trim(),
    final_title: item.final_title.trim(),
    final_site_srch: item.final_site_srch.trim(),
    source_row_index: item.source_row_index,
    classification: item.classification,
    review_status: item.review_status,
    block_reason: item.block_reason,
    warning_flags: item.warning_flags,
    payload_preview_snapshot: item.preview_payload
      ? { ...item.preview_payload }
      : null,
    xml_preview_fragment_snapshot: item.preview_xml_fragment,
  };
}

/**
 * Creates a local, immutable-style snapshot of a valid preflight plan. This
 * function only records intent and cannot execute product updates.
 */
export function buildKeywordExecutionIntent(
  preflightResult: KeywordExecutionPreflightResult,
  input: KeywordExecutionIntentInput,
  config: KeywordExecutionIntentConfig = DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIG,
): KeywordExecutionIntentResult {
  if (!input.confirmationAccepted) {
    throw new Error("Execution intent confirmation must be accepted.");
  }
  if (input.confirmationText !== config.requiredConfirmationText) {
    throw new Error("Execution intent confirmation text does not match.");
  }
  if (preflightResult.summary.maxRowsExceeded) {
    throw new Error("Execution intent cannot be created when maxRows is exceeded.");
  }
  if (preflightResult.summary.requiresFinalConfirmation) {
    throw new Error("Execution intent requires a valid preflight confirmation.");
  }
  if (preflightResult.eligibleItems.length === 0) {
    throw new Error("Execution intent requires at least one eligible item.");
  }
  if (
    preflightResult.summary.eligibleCount !==
      preflightResult.eligibleItems.length ||
    preflightResult.summary.blockedCount !==
      preflightResult.blockedItems.length
  ) {
    throw new Error("Execution intent preflight summary is inconsistent.");
  }

  for (const item of preflightResult.eligibleItems) {
    if (item.preflight_status !== "eligible" || item.block_reasons.length > 0) {
      throw new Error("Execution intent contains an invalid eligible item.");
    }
    if (!item.goods_key.trim()) throw new Error("goods_key is required.");
    if (!item.mall_key.trim()) throw new Error("mall_key is required.");
    if (!item.final_title.trim()) throw new Error("final_title is required.");
    if (!item.final_site_srch.trim()) {
      throw new Error("final_site_srch is required.");
    }
    if (keywordCount(item.final_site_srch) !== 10) {
      throw new Error("final_site_srch must contain exactly 10 keywords.");
    }
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    intentId: intentId(createdAt, input.randomSuffix),
    createdAt,
    mode: "preview_only_execution_intent",
    status: "intent_created",
    source: "keyword_review_queue",
    preflightSummarySnapshot: { ...preflightResult.summary },
    preflightConfigSnapshot: {
      ...input.preflightConfig,
      allowedMallKeys: [...input.preflightConfig.allowedMallKeys],
      alreadyAppliedGoodsKeys: [
        ...input.preflightConfig.alreadyAppliedGoodsKeys,
      ],
    },
    eligibleItemsSnapshot: preflightResult.eligibleItems.map(snapshotItem),
    blockedItemsSnapshot: preflightResult.blockedItems.map((item) => ({
      ...item,
      block_reasons: [...item.block_reasons],
      preflight_warnings: [...item.preflight_warnings],
    })),
    confirmationText: input.confirmationText,
    confirmationAccepted: true,
    executionDisabled: true,
    notExecuted: true,
    noShoplingApiCall: true,
    futureExecutionRequired: true,
    futureExecutionRequiresSeparatePR: true,
    warnings: [...preflightResult.warnings],
    errors: [...preflightResult.errors],
  };
}

export function exportKeywordExecutionIntent(
  intent: KeywordExecutionIntentResult,
) {
  return JSON.stringify(intent, null, 2);
}
