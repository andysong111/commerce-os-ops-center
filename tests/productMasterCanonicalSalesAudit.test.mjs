import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [audit, page, sync] = await Promise.all([
  readFile("src/lib/productMasterCanonicalSalesAudit.ts", "utf8"),
  readFile("src/app/stage8-canonical-sales-audit/page.tsx", "utf8"),
  readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
]);

test("canonical audit reuses the exact completed sales-event analysisAsOf", () => {
  assert.match(audit, /status\.state !== "COMPLETED" \|\| !status\.analysisAsOf/);
  assert.match(audit, /analysisAsOf=\$\{encodeURIComponent\(analysisAsOf\)\}/);
  assert.match(audit, /snapshot\.analysisAsOf !== analysisAsOf/);
  assert.match(sync, /analysisAsOf: string \| null/);
  assert.match(sync, /analysisAsOf: request\.analysisAsOf/);
});

test("audit is GET-only and blocks structural canonical mismatches", () => {
  assert.match(audit, /method: "GET"/);
  assert.doesNotMatch(audit, /method: "POST"|method: "PUT"|method: "PATCH"|method: "DELETE"/);
  assert.match(audit, /snapshot\.bucketDays !== 30/);
  assert.match(audit, /snapshot\.bucketCount !== 12/);
  assert.match(audit, /!snapshot\.classificationComplete/);
  assert.match(audit, /snapshot\.orphanEventCount > 0/);
  assert.match(audit, /snapshot\.rows\.length !== snapshot\.managedActiveSkuCount/);
});

test("audit page exposes inactive managed history separately from true orphan events", () => {
  assert.match(page, /비활성 관리 역사/);
  assert.match(page, /실제 orphan/);
  assert.match(page, /inactiveManagedHistoricalSamples/);
  assert.match(page, /현재 활성 SKU의 발주 수요에는 합산하지 않습니다/);
  assert.match(page, /12×30일 계약/);
});
