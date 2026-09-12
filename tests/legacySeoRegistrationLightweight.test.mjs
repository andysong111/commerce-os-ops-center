import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Shopling 등록 전용 RUN 조회는 checkpoint를 절대 읽지 않는다", async () => {
  const store = await source("src/lib/legacySeoRegistrationRunStore.ts");
  const selectStart = store.indexOf("const REGISTRATION_SELECT");
  const patchStart = store.indexOf("const REGISTRATION_PATCH_SELECT", selectStart);
  const selectSource = store.slice(selectStart, patchStart);
  assert.match(selectSource, /input_payload/);
  assert.match(selectSource, /result_payload/);
  assert.match(selectSource, /registration_payload/);
  assert.doesNotMatch(selectSource, /checkpoint_payload/);
  assert.match(store, /LEGACY_SEO_REGISTRATION_PATCH_MISMATCH/);
});

test("register POST는 대형 범용 RUN 조회 대신 전용 compact 조회를 사용한다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs/route.ts");
  assert.match(route, /const REGISTRATION_BATCH_LIMIT = 8/);
  const start = route.indexOf('if (action === "register")');
  const end = route.indexOf('if (action === "pulse")', start);
  const register = route.slice(start, end);
  assert.match(register, /listLegacySeoRegistrationJobs\(context, runIds\)/);
  assert.doesNotMatch(register, /listLegacySeoRunJobs\(/);
});

test("등록 상태 PATCH는 multi-MB checkpoint를 반환하지 않는다", async () => {
  const registration = await source("src/lib/legacySeoShoplingRegistration.ts");
  assert.match(registration, /patchLegacySeoRegistrationStatus/);
  assert.doesNotMatch(registration, /patchOwnedLegacySeoRunJobs/);
  const store = await source("src/lib/legacySeoRegistrationRunStore.ts");
  const patchStart = store.indexOf("const REGISTRATION_PATCH_SELECT");
  const typeStart = store.indexOf("type UnknownRecord", patchStart);
  const patchSelect = store.slice(patchStart, typeStart);
  assert.match(patchSelect, /run_id/);
  assert.match(patchSelect, /registration_status/);
  assert.doesNotMatch(patchSelect, /checkpoint_payload|input_payload|result_payload/);
});

test("전체 등록 UI는 한 요청당 8건으로 제한해 반복 클릭이 안전하다", async () => {
  const client = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx");
  assert.match(client, /const REGISTRATION_BATCH_SIZE = 8/);
  assert.match(client, /slice\(0, REGISTRATION_BATCH_SIZE\)/);
  assert.match(client, /FINAL Shopling 신규등록 \(8건씩\)/);
});
