import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legacy SEO polling isolates FINAL ledger from heavy catalog reads", async () => {
  const lite = await source("src/app/api/legacy-seo-run-jobs-lite/route.ts");
  const client = await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx");
  const page = await source("src/app/legacy-seo-bulk-cloud/page.tsx");
  assert.doesNotMatch(lite, /\"input_payload\",/);
  assert.doesNotMatch(lite, /item_payload->legacySeoRegistrationPolicy/);
  assert.match(lite, /Promise\.allSettled/);
  assert.match(lite, /includeJobs/);
  assert.match(client, /\?items=false/);
  assert.match(client, /\?jobs=false&items=true/);
  assert.match(client, /const POLL_MS = 60_000/);
  assert.match(client, /document\.visibilityState === "visible"/);
  assert.doesNotMatch(client, /load\(true\)/);
  assert.doesNotMatch(page, /LegacySeoSourceRecoveryEnhancer/);
});
