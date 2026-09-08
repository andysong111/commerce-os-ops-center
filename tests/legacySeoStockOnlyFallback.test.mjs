import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("확인된 이전상품만 Shopling 근거 없음에서 실재고 사전 SEO fallback을 허용한다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs-enqueue/route.ts");
  assert.match(route, /isConfirmedLegacyInventoryModel/);
  assert.match(route, /:Shopling데이터없음/);
  assert.match(route, /stock:\/\/legacy\//);
  assert.match(route, /legacy_stock_sheet_seo_cloud_v1/);
  assert.match(route, /stock_sheet_fallback/);
  assert.match(route, /stock_sheet_only/);
  assert.match(route, /legacySeoRegistrationExclusion/);
});

test("fallback SEO 재료에는 실재고 상품명·모델번호·판매옵션·중국옵션을 포함한다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs-enqueue/route.ts");
  assert.match(route, /실재고 사전 기존상품/);
  assert.match(route, /모델번호:/);
  assert.match(route, /판매옵션\/중국옵션/);
  assert.match(route, /row\.chinaOption/);
  assert.match(route, /row\.saleOption/);
});

test("기존 enqueue 결과를 먼저 사용하고 Shopling데이터없음 항목만 보충한다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs-enqueue/route.ts");
  assert.match(route, /legacySeoRunJobsPost/);
  assert.match(route, /primaryResponse/);
  assert.match(route, /remainingMissing/);
  assert.match(route, /stockSheetFallbackCount/);
  assert.match(route, /insertedCount: primaryInserted \+ inserted\.length/);
});

test("브라우저 shim은 목록 GET은 lite로, enqueue POST만 fallback orchestrator로 보낸다", async () => {
  const shim = await source(
    "src/app/legacy-seo-bulk-cloud/LegacySeoBulkListFetchShim.tsx",
  );
  assert.match(shim, /LITE_API_PATH/);
  assert.match(shim, /ENQUEUE_API_PATH/);
  assert.match(shim, /method === "GET"/);
  assert.match(shim, /method === "POST" && isEnqueueBody\(init\)/);
  assert.match(shim, /legacy-seo-run-jobs-enqueue/);
});
