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
    variant.storageSize === "S" && variant.unitPriceCny === null && variant.moq === null
  ))));
});

test("owner small-storage decision replaces an older saved choice without overwriting it during ordinary merges", () => {
  const stored = structuredClone(OWNER_MANUAL_SOURCING_PRESETS);
  stored[0].variants[0].storageSize = "L";

  const ordinaryMerge = mergeManualSourcingCandidatePresets(stored, OWNER_MANUAL_SOURCING_PRESETS);
  assert.equal(ordinaryMerge[0].variants[0].storageSize, "L");

  const ownerPresetRestore = mergeManualSourcingCandidatePresets(
    stored,
    OWNER_MANUAL_SOURCING_PRESETS,
    { preferAdditionFields: true },
  );
  assert.ok(ownerPresetRestore.every(product => product.variants.every(variant => variant.storageSize === "S")));
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
