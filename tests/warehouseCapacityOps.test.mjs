import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  warehouseCapacityBridgeConfigured,
  isWarehouseCapacityWriteAction,
} from "../src/lib/warehouseCapacityBridge.ts";

const originalFetch = global.fetch;

function withEnv(patch, fn) {
  const before = {};
  for (const [key, value] of Object.entries(patch)) {
    before[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("OPS capacity bridge fails closed when the server integration secret is absent", async () => {
  const { getWarehouseCapacitySnapshot } = await import(
    "../src/lib/warehouseCapacityBridge.ts"
  );
  await withEnv(
    {
      PRODUCT_MASTER_BASE_URL: "https://product-master.example.com",
      PRODUCT_MASTER_INTEGRATION_SECRET: null,
    },
    async () => {
      assert.equal(warehouseCapacityBridgeConfigured(), false);
      await assert.rejects(
        () => getWarehouseCapacitySnapshot(),
        (error) => error?.code === "WAREHOUSE_CAPACITY_NOT_CONFIGURED",
      );
    },
  );
});

test("OPS capacity proxy exposes only the three metadata actions", () => {
  assert.equal(isWarehouseCapacityWriteAction("register_locations"), true);
  assert.equal(isWarehouseCapacityWriteAction("update_settings"), true);
  assert.equal(isWarehouseCapacityWriteAction("register_active_location_codes"), true);
  assert.equal(isWarehouseCapacityWriteAction("delete_locations"), false);
  assert.equal(isWarehouseCapacityWriteAction("reserve"), false);
});

test("warehouse UI never turns an incomplete registry into a numeric occupancy or sourcing capacity", async () => {
  const source = await readFile(
    new URL(
      "../src/app/warehouse-capacity/WarehouseCapacityClient.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /registryComplete/);
  assert.match(source, /기준 위치 원장 미확정/);
  assert.match(source, /확정 전에는 사용률·여유칸·신규 소싱 가능 칸을 숫자로 표시하지 않습니다/);
  assert.doesNotMatch(source, /\?\?\s*0/);
});

test("lifecycle readiness panel exposes missing, shadow, and baseline blockers without auto-promoting them", async () => {
  const source = await readFile(
    new URL(
      "../src/app/warehouse-capacity/WarehouseCapacityClient.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /lifecycleMissing/);
  assert.match(source, /lifecycleShadow/);
  assert.match(source, /lifecyclePendingBaseline/);
  assert.match(source, /등급 미연결/);
  assert.match(source, /Shadow 등급/);
  assert.match(source, /Baseline 대기/);
});

test("failed warehouse mutations preserve operator input for correction and retry", async () => {
  const source = await readFile(
    new URL(
      "../src/app/warehouse-capacity/WarehouseCapacityClient.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /catch \(error\)/);
  assert.match(source, /setErrorMessage/);
  assert.doesNotMatch(
    source,
    /catch \(error\)[\s\S]{0,220}(?:setRegisterText\(""\)|setReplaceText\(""\))/,
  );
});

test("capacity proxy keeps the Product Master secret server-side and same-origin guarded", async () => {
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
  assert.match(route, /import \{ isSameOriginOpsRequest \} from "@\/lib\/opsLoginBypass"/);
  assert.match(
    route,
    /export async function GET\(request: Request\)[\s\S]*?if \(!isSameOriginOpsRequest\(request\)\) return unauthorized\(\);/,
  );
  assert.match(
    route,
    /export async function POST\(request: Request\)[\s\S]*?if \(!isSameOriginOpsRequest\(request\)\) return unauthorized\(\);/,
  );
  assert.match(route, /WAREHOUSE_CAPACITY_UNAUTHORIZED/);
  assert.match(route, /configured: warehouseCapacityBridgeConfigured\(\)/);
});

test("OPS dashboard uses the physical warehouse map as the official entry while preserving the legacy diagnostic route", async () => {
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
  assert.match(registry, /title: "창고 지도·위치코드 관리"/);
  assert.match(
    registry,
    /route: "https:\/\/storage-organization\.vercel\.app\/warehouse-map\/index\.html"/,
  );
  assert.match(registry, /externalProject: true/);
  assert.match(registry, /1,164개 물리 수납칸/);
  assert.match(registry, /미실사 공간 자동배정 금지/);
  assert.match(registry, /미확인·점유추정 칸은 실물 확인 전 빈자리로 계산하지 않으며/);
  assert.match(stockPage, /href="\/warehouse-capacity"/);
});
