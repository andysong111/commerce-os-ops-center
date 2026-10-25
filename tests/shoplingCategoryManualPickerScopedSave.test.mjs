import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual Shopling category approval uses a scoped tracker mutation", async () => {
  const picker = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryManualPicker.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(picker, /OPTIMIZED_ENDPOINT = "\/api\/product-launch-tracker\/optimized"/);
  assert.match(picker, /operation: "bulk_patch_items"/);
  assert.match(picker, /expectedUpdatedAt: text\(current\.updatedAt\)/);
  assert.match(picker, /categoryAiStatus: "review_approved"/);
  assert.match(picker, /const next = await readServerState\(\)/);
  assert.doesNotMatch(picker, /method: "PUT"/);
  assert.doesNotMatch(picker, /JSON\.stringify\(\{ state: next \}\)/);
});
