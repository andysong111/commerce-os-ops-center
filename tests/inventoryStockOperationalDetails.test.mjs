import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL("../src/components/china-order-manager/InventoryStockOperationalDetails.tsx", import.meta.url);
const pagePath = new URL("../src/app/china-order-manager/stock-control/page.tsx", import.meta.url);

test("operational queue first open waits for a fresh inventory evidence read", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /inventoryStockReadClient\.read<Record<string, unknown>>\(INVENTORY_QUEUE_PATH, true\)/);
  assert.match(source, /if \(!detailsRef\.current\?\.open\) return;/);
  assert.match(source, /hasFreshEvidence \? \(\s*<StockSyncOperationalQueuePanel \/>/s);
  assert.match(source, /setHasFreshEvidence\(true\)/);
});

test("stock control page uses the fresh-evidence operational details wrapper", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /InventoryStockOperationalDetails/);
  assert.match(source, /<InventoryStockOperationalDetails \/>/);
  assert.doesNotMatch(source, /<details className=/);
});
