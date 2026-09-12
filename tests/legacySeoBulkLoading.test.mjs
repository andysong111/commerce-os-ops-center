import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("이전상품 SEO 목록 조회는 대형 checkpoint를 읽거나 nested 추출하지 않는다", async () => {
  const lite = await source("src/app/api/legacy-seo-run-jobs-lite/route.ts");
  const shim = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkListFetchShim.tsx");
  const page = await source("src/app/legacy-seo-bulk-cloud/page.tsx");

  assert.doesNotMatch(lite, /checkpoint_payload->/);
  assert.doesNotMatch(lite, /"checkpoint_payload",/);
  assert.match(lite, /checkpoint_payload: \{\}/);
  assert.match(lite, /registration_payload: \{\}/);
  assert.match(shim, /LITE_API_PATH = "\/api\/legacy-seo-run-jobs-lite"/);
  assert.match(shim, /method === "GET"/);
  assert.match(shim, /AbortSignal\.timeout\(LIST_TIMEOUT_MS\)/);
  assert.match(page, /<LegacySeoBulkListFetchShim \/>/);
});

test("Shopling 등록은 checkpoint 없는 전용 조회와 8건 제한을 사용한다", async () => {
  const store = await source("src/lib/legacySeoRegistrationRunStore.ts");
  const route = await source("src/app/api/legacy-seo-run-jobs/route.ts");
  const registration = await source("src/lib/legacySeoShoplingRegistration.ts");
  const client = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx");

  const selectStart = store.indexOf("const REGISTRATION_SELECT");
  const patchStart = store.indexOf("const REGISTRATION_PATCH_SELECT", selectStart);
  const selectSource = store.slice(selectStart, patchStart);
  assert.match(selectSource, /input_payload/);
  assert.match(selectSource, /result_payload/);
  assert.match(selectSource, /registration_payload/);
  assert.doesNotMatch(selectSource, /checkpoint_payload/);

  const patchTypeStart = store.indexOf("type UnknownRecord", patchStart);
  const patchSelect = store.slice(patchStart, patchTypeStart);
  assert.match(patchSelect, /run_id/);
  assert.match(patchSelect, /registration_status/);
  assert.doesNotMatch(patchSelect, /checkpoint_payload|input_payload|result_payload|registration_payload/);

  const registerStart = route.indexOf('if (action === "register")');
  const registerEnd = route.indexOf('if (action === "pulse")', registerStart);
  const registerSource = route.slice(registerStart, registerEnd);
  assert.match(route, /const REGISTRATION_BATCH_LIMIT = 8/);
  assert.match(registerSource, /listLegacySeoRegistrationJobs\(context, runIds\)/);
  assert.doesNotMatch(registerSource, /listLegacySeoRunJobs\(/);

  assert.match(registration, /patchLegacySeoRegistrationStatus/);
  assert.doesNotMatch(registration, /patchOwnedLegacySeoRunJobs/);
  assert.match(store, /LEGACY_SEO_REGISTRATION_PATCH_MISMATCH/);

  assert.match(client, /const REGISTRATION_BATCH_SIZE = 8/);
  assert.match(client, /const REGISTRATION_BATCH_DELAY_MS = 750/);
  assert.match(client, /for \(let index = 0; index < runIds.length; index \+= REGISTRATION_BATCH_SIZE\)/);
  assert.match(client, /runIds.slice\(index, index \+ REGISTRATION_BATCH_SIZE\)/);
  assert.match(client, /action: "register", runIds: batch/);
  assert.match(client, /FINAL 전체 Shopling 신규등록/);
});

test("전체 RUN enhancer는 MutationObserver 안에서 DOM을 재작성하지 않는다", async () => {
  const enhancer = await source(
    "src/app/legacy-seo-bulk-cloud/LegacySeoBulkRunAllEnhancer.tsx",
  );

  assert.doesNotMatch(enhancer, /new MutationObserver/);
  assert.doesNotMatch(enhancer, /\.textContent\s*=/);
  assert.match(enhancer, /window\.setInterval\(syncDom, 1_000\)/);
});
