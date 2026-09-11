import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { evaluateWarehouseIntakePreflight } from "../src/lib/warehouseIntakePreflight.ts";

const mode = process.env.WAREHOUSE_SMOKE_MODE || "fixture";
assert.ok(["fixture", "live"].includes(mode), "Unsupported smoke mode");
const origin = mode === "live" ? "https://commerce-os-ops-center.vercel.app" : "http://127.0.0.1:3017";
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
assert.ok(modulePath, "Set PLAYWRIGHT_MODULE_PATH to the isolated CI Playwright installation");
const { chromium } = await import(modulePath);
await mkdir("artifacts/warehouse", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
const page = await context.newPage();
const pageErrors = [];
const mutationsPrevented = [];
const report = { mode, origin, passed: [], requestsForwardedWithWriteMethods: 0 };
page.on("pageerror", (error) => pageErrors.push(error.message));
let registryComplete = false;
let simulatePreflightFailure = false;
let interceptedMetadataWrites = 0;

function fixture() {
  return {
    generatedAt: new Date().toISOString(), registryComplete,
    registryConfirmedAt: registryComplete ? new Date().toISOString() : null,
    reserveSlotCount: 2, registeredSlotCount: 12, registeredAllocatableSlotCount: 12,
    registeredBlockedSlotCount: 0, occupiedLocationCount: 2, registeredOccupiedLocationCount: 2,
    freeRegisteredSlotCount: 10, usableFreeSlotCount: registryComplete ? 8 : null,
    occupancyRate: registryComplete ? 16.7 : null, registryCoverageRate: 100,
    unregisteredOccupiedLocationCount: 0, occupiedBlockedLocationCount: 0, occupancyCollisionCount: 0,
    lifecycleReady: false, lifecycleCoveredSkuCount: 1, lifecycleRequiredSkuCount: 2,
    lifecycleAuthoritativeSkuCount: 0, lifecycleMissingSkuCount: 1, lifecycleShadowSkuCount: 1,
    lifecycleWaitingBaselineSkuCount: 1, lifecycleInsufficientHistorySkuCount: 1,
    exitCandidateLocationCount: 0, trustedExitCandidateLocationCount: 0,
    untrustedExitCandidateLocationCount: 0, exitCandidateCountTrusted: true,
    safeImmediateNewSkuCapacity: registryComplete ? 8 : null,
    forecastNewSkuCapacity: registryComplete ? 8 : null,
    forecastIsLowerBound: true, forecastRequiresPhysicalRelease: false,
    sourcingIntakeGate: registryComplete ? "READY" : "WAITING_PHYSICAL_REGISTRY_CONFIRMATION",
    settingsNote: "Synthetic browser fixture only", warnings: [],
    locations: Array.from({ length: 12 }, (_, index) => ({
      locationCode: `FIXTURE-${index + 1}`, registered: true, allocatable: true,
      occupied: index < 2, zone: "가상 테스트 구역", source: "synthetic_fixture", note: "실재 창고 데이터 아님",
      exitCandidate: false, trustedExitCandidate: false,
      occupants: index < 2 ? [{ skuId: `fixture-${index}`, modelNo: `TEST-${index}`, productName: "가상 테스트 상품", optionName: "단품", lifecycleStatus: "ACTIVE", reorderingAllowed: true, discontinued: false, clearanceStage: 0, lastAction: "WAITING_BASELINE", shadowMode: true, baselineReady: false }] : [],
    })),
  };
}

// Every browser request is fenced. Production smoke never forwards POST/PUT/
// PATCH/DELETE and never opens other operational APIs. Fixture metadata writes
// are fulfilled in memory to test input retention, never sent to an app server.
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const writeMethod = !["GET", "HEAD"].includes(request.method());
  if (writeMethod) {
    mutationsPrevented.push({ method: request.method(), path: url.pathname });
    if (mode === "fixture" && url.origin === origin && url.pathname === "/api/warehouse-capacity") {
      interceptedMetadataWrites += 1;
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, message: "가상 저장 실패 · 입력 유지 테스트" }) });
    }
    return route.abort("blockedbyclient");
  }
  if (url.origin !== origin) return route.abort("blockedbyclient");
  if (url.pathname.startsWith("/api/") && ![
    "/api/warehouse-capacity", "/api/warehouse-capacity/intake-preflight",
  ].includes(url.pathname)) return route.abort("blockedbyclient");
  if (mode === "fixture" && url.pathname === "/api/warehouse-capacity") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, configured: true, snapshot: fixture() }) });
  }
  if (mode === "fixture" && url.pathname === "/api/warehouse-capacity/intake-preflight") {
    if (simulatePreflightFailure) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "가상 연결 실패" }) });
    const preflight = evaluateWarehouseIntakePreflight(fixture(), Object.fromEntries(url.searchParams));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, preflight }) });
  }
  return route.continue();
});

async function visible(locator) { await locator.waitFor({ state: "visible", timeout: 30000 }); }

try {
  await page.goto(`${origin}/warehouse-capacity`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await visible(page.getByRole("heading", { name: "창고 위치·수용능력", exact: true }));
  const panel = page.getByRole("region", { name: "신규 소싱 공간 사전점검" });
  const submit = panel.getByRole("button", { name: "공간 사전점검 · 실제 발주 없음" });
  await visible(submit);
  assert.equal(await submit.isDisabled(), true);
  await panel.getByLabel("검토할 신규 상품 수", { exact: true }).fill("2");
  await panel.getByLabel("상품당 옵션 수", { exact: true }).fill("3");
  assert.equal(await submit.isDisabled(), true, "Pending commitments must be explicit");
  await panel.getByLabel("미배정 입고·발주 선점 위치 수", { exact: true }).fill("0");
  report.passed.push("explicit-commitment-input-required");

  if (mode === "live") {
    // Synthetic input is only used to exercise this read-only route; it is not
    // an assertion that the user's real inbound commitments are zero.
    const evidence = await page.evaluate(async () => {
      const capacityResponse = await fetch("/api/warehouse-capacity", { cache: "no-store" });
      const capacity = await capacityResponse.json();
      const response = await fetch("/api/warehouse-capacity/intake-preflight?productCount=2&optionsPerProduct=3&slotsPerSku=1&committedSlots=0", { cache: "no-store" });
      const result = await response.json();
      return { capacityStatus: capacityResponse.status, capacity, preflightStatus: response.status, result };
    });
    assert.equal(evidence.capacityStatus, 200);
    assert.equal(evidence.capacity.ok, true);
    assert.equal(evidence.preflightStatus, 200);
    assert.equal(evidence.result.ok, true);
    assert.equal(evidence.result.preflight.executionAllowed, false);
    assert.equal(evidence.result.preflight.mode, "DRY_RUN");
    const actual = evidence.capacity.snapshot;
    assert.equal(typeof actual.forecastRequiresPhysicalRelease, "boolean", "Updated Product Master contract must be deployed");
    if (!actual.registryComplete) {
      assert.equal(actual.safeImmediateNewSkuCapacity, null);
      assert.equal(actual.forecastNewSkuCapacity, null);
      assert.equal(evidence.result.preflight.decision, "BLOCKED");
      assert.equal(evidence.result.preflight.availableSlots, null);
    }
    await submit.click();
    await visible(panel.getByRole("heading", { name: actual.registryComplete ? /위치 수|공간 판단 보류/ : "공간 판단 보류 · 원장 확인 필요" }));
    report.live = {
      registryComplete: actual.registryComplete,
      registeredSlotCount: actual.registeredSlotCount,
      occupiedLocationCount: actual.occupiedLocationCount,
      reserveSlotCount: actual.reserveSlotCount,
      lifecycleCoveredSkuCount: actual.lifecycleCoveredSkuCount,
      lifecycleRequiredSkuCount: actual.lifecycleRequiredSkuCount,
      lifecycleMissingSkuCount: actual.lifecycleMissingSkuCount,
      decision: evidence.result.preflight.decision,
      executionAllowed: false,
      syntheticInputUsed: true,
    };
    report.passed.push("production-same-origin-capacity-read", "production-read-only-preflight", "updated-product-master-contract", "unconfirmed-physical-registry-stays-blocked");
    assert.equal(mutationsPrevented.length, 0, "Live page should not even attempt writes");
  } else {
    await submit.click();
    await visible(panel.getByRole("heading", { name: "공간 판단 보류 · 원장 확인 필요" }));
    assert.match(await panel.innerText(), /가용 위치 미확정/);
    report.passed.push("unconfirmed-registry-shows-no-capacity");

    registryComplete = true;
    await submit.click();
    await visible(panel.getByRole("heading", { name: "입력한 조건에서 위치 수 충족 · 발주 승인 아님" }));
    assert.match(await panel.innerText(), /필요 위치 6개/);
    assert.match(await panel.innerText(), /가용 위치 8개/);
    report.passed.push("product-and-option-aware-space-fit");

    await panel.getByLabel("상품당 옵션 수", { exact: true }).fill("5");
    assert.equal(await panel.getByRole("heading", { name: "입력한 조건에서 위치 수 충족 · 발주 승인 아님" }).count(), 0);
    await submit.click();
    await visible(panel.getByRole("heading", { name: "입력한 조건에서 위치 수 부족" }));
    assert.match(await panel.innerText(), /부족 위치 2개/);
    report.passed.push("input-change-clears-prior-pass", "space-shortfall-rendered");

    simulatePreflightFailure = true;
    await submit.click();
    await visible(panel.getByRole("alert"));
    assert.match(await panel.getByRole("alert").innerText(), /가상 연결 실패/);
    assert.equal(await panel.getByLabel("상품당 옵션 수", { exact: true }).inputValue(), "5");
    simulatePreflightFailure = false;
    await submit.click();
    await visible(panel.getByRole("heading", { name: "입력한 조건에서 위치 수 부족" }));
    report.passed.push("read-failure-retains-input-and-retries");

    await page.getByText("위치코드 레지스트리 관리 · 고급", { exact: true }).click();
    await page.getByLabel("추가할 물리 위치코드", { exact: true }).fill("FIXTURE-ONLY-13");
    await page.getByRole("button", { name: "위치코드 추가", exact: true }).click();
    await visible(page.getByRole("alert"));
    assert.equal(await page.getByLabel("추가할 물리 위치코드", { exact: true }).inputValue(), "FIXTURE-ONLY-13");
    assert.equal(interceptedMetadataWrites, 1);
    await page.getByLabel("예약 버퍼", { exact: true }).fill("");
    assert.equal(await page.getByRole("button", { name: "버퍼만 저장", exact: true }).isDisabled(), true);
    report.passed.push("failed-metadata-write-preserves-input", "blank-buffer-write-disabled");
    await page.screenshot({ path: "artifacts/warehouse/fixture-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/warehouse/fixture-mobile.png", fullPage: true });
  }
  assert.deepEqual(pageErrors, [], "Browser must not report uncaught page errors");
  report.passed.push("no-uncaught-browser-errors", "no-forwarded-write-requests");
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  if (mode === "fixture") await page.screenshot({ path: "artifacts/warehouse/fixture-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  report.pageErrorCount = pageErrors.length;
  report.interceptedSyntheticMetadataWrites = interceptedMetadataWrites;
  await writeFile("artifacts/warehouse/browser-summary.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
