import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),"utf8");}
test("legacy SEO ledger polling is split, bounded and backpressured",async()=>{
 const route=await source("src/app/api/legacy-seo-run-jobs-lite/route.ts");
 const client=await source("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx");
 assert.match(route,/attempts: 3, timeoutMs: 4_500/);
 assert.match(route,/attempts: 2, timeoutMs: 4_500/);
 assert.match(client,/const POLL_MS = 60_000/);
 assert.match(client,/\?items=false/);
 assert.match(client,/\?jobs=false&items=true/);
 assert.match(client,/itemsLoadingRef/);
 assert.match(client,/document\.visibilityState === "visible"/);
 assert.doesNotMatch(client,/load\(true\)/);
});
