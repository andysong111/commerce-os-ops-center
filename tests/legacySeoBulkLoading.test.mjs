import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("이전상품 SEO 목록 조회는 대형 checkpoint 전체가 아닌 compact endpoint를 사용한다", async () => {
  const lite = await source("src/app/api/legacy-seo-run-jobs-lite/route.ts");
  const shim = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkListFetchShim.tsx");
  const page = await source("src/app/legacy-seo-bulk-cloud/page.tsx");

  assert.match(lite, /legacy_source_mode:checkpoint_payload->legacySourceMode/);
  assert.doesNotMatch(lite, /"checkpoint_payload",/);
  assert.match(lite, /registration_payload: \{\}/);
  assert.match(shim, /LITE_API_PATH = "\/api\/legacy-seo-run-jobs-lite"/);
  assert.match(shim, /method === "GET"/);
  assert.match(shim, /AbortSignal\.timeout\(LIST_TIMEOUT_MS\)/);
  assert.match(page, /<LegacySeoBulkListFetchShim \/>/);
});

test("전체 RUN enhancer는 MutationObserver 안에서 DOM을 재작성하지 않는다", async () => {
  const enhancer = await source(
    "src/app/legacy-seo-bulk-cloud/LegacySeoBulkRunAllEnhancer.tsx",
  );

  assert.doesNotMatch(enhancer, /new MutationObserver/);
  assert.doesNotMatch(enhancer, /\.textContent\s*=/);
  assert.match(enhancer, /window\.setInterval\(syncDom, 1_000\)/);
});
