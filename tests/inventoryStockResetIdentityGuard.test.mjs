import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("prepared Shopling canary identities guard one-edit B-code typos", async () => {
  const identity = await readFile(
    "src/lib/inventoryStockResetIdentity.ts",
    "utf8",
  );
  const route = await readFile(
    "src/app/api/inventory-stock-control/route.ts",
    "utf8",
  );

  assert.match(identity, /A6_UNIQUENESS_CONFIRMED/);
  assert.match(identity, /EXACT_ONE_ROW_CONFIRMED/);
  assert.match(identity, /editDistance/);
  assert.match(identity, /STOCKOUT_RESET_BARCODE_POSSIBLE_TYPO/);
  assert.match(identity, /STOCKOUT_RESET_MODEL_MISMATCH/);
  assert.match(route, /validateInventoryStockoutResetIdentity/);
});
