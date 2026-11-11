import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, server, isolation, reconciliation, dailyRefresh, onboarding, migration] = await Promise.all([
  readFile("src/app/api/seo-listing-lifecycle/route.ts", "utf8"),
  readFile(
    "src/lib/seoListingShoplingBCodeInternalCorrectionServer.ts",
    "utf8",
  ),
  readFile("src/lib/seoListingLifecycleIsolationServer.ts", "utf8"),
  readFile("src/lib/seoListingLifecycleReconciliationServer.ts", "utf8"),
  readFile("src/lib/seoListingLifecycleDailyRefreshServer.ts", "utf8"),
  readFile("src/lib/seoListingShoplingBCodeOnboardingServer.ts", "utf8"),
  readFile(
    "supabase/migrations/20261110160000_seo_listing_bcode_internal_correction_v1.sql",
    "utf8",
  ),
]);

test("internal correction requires the exact fresh audit fingerprint and explicit confirmation", () => {
  assert.match(route, /apply_shopling_bcode_internal_correction/);
  assert.match(route, /APPLY_INTERNAL_CORRECTION/);
  assert.match(route, /ROLLBACK_INTERNAL_CORRECTION/);
  assert.ok(
    route.indexOf("reconcileSeoListingShoplingBCodeOnboarding") <
      route.indexOf("applySeoListingShoplingBCodeInternalCorrection({"),
  );
  assert.match(server, /text\(plan\.planFingerprint\) !== fingerprint/);
  assert.match(server, /plan\.readyToApply !== true/);
  assert.match(server, /verifyCorrectionReadback/);
  assert.match(server, /SEO_BCODE_INTERNAL_CORRECTION_REPLAY_READ_FAILED/);
  assert.match(server, /replayed \? prior\.input_snapshot : input\.currentPlan/);
  assert.match(server, /externalMarketWrite: false/);
});

test("database correction is atomic, drift-locked and never deletes source lifecycle rows", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /for update;/i);
  assert.match(migration, /LEDGER_DRIFT/);
  assert.match(migration, /RECEIPT_CONFLICT/);
  assert.match(migration, /RESTORE_EXACT_BEFORE_IDENTITY|ROLLBACK_DRIFT/);
  assert.match(migration, /auditReceiptsRetained/);
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+public\.seo_listing_lifecycle_records/i,
  );
  assert.doesNotMatch(migration, /http|shopling.*write|market.*submit/i);
});

test("database correction RPCs use least-privilege invoker execution for service role only", () => {
  assert.equal((migration.match(/\bsecurity invoker\b/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /\bsecurity definer\b/i);
  assert.doesNotMatch(migration, /auth\.role\s*\(/i);
  assert.match(
    migration,
    /revoke all on function public\.apply_seo_listing_bcode_internal_correction_v1\([\s\S]*?from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.rollback_seo_listing_bcode_internal_correction_v1\([\s\S]*?from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.apply_seo_listing_bcode_internal_correction_v1\([\s\S]*?to service_role;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.rollback_seo_listing_bcode_internal_correction_v1\([\s\S]*?to service_role;/i,
  );
});

test("active isolation markers are reversible filters and missing pre-migration schema is explicit", () => {
  assert.match(isolation, /schemaAvailable: false/);
  assert.match(isolation, /error\.code === "42P01"/);
  assert.match(isolation, /error\.code === "PGRST205"/);
  assert.match(isolation, /!launchItemIds\.has\(text\(row\.launch_item_id\)\)/);
  assert.match(migration, /active = false/);
  assert.match(migration, /released_at = p_rolled_back_at/);
  for (const source of [route, reconciliation, dailyRefresh, onboarding]) {
    assert.match(source, /readActiveSeoListingLifecycleIsolations/);
    assert.match(source, /excludeActiveSeoListingLifecycleIsolations/);
  }
  assert.match(
    reconciliation,
    /!activeIsolations\.launchItemIds\.has\(text\(row\.launch_item_id\)\)/,
  );
  assert.match(
    route,
    /!activeIsolations\.launchItemIds\.has\(text\(job\.launch_item_id\)\)/,
  );
});
