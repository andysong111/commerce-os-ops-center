import type {
  KeywordPayloadPreviewItem,
  KeywordPayloadPreviewResult,
} from "./keywordReviewPayloadPreview";

export type KeywordExecutionPreflightConfig = {
  allowedMallKeys: string[];
  maxRows: number;
  alreadyAppliedGoodsKeys: string[];
  requireFinalConfirmation: boolean;
  confirmationText: string;
};

export type KeywordExecutionPreflightInput = {
  previewResult: KeywordPayloadPreviewResult;
  finalConfirmationText: string;
};

export type KeywordExecutionPreflightItem = KeywordPayloadPreviewItem & {
  preflight_status: "eligible" | "blocked";
  block_reasons: string[];
  preflight_warnings: string[];
};

export type KeywordExecutionPreflightResult = {
  eligibleItems: KeywordExecutionPreflightItem[];
  blockedItems: KeywordExecutionPreflightItem[];
  warnings: string[];
  errors: string[];
  summary: {
    totalPreviewItems: number;
    eligibleCount: number;
    blockedCount: number;
    alreadyAppliedBlockedCount: number;
    mallKeyBlockedCount: number;
    maxRowsExceeded: boolean;
    duplicateGoodsKeyCount: number;
    requiresFinalConfirmation: boolean;
  };
};

export const DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG: KeywordExecutionPreflightConfig =
  {
    allowedMallKeys: [],
    maxRows: 0,
    alreadyAppliedGoodsKeys: [],
    requireFinalConfirmation: true,
    confirmationText:
      "I understand this is a preview-only preflight. No Shopling API execution is performed.",
  };

function normalizedSet(values: string[]) {
  return new Set(values.map((value) => value.trim()).filter(Boolean));
}

function keywordCount(value: string) {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean).length;
}

/**
 * Builds a fail-closed, local execution plan preview. It never performs an
 * API request or product update.
 */
export function buildKeywordExecutionPreflight(
  input: KeywordExecutionPreflightInput,
  config: KeywordExecutionPreflightConfig = DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
): KeywordExecutionPreflightResult {
  const allowedMallKeys = normalizedSet(config.allowedMallKeys);
  const alreadyAppliedGoodsKeys = normalizedSet(
    config.alreadyAppliedGoodsKeys,
  );
  const confirmationSatisfied =
    !config.requireFinalConfirmation ||
    input.finalConfirmationText.trim() === config.confirmationText;
  const goodsKeyCounts = new Map<string, number>();

  for (const item of input.previewResult.items) {
    const goodsKey = item.goods_key.trim();
    if (goodsKey) {
      goodsKeyCounts.set(goodsKey, (goodsKeyCounts.get(goodsKey) ?? 0) + 1);
    }
  }

  const duplicateGoodsKeys = new Set(
    [...goodsKeyCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([goodsKey]) => goodsKey),
  );

  const evaluatedItems = input.previewResult.items.map(
    (item): KeywordExecutionPreflightItem => {
      const blockReasons: string[] = [];
      const warnings = [...item.validation_warnings];
      const goodsKey = item.goods_key.trim();
      const mallKey = item.mall_key.trim();
      const title = item.final_title.trim();
      const siteSrch = item.final_site_srch.trim();
      const siteSrchKeywordCount = keywordCount(siteSrch);

      if (
        item.payload_status !== "preview_ready" ||
        item.review_status !== "approved"
      ) {
        blockReasons.push("NOT_PREVIEW_READY_APPROVED");
      }
      if (item.validation_errors.length > 0) {
        blockReasons.push("VALIDATION_ERRORS_PRESENT");
      }
      if (item.classification === "blocked_risk") {
        blockReasons.push("BLOCKED_RISK");
      }
      if (item.review_status === "hold" || item.payload_status === "held") {
        blockReasons.push("HELD");
      }
      if (!goodsKey) blockReasons.push("GOODS_KEY_REQUIRED");
      if (!mallKey) blockReasons.push("MALL_KEY_REQUIRED");
      if (!title) blockReasons.push("FINAL_TITLE_REQUIRED");
      if (!siteSrch) {
        blockReasons.push("FINAL_SITE_SRCH_REQUIRED");
      } else if (siteSrchKeywordCount < 10) {
        blockReasons.push("FINAL_SITE_SRCH_UNDERFILLED");
      } else if (siteSrchKeywordCount > 10) {
        blockReasons.push("FINAL_SITE_SRCH_TOO_MANY_KEYWORDS");
      }
      if (title.length > 255) {
        warnings.push(
          "final_title exceeds the conservative 255-character preflight threshold.",
        );
      }
      if (!allowedMallKeys.has(mallKey)) {
        blockReasons.push("MALL_KEY_NOT_ALLOWED");
      }
      if (goodsKey && alreadyAppliedGoodsKeys.has(goodsKey)) {
        blockReasons.push("ALREADY_APPLIED_GOODS_KEY");
      }
      if (goodsKey && duplicateGoodsKeys.has(goodsKey)) {
        blockReasons.push("DUPLICATE_GOODS_KEY");
      }
      if (!confirmationSatisfied) {
        blockReasons.push("FINAL_CONFIRMATION_REQUIRED");
      }

      return {
        ...item,
        preflight_status: blockReasons.length === 0 ? "eligible" : "blocked",
        block_reasons: [...new Set(blockReasons)],
        preflight_warnings: [...new Set(warnings)],
      };
    },
  );

  const initiallyEligible = evaluatedItems.filter(
    (item) => item.preflight_status === "eligible",
  );
  const maxRowsExceeded =
    config.maxRows <= 0
      ? initiallyEligible.length > 0
      : initiallyEligible.length > config.maxRows;

  // Fail the entire candidate plan closed rather than selecting an arbitrary
  // subset when its size exceeds the configured maximum.
  if (maxRowsExceeded) {
    for (const item of initiallyEligible) {
      item.preflight_status = "blocked";
      item.block_reasons.push("MAX_ROWS_EXCEEDED");
    }
  }

  const eligibleItems = evaluatedItems.filter(
    (item) => item.preflight_status === "eligible",
  );
  const blockedItems = evaluatedItems.filter(
    (item) => item.preflight_status === "blocked",
  );
  const warnings = evaluatedItems.flatMap((item) =>
    item.preflight_warnings.map(
      (warning) => `${item.goods_key || "(missing goods_key)"}: ${warning}`,
    ),
  );
  const errors = blockedItems.flatMap((item) =>
    item.block_reasons.map(
      (reason) => `${item.goods_key || "(missing goods_key)"}: ${reason}`,
    ),
  );

  return {
    eligibleItems,
    blockedItems,
    warnings,
    errors,
    summary: {
      totalPreviewItems: input.previewResult.items.length,
      eligibleCount: eligibleItems.length,
      blockedCount: blockedItems.length,
      alreadyAppliedBlockedCount: blockedItems.filter((item) =>
        item.block_reasons.includes("ALREADY_APPLIED_GOODS_KEY"),
      ).length,
      mallKeyBlockedCount: blockedItems.filter((item) =>
        item.block_reasons.includes("MALL_KEY_NOT_ALLOWED"),
      ).length,
      maxRowsExceeded,
      duplicateGoodsKeyCount: evaluatedItems.filter((item) =>
        item.block_reasons.includes("DUPLICATE_GOODS_KEY"),
      ).length,
      requiresFinalConfirmation:
        config.requireFinalConfirmation && !confirmationSatisfied,
    },
  };
}

export function exportKeywordExecutionPlan(
  result: KeywordExecutionPreflightResult,
  config: KeywordExecutionPreflightConfig,
  generatedAt = new Date().toISOString(),
) {
  return JSON.stringify(
    {
      generatedAt,
      mode: "preview_only_preflight",
      executionStatus: "not_executed",
      notices: [
        "Preview only.",
        "No Shopling API call was performed.",
        "Future execution requires a separate guarded PR.",
      ],
      eligibleItems: result.eligibleItems,
      blockedItems: result.blockedItems,
      configSnapshot: config,
      summary: result.summary,
    },
    null,
    2,
  );
}
