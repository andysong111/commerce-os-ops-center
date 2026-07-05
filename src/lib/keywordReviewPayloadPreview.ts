import type {
  KeywordQueueClassification,
  KeywordReviewStatus,
  ReviewedKeywordRow,
} from "./keywordReviewQueue";
import { buildMallSpecificTitleVariant, sourceFromReviewedRow } from "./productTitleVariants";
import { getMarketsForProductGroup } from "./productGroupMarketRegistry";

export type KeywordReviewedRow = ReviewedKeywordRow;

export type KeywordPayloadStatus =
  | "preview_ready"
  | "invalid"
  | "held"
  | "not_approved"
  | "blocked_risk";

export type KeywordPayloadPreviewItem = {
  goods_key: string;
  mall_key: string;
  source_row_index: number;
  ptn_goods_cd: string;
  group_suffix: string;
  product_group: string;
  product_group_type: string;
  product_group_status: string;
  original_title: string;
  recommended_title: string;
  edited_title: string;
  final_title: string;
  original_site_srch: string;
  recommended_site_srch: string;
  edited_site_srch: string;
  edited_mall_key: string;
  final_site_srch: string;
  classification: KeywordQueueClassification;
  review_status: KeywordReviewStatus;
  block_reason: string;
  warning_flags: string;
  payload_status: KeywordPayloadStatus;
  validation_errors: string[];
  validation_warnings: string[];
  preview_xml_fragment: string | null;
  preview_payload: {
    goods_key: string;
    mall_key: string;
    title: string;
    site_srch: string;
  } | null;
  expansion_mode?: "single_mall" | "product_group_markets";
  group_variant_enabled?: boolean;
  market_name?: string;
  account_id_label?: string;
  group_title?: string;
  mall_title?: string;
  selected_modifier?: string;
  word_order_strategy?: string;
};

export const BLANK_MALL_TITLE_BLOCK_MESSAGE = "쇼핑몰별 상품명이 비어 있어 실제 반영을 중단했습니다.";
export const PARTIAL_MALL_TITLE_BLOCK_MESSAGE = "상품명 반영 대상 중 일부가 비어 있습니다. 누락 상품명을 자동 보강하세요.";

export type KeywordPayloadPreviewResult = {
  items: KeywordPayloadPreviewItem[];
  previewableItems: KeywordPayloadPreviewItem[];
  excludedItems: KeywordPayloadPreviewItem[];
  summary: {
    totalReviewedRows: number;
    approvedCount: number;
    previewReadyCount: number;
    invalidCount: number;
    heldCount: number;
    blockedRiskCount: number;
    titleReadyCount: number;
    titleBlankCount: number;
    titleBlockedCount: number;
  };
  previewXml: string;
  expansionMode: "single_mall" | "product_group_markets";
  expandedItemCount: number;
  groupVariantEnabled: boolean;
  attributeModifierMode: "safe_source_only";
  expansionErrors: string[];
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function preferredValue(edited: string, recommended: string) {
  return edited.trim() || recommended.trim();
}

function readRawString(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
  }
  return "";
}

function isSafeMallTitle(value: unknown, goodsKey?: string) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!title || title === "-") return false;
  if (/^\d+$/.test(title)) return false;
  if (goodsKey && title === goodsKey.trim() && /^\d+$/.test(goodsKey.trim())) return false;
  return true;
}

function resolveMallTitle(row: KeywordReviewedRow) {
  const candidates = [
    row.editedTitle,
    row.recommendedTitle,
    row.originalTitle,
    readRawString(row.raw, ["registered_title", "upload_registered_title"]),
    readRawString(row.raw, ["final_title", "upload_final_title"]),
    readRawString(row.raw, ["mallTitle", "mall_title", "productTitle", "product_name", "current_shopling_title", "shopling_title"]),
  ];
  return candidates.find((candidate) => isSafeMallTitle(candidate, row.goodsKey))?.trim() ?? "";
}

function markBlankMallTitle(item: KeywordPayloadPreviewItem) {
  return {
    ...item,
    final_title: "",
    mall_title: "",
    payload_status: "invalid" as const,
    validation_errors: [...new Set([...item.validation_errors, BLANK_MALL_TITLE_BLOCK_MESSAGE])],
    preview_payload: null,
    preview_xml_fragment: null,
  };
}

function normalizeSiteSrch(value: string) {
  const keywords = value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const duplicateKeywords: string[] = [];
  const uniqueKeywords = keywords.filter((keyword) => {
    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) {
      duplicateKeywords.push(keyword);
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    normalized: uniqueKeywords.join(", "),
    duplicateKeywords,
    keywords: uniqueKeywords,
  };
}

function xmlFragment(
  goodsKey: string,
  mallKey: string,
  title: string,
  siteSrch: string,
) {
  return [
    '  <product-update preview-only="true">',
    `    <goods_key>${escapeXml(goodsKey)}</goods_key>`,
    `    <mall_key>${escapeXml(mallKey)}</mall_key>`,
    `    <title>${escapeXml(title)}</title>`,
    `    <site_srch>${escapeXml(siteSrch)}</site_srch>`,
    "  </product-update>",
  ].join("\n");
}

/**
 * Builds a local preview only. Nothing returned by this function is sent to
 * Shopling. Final API execution belongs in a later, separately guarded PR.
 */
export function buildKeywordShoplingPayloadPreview(
  reviewedRows: KeywordReviewedRow[],
  options: { groupVariantEnabled?: boolean; expandProductGroupMarkets?: boolean } = {},
): KeywordPayloadPreviewResult {
  const expansionMode = options.expandProductGroupMarkets ? "product_group_markets" : "single_mall";
  const expansionErrors: string[] = [];
  const baseItems = reviewedRows.map((row): KeywordPayloadPreviewItem => {
    const validation_errors: string[] = [];
    const validation_warnings: string[] = [];
    let final_title = resolveMallTitle(row);
    const final_mall_key = preferredValue(row.editedMallKey, row.mallKey);
    const preferredSiteSrch = preferredValue(
      row.editedSiteSrch,
      row.recommendedSiteSrch,
    );
    const normalizedSiteSrch = normalizeSiteSrch(preferredSiteSrch);
    const final_site_srch = normalizedSiteSrch.normalized;

    if (options.groupVariantEnabled && final_title) {
      final_title = sourceFromReviewedRow(row).baseTitle ? buildMallSpecificTitleVariant(sourceFromReviewedRow(row), { productGroup: row.productGroup ?? "", groupSuffix: row.groupSuffix ?? "", productGroupType: row.productGroupType ?? "확인 필요", marketName: "single", mallType: "", mallKey: final_mall_key || row.mallKey, accountIdLabel: "single" }).mallTitle : final_title;
    }
    let payload_status: KeywordPayloadStatus = "not_approved";
    if (row.reviewStatus === "hold") {
      payload_status = "held";
    } else if (row.classification === "blocked_risk") {
      payload_status = "blocked_risk";
    } else if (row.reviewStatus === "approved") {
      if (!row.goodsKey.trim())
        validation_errors.push("goods_key is required.");
      if (!options.expandProductGroupMarkets && !final_mall_key)
        validation_errors.push("적용할 쇼핑몰(mall_key)을 선택하세요.");
      if (!final_title) validation_errors.push(BLANK_MALL_TITLE_BLOCK_MESSAGE);
      if (!final_site_srch) {
        validation_errors.push("검색어를 입력하세요.");
      } else if (normalizedSiteSrch.keywords.length > 10) {
        validation_errors.push("검색어는 최대 10개까지만 입력할 수 있습니다.");
      }
      if (normalizedSiteSrch.duplicateKeywords.length > 0) {
        validation_warnings.push(
          `중복 검색어를 제거했습니다: ${normalizedSiteSrch.duplicateKeywords.join(", ")}.`,
        );
      }
      if (
        normalizedSiteSrch.keywords.length > 0 &&
        normalizedSiteSrch.keywords.length !== 10
      ) {
        validation_warnings.push(
          `검색어가 ${normalizedSiteSrch.keywords.length}개입니다. 권장 개수는 10개입니다.`,
        );
      }
      payload_status =
        validation_errors.length === 0 ? "preview_ready" : "invalid";
    }

    const canPreview = payload_status === "preview_ready";
    const preview_payload = canPreview
      ? {
          goods_key: row.goodsKey.trim(),
          mall_key: final_mall_key,
          title: final_title,
          site_srch: final_site_srch,
        }
      : null;
    const preview_xml_fragment = preview_payload
      ? xmlFragment(
          preview_payload.goods_key,
          preview_payload.mall_key,
          preview_payload.title,
          preview_payload.site_srch,
        )
      : null;

    return {
      goods_key: row.goodsKey,
      mall_key: final_mall_key,
      source_row_index: row.sourceRowIndex,
      ptn_goods_cd: row.ptnGoodsCd ?? "",
      group_suffix: row.groupSuffix ?? "",
      product_group: row.productGroup ?? "상품그룹 확인 필요",
      product_group_type: row.productGroupType ?? "확인 필요",
      product_group_status: row.productGroupStatus ?? "missing",
      original_title: row.originalTitle,
      recommended_title: row.recommendedTitle,
      edited_title: row.editedTitle,
      final_title,
      original_site_srch: row.originalSiteSrch,
      recommended_site_srch: row.recommendedSiteSrch,
      edited_site_srch: row.editedSiteSrch,
      edited_mall_key: row.editedMallKey,
      final_site_srch,
      classification: row.classification,
      review_status: row.reviewStatus,
      block_reason: row.blockReason,
      warning_flags: row.warningFlags,
      payload_status,
      validation_errors,
      validation_warnings,
      preview_xml_fragment,
      preview_payload,
      expansion_mode: expansionMode,
      group_variant_enabled: Boolean(options.groupVariantEnabled),
    };
  });

  const items = options.expandProductGroupMarkets ? baseItems.flatMap((item) => {
    if (item.payload_status !== "preview_ready") return [item];
    const row = reviewedRows.find((candidate) => candidate.sourceRowIndex === item.source_row_index && candidate.goodsKey === item.goods_key);
    if (!row) return [item];
    const markets = getMarketsForProductGroup(row.productGroup ?? "");
    if (markets.length === 0) {
      expansionErrors.push(`${row.goodsKey || "(missing goods_key)"}: 상품그룹을 확인해야 쇼핑몰 자동 확장이 가능합니다.`);
      return [{ ...item, payload_status: "invalid" as const, validation_errors: [...item.validation_errors, "상품그룹을 확인해야 쇼핑몰 자동 확장이 가능합니다."] }];
    }
    const source = sourceFromReviewedRow(row);
    return markets.map((market) => {
      const variant = options.groupVariantEnabled ? buildMallSpecificTitleVariant(source, market) : null;
      const finalTitle = variant?.mallTitle ?? item.final_title;
      if (!isSafeMallTitle(finalTitle, item.goods_key)) return markBlankMallTitle({ ...item, mall_key: market.mallKey, edited_mall_key: market.mallKey });
      const preview_payload = { goods_key: item.goods_key.trim(), mall_key: market.mallKey, title: finalTitle, site_srch: item.final_site_srch };
      return { ...item, mall_key: market.mallKey, edited_mall_key: market.mallKey, final_title: finalTitle, preview_payload, preview_xml_fragment: xmlFragment(preview_payload.goods_key, preview_payload.mall_key, preview_payload.title, preview_payload.site_srch), market_name: market.marketName, account_id_label: market.accountIdLabel, group_title: variant?.groupTitle, mall_title: variant?.mallTitle, selected_modifier: variant?.selectedModifier, word_order_strategy: variant?.wordOrderStrategy };
    });
  }).filter((item, index, all) => all.findIndex((other) => `${other.goods_key}::${other.mall_key}` === `${item.goods_key}::${item.mall_key}`) === index) : baseItems;

  const previewableItems = items.filter(
    (item) => item.payload_status === "preview_ready",
  );
  const fragments = previewableItems
    .map((item) => item.preview_xml_fragment)
    .filter((fragment): fragment is string => fragment !== null);

  return {
    items,
    previewableItems,
    excludedItems: items.filter(
      (item) => item.payload_status !== "preview_ready",
    ),
    summary: {
      totalReviewedRows: items.length,
      approvedCount: items.filter((item) => item.review_status === "approved")
        .length,
      previewReadyCount: previewableItems.length,
      invalidCount: items.filter((item) => item.payload_status === "invalid")
        .length,
      heldCount: items.filter((item) => item.payload_status === "held").length,
      blockedRiskCount: items.filter(
        (item) => item.payload_status === "blocked_risk",
      ).length,
      titleReadyCount: previewableItems.filter((item) => isSafeMallTitle(item.final_title, item.goods_key)).length,
      titleBlankCount: items.filter((item) => item.review_status === "approved" && !isSafeMallTitle(item.final_title, item.goods_key)).length,
      titleBlockedCount: items.filter((item) => item.validation_errors.includes(BLANK_MALL_TITLE_BLOCK_MESSAGE)).length,
    },
    expansionMode,
    expandedItemCount: previewableItems.length,
    groupVariantEnabled: Boolean(options.groupVariantEnabled),
    attributeModifierMode: "safe_source_only",
    expansionErrors,
    previewXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!-- PREVIEW ONLY. Not sent to Shopling. -->",
      `<shopling-update-preview preview-only="true" item-count="${fragments.length}">`,
      ...fragments,
      "</shopling-update-preview>",
    ].join("\n"),
  };
}

export function exportKeywordPayloadPreview(
  result: KeywordPayloadPreviewResult,
) {
  return JSON.stringify(result, null, 2);
}
