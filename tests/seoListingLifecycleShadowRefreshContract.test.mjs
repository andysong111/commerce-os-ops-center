import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [route, server, dispatcher, migration, apiRoute] = await Promise.all([
  read("src/app/api/cron/seo-listing-lifecycle-shadow-refresh/route.ts"),
  read("src/lib/seoListingLifecycleDailyRefreshServer.ts"),
  read("src/lib/opsAdaptiveDispatcher.ts"),
  read(
    "supabase/migrations/20261029014500_seo_listing_shadow_daily_refresh_dispatch.sql",
  ),
  read("src/app/api/seo-listing-lifecycle/route.ts"),
]);

test("daily lifecycle refresh is a production-only authenticated dispatcher task", () => {
  assert.match(route, /VERCEL_ENV !== "production"/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /maxDuration = 300/);
  assert.match(dispatcher, /"seo-listing-lifecycle-shadow-refresh"/);
  assert.match(
    dispatcher,
    /@\/app\/api\/cron\/seo-listing-lifecycle-shadow-refresh\/route/,
  );
});

test("first deployment stages the once-daily task disabled", () => {
  assert.match(migration, /'seo-listing-lifecycle-shadow-refresh'/);
  assert.match(migration, /'\/api\/cron\/seo-listing-lifecycle-shadow-refresh'/);
  assert.match(migration, /'operational'/);
  assert.match(migration, /\n  118,/);
  assert.match(migration, /\n  false,/);
  assert.match(migration, /\n  86400,\n  86400,/);
  assert.match(migration, /enabled = false/);
});

test("daily refresh only reads Shopling and writes internal shadow evidence", () => {
  assert.match(server, /loadShoplingLifecycleStatusSnapshot/);
  assert.match(server, /seo_listing_lifecycle_records/);
  assert.match(server, /seo_listing_lifecycle_events/);
  assert.match(server, /seo_listing_rotation_actions/);
  assert.match(server, /status: "shadow"/);
  assert.match(server, /shadow_mode: true/);
  assert.match(server, /externalMarketWrite: false/);
  assert.doesNotMatch(server, /postShoplingXml/);
  assert.doesNotMatch(server, /pending["']/);
});

test("manual same-origin refresh uses the same safe server path", () => {
  assert.match(apiRoute, /"refresh_shadow_daily"/);
  assert.match(apiRoute, /refreshSeoListingLifecycleShadowDaily/);
  assert.match(apiRoute, /externalMarketWrite: false/);
});
