import type {
  KeywordPayloadPreviewItem,
  KeywordPayloadPreviewResult,
} from "./keywordReviewPayloadPreview";
import { getMarketsForProductGroup, PRODUCT_GROUP_MARKET_MALL_KEYS } from "./productGroupMarketRegistry.ts";

const SHOPLING_MALL_KEY_PATTERN = /^SMALL_\d{5}$/;

export const KEYWORD_EXECUTION_PREFLIGHT_LABELS: Record<string, string> = {
  MALL_KEY_NOT_ALLOWED: "선택한 쇼핑몰이 허용 목록에 없습니다.",
  DUPLICATE_GOODS_KEY: "중복 상품번호입니다.",
  DUPLICATE_GOODS_KEY_MALL_KEY: "같은 상품번호/쇼핑몰 조합이 중복되었습니다.",
  FINAL_CONFIRMATION_REQUIRED: "최종 확인이 필요합니다.",
  NOT_PREVIEW_READY_APPROVED: "반영 준비가 완료되지 않았습니다.",
  VALIDATION_ERRORS_PRESENT: "미리보기 검사 오류가 있습니다.",
  BLOCKED_RISK: "위험/차단 항목입니다.",
  HELD: "보류 항목입니다.",
  GOODS_KEY_REQUIRED: "상품번호가 없습니다.",
  MALL_KEY_REQUIRED: "쇼핑몰을 선택하세요.",
  MALL_KEY_INVALID_FORMAT: "실제 샵플링 mall_key(SMALL_000xx) 형식만 사용할 수 있습니다.",
  FINAL_TITLE_REQUIRED: "상품명을 입력하세요.",
  FINAL_SITE_SRCH_REQUIRED: "검색어를 입력하세요.",
  FINAL_SITE_SRCH_TOO_MANY_KEYWORDS: "검색어는 최대 10개까지만 가능합니다.",
  ALREADY_APPLIED_GOODS_KEY: "이미 반영한 상품번호입니다.",
  MAX_ROWS_EXCEEDED: "최대 실행 행 수를 초과했습니다.",
  FINAL_SITE_SRCH_UNDERFILLED: "검색어가 10개 미만입니다. 현재는 경고만 표시합니다.",
  PRODUCT_GROUP_MARKETS_MISMATCH: "상품그룹 쇼핑몰 전체 대상과 실행계획이 일치하지 않습니다.",
  PRODUCT_GROUP_UNREGISTERED: "등록되지 않은 상품그룹입니다.",
};

export function formatKeywordExecutionPreflightLabels(values: string[]) {
  return values
    .map((value) => KEYWORD_EXECUTION_PREFLIGHT_LABELS[value] ?? value)
    .join(", ");
}

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
    expectedTitleTargetCount: number;
    generatedTitleTargetCount: number;
    siteSrchGoodsKeyCount: number;
  };
};

export const DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG: KeywordExecutionPreflightConfig =
  {
    allowedMallKeys: PRODUCT_GROUP_MARKET_MALL_KEYS,
    maxRows: 20,
    alreadyAppliedGoodsKeys: [],
    requireFinalConfirmation: false,
    confirmationText:
      "실행 전 점검은 미리보기 전용입니다. 실제 반영은 아래 ‘실제 샵플링 반영 실행’에서 확인문구 입력 후 진행됩니다.",
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
  const candidateItems = input.previewResult.items.filter(
    (item) =>
      item.review_status === "approved" ||
      item.payload_status === "preview_ready",
  );
  const goodsMallKeyCounts = new Map<string, number>();
  const requiresProductGroupCoverage = input.previewResult.expansionMode === "product_group_markets";
  const expectedMallKeysByGoodsKey = new Map<string, Set<string>>();
  if (requiresProductGroupCoverage) for (const item of candidateItems) {
    const goodsKey = item.goods_key.trim();
    if (!goodsKey || expectedMallKeysByGoodsKey.has(goodsKey)) continue;
    const markets = getMarketsForProductGroup(item.product_group);
    if (markets.length > 0) expectedMallKeysByGoodsKey.set(goodsKey, new Set(markets.map((market) => market.mallKey)));
  }

  for (const item of candidateItems) {
    const goodsKey = item.goods_key.trim();
    const mallKey = item.mall_key.trim();
    if (goodsKey && mallKey) {
      const duplicateKey = `${goodsKey}::${mallKey}`;
      goodsMallKeyCounts.set(
        duplicateKey,
        (goodsMallKeyCounts.get(duplicateKey) ?? 0) + 1,
      );
    }
  }

  const duplicateGoodsMallKeys = new Set(
    [...goodsMallKeyCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([duplicateKey]) => duplicateKey),
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
      else if (!SHOPLING_MALL_KEY_PATTERN.test(mallKey)) blockReasons.push("MALL_KEY_INVALID_FORMAT");
      if (!title) blockReasons.push("FINAL_TITLE_REQUIRED");
      if (!siteSrch) {
        blockReasons.push("FINAL_SITE_SRCH_REQUIRED");
      } else if (siteSrchKeywordCount < 10) {
        warnings.push("FINAL_SITE_SRCH_UNDERFILLED");
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
      const expectedMallKeys = expectedMallKeysByGoodsKey.get(goodsKey);
      if (requiresProductGroupCoverage && !expectedMallKeys && goodsKey) blockReasons.push("PRODUCT_GROUP_UNREGISTERED");
      if (requiresProductGroupCoverage && expectedMallKeys && (!expectedMallKeys.has(mallKey) || candidateItems.filter((candidate) => candidate.goods_key.trim() === goodsKey).length !== expectedMallKeys.size)) {
        blockReasons.push("PRODUCT_GROUP_MARKETS_MISMATCH");
      }
      if (goodsKey && alreadyAppliedGoodsKeys.has(goodsKey)) {
        blockReasons.push("ALREADY_APPLIED_GOODS_KEY");
      }
      if (
        goodsKey &&
        mallKey &&
        duplicateGoodsMallKeys.has(`${goodsKey}::${mallKey}`)
      ) {
        blockReasons.push("DUPLICATE_GOODS_KEY_MALL_KEY");
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
      (warning) =>
        `${item.goods_key || "(missing goods_key)"}: ${KEYWORD_EXECUTION_PREFLIGHT_LABELS[warning] ?? warning}`,
    ),
  );
  const errors = blockedItems.flatMap((item) =>
    item.block_reasons.map(
      (reason) =>
        `${item.goods_key || "(missing goods_key)"}: ${KEYWORD_EXECUTION_PREFLIGHT_LABELS[reason] ?? reason}`,
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
        item.block_reasons.includes("DUPLICATE_GOODS_KEY_MALL_KEY"),
      ).length,
      expectedTitleTargetCount: [...expectedMallKeysByGoodsKey.values()].reduce((sum, keys) => sum + keys.size, 0),
      generatedTitleTargetCount: candidateItems.length,
      siteSrchGoodsKeyCount: new Set(eligibleItems.map((item) => item.goods_key.trim()).filter(Boolean)).size,
      requiresFinalConfirmation:
        config.requireFinalConfirmation && !confirmationSatisfied,
    },
  };
}

export function buildCompactKeywordApplyExecutionPlan(
  preflightResult: KeywordExecutionPreflightResult,
) {
  return JSON.stringify(
    preflightResult.eligibleItems.map((item) => ({
      goods_key: item.goods_key,
      mall_key: item.mall_key,
      final_title: item.final_title,
      final_site_srch: item.final_site_srch,
    })),
  );
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
