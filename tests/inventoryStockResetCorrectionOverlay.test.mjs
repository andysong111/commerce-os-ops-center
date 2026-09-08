import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("superseded stock reset events are removed before report and Shopling queue generation", async () => {
  const overlay = await readFile(
    "src/lib/inventoryStockResetCorrections.ts",
    "utf8",
  );
  const stateRoute = await readFile(
    "src/app/api/inventory-stock-control/route.ts",
    "utf8",
  );
  const syncRoute = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );

  assert.match(overlay, /INVENTORY_STOCKOUT_RESET_SUPERSEDE_EVENT/);
  assert.match(overlay, /supersededResetEventId/);
  assert.match(overlay, /removedIds/);
  assert.match(overlay, /pendingSyncCount/);
  assert.match(stateRoute, /overlayInventoryStockControlReportWithResetCorrections/);
  assert.match(syncRoute, /overlayInventoryStockControlReportWithResetCorrections/);
  assert.match(syncRoute, /loadCorrectedReport/);
});
