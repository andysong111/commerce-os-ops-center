import type {
  KeywordQueueClassification,
  KeywordReviewStatus,
  ReviewedKeywordRow,
} from "./keywordReviewQueue";

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
  original_title: string;
  recommended_title: string;
  edited_title: string;
  final_title: string;
  original_site_srch: string;
  recommended_site_srch: string;
  edited_site_srch: string;
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
  return { normalized: uniqueKeywords.join(", "), duplicateKeywords, keywords: uniqueKeywords };
}

function xmlFragment(
  goodsKey: string,
  mallKey: string,
  title: string,
  siteSrch: string,
) {
  return [
    "  <product-update preview-only=\"true\">",
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
): KeywordPayloadPreviewResult {
  const items = reviewedRows.map((row): KeywordPayloadPreviewItem => {
    const validation_errors: string[] = [];
    const validation_warnings: string[] = [];
    const final_title = preferredValue(row.editedTitle, row.recommendedTitle);
    const preferredSiteSrch = preferredValue(
      row.editedSiteSrch,
      row.recommendedSiteSrch,
    );
    const normalizedSiteSrch = normalizeSiteSrch(preferredSiteSrch);
    const final_site_srch = normalizedSiteSrch.normalized;

    let payload_status: KeywordPayloadStatus = "not_approved";
    if (row.reviewStatus === "hold") {
      payload_status = "held";
    } else if (row.classification === "blocked_risk") {
      payload_status = "blocked_risk";
    } else if (row.reviewStatus === "approved") {
      if (!row.goodsKey.trim()) validation_errors.push("goods_key is required.");
      if (!row.mallKey.trim()) validation_errors.push("mall_key is required.");
      if (!final_title) validation_errors.push("final_title is required.");
      if (!final_site_srch) {
        validation_errors.push("final_site_srch is required.");
      } else if (normalizedSiteSrch.keywords.length > 10) {
        validation_errors.push("site_srch must contain no more than 10 keywords.");
      }
      if (normalizedSiteSrch.duplicateKeywords.length > 0) {
        validation_warnings.push(
          `Duplicate site_srch keywords were removed: ${normalizedSiteSrch.duplicateKeywords.join(", ")}.`,
        );
      }
      if (
        normalizedSiteSrch.keywords.length > 0 &&
        normalizedSiteSrch.keywords.length !== 10
      ) {
        validation_warnings.push(
          `site_srch contains ${normalizedSiteSrch.keywords.length} keywords; 10 is recommended.`,
        );
      }
      payload_status =
        validation_errors.length === 0 ? "preview_ready" : "invalid";
    }

    const canPreview = payload_status === "preview_ready";
    const preview_payload = canPreview
      ? {
          goods_key: row.goodsKey.trim(),
          mall_key: row.mallKey.trim(),
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
      mall_key: row.mallKey,
      source_row_index: row.sourceRowIndex,
      original_title: row.originalTitle,
      recommended_title: row.recommendedTitle,
      edited_title: row.editedTitle,
      final_title,
      original_site_srch: row.originalSiteSrch,
      recommended_site_srch: row.recommendedSiteSrch,
      edited_site_srch: row.editedSiteSrch,
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
    };
  });

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
    },
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
