export type DetailPageDraftClassification =
  | "mvp_pass"
  | "production_ready"
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

export type ShoplingFullImageReport = {
  production_ready: boolean | null;
  full_image_ready: boolean | null;
  full_image_width: number | null;
  full_image_format: string;
  recommended_upload_html: string;
  recommended_upload_mode: string;
  full_image_uploaded_url: string;
  uploaded_url: string;
  product_code: string;
};

export type CopywriterV2Report = {
  product_code: string;
  copy_quality_score: number | null;
  final_defect_counts: Record<string, number>;
  total_final_defects: number | null;
};

export type DetailPageProductionResult = {
  finalHtml: string;
  fullImageHtml: string;
  finalImageUrl: string;
  fullImageReport: ParsedJson<ShoplingFullImageReport>;
  fullImageManifest: ParsedJson<ShoplingFullImageReport>;
  copywriterReport: ParsedJson<CopywriterV2Report>;
  polishedBlueprint: ParsedJson<Record<string, unknown>>;
  recommendedUploadHtml: string;
  recommendedUploadMode: string;
  productionReady: boolean;
};

export type DetailPageDraftParseResult = {
  productCode: string;
  html: string;
  generatedSourceFiles: string[];
  renderReport: ParsedJson<RenderReport>;
  multiSourceSummary: ParsedJson<MultiSourceSummary>;
  production: DetailPageProductionResult;
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

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
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

export function parseShoplingFullImageReport(rawText: string, label = "shopling full image report"): ParsedJson<ShoplingFullImageReport> {
  if (!rawText.trim()) return { rawText, data: null, errors: [], warnings: [] };
  const parsed = parseJsonObject(rawText, label);
  if (!parsed.data) return { ...parsed, data: null };
  return {
    rawText,
    data: {
      production_ready: booleanOrNull(parsed.data.production_ready),
      full_image_ready: booleanOrNull(parsed.data.full_image_ready),
      full_image_width: numberOrNull(parsed.data.full_image_width),
      full_image_format: stringOrEmpty(parsed.data.full_image_format).toLowerCase(),
      recommended_upload_html: stringOrEmpty(parsed.data.recommended_upload_html),
      recommended_upload_mode: stringOrEmpty(parsed.data.recommended_upload_mode),
      full_image_uploaded_url: stringOrEmpty(parsed.data.full_image_uploaded_url),
      uploaded_url: stringOrEmpty(parsed.data.uploaded_url),
      product_code: stringOrEmpty(parsed.data.product_code),
    },
    errors: parsed.errors,
    warnings: parsed.warnings,
  };
}

export function parseCopywriterV2Report(rawText: string): ParsedJson<CopywriterV2Report> {
  if (!rawText.trim()) return { rawText, data: null, errors: [], warnings: [] };
  const parsed = parseJsonObject(rawText, "copywriter v2 report");
  if (!parsed.data) return { ...parsed, data: null };
  const rawCounts = parsed.data.final_defect_counts;
  const final_defect_counts = rawCounts && typeof rawCounts === "object" && !Array.isArray(rawCounts)
    ? Object.fromEntries(Object.entries(rawCounts).filter(([, value]) => typeof value === "number")) as Record<string, number>
    : {};
  const totalFromCounts = Object.values(final_defect_counts).reduce((sum, count) => sum + count, 0);
  return {
    rawText,
    data: {
      product_code: stringOrEmpty(parsed.data.product_code),
      copy_quality_score: numberOrNull(parsed.data.copy_quality_score),
      final_defect_counts,
      total_final_defects: numberOrNull(parsed.data.total_final_defects ?? parsed.data.final_defects) ?? totalFromCounts,
    },
    errors: parsed.errors,
    warnings: parsed.warnings,
  };
}

export function parseFinalImageUrl(input: { manifest?: ParsedJson<ShoplingFullImageReport>; report?: ParsedJson<ShoplingFullImageReport>; fullImageHtml?: string }) {
  const manifestUrl = input.manifest?.data?.uploaded_url || input.manifest?.data?.full_image_uploaded_url || "";
  const reportUrl = input.report?.data?.full_image_uploaded_url || input.report?.data?.uploaded_url || "";
  const htmlUrl = input.fullImageHtml?.match(/<img[^>]+src=[\"']([^\"']+)[\"']/i)?.[1] ?? "";
  return manifestUrl || reportUrl || htmlUrl;
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
  production?: DetailPageProductionResult;
}): DetailPageDraftClassification {
  if (input.production?.productionReady) return "production_ready";
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
  fullImageHtml?: string;
  renderReportText: string;
  multiSourceSummaryText: string;
  fullImageReportText?: string;
  fullImageManifestText?: string;
  copywriterReportText?: string;
  polishedBlueprintText?: string;
  generatedSourceListText?: string;
}): DetailPageDraftParseResult {
  const renderReport = parseRenderReport(input.renderReportText);
  const multiSourceSummary = parseMultiSourceSummary(input.multiSourceSummaryText);
  const fullImageReport = parseShoplingFullImageReport(input.fullImageReportText ?? "");
  const fullImageManifest = parseShoplingFullImageReport(input.fullImageManifestText ?? "", "shopling full image manifest");
  const copywriterReport = parseCopywriterV2Report(input.copywriterReportText ?? "");
  const polishedBlueprint = parseJsonObject(input.polishedBlueprintText ?? "{}", "polished blueprint");
  const finalHtml = input.html;
  const fullImageHtml = input.fullImageHtml ?? "";
  const finalImageUrl = parseFinalImageUrl({ manifest: fullImageManifest, report: fullImageReport, fullImageHtml });
  const recommendedUploadHtml = fullImageReport.data?.recommended_upload_html || fullImageManifest.data?.recommended_upload_html || fullImageHtml || finalHtml;
  const copywriterDefectsZero = copywriterReport.data ? (copywriterReport.data.total_final_defects ?? 0) === 0 && Object.values(copywriterReport.data.final_defect_counts).every((count) => count === 0) : true;
  const productionReady = (
    (fullImageReport.data?.production_ready ?? fullImageManifest.data?.production_ready) === true &&
    (fullImageReport.data?.full_image_ready ?? fullImageManifest.data?.full_image_ready) === true &&
    (fullImageReport.data?.full_image_width ?? fullImageManifest.data?.full_image_width) === 1000 &&
    (fullImageReport.data?.full_image_format || fullImageManifest.data?.full_image_format) === "jpg" &&
    recommendedUploadHtml.trim().length > 0 &&
    copywriterDefectsZero
  );
  const production: DetailPageProductionResult = {
    finalHtml,
    fullImageHtml,
    finalImageUrl,
    fullImageReport,
    fullImageManifest,
    copywriterReport,
    polishedBlueprint,
    recommendedUploadHtml,
    recommendedUploadMode: fullImageReport.data?.recommended_upload_mode || fullImageManifest.data?.recommended_upload_mode || "",
    productionReady,
  };
  const generatedSourceFiles = parseGeneratedSourceFiles(input.generatedSourceListText ?? "");
  const productCode = input.productCode?.trim() || fullImageReport.data?.product_code || fullImageManifest.data?.product_code || copywriterReport.data?.product_code || renderReport.data?.product_code || "";
  const classification = classifyDetailPageDraft({ renderReport, multiSourceSummary, html: input.html, production });
  const validationErrors = [...renderReport.errors, ...multiSourceSummary.errors, ...fullImageReport.errors, ...fullImageManifest.errors, ...copywriterReport.errors, ...polishedBlueprint.errors];
  const validationWarnings = [...renderReport.warnings, ...multiSourceSummary.warnings, ...fullImageReport.warnings, ...fullImageManifest.warnings, ...copywriterReport.warnings, ...polishedBlueprint.warnings];
  if ((input.fullImageReportText ?? input.fullImageManifestText ?? "").trim()) {
    if (!productionReady) validationWarnings.push("Production-ready checks are not fully satisfied.");
    if (!finalImageUrl) validationWarnings.push("최종 이미지 URL이 없습니다. JPG 열기/다운로드를 사용할 수 없습니다.");
  }
  if ((renderReport.data?.generated_images_used ?? 0) >= GENERATED_IMAGE_REVIEW_THRESHOLD) {
    validationWarnings.push("Generated image usage is high and requires human review before final use.");
  }
  if (typeof renderReport.data?.quality_score === "number" && renderReport.data.quality_score < IDEAL_QUALITY_SCORE) {
    validationWarnings.push("Quality score is below the ideal threshold and needs human review.");
  }
  if (!input.html.trim()) validationErrors.push("detailpage_final.html content is missing.");
  if (!productCode) validationErrors.push("product_code is missing.");
  return { productCode, html: input.html, generatedSourceFiles, renderReport, multiSourceSummary, production, classification, validationErrors, validationWarnings };
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
