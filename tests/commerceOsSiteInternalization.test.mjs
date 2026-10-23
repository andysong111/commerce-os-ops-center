import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chinaPage = await readFile("src/app/china-order-manager/page.tsx", "utf8");
const cashEnvelopePage = await readFile(
  "src/app/china-order-manager/cash-envelope/page.tsx",
  "utf8",
);
const pricePage = await readFile("src/app/price-adjustment-engine/page.tsx", "utf8");
const registry = await readFile("src/lib/extendedModuleRegistry.ts", "utf8");
const chinaAdapter = await readFile("src/lib/integrations/chinaOrderManager.ts", "utf8");
const priceAdapter = await readFile("src/lib/integrations/priceAdjustmentEngine.ts", "utf8");

test("China order manager stays inside Ops Center and exposes the purchase-run workspace", () => {
  assert.doesNotMatch(chinaPage, /redirect\(/);
  assert.doesNotMatch(chinaPage, /chatgpt\.site/);
  assert.match(chinaPage, /발주차시·입고 관리/);
  assert.match(chinaPage, /현재 지출가능금액/);
  assert.match(chinaPage, /배송대행지 바코드 출력/);
  assert.match(chinaPage, /title="자금 마감"/);
  assert.match(cashEnvelopePage, /현금 제약 발주/);
  assert.match(cashEnvelopePage, /InternalChinaCashEnvelopePanel/);
  assert.match(registry, /module\.id === "china-order-cost"/);
  assert.match(registry, /route: "\/china-order-manager"/);
  assert.match(registry, /externalProject: false/);
});

test("Price adjustment dashboard uses an internal route and keeps actual price writes blocked", () => {
  assert.match(pricePage, /loadPriceAdjustmentDashboard/);
  assert.match(pricePage, /href="\/shopling-price-adjustment-runner"/);
  assert.match(pricePage, /실제 가격변경 차단/);
  assert.match(registry, /route: "\/price-adjustment-engine"/);
  assert.doesNotMatch(registry, /route:\s*process\.env\.NEXT_PUBLIC_PRICE_ADJUSTMENT_ENGINE_URL/);
});

test("Internalization adapters are read-only and never invoke external write methods", () => {
  for (const source of [chinaAdapter, priceAdapter]) {
    assert.doesNotMatch(source, /method:\s*"POST"/);
    assert.doesNotMatch(source, /method:\s*"PUT"/);
    assert.doesNotMatch(source, /method:\s*"PATCH"/);
    assert.doesNotMatch(source, /method:\s*"DELETE"/);
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  }
  assert.match(chinaAdapter, /writesEnabled: false/);
  assert.match(priceAdapter, /writesEnabled: false/);
});
