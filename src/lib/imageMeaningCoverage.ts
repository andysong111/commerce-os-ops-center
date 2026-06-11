export const DEFAULT_IMAGE_CONFIDENCE_THRESHOLD = 60;

export type ImageMeaningRole =
  | "hero"
  | "option"
  | "detail_closeup"
  | "lifestyle"
  | "dimension"
  | "packaging"
  | "other"
  | "discard";

export type ProductImageType =
  | "single_product"
  | "multiple_variants"
  | "non_product"
  | "unknown";

export interface ImageMeaningImage {
  id?: string | number;
  url?: string;
  role: ImageMeaningRole;
  confidence?: number;
  priority?: number;
  section_index?: number;
  product_only?: boolean;
  product_type?: ProductImageType;
  clean?: boolean;
  discard?: boolean;
}

export interface LowConfidenceImage {
  image_id: string;
  section_index?: number;
  role: ImageMeaningRole;
  confidence: number;
  warning: "low_confidence_warning";
}

export interface CoverageAdjustment {
  image_id: string;
  action: "hero_fallback" | "coverage_ignored";
  reason:
    | "no_hero_promoted_clean_product_image"
    | "low_confidence_image"
    | "low_confidence_non_product_detail";
  from_role: ImageMeaningRole;
  to_role?: ImageMeaningRole;
}

export interface ImageCoverage {
  score: number;
  hero: number;
  option: number;
  detail_closeup: number;
  lifestyle: number;
  dimension: number;
  packaging: number;
}

export interface ImageCoverageAnalysis {
  images: ImageMeaningImage[];
  coverage: ImageCoverage;
  hero_fallback_applied: boolean;
  low_confidence_images: LowConfidenceImage[];
  coverage_adjustments: CoverageAdjustment[];
}

export interface AnalyzeImageCoverageOptions {
  confidence_threshold?: number;
}

function imageId(image: ImageMeaningImage, index: number): string {
  return image.id == null ? `image_${index}` : String(image.id);
}

function confidenceOf(image: ImageMeaningImage): number {
  return Number.isFinite(image.confidence) ? image.confidence! : 100;
}

function priorityOf(image: ImageMeaningImage): number {
  return Number.isFinite(image.priority) ? image.priority! : 0;
}

function isDiscard(image: ImageMeaningImage): boolean {
  return image.discard === true || image.role === "discard";
}

function isProductImage(image: ImageMeaningImage): boolean {
  if (image.product_only === true) return true;
  if (
    image.product_type === "single_product" ||
    image.product_type === "multiple_variants"
  ) {
    return true;
  }

  // An option classification inherently depicts a purchasable product/variant.
  return image.role === "option";
}

function isCleanProductImage(image: ImageMeaningImage): boolean {
  return !isDiscard(image) && image.clean !== false && isProductImage(image);
}

function productTypeRank(image: ImageMeaningImage): number {
  if (image.product_type === "single_product") return 2;
  if (image.product_type === "multiple_variants") return 1;
  return 0;
}

function compareHeroCandidates(
  left: { image: ImageMeaningImage; index: number },
  right: { image: ImageMeaningImage; index: number },
): number {
  const productOnlyDifference =
    Number(right.image.product_only === true) -
    Number(left.image.product_only === true);
  if (productOnlyDifference) return productOnlyDifference;

  const productTypeDifference =
    productTypeRank(right.image) - productTypeRank(left.image);
  if (productTypeDifference) return productTypeDifference;

  const confidenceDifference =
    confidenceOf(right.image) - confidenceOf(left.image);
  if (confidenceDifference) return confidenceDifference;

  const priorityDifference = priorityOf(right.image) - priorityOf(left.image);
  if (priorityDifference) return priorityDifference;

  return left.index - right.index;
}

function calculateCoverage(images: ImageMeaningImage[]): ImageCoverage {
  const roleCounts = {
    hero: 0,
    option: 0,
    detail_closeup: 0,
    lifestyle: 0,
    dimension: 0,
    packaging: 0,
  };

  for (const image of images) {
    if (image.role in roleCounts) {
      roleCounts[image.role as keyof typeof roleCounts] += 1;
    }
  }

  // Category caps prevent a large number of near-duplicate images from
  // producing an unrealistically complete coverage score.
  const score = Math.min(
    100,
    Math.min(roleCounts.hero, 1) * 40 +
      Math.min(roleCounts.option, 2) * 10 +
      Math.min(roleCounts.detail_closeup, 2) * 10 +
      Math.min(roleCounts.lifestyle, 1) * 15 +
      Math.min(roleCounts.dimension, 1) * 15 +
      Math.min(roleCounts.packaging, 1) * 10,
  );

  return { score, ...roleCounts };
}

/**
 * Normalizes Image Meaning V2 roles before coverage is scored.
 *
 * If V2 produced no usable hero, the strongest clean product image is
 * promoted. Low-confidence images remain in the result for diagnostics but
 * are omitted from role coverage so uncertain classifications do not inflate
 * the score.
 */
export function analyzeImageCoverage(
  inputImages: readonly ImageMeaningImage[],
  options: AnalyzeImageCoverageOptions = {},
): ImageCoverageAnalysis {
  const confidenceThreshold =
    options.confidence_threshold ?? DEFAULT_IMAGE_CONFIDENCE_THRESHOLD;
  const images = inputImages.map((image) => ({ ...image }));
  const coverageAdjustments: CoverageAdjustment[] = [];
  const lowConfidenceImages: LowConfidenceImage[] = [];

  const hasHero = images.some(
    (image) => image.role === "hero" && !isDiscard(image),
  );
  let heroFallbackApplied = false;

  if (!hasHero) {
    const candidate = images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => isCleanProductImage(image))
      .sort(compareHeroCandidates)[0];

    if (candidate) {
      const fromRole = candidate.image.role;
      candidate.image.role = "hero";
      heroFallbackApplied = true;
      coverageAdjustments.push({
        image_id: imageId(candidate.image, candidate.index),
        action: "hero_fallback",
        reason: "no_hero_promoted_clean_product_image",
        from_role: fromRole,
        to_role: "hero",
      });
    }
  }

  const coverageImages = images.filter((image, index) => {
    if (isDiscard(image)) return false;

    const confidence = confidenceOf(image);
    if (confidence >= confidenceThreshold) return true;

    const nonProductDetail =
      image.role === "detail_closeup" && !isProductImage(image);
    lowConfidenceImages.push({
      image_id: imageId(image, index),
      section_index: image.section_index,
      role: image.role,
      confidence,
      warning: "low_confidence_warning",
    });
    coverageAdjustments.push({
      image_id: imageId(image, index),
      action: "coverage_ignored",
      reason: nonProductDetail
        ? "low_confidence_non_product_detail"
        : "low_confidence_image",
      from_role: image.role,
    });
    return false;
  });

  return {
    images,
    coverage: calculateCoverage(coverageImages),
    hero_fallback_applied: heroFallbackApplied,
    low_confidence_images: lowConfidenceImages,
    coverage_adjustments: coverageAdjustments,
  };
}

export const applyImageMeaningCoverageFallback = analyzeImageCoverage;
