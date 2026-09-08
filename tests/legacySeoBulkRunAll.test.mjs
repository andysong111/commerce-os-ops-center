import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("이전상품 후보는 작업묶음이 아니라 Shopling 등록완료 전체를 사용한다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs/route.ts");
  const listStart = route.indexOf("async function listLegacyItems");
  const getStart = route.indexOf("export async function GET", listStart);
  const listSource = route.slice(listStart, getStart);

  assert.match(listSource, /shopling_upload_status: "eq\.완료"/);
  assert.doesNotMatch(listSource, /work_batch: "eq\.등록완료건"/);
});

test("RUN 직전 옵션이 없으면 Shopling 근거로 자동 복구하고 다시 읽는다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs/route.ts");
  assert.match(route, /syncLegacySeoShoplingOptions/);
  assert.match(route, /missingOptionModels/);
  assert.match(route, /goodsKeyOverridesFromItems\(items\)/);
  assert.match(route, /bulkMode/);
});

test("옵션 동기화는 tracker goods_key를 Product Master 근거와 병합한다", async () => {
  const sync = await source("src/lib/legacySeoShoplingOptionSync.ts");
  const evidence = await source("src/lib/legacySeoShoplingEvidence.ts");

  assert.match(sync, /detailPageAssetSource/);
  assert.match(sync, /shoplingProducts/);
  assert.match(sync, /goodsKeyOverridesFromItems\(items\)/);
  assert.match(evidence, /LegacySeoGoodsKeyOverrides/);
  assert.match(evidence, /mergeGoodsKeyOverrides/);
});

test("전체 RUN 버튼은 50개 단위로 나누고 bulkMode로 중복 RUN을 막는다", async () => {
  const client = await source(
    "src/app/legacy-seo-bulk-cloud/LegacySeoBulkRunAllEnhancer.tsx",
  );
  assert.match(client, /const CHUNK_SIZE = 50/);
  assert.match(client, /bulkMode: true/);
  assert.match(client, /\["queued", "running", "ready"\]/);
  assert.match(client, /전체 미실행/);
});
