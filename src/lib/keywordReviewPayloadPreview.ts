import type {
  KeywordQueueClassification,
  KeywordReviewStatus,
  ReviewedKeywordRow,
} from "./keywordReviewQueue";
import { buildMallSpecificTitleVariant, sourceFromReviewedRow } from "./productTitleVariants";
import { getMarketsForProductGroup } from "./productGroupMarketRegistry";
import { buildManualMallTitleVariants, parseManualMallTitleKeywords } from "./manualMallTitleVariants";
import { normalizeManualKeywordOverride, normalizeSeedKeywords, resolveManualTitleOverride } from "./productLaunchFlow";

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
  title_keyword_count?: number;
  title_included_keyword_count?: number;
  title_keyword_integrity_ok?: boolean;
  title_byte_length?: number;
  apply_blocked?: boolean;
};

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

function fallbackSiteSrchFromTitle(title: string) {
  return title.replace(/\s+/g, ",").trim();
}

function normalizeSiteSrch(value: string) {
  const keywords = value
    .split(/[,;|\n\r]+/)
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
    normalized: uniqueKeywords.join(","),
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

export function buildManualProductGroupPreview(input: {
  item: KeywordPayloadPreviewItem;
  manualTitle: string;
  manualSiteSrch: string;
  markets: ReturnType<typeof getMarketsForProductGroup>;
}) {
  const titleKeywords = parseManualMallTitleKeywords(input.manualTitle);
  const titleVariants = buildManualMallTitleVariants({
    keywords: titleKeywords,
    markets: input.markets,
  });

  return titleVariants.map((variant) => {
    const validation_errors = [...input.item.validation_errors, ...variant.validationErrors];
    const payload_status: KeywordPayloadStatus = validation_errors.length === 0 ? "preview_ready" : "invalid";
    const preview_payload = payload_status === "preview_ready"
      ? { goods_key: input.item.goods_key.trim(), mall_key: variant.mallKey, title: variant.title, site_srch: input.manualSiteSrch }
      : null;

    return {
      ...input.item,
      mall_key: variant.mallKey,
      edited_mall_key: variant.mallKey,
      final_title: variant.title,
      final_site_srch: input.manualSiteSrch,
      payload_status,
      validation_errors,
      preview_payload,
      preview_xml_fragment: preview_payload
        ? xmlFragment(preview_payload.goods_key, preview_payload.mall_key, preview_payload.title, preview_payload.site_srch)
        : null,
      market_name: variant.marketName,
      account_id_label: variant.accountIdLabel,
      group_title: variant.title,
      mall_title: variant.title,
      selected_modifier: "manual_keyword_permutation",
      word_order_strategy: `manual_permutation_${variant.permutationIndex.toString()}`,
      title_keyword_count: variant.keywordCount,
      title_included_keyword_count: variant.includedKeywordCount,
      title_keyword_integrity_ok: variant.keywordIntegrityOk,
      title_byte_length: variant.byteLength,
      apply_blocked: payload_status !== "preview_ready",
    };
  });
}

/**
 * Builds a local preview only. Nothing returned by this function is sent to
 * Shopling. Final API execution belongs in a later, separately guarded PR.
 */
export function buildKeywordShoplingPayloadPreview(
  reviewedRows: KeywordReviewedRow[],
  options: { groupVariantEnabled?: boolean; expandProductGroupMarkets?: boolean; manualTitleOverridesByGoodsKey?: Record<string, string>; manualKeywordOverridesByGoodsKey?: Record<string, string>; seedKeywordsByGoodsKey?: Record<string, string> } = {},
): KeywordPayloadPreviewResult {
  const expansionMode = options.expandProductGroupMarkets ? "product_group_markets" : "single_mall";
  const strictManualProductGroupExpansion = Boolean(
    options.expandProductGroupMarkets &&
      options.manualTitleOverridesByGoodsKey !== undefined &&
      options.manualKeywordOverridesByGoodsKey !== undefined,
  );
  const allowManualOverrides = strictManualProductGroupExpansion ||
    !options.expandProductGroupMarkets;
  const expansionErrors: string[] = [];
  const baseItems = reviewedRows.map((row): KeywordPayloadPreviewItem => {
    const validation_errors: string[] = [];
    const validation_warnings: string[] = [];
    const goodsKey = row.goodsKey.trim();
    const seedKeywords = normalizeSeedKeywords(options.seedKeywordsByGoodsKey?.[goodsKey]);
    const manualTitle = resolveManualTitleOverride(
      allowManualOverrides ? options.manualTitleOverridesByGoodsKey?.[goodsKey] : undefined,
      goodsKey,
    );
    const rawManualKeywordOverride = allowManualOverrides ? options.manualKeywordOverridesByGoodsKey?.[goodsKey] : undefined;
    const manualSiteSrch = strictManualProductGroupExpansion
      ? normalizeSiteSrch(String(rawManualKeywordOverride ?? "")).normalized
      : normalizeManualKeywordOverride(rawManualKeywordOverride);
    let final_title = strictManualProductGroupExpansion
      ? manualTitle
      : manualTitle ||
        (seedKeywords
          ? `${seedKeywords.split(",").join(" ")} ${row.productGroup ?? ""}`
              .replace(/\s+/g, " ")
              .trim()
          : "") ||
        preferredValue(row.editedTitle, row.recommendedTitle) ||
        row.originalTitle.trim();
    const final_mall_key = preferredValue(row.editedMallKey, row.mallKey);
    const preferredSiteSrch = strictManualProductGroupExpansion
      ? manualSiteSrch
      : manualSiteSrch ||
        seedKeywords ||
        row.editedSiteSrch.trim() ||
        row.recommendedSiteSrch.trim() ||
        fallbackSiteSrchFromTitle(final_title);
    const normalizedSiteSrch = normalizeSiteSrch(preferredSiteSrch);
    const final_site_srch = normalizedSiteSrch.normalized;

    if (strictManualProductGroupExpansion && !manualTitle) {
      validation_errors.push("상품명을 입력하세요.");
    }
    if (strictManualProductGroupExpansion && !manualSiteSrch) {
      validation_errors.push("검색어를 입력하세요.");
    }

    if (!strictManualProductGroupExpansion && options.groupVariantEnabled && final_title) {
      final_title = (seedKeywords || sourceFromReviewedRow(row).baseTitle) ? buildMallSpecificTitleVariant(seedKeywords ? { ...sourceFromReviewedRow(row), baseTitle: finalTitleSeedBase(seedKeywords, row.productGroup ?? "") } : sourceFromReviewedRow(row), { productGroup: row.productGroup ?? "", groupSuffix: row.groupSuffix ?? "", productGroupType: row.productGroupType ?? "확인 필요", marketName: "single", mallType: "", mallKey: final_mall_key || row.mallKey, accountIdLabel: "single" }).mallTitle : final_title;
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
      if (!final_title) validation_errors.push("상품명을 입력하세요.");
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
    if (strictManualProductGroupExpansion) {
      return buildManualProductGroupPreview({
        item,
        manualTitle: options.manualTitleOverridesByGoodsKey?.[item.goods_key] ?? "",
        manualSiteSrch: item.final_site_srch,
        markets,
      });
    }
    const itemSeedKeywords = normalizeSeedKeywords(options.seedKeywordsByGoodsKey?.[item.goods_key]);
    const source = itemSeedKeywords ? { ...sourceFromReviewedRow(row), baseTitle: finalTitleSeedBase(itemSeedKeywords, row.productGroup ?? item.product_group) } : sourceFromReviewedRow(row);
    return markets.map((market) => {
      const variant = !strictManualProductGroupExpansion && options.groupVariantEnabled ? buildMallSpecificTitleVariant(source, market) : null;
      const finalTitle = variant?.mallTitle ?? item.final_title;
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
      totalReviewedRows: reviewedRows.length,
      approvedCount: reviewedRows.filter((row) => row.reviewStatus === "approved")
        .length,
      previewReadyCount: previewableItems.length,
      invalidCount: items.filter((item) => item.payload_status === "invalid")
        .length,
      heldCount: items.filter((item) => item.payload_status === "held").length,
      blockedRiskCount: items.filter(
        (item) => item.payload_status === "blocked_risk",
      ).length,
    },
    expansionMode,
    expandedItemCount: items.length,
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

function finalTitleSeedBase(seedKeywords: string, productGroup: string) {
  return `${seedKeywords.split(",").join(" ")} ${productGroup}`.replace(/\s+/g, " ").trim();
}

export function exportKeywordPayloadPreview(
  result: KeywordPayloadPreviewResult,
) {
  return JSON.stringify(result, null, 2);
}
