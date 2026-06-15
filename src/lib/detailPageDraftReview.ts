export type DetailPageDraftClassification =
  | "mvp_pass"
  | "needs_review"
  | "blocked_or_failed";

export type ReviewStatus = "final_candidate" | "needs_manual_edit" | "hold_reject";

export type ParsedJson<T> = {
  rawText: string;
  data: T | null;
  errors: string[];
  warnings: string[];
};

export type RenderReport = {
  product_code: string;
  rendered_block_count: number | null;
  rendered_image_count: number | null;
  generated_images_used: number | null;
  missing_roles: string[];
  warnings: string[];
  mvp_pass: boolean | null;
  quality_score?: number | null;
  selected_roles?: string[];
};

export type MultiSourceSummary = {
  sources: unknown[];
  source_links: string[];
  images_before: number | null;
  images_after: number | null;
  coverage_before: unknown;
  coverage_after: unknown;
  new_roles: string[];
  missing_roles: string[];
  collection_errors: unknown[];
};

export type DetailPageDraftParseResult = {
  productCode: string;
  html: string;
  generatedSourceFiles: string[];
  renderReport: ParsedJson<RenderReport>;
  multiSourceSummary: ParsedJson<MultiSourceSummary>;
  classification: DetailPageDraftClassification;
  validationErrors: string[];
  validationWarnings: string[];
};

const CRITICAL_ROLES = new Set(["hero", "main_image", "product_title"]);
const GENERATED_IMAGE_REVIEW_THRESHOLD = 4;
const IDEAL_QUALITY_SCORE = 0.8;

function parseJsonObject(rawText: string, label: string): ParsedJson<Record<string, unknown>> {
  if (!rawText.trim()) {
    return { rawText, data: null, errors: [`${label} JSON is empty.`], warnings: [] };
  }
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { rawText, data: null, errors: [`${label} JSON must be an object.`], warnings: [] };
    }
    return { rawText, data: parsed as Record<string, unknown>, errors: [], warnings: [] };
  } catch (error) {
    return {
      rawText,
      data: null,
      errors: [`Invalid ${label} JSON: ${error instanceof Error ? error.message : "unknown parse error"}`],
      warnings: [],
    };
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseRenderReport(rawText: string): ParsedJson<RenderReport> {
  const parsed = parseJsonObject(rawText, "render report");
  if (!parsed.data) return { ...parsed, data: null };
  const data: RenderReport = {
    product_code: typeof parsed.data.product_code === "string" ? parsed.data.product_code : "",
    rendered_block_count: numberOrNull(parsed.data.rendered_block_count),
    rendered_image_count: numberOrNull(parsed.data.rendered_image_count),
    generated_images_used: numberOrNull(parsed.data.generated_images_used),
    missing_roles: stringArray(parsed.data.missing_roles),
    warnings: stringArray(parsed.data.warnings),
    mvp_pass: booleanOrNull(parsed.data.mvp_pass),
    quality_score: numberOrNull(parsed.data.quality_score),
    selected_roles: stringArray(parsed.data.selected_roles),
  };
  const warnings = [...parsed.warnings];
  if (!data.product_code) warnings.push("render report is missing product_code.");
  if (data.rendered_block_count === null) warnings.push("render report is missing rendered_block_count.");
  if (data.rendered_image_count === null) warnings.push("render report is missing rendered_image_count.");
  return { rawText, data, errors: parsed.errors, warnings };
}

export function parseMultiSourceSummary(rawText: string): ParsedJson<MultiSourceSummary> {
  const parsed = parseJsonObject(rawText, "multi source summary");
  if (!parsed.data) return { ...parsed, data: null };
  return {
    rawText,
    data: {
      sources: Array.isArray(parsed.data.sources) ? parsed.data.sources : [],
      source_links: stringArray(parsed.data.source_links),
      images_before: numberOrNull(parsed.data.images_before),
      images_after: numberOrNull(parsed.data.images_after),
      coverage_before: parsed.data.coverage_before ?? null,
      coverage_after: parsed.data.coverage_after ?? null,
      new_roles: stringArray(parsed.data.new_roles),
      missing_roles: stringArray(parsed.data.missing_roles),
      collection_errors: Array.isArray(parsed.data.collection_errors) ? parsed.data.collection_errors : [],
    },
    errors: [],
    warnings: [],
  };
}

export function parseGeneratedSourceFiles(rawText: string): string[] {
  return rawText.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function hasCriticalMissingRole(roles: string[]): boolean {
  return roles.some((role) => CRITICAL_ROLES.has(role.toLowerCase()));
}

function hasHtmlContent(html: string): boolean {
  return html.trim().length > 0;
}

export function classifyDetailPageDraft(input: {
  renderReport: ParsedJson<RenderReport>;
  multiSourceSummary?: ParsedJson<MultiSourceSummary>;
  html: string;
}): DetailPageDraftClassification {
  const report = input.renderReport.data;
  const summary = input.multiSourceSummary?.data;
  if (input.renderReport.errors.length > 0 || !report) return "blocked_or_failed";
  if (!hasHtmlContent(input.html)) return "blocked_or_failed";
  if (!report.product_code) return "blocked_or_failed";
  if ((report.rendered_block_count ?? 0) <= 0) return "blocked_or_failed";
  if ((report.rendered_image_count ?? 0) <= 0) return "blocked_or_failed";
  const allMissingRoles = [...report.missing_roles, ...(summary?.missing_roles ?? [])];
  if (hasCriticalMissingRole(allMissingRoles)) return "blocked_or_failed";
  if ((summary?.collection_errors.length ?? 0) > 0 && !hasHtmlContent(input.html)) return "blocked_or_failed";
  if (
    report.mvp_pass === true &&
    report.missing_roles.length === 0 &&
    report.warnings.length === 0 &&
    (report.rendered_block_count ?? 0) > 0 &&
    (report.rendered_image_count ?? 0) > 0
  ) return "mvp_pass";
  return "needs_review";
}

export function parseDetailPageDraftReview(input: {
  productCode?: string;
  html: string;
  renderReportText: string;
  multiSourceSummaryText: string;
  generatedSourceListText?: string;
}): DetailPageDraftParseResult {
  const renderReport = parseRenderReport(input.renderReportText);
  const multiSourceSummary = parseMultiSourceSummary(input.multiSourceSummaryText);
  const generatedSourceFiles = parseGeneratedSourceFiles(input.generatedSourceListText ?? "");
  const productCode = input.productCode?.trim() || renderReport.data?.product_code || "";
  const classification = classifyDetailPageDraft({ renderReport, multiSourceSummary, html: input.html });
  const validationErrors = [...renderReport.errors, ...multiSourceSummary.errors];
  const validationWarnings = [...renderReport.warnings, ...multiSourceSummary.warnings];
  if ((renderReport.data?.generated_images_used ?? 0) >= GENERATED_IMAGE_REVIEW_THRESHOLD) {
    validationWarnings.push("Generated image usage is high and requires human review before final use.");
  }
  if (typeof renderReport.data?.quality_score === "number" && renderReport.data.quality_score < IDEAL_QUALITY_SCORE) {
    validationWarnings.push("Quality score is below the ideal threshold and needs human review.");
  }
  if (!input.html.trim()) validationErrors.push("detailpage_final.html content is missing.");
  if (!productCode) validationErrors.push("product_code is missing.");
  return { productCode, html: input.html, generatedSourceFiles, renderReport, multiSourceSummary, classification, validationErrors, validationWarnings };
}

export function exportReviewedDetailPageDraft(input: {
  productCode: string;
  classification: DetailPageDraftClassification;
  reviewStatus: ReviewStatus;
  memo: string;
  renderReportSnapshot: RenderReport | null;
  multiSourceSummarySnapshot: MultiSourceSummary | null;
  html: string;
  generatedSourceFiles: string[];
  createdAt?: string;
}): string {
  return JSON.stringify({
    product_code: input.productCode,
    classification: input.classification,
    review_status: input.reviewStatus,
    memo: input.memo,
    render_report_snapshot: input.renderReportSnapshot,
    multi_source_summary_snapshot: input.multiSourceSummarySnapshot,
    html_present: input.html.trim().length > 0,
    html_length: input.html.length,
    generated_source_files: input.generatedSourceFiles,
    createdAt: input.createdAt ?? new Date().toISOString(),
    mode: "detail_page_draft_review",
    notPublished: true,
    externalEngineExecution: false,
  }, null, 2);
}
