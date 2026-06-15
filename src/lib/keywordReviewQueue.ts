export type KeywordQueueClassification =
  | "auto_apply_candidate"
  | "manual_review"
  | "blocked_risk";

export type KeywordReviewStatus = "pending" | "approved" | "hold";

export type KeywordReviewRow = {
  goodsKey: string;
  mallKey: string;
  originalTitle: string;
  recommendedTitle: string;
  originalSiteSrch: string;
  recommendedSiteSrch: string;
  siteSrchKeywordCount: number | null;
  verifiedKeywordCount: number | null;
  qualityStatus: string;
  confidenceStatus: string;
  blockReason: string;
  warningFlags: string;
  reviewReason: string;
  payloadStatus: string;
  approvalStatus: string;
  manualCandidateKeywords: string;
  sourceRowIndex: number;
  raw: Record<string, string>;
  classification: KeywordQueueClassification;
};

export type ReviewedKeywordRow = KeywordReviewRow & {
  editedTitle: string;
  editedSiteSrch: string;
  reviewStatus: KeywordReviewStatus;
};

const aliases = {
  goodsKey: ["goods_key", "goodskey", "product_key", "product_id"],
  mallKey: ["mall_key", "mallkey", "shop_key"],
  originalTitle: ["current_title", "old_title", "original_title", "title"],
  recommendedTitle: ["new_title", "recommended_title", "suggested_title"],
  originalSiteSrch: [
    "site_srch",
    "current_site_srch",
    "old_site_srch",
    "original_site_srch",
  ],
  recommendedSiteSrch: [
    "new_site_srch",
    "recommended_site_srch",
    "suggested_site_srch",
  ],
  siteSrchKeywordCount: [
    "site_srch_keyword_count",
    "keyword_count",
    "new_site_srch_keyword_count",
  ],
  verifiedKeywordCount: ["verified_keyword_count", "verified_count"],
  qualityStatus: ["site_srch_quality_status", "quality_status"],
  confidenceStatus: [
    "final_site_srch_confidence_status",
    "confidence_status",
    "final_confidence_status",
  ],
  blockReason: ["block_reason", "blocked_reason"],
  warningFlags: ["warning_flags", "warnings", "warning_flag"],
  reviewReason: ["review_reason", "manual_review_reason"],
  payloadStatus: ["payload_status"],
  approvalStatus: ["approval_status", "review_status"],
  manualCandidateKeywords: [
    "manual_candidate_keywords",
    "candidate_keywords",
  ],
} as const;

const manualIndicators = [
  "BLOCKED_TITLE_LENGTH",
  "UNDERFILLED_SITE_SRCH",
  "RELATED_EXPANSION_REVIEW_REQUIRED",
  "FINAL_SITE_SRCH_QUALITY_REVIEW_REQUIRED",
  "FINAL_SITE_SRCH_CONFIDENCE_REVIEW_REQUIRED",
];

const riskIndicators = [
  "PRODUCT IDENTITY DRIFT",
  "PRODUCT_IDENTITY_DRIFT",
  "SENSITIVE",
  "MEDICAL",
  "CHILD",
  "ECO",
  "UNSUPPORTED",
  "BRAND",
  "STORE-NAME",
  "STORE_NAME",
  "HIGH_DEMAND_BROAD_RISK",
  "ZERO_DEMAND",
  "LOW_DEMAND_CENSORED",
  "BROAD KEYWORD RISK",
  "BROAD_KEYWORD_RISK",
  "SEARCHAD DEMAND MISSING",
  "SEARCHAD_DEMAND_MISSING",
  "UNSAFE",
];

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function valueFor(
  normalizedRow: Record<string, string>,
  fieldAliases: readonly string[],
) {
  for (const alias of fieldAliases) {
    const value = normalizedRow[normalizeHeader(alias)];
    if (value !== undefined) return value.trim();
  }
  return "";
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (character === '"') {
      if (quoted && csvText[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function classifyKeywordRow(
  row: Pick<
    KeywordReviewRow,
    | "blockReason"
    | "warningFlags"
    | "reviewReason"
    | "qualityStatus"
    | "confidenceStatus"
    | "siteSrchKeywordCount"
    | "verifiedKeywordCount"
  >,
): KeywordQueueClassification {
  const indicators = [
    row.blockReason,
    row.warningFlags,
    row.reviewReason,
    row.qualityStatus,
    row.confidenceStatus,
  ]
    .join(" ")
    .toUpperCase();

  if (riskIndicators.some((indicator) => indicators.includes(indicator))) {
    return "blocked_risk";
  }
  if (manualIndicators.some((indicator) => indicators.includes(indicator))) {
    return "manual_review";
  }
  if (
    row.blockReason === "" &&
    row.qualityStatus.toUpperCase() === "PASS" &&
    row.confidenceStatus.toUpperCase() === "PASS" &&
    row.siteSrchKeywordCount === 10 &&
    row.verifiedKeywordCount === 10
  ) {
    return "auto_apply_candidate";
  }
  return "manual_review";
}

export function parseKeywordMvpCsv(csvText: string): KeywordReviewRow[] {
  const [headers = [], ...dataRows] = parseCsvRows(csvText);
  if (headers.length === 0) return [];

  return dataRows.map((values, index) => {
    const raw = Object.fromEntries(
      headers.map((header, columnIndex) => [
        header.trim(),
        (values[columnIndex] ?? "").trim(),
      ]),
    );
    const normalizedRow = Object.fromEntries(
      Object.entries(raw).map(([header, value]) => [
        normalizeHeader(header),
        value,
      ]),
    );
    const partial = {
      goodsKey: valueFor(normalizedRow, aliases.goodsKey),
      mallKey: valueFor(normalizedRow, aliases.mallKey),
      originalTitle: valueFor(normalizedRow, aliases.originalTitle),
      recommendedTitle: valueFor(normalizedRow, aliases.recommendedTitle),
      originalSiteSrch: valueFor(normalizedRow, aliases.originalSiteSrch),
      recommendedSiteSrch: valueFor(
        normalizedRow,
        aliases.recommendedSiteSrch,
      ),
      siteSrchKeywordCount: numberOrNull(
        valueFor(normalizedRow, aliases.siteSrchKeywordCount),
      ),
      verifiedKeywordCount: numberOrNull(
        valueFor(normalizedRow, aliases.verifiedKeywordCount),
      ),
      qualityStatus: valueFor(normalizedRow, aliases.qualityStatus),
      confidenceStatus: valueFor(normalizedRow, aliases.confidenceStatus),
      blockReason: valueFor(normalizedRow, aliases.blockReason),
      warningFlags: valueFor(normalizedRow, aliases.warningFlags),
      reviewReason: valueFor(normalizedRow, aliases.reviewReason),
      payloadStatus: valueFor(normalizedRow, aliases.payloadStatus),
      approvalStatus: valueFor(normalizedRow, aliases.approvalStatus),
      manualCandidateKeywords: valueFor(
        normalizedRow,
        aliases.manualCandidateKeywords,
      ),
      sourceRowIndex: index + 2,
      raw,
    };
    return { ...partial, classification: classifyKeywordRow(partial) };
  });
}

export function createReviewedRows(
  rows: KeywordReviewRow[],
): ReviewedKeywordRow[] {
  return rows.map((row) => ({
    ...row,
    editedTitle: row.recommendedTitle,
    editedSiteSrch: row.recommendedSiteSrch,
    reviewStatus: "pending",
  }));
}

export function exportReviewedQueue(rows: ReviewedKeywordRow[]) {
  return JSON.stringify(
    rows.map((row) => ({
      goods_key: row.goodsKey,
      mall_key: row.mallKey,
      original_title: row.originalTitle,
      recommended_title: row.recommendedTitle,
      original_site_srch: row.originalSiteSrch,
      recommended_site_srch: row.recommendedSiteSrch,
      edited_title: row.editedTitle,
      edited_site_srch: row.editedSiteSrch,
      classification: row.classification,
      review_status: row.reviewStatus,
      block_reason: row.blockReason,
      warning_flags: row.warningFlags,
      source_row_index: row.sourceRowIndex,
    })),
    null,
    2,
  );
}
