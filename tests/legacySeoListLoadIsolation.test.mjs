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
  assert.match(client, /load\(true\)/);
  assert.match(client, /setInterval\(\(\) => void load\(false\), POLL_MS\)/);
  assert.match(client, /\?items=\$\{includeItems/);
  assert.doesNotMatch(page, /LegacySeoSourceRecoveryEnhancer/);
});
