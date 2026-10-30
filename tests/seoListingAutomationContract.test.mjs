import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("SEO cloud adds the one-click portfolio panel without removing recovery controls", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const panel = await source("src/app/seo-bulk-cloud/SeoBulkAutomationPanel.tsx");
  const oneClick = await source("src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx");

  assert.match(page, /SeoBulkAutomationPanel/);
  assert.match(page, /SeoBulkRegistrationFailurePanel/);
  assert.match(page, /SeoBulkRegistrationRetryAllControl/);
  assert.match(page, /SeoBulkShoplingOneClickControl/);
  assert.ok(
    page.indexOf("<SeoBulkShoplingOneClickControl />") <
      page.indexOf("<SeoBulkWindowBridge />"),
  );
  assert.match(oneClick, /오늘 자동운영 1번 실행/);
  assert.match(oneClick, /prepare_scheduled_run/);
  assert.match(oneClick, /재고 동기화가 끝난 뒤 하루 1회/);
  assert.match(panel, /신규등록 원클릭 · 물갈이 안전잠금/);
  assert.match(panel, /오늘 운영 흐름/);
  assert.match(panel, /신규 등록은 한 번에 최대 3개만 진행/);
  assert.match(panel, /60일 노출/);
  assert.match(panel, /90일 쉬었다가/);
  assert.match(panel, /3회 연속 무판매/);
  assert.match(panel, /매일 자동 확인 상태/);
  assert.match(panel, /다음 자동 확인/);
  assert.match(panel, /가장 오래 노출된 상품/);
  assert.match(panel, /첫 실제 시험 준비/);
  assert.match(panel, /승인 전 외부 변경 0건/);
  assert.match(panel, /응답이 불명확하면 즉시 멈추며 자동 재시도·재등록은 하지 않습니다/);
  assert.match(panel, /Shopling 상품 DB 1만 개 한도/);
  assert.match(panel, /기존 goods_key 마켓전송은 계속 가능/);
  assert.match(oneClick, /SHOPLING_PRODUCT_DB_/);
});

test("dashboard prepares an authenticated scheduled run but keeps destructive writes locked", async () => {
  const route = await source("src/app/api/seo-listing-lifecycle/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /prepare_scheduled_run/);
  assert.match(route, /externalMarketWrite: false/);
  assert.match(route, /externalDeleteEnabled: false/);
  assert.match(route, /autoExecutionEnabled: false/);
  assert.match(route, /mode: "shadow"/);
  assert.match(route, /REGISTRATION_ONLY_FALLBACK_ACTIVE/);
  assert.match(route, /SEO_REGISTRATION_FALLBACK_BATCH_LIMIT/);
  assert.match(route, /requireSeoTitleLedgerContext/);
  assert.match(route, /eq\("owner_id", context\.identity\.userId\)/);
  assert.match(route, /ops_dispatch_tasks/);
  assert.match(route, /seo-listing-lifecycle-shadow-refresh/);
  assert.match(route, /summarizeSeoVerifiedExposureProgress/);
  assert.match(route, /summarizeSeoListingCanaryReadiness/);
  assert.match(route, /seo_listing_rotation_actions/);
  assert.match(route, /requiredMarketListingCount: 6/);
  assert.match(route, /readbackMaxAgeHours: 24/);
  assert.match(route, /seo_shopling_product_db_capacities/);
  assert.match(route, /calculateSeoShoplingProductDbCapacity/);
  assert.doesNotMatch(route, /\.eq\("status", "shadow"\)/);
  assert.match(route, /externalMarketWrite: false/);
});

test("Shopling product DB readback is same-origin, owner-scoped and reconciled once", async () => {
  const route = await source(
    "src/app/api/seo-listing-lifecycle/shopling-product-db-capacity-readback/route.ts",
  );
  assert.match(route, /requireSeoTitleLedgerContext/);
  assert.match(route, /prepareSeoShoplingProductDbSnapshot/);
  assert.match(route, /p_owner_id: context\.identity\.userId/);
  assert.match(route, /eq\("owner_id", context\.identity\.userId\)/);
  assert.equal((route.match(/\.rpc\(/g) ?? []).length, 1);
  assert.match(route, /자동 재시도하지 않습니다/);
  assert.match(route, /externalMarketWrite: false/);
});

test("Shopling product DB quota migration is service-only and stale-write safe", async () => {
  const migration = await source(
    "supabase/migrations/20261030043000_seo_shopling_product_db_capacity_guard.sql",
  );
  assert.match(
    migration,
    /alter table public\.seo_shopling_product_db_capacities enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on table public\.seo_shopling_product_db_capacities[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(migration, /security invoker/);
  assert.match(migration, /p_source <> 'shopling-plan-dom-v1'/);
  assert.match(
    migration,
    /excluded\.observed_at >= public\.seo_shopling_product_db_capacities\.observed_at/,
  );
  assert.match(
    migration,
    /grant execute on function public\.ingest_seo_shopling_product_db_capacity[\s\S]*to service_role/,
  );
  assert.match(migration, /Deletions never create capacity until a newer verified Shopling readback/);
});

test("server blocks new Shopling uploads before orchestration insertion but preserves market-only resume", async () => {
  const server = await source("src/lib/shoplingMarketAutoOrchestrationServer.ts");
  const guardIndex = server.indexOf(
    "await assertShoplingProductDbCapacityForNewUploads",
  );
  const insertIndex = server.indexOf("insertOrRecoverOrchestration", guardIndex);
  assert.ok(guardIndex > 0);
  assert.ok(insertIndex > guardIndex);
  assert.match(server, /queueRunIds\.length/);
  assert.match(server, /기존 goods_key 마켓전송만 진행할 수 있습니다/);
  const marketOnly = server.slice(server.indexOf("export async function createMarketOnlyOrchestration"));
  assert.doesNotMatch(marketOnly, /assertShoplingProductDbCapacityForNewUploads/);
});

test("capacity readback ingestion is authenticated, owner-scoped and reconciled once", async () => {
  const route = await source(
    "src/app/api/seo-listing-lifecycle/capacity-readback/route.ts",
  );
  assert.match(route, /export async function POST/);
  assert.match(route, /requireSeoTitleLedgerContext/);
  assert.match(route, /prepareSeoMarketCapacitySnapshot/);
  assert.match(route, /p_owner_id: context\.identity\.userId/);
  assert.match(route, /eq\("owner_id", context\.identity\.userId\)/);
  assert.match(route, /eq\("snapshot_id", snapshot\.snapshotId\)/);
  assert.match(route, /verifySeoMarketCapacitySnapshotReadback/);
  assert.equal((route.match(/\.rpc\(/g) ?? []).length, 1);
  assert.match(route, /CAPACITY_READBACK_CONFIRM_NEEDED/);
  assert.match(route, /자동 재시도하지 않습니다/);
  assert.match(route, /externalMarketWrite: false/);
});

test("migration is service-only, Shadow-first and does not schedule an executor", async () => {
  const migration = await source(
    "supabase/migrations/20261014191618_seo_listing_rotation_shadow_v1.sql",
  );
  for (const table of [
    "seo_listing_rotation_policies",
    "seo_market_account_capacities",
    "seo_listing_lifecycle_records",
    "seo_listing_lifecycle_events",
    "seo_listing_rotation_actions",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`));
  }
  assert.match(migration, /mode text not null default 'shadow'/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /status text not null default 'shadow'/);
  assert.doesNotMatch(migration, /insert into public\.ops_dispatch_tasks/);
});

test("ACL hardening preserves immutable events and non-deletable actions", async () => {
  const migration = await source(
    "supabase/migrations/20261014194449_seo_listing_rotation_shadow_v1_acl_hardening.sql",
  );
  assert.match(
    migration,
    /revoke all on table public\.seo_listing_lifecycle_events from service_role/,
  );
  assert.match(
    migration,
    /grant select, insert on table public\.seo_listing_lifecycle_events to service_role/,
  );
  assert.match(
    migration,
    /grant select, insert, update on table public\.seo_listing_rotation_actions to service_role/,
  );
  assert.doesNotMatch(
    migration,
    /grant[^;]*delete[^;]*seo_listing_lifecycle_events/i,
  );
  assert.doesNotMatch(
    migration,
    /grant[^;]*delete[^;]*seo_listing_rotation_actions/i,
  );
});

test("capacity snapshot RPC is service-only, complete and stale-write safe", async () => {
  const migration = await source(
    "supabase/migrations/20261014191618_seo_listing_rotation_shadow_v1.sql",
  );
  assert.match(migration, /snapshot_id uuid not null/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /jsonb_array_length\(p_observations\) <> 29/);
  assert.match(migration, /p_observed_at < clock_timestamp\(\) - interval '24 hours'/);
  assert.match(migration, /excluded\.observed_at >= public\.seo_market_account_capacities\.observed_at/);
  assert.match(
    migration,
    /revoke all on function public\.ingest_seo_market_account_capacities[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.ingest_seo_market_account_capacities[\s\S]*to service_role/,
  );
});

test("listing ledger keeps canonical products separate from removable listings", async () => {
  const migration = await source(
    "supabase/migrations/20261014191618_seo_listing_rotation_shadow_v1.sql",
  );
  assert.match(migration, /launch_item_id text not null/);
  assert.match(migration, /goods_key text not null default ''/);
  assert.match(migration, /A listing removal never deletes the canonical Product Master product/);
  assert.match(migration, /technical failures never consume an attempt/);
});
