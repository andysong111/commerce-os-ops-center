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
  assert.deepEqual(WAREHOUSE_CAPACITY_ALLOWED_ACTIONS, ["register_slots", "set_slot_allocatable", "set_registry_status"]);
  assert.equal(isWarehouseCapacityWriteAction("register_slots"), true);
  assert.equal(isWarehouseCapacityWriteAction("set_slot_allocatable"), true);
  assert.equal(isWarehouseCapacityWriteAction("set_registry_status"), true);
  assert.equal(isWarehouseCapacityWriteAction("confirm_stock_quantity"), false);
  assert.equal(isWarehouseCapacityWriteAction("sync_shopling"), false);
  assert.equal(isWarehouseCapacityWriteAction("delete_slot"), false);
});

test("warehouse UI never turns an incomplete registry into numeric occupancy or immediate capacity", async () => {
  const ui = await readFile(new URL("../src/app/warehouse-capacity/WarehouseCapacityClient.tsx", import.meta.url), "utf8");
  assert.match(ui, /snapshot\.occupancyRate === null\s*\? "미확정"/);
  assert.match(ui, /formatNumber\(snapshot\.safeImmediateNewSkuCapacity\)/);
  assert.match(ui, /formatNumber\(snapshot\.forecastNewSkuCapacity\)/);
  // The backend intentionally separated actual free space from analytical
  // readiness. Replace the old all-lifecycle copy check with both safety rules.
  assert.match(ui, /즉시 수용량은 전체 물리 위치 목록 확정 후 계산/);
  assert.match(ui, /실제 비워지기 전에는 즉시 수용량에 더하지 않습니다/);
  assert.match(ui, /현재 사용 중 코드만으로 빈 위치를 추정하지 않고/);
  assert.doesNotMatch(ui, /maxBay|maxSlot|parseInt\([^)]*location|BBA\d\+.*capacity/i);
});

test("lifecycle readiness exposes missing, shadow, and baseline data without auto-promoting them", async () => {
  const bridge = await readFile(new URL("../src/lib/warehouseCapacityBridge.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/app/warehouse-capacity/LifecycleReadinessPanel.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/warehouse-capacity/page.tsx", import.meta.url), "utf8");
  for (const field of ["lifecycleAuthoritativeSkuCount", "lifecycleMissingSkuCount", "lifecycleShadowSkuCount", "lifecycleWaitingBaselineSkuCount"]) {
    assert.match(bridge, new RegExp(`${field}: number`));
    assert.match(panel, new RegExp(`snapshot\\.${field}`));
  }
  assert.match(panel, /FAIL-CLOSED/);
  assert.match(panel, /6개월 분석 기준선과 그림자 모드는 별개/);
  assert.match(panel, /그림자 모드는 가격·발주 자동실행을 막으며/);
  assert.match(panel, /누락·기준선 대기 데이터는 자동 승격하지 않습니다/);
  assert.doesNotMatch(panel, /set_registry_status|shadowMode:\s*false|WAITING_BASELINE.*HOLD/);
  assert.match(page, /<LifecycleReadinessPanel \/>/);
});

test("failed warehouse mutations preserve operator input for correction and retry", async () => {
  const ui = await readFile(new URL("../src/app/warehouse-capacity/WarehouseCapacityClient.tsx", import.meta.url), "utf8");
  assert.match(ui, /setMessage\(successMessage\);\s*return true;/);
  assert.match(ui, /setError\([\s\S]*?return false;/);
  assert.match(ui, /if \(ok\) setSlotCodes\(""\)/);
  assert.match(ui, /if \(ok\) setAllocationCodes\(""\)/);
  assert.match(ui, /if \(ok\) setRegistryConfirmation\(""\)/);
  assert.doesNotMatch(ui, /\.then\(\(\) => setSlotCodes\(""\)\)/);
  assert.match(ui, /!payload\.snapshot/);
  assert.match(ui, /if \(savingRef\.current\) return false/);
});

test("capacity proxy keeps the Product Master secret server-side and same-origin guarded", async () => {
  const bridge = await readFile(new URL("../src/lib/warehouseCapacityBridge.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/warehouse-capacity/route.ts", import.meta.url), "utf8");
  assert.match(bridge, /process\.env\.PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(bridge, /x-commerce-os-integration-secret/);
  assert.doesNotMatch(route, /x-commerce-os-integration-secret/);
  assert.doesNotMatch(route, /PRODUCT_MASTER_INTEGRATION_SECRET\s*:/);
  assert.match(route, /import \{ isSameOriginOpsRequest \} from "@\/lib\/opsLoginBypass"/);
  assert.match(route, /export async function GET\(request: Request\)[\s\S]*?if \(!isSameOriginOpsRequest\(request\)\) return unauthorized\(\);/);
  assert.match(route, /export async function POST\(request: Request\)[\s\S]*?if \(!isSameOriginOpsRequest\(request\)\) return unauthorized\(\);/);
  assert.match(route, /WAREHOUSE_CAPACITY_UNAUTHORIZED/);
  assert.match(route, /configured: warehouseCapacityBridgeConfigured\(\)/);
});

test("OPS dashboard and stock page expose the warehouse capacity workflow", async () => {
  const registry = await readFile(new URL("../src/lib/opsModuleRegistry.ts", import.meta.url), "utf8");
  const stockPage = await readFile(new URL("../src/app/china-order-manager/stock-control/page.tsx", import.meta.url), "utf8");
  assert.match(registry, /id: "warehouse-capacity"/);
  assert.match(registry, /route: "\/warehouse-capacity"/);
  assert.match(registry, /미확정 수치 사용 금지/);
  assert.match(stockPage, /href="\/warehouse-capacity"/);
});

test("buffer-only edits preserve registry confirmation and blank input never becomes zero", async () => {
  const ui = await readFile(new URL("../src/app/warehouse-capacity/WarehouseCapacityClient.tsx", import.meta.url), "utf8");
  assert.match(ui, /버퍼만 저장/);
  assert.match(ui, /registryComplete: snapshot\.registryComplete/);
  assert.match(ui, /!validReserve/);
  assert.doesNotMatch(ui, /Number\(reserveSlots \|\| 0\)/);
  assert.match(ui, /registryComplete: false \}/);
});
