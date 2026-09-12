import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202609122359_reliability_batch_ingest.sql",
  import.meta.url,
);
const storeUrl = new URL(
  "../src/lib/reliability/reliabilityStore.ts",
  import.meta.url,
);
const routeUrl = new URL(
  "../src/app/api/integrations/reliability/events/route.ts",
  import.meta.url,
);

test("reliability batches use one bounded service-role RPC", async () => {
  const [migration, store, route] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(storeUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);

  assert.match(
    migration,
    /create or replace function public\.ingest_reliability_events\(p_events jsonb\)/i,
  );
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public/i);
  assert.match(migration, /jsonb_array_length\(p_events\)/i);
  assert.match(migration, /v_count < 1 or v_count > 50/i);
  assert.match(migration, /public\.ingest_reliability_event\(v_event\)/i);
  assert.match(
    migration,
    /revoke all on function public\.ingest_reliability_events\(jsonb\) from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.ingest_reliability_events\(jsonb\) to service_role/i,
  );

  assert.match(store, /inputs\.map\(\(input\) => normalizeReliabilityEvent\(input\)\)/);
  assert.match(store, /admin\.rpc\("ingest_reliability_events"/);
  assert.match(store, /payload\.accepted !== events\.length/);
  assert.match(route, /ingestReliabilityEvents\(events\)/);
  assert.doesNotMatch(route, /for \(const event of events\)/);
});
