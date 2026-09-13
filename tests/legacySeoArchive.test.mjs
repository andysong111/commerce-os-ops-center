import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("완료 일괄보관은 FINAL+Shopling success+미보관 원장만 서버에서 원자적으로 이동한다", async () => {
  const store = await source("src/lib/legacySeoRunJobServer.ts");
  const route = await source("src/app/api/legacy-seo-run-jobs/route.ts");

  const start = store.indexOf("export async function archiveCompletedLegacySeoRunJobs");
  const end = store.indexOf("export async function claimNextLegacySeoRunJob", start);
  assert.ok(start >= 0 && end > start, "archiveCompletedLegacySeoRunJobs helper must exist");
  const helper = store.slice(start, end);
  assert.match(helper, /owner_id: `eq\.\$\{context\.identity\.userId\}`/);
  assert.match(helper, /archived_at: "is\.null"/);
  assert.match(helper, /status: "eq\.ready"/);
  assert.match(helper, /registration_status: "eq\.success"/);
  assert.match(helper, /method: "PATCH"/);
  assert.match(helper, /archived_at: archivedAt/);
  assert.match(route, /action === "archive_completed"/);
  assert.match(route, /archiveCompletedLegacySeoRunJobs\(context\)/);
});

test("보관함 조회는 active 조회와 분리되고 대형 FINAL payload를 읽지 않는다", async () => {
  const lite = await source("src/app/api/legacy-seo-run-jobs-lite/route.ts");
  assert.match(lite, /scope === "archived"/);
  assert.match(lite, /archived_at: archivedOnly \? "not\.is\.null" : "is\.null"/);
  assert.match(lite, /archived_at: text\(row\.archived_at\)/);
  assert.match(lite, /archivedOnly[\s\S]*?ARCHIVED_JOB_SELECT/);

  const selectStart = lite.indexOf("const ARCHIVED_JOB_SELECT");
  const selectEnd = lite.indexOf("].join", selectStart);
  const archiveSelect = lite.slice(selectStart, selectEnd);
  assert.doesNotMatch(archiveSelect, /result_payload|checkpoint_payload|registration_payload|input_payload/);
});

test("UI는 성공건 일괄보관과 보관함을 제공하고 원본 재선택 가능성을 명시한다", async () => {
  const client = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx");
  assert.match(client, /Shopling 완료 전체 보관/);
  assert.match(client, /action",?\s*:\s*"archive_completed"|runAction\("archive_completed"/);
  assert.match(client, /보관함/);
  assert.match(client, /scope=archived&items=false/);
  assert.match(client, /다시 선택하면 새 SEO RUN/);
});

test("수동 재선택은 archived 이력을 제목 제외재료로 쓰되 새 RUN을 허용하고 전체 미실행만 막는다", async () => {
  const route = await source("src/app/api/legacy-seo-run-jobs/route.ts");
  const client = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx");
  const enhancer = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkRunAllEnhancer.tsx");

  assert.match(route, /includeArchived: true/);
  assert.match(route, /const bulkMode = body\.bulkMode === true/);
  assert.match(route, /bulkMode[\s\S]*?bulkBlockedItems/);

  const enqueueStart = client.indexOf("const enqueue =");
  const registerStart = client.indexOf("const registerAll", enqueueStart);
  const manualEnqueue = client.slice(enqueueStart, registerStart);
  assert.match(manualEnqueue, /runAction\("enqueue"/);
  assert.doesNotMatch(manualEnqueue, /bulkMode/);

  assert.match(enhancer, /ARCHIVED_HISTORY_API/);
  assert.match(enhancer, /loadArchivedReadyItemIds/);
  assert.match(enhancer, /archivedReadyIds/);
  assert.match(enhancer, /bulkMode: true/);
});
