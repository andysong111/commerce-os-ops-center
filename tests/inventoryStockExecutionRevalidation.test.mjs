import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const connectionSource = await readFile(
  new URL("../src/lib/inventoryStockConnection.ts", import.meta.url),
  "utf8",
);
const routeSource = await readFile(
  new URL("../src/app/api/inventory-stock-control/sync/route.ts", import.meta.url),
  "utf8",
);

test("passive stock queue observes candidates while execution revalidates", () => {
  assert.match(
    connectionSource,
    /\?mode=\$\{fresh \? "execute" : "observe"\}/,
  );
  assert.match(
    connectionSource,
    /read<Record<string, unknown>>\(INVENTORY_REFRESH_PATH, false\)\.then\(\(\) =>\s*read<T>\(INVENTORY_QUEUE_PATH, true\)/s,
  );
  assert.match(routeSource, /searchParams\.get\("mode"\) === "observe"/);
  assert.match(routeSource, /: "execute";/);
  assert.match(routeSource, /loadLatestInventoryStockSalesTailSnapshots/);
  assert.match(routeSource, /snapshot\.barcode !== row\.barcode/);
  assert.match(routeSource, /snapshot\.resetAt !== row\.resetAt/);
  assert.match(routeSource, /startMs <= resetMs/);
  assert.match(routeSource, /endMs >= resetMs/);
});

test("execute queue remains fail-closed for stale canonical coverage", () => {
  assert.match(
    routeSource,
    /row\.syncNeeded &&\s*\(!row\.syncBlocked \|\|\s*\(mode === "observe" && revalidationBarcodes\.has\(row\.barcode\)\)\)/s,
  );
  assert.match(
    routeSource,
    /mode === "observe"\s*\? observePresentationReport\(authoritativeReport, revalidationBarcodes\)\s*:\s*authoritativeReport/s,
  );
  assert.match(routeSource, /executionRevalidationRequiredCount/);
});
