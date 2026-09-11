import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WAREHOUSE_CAPACITY_ALLOWED_ACTIONS,
  WarehouseCapacityBridgeError,
  getWarehouseCapacitySnapshot,
  isWarehouseCapacityWriteAction,
  warehouseCapacityBridgeConfigured,
} from "../src/lib/warehouseCapacityBridge.ts";

test("OPS capacity bridge fails closed when the server integration secret is absent", async () => {
  const previous = process.env.PRODUCT_MASTER_INTEGRATION_SECRET;
  delete process.env.PRODUCT_MASTER_INTEGRATION_SECRET;
  try {
    assert.equal(warehouseCapacityBridgeConfigured(), false);
    await assert.rejects(
      () => getWarehouseCapacitySnapshot(),
      (error) => {
        assert.equal(error instanceof WarehouseCapacityBridgeError, true);
        assert.equal(error.code, "PRODUCT_MASTER_INTEGRATION_NOT_CONFIGURED");
        assert.equal(error.status, 503);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.PRODUCT_MASTER_INTEGRATION_SECRET;
    else process.env.PRODUCT_MASTER_INTEGRATION_SECRET = previous;
  }
});

test("OPS capacity proxy exposes only the three metadata actions", () => {
  assert.deepEqual(WAREHOUSE_CAPACITY_ALLOWED_ACTIONS, [
    "register_slots",
    "set_slot_allocatable",
    "set_registry_status",
  ]);
  assert.equal(isWarehouseCapacityWriteAction("register_slots"), true);
  assert.equal(isWarehouseCapacityWriteAction("set_slot_allocatable"), true);
  assert.equal(isWarehouseCapacityWriteAction("set_registry_status"), true);
  assert.equal(isWarehouseCapacityWriteAction("confirm_stock_quantity"), false);
  assert.equal(isWarehouseCapacityWriteAction("sync_shopling"), false);
  assert.equal(isWarehouseCapacityWriteAction("delete_slot"), false);
});

test("warehouse UI never turns an incomplete registry into a numeric occupancy or sourcing capacity", async () => {
  const ui = await readFile(
    new URL(
      "../src/app/warehouse-capacity/WarehouseCapacityClient.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(ui, /snapshot\.occupancyRate === null \? "미확정"/);
  assert.match(ui, /formatNumber\(snapshot\.safeImmediateNewSkuCapacity\)/);
  assert.match(ui, /formatNumber\(snapshot\.forecastNewSkuCapacity\)/);
  assert.match(ui, /전체 위치 목록과 생애주기 기준이 확정된 뒤에만/);
  assert.match(ui, /현재 사용 중 코드만으로 빈 위치를 추정하지 않고/);
  assert.doesNotMatch(ui, /maxBay|maxSlot|parseInt\([^)]*location|BBA\d\+.*capacity/i);
});

test("capacity proxy keeps the Product Master secret server-side", async () => {
  const bridge = await readFile(
    new URL("../src/lib/warehouseCapacityBridge.ts", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../src/app/api/warehouse-capacity/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(bridge, /process\.env\.PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(bridge, /x-commerce-os-integration-secret/);
  assert.doesNotMatch(route, /x-commerce-os-integration-secret/);
  assert.doesNotMatch(route, /PRODUCT_MASTER_INTEGRATION_SECRET\s*:/);
  assert.match(route, /configured: warehouseCapacityBridgeConfigured\(\)/);
});

test("OPS dashboard and stock page expose the warehouse capacity workflow", async () => {
  const registry = await readFile(
    new URL("../src/lib/opsModuleRegistry.ts", import.meta.url),
    "utf8",
  );
  const stockPage = await readFile(
    new URL(
      "../src/app/china-order-manager/stock-control/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(registry, /id: "warehouse-capacity"/);
  assert.match(registry, /route: "\/warehouse-capacity"/);
  assert.match(registry, /미확정 수치 사용 금지/);
  assert.match(stockPage, /href="\/warehouse-capacity"/);
});
