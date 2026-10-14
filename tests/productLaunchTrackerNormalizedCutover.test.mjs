import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  config: new URL("../next.config.ts", import.meta.url),
  normalized: new URL(
    "../src/app/api/product-launch-tracker/normalized-optimized/route.ts",
    import.meta.url,
  ),
  cachedNormalized: new URL(
    "../src/app/api/product-launch-tracker/normalized-optimized-cached/route.ts",
    import.meta.url,
  ),
  cachedDetailJobs: new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs-cached/route.ts",
    import.meta.url,
  ),
  state: new URL(
    "../src/app/api/product-launch-tracker/normalized-state/route.ts",
    import.meta.url,
  ),
  cutover: new URL(
    "../src/lib/productLaunchTrackerNormalizedCutover.ts",
    import.meta.url,
  ),
  store: new URL(
    "../src/lib/productLaunchTrackerNormalizedStore.ts",
    import.meta.url,
  ),
  migration: new URL(
    "../supabase/migrations/202608130001_product_launch_normalized.sql",
    import.meta.url,
  ),
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, url]) => [key, await readFile(url, "utf8")]),
  ),
);

test("public tracker routes are wrapped without deleting the legacy source", () => {
  assert.match(source.config, /normalized-optimized-cached/);
  assert.match(source.config, /detail-page-jobs-cached/);
  assert.match(source.config, /normalized-state/);
  assert.match(source.normalized, /legacyGet/);
  assert.match(source.normalized, /legacyPatch/);
  assert.match(source.state, /legacyPut/);
});

test("normalized reads require an enabled and fresh workspace", () => {
  assert.match(source.normalized, /loadFreshProductLaunchNormalized/);
  assert.match(source.store, /normalized_read_enabled !== true/);
  assert.match(source.store, /source_state_updated_at/);
  assert.match(source.normalized, /listSource: "normalized"/);
});

test("page and detail reads use normalized product and option rows", () => {
  assert.match(source.normalized, /queryProductLaunchNormalizedPage/);
  assert.match(source.normalized, /readProductLaunchNormalizedItem/);
  assert.match(source.normalized, /readProductLaunchNormalizedItems/);
  assert.match(source.normalized, /itemSource: "normalized"/);
  assert.match(source.store, /product_launch_items/);
  assert.match(source.store, /product_launch_options/);
  assert.match(source.normalized, /return legacyGet\(request\)/);
});

test("hot list reads use shared Next Data Cache across function instances", () => {
  assert.match(source.cachedNormalized, /unstable_cache/);
  assert.match(source.cachedNormalized, /PAGE_REVALIDATE_SECONDS = 10/);
  assert.match(source.cachedNormalized, /revalidateTag\([^\n]+, "max"\)/);
  assert.match(source.cachedNormalized, /queryProductLaunchNormalizedPage/);
  assert.match(source.cachedNormalized, /listCache: "next-data-cache"/);

  assert.match(source.cachedDetailJobs, /unstable_cache/);
  assert.match(source.cachedDetailJobs, /JOB_LIST_REVALIDATE_SECONDS = 15/);
  assert.match(source.cachedDetailJobs, /revalidateTag\([^\n]+, "max"\)/);
  assert.match(source.cachedDetailJobs, /listDetailPageJobs/);
  assert.match(source.cachedDetailJobs, /listSource: "next-data-cache"/);
  assert.doesNotMatch(source.cachedDetailJobs, /withDetailPageStoreRetry/);
  assert.doesNotMatch(source.cachedDetailJobs, /"use cache: remote"/);
});

test("transient Supabase failures are cached briefly instead of creating a retry storm", () => {
  assert.match(source.cachedNormalized, /type CachedPageResult/);
  assert.match(source.cachedNormalized, /kind: "unavailable"/);
  assert.match(source.cachedNormalized, /cached-backpressure/);
  assert.match(source.cachedNormalized, /product-launch-page-v3-backpressure/);

  assert.match(source.cachedDetailJobs, /type CachedJobListResult/);
  assert.match(source.cachedDetailJobs, /ok: false/);
  assert.match(source.cachedDetailJobs, /cached-backpressure/);
  assert.match(source.cachedDetailJobs, /detail-page-job-list-v3-backpressure/);
});

test("legacy writes remain authoritative and refresh normalized rows", () => {
  assert.match(source.normalized, /syncProductLaunchNormalizedAfterMutation/);
  assert.match(source.state, /syncProductLaunchNormalizedFull/);
  assert.match(source.normalized, /disableProductLaunchNormalizedRead/);
});

test("normalized state can rebuild the derived list without rewriting the source state", () => {
  assert.match(source.state, /export async function POST\(request: NextRequest\)/);
  assert.match(source.state, /readProductLaunchState/);
  assert.match(source.state, /syncProductLaunchNormalizedFull/);
  assert.match(source.state, /readEnabled: true/);
  assert.doesNotMatch(source.state, /POST[\s\S]*?legacyPut\(request\)/);
});

test("cutover requires item and option count parity before enabling reads", () => {
  assert.match(source.cutover, /PRODUCT_LAUNCH_NORMALIZED_COUNT_MISMATCH/);
  assert.match(source.cutover, /setProductLaunchNormalizedReadEnabled/);
  assert.match(source.cutover, /countMatch && fresh/);
  assert.match(source.migration, /normalized_read_enabled boolean not null default false/);
});
