import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeImageCoverage,
  DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
} from "../src/lib/imageMeaningCoverage.ts";

test("promotes a clean option image when Image Meaning V2 returns no hero", () => {
  const result = analyzeImageCoverage([
    {
      id: "option-low-priority",
      role: "option",
      product_only: true,
      clean: true,
      confidence: 82,
      priority: 10,
    },
    {
      id: "option-high-priority",
      role: "option",
      product_only: true,
      clean: true,
      confidence: 91,
      priority: 20,
    },
  ]);

  assert.equal(result.hero_fallback_applied, true);
  assert.equal(result.images[1].role, "hero");
  assert.equal(result.coverage.hero, 1);
  assert.equal(result.coverage.score, 50);
  assert.deepEqual(result.coverage_adjustments[0], {
    image_id: "option-high-priority",
    action: "hero_fallback",
    reason: "no_hero_promoted_clean_product_image",
    from_role: "option",
    to_role: "hero",
  });
});

test("never promotes discard images to hero", () => {
  const result = analyzeImageCoverage([
    {
      id: "discarded-product",
      role: "option",
      product_only: true,
      clean: true,
      discard: true,
      confidence: 99,
      priority: 100,
    },
  ]);

  assert.equal(result.hero_fallback_applied, false);
  assert.equal(result.images[0].role, "option");
  assert.equal(result.coverage.hero, 0);
  assert.equal(result.coverage.score, 0);
});

test("uses a multiple-variants image only when no stronger single-product candidate exists", () => {
  const withSingle = analyzeImageCoverage([
    {
      id: "variants",
      role: "option",
      product_only: true,
      product_type: "multiple_variants",
      confidence: 98,
      priority: 100,
    },
    {
      id: "single",
      role: "option",
      product_only: true,
      product_type: "single_product",
      confidence: 80,
      priority: 1,
    },
  ]);
  const variantsOnly = analyzeImageCoverage([
    {
      id: "variants",
      role: "option",
      product_type: "multiple_variants",
      confidence: 85,
    },
  ]);

  assert.equal(withSingle.images[1].role, "hero");
  assert.equal(variantsOnly.images[0].role, "hero");
  assert.equal(variantsOnly.hero_fallback_applied, true);
});

test("does not let a low-confidence non-product classification inflate detail coverage", () => {
  const result = analyzeImageCoverage([
    {
      id: "section-17",
      role: "detail_closeup",
      product_only: false,
      product_type: "non_product",
      section_index: 17,
      confidence: 45,
    },
  ]);

  assert.equal(DEFAULT_IMAGE_CONFIDENCE_THRESHOLD, 60);
  assert.equal(result.coverage.detail_closeup, 0);
  assert.equal(result.coverage.score, 0);
  assert.deepEqual(result.low_confidence_images, [
    {
      image_id: "section-17",
      section_index: 17,
      role: "detail_closeup",
      confidence: 45,
      warning: "low_confidence_warning",
    },
  ]);
  assert.equal(
    result.coverage_adjustments[0].reason,
    "low_confidence_non_product_detail",
  );
});

test("hero fallback raises sparse coverage without claiming unrelated roles", () => {
  const result = analyzeImageCoverage([
    {
      id: "clean-option",
      role: "option",
      product_only: true,
      confidence: 90,
    },
    {
      id: "uncertain-detail",
      role: "detail_closeup",
      product_only: false,
      confidence: 45,
    },
  ]);

  assert.equal(result.coverage.score, 40);
  assert.deepEqual(result.coverage, {
    score: 40,
    hero: 1,
    option: 0,
    detail_closeup: 0,
    lifestyle: 0,
    dimension: 0,
    packaging: 0,
  });
});
