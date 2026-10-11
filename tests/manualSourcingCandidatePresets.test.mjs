import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalManualSourcingSourceUrl,
  mergeManualSourcingCandidatePresets,
  OWNER_MANUAL_SOURCING_PRESETS,
} from "../src/lib/manualSourcingCandidatePresets.ts";

test("owner manual sourcing list contains six canonical 1688 products and eight requested options", () => {
  assert.equal(OWNER_MANUAL_SOURCING_PRESETS.length, 6);
  assert.equal(
    OWNER_MANUAL_SOURCING_PRESETS.reduce((sum, product) => sum + product.variants.length, 0),
    8,
  );
  assert.deepEqual(
    OWNER_MANUAL_SOURCING_PRESETS.map(product => product.sourceUrl),
    [
      "https://detail.1688.com/offer/673212748487.html",
      "https://detail.1688.com/offer/923615736263.html",
      "https://detail.1688.com/offer/1043324736129.html",
      "https://detail.1688.com/offer/831359527999.html",
      "https://detail.1688.com/offer/817041594793.html",
      "https://detail.1688.com/offer/668850156055.html",
    ],
  );
  assert.ok(OWNER_MANUAL_SOURCING_PRESETS.every(product => product.variants.every(variant => (
    variant.storageSize === "S" && variant.unitPriceCny > 0 && variant.moq >= 1
  ))));
  assert.deepEqual(
    OWNER_MANUAL_SOURCING_PRESETS.flatMap(product => product.variants.map(variant => ({
      saleOption: variant.saleOption,
      unitPriceCny: variant.unitPriceCny,
      moq: variant.moq,
    }))),
    [
      { saleOption: "단품 그레이", unitPriceCny: 21.5, moq: 10 },
      { saleOption: "단품 그레이", unitPriceCny: 14.5, moq: 1 },
      { saleOption: "단품 그레이", unitPriceCny: 9, moq: 1 },
      { saleOption: "신발 세탁망 · 색상랜덤", unitPriceCny: 12.83, moq: 1 },
      { saleOption: "브라 세탁망 · 색상랜덤", unitPriceCny: 6.08, moq: 1 },
      { saleOption: "단품", unitPriceCny: 3.9, moq: 1 },
      { saleOption: "남성용1쌍과 지압봉", unitPriceCny: 4.1, moq: 1 },
      { saleOption: "여성용1쌍과 지압봉", unitPriceCny: 4.1, moq: 1 },
    ],
  );
});

test("owner small-storage decision replaces an older saved choice without overwriting it during ordinary merges", () => {
  const stored = structuredClone(OWNER_MANUAL_SOURCING_PRESETS);
  stored[0].variants[0].storageSize = "L";
  stored[0].variants[0].unitPriceCny = null;
  stored[0].variants[0].moq = null;

  const ordinaryMerge = mergeManualSourcingCandidatePresets(stored, OWNER_MANUAL_SOURCING_PRESETS);
  assert.equal(ordinaryMerge[0].variants[0].storageSize, "L");
  assert.equal(ordinaryMerge[0].variants[0].unitPriceCny, null);
  assert.equal(ordinaryMerge[0].variants[0].moq, null);

  const ownerPresetRestore = mergeManualSourcingCandidatePresets(
    stored,
    OWNER_MANUAL_SOURCING_PRESETS,
    { preferAdditionFields: true },
  );
  assert.ok(ownerPresetRestore.every(product => product.variants.every(variant => variant.storageSize === "S")));
  assert.equal(ownerPresetRestore[0].variants[0].unitPriceCny, 21.5);
  assert.equal(ownerPresetRestore[0].variants[0].moq, 10);
});

test("tracking URLs normalize and repeated bulk additions remain idempotent by offer and option", () => {
  assert.equal(
    canonicalManualSourcingSourceUrl("https://detail.1688.com/offer/831359527999.html?spm=tracking&clickid=abc"),
    "https://detail.1688.com/offer/831359527999.html",
  );
  const repeated = mergeManualSourcingCandidatePresets(
    OWNER_MANUAL_SOURCING_PRESETS,
    OWNER_MANUAL_SOURCING_PRESETS,
  );
  assert.equal(repeated.length, 6);
  assert.equal(repeated.reduce((sum, product) => sum + product.variants.length, 0), 8);
});
