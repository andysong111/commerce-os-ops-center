import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const pglitePath = process.argv[2];
assert.ok(pglitePath, "Pass the path to PGlite's dist/index.js");
const { PGlite } = await import(pathToFileURL(pglitePath).href);
const database = new PGlite();

try {
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.product_launch_options (owner_id uuid, item_id text, barcode text);
    create table public.product_launch_tracker_states (owner_id uuid primary key, updated_at timestamptz);
    create table public.product_launch_workspaces (
      owner_id uuid primary key, source_state_updated_at timestamptz, updated_at timestamptz, counts jsonb
    );
    create table public.product_launch_items (
      owner_id uuid, item_id text, item_payload jsonb, summary_payload jsonb,
      readiness_ready boolean, readiness_error_count integer, readiness_warning_count integer, updated_at timestamptz,
      primary key (owner_id, item_id)
    );
    grant select on public.product_launch_options to service_role;
    grant select, update on public.product_launch_tracker_states, public.product_launch_workspaces, public.product_launch_items to service_role;
  `);

  const migrations = new URL("../supabase/migrations/", import.meta.url);
  const files = await readdir(migrations);
  for (const suffix of ["_ai_saurus_detail_batches_live.sql", "_ai_saurus_review_decisions.sql"]) {
    const filename = files.find((file) => file.endsWith(suffix));
    assert.ok(filename, `Missing migration ${suffix}`);
    await database.exec(await readFile(new URL(filename, migrations), "utf8"));
  }

  const regression = await readFile(new URL("../tests/aiSaurusReviewDecisions.pg.sql", import.meta.url), "utf8");
  const results = await database.exec(regression);
  const messages = results.flatMap(({ rows }) => rows.map(({ proof }) => proof).filter(Boolean));
  assert.equal(messages.length, 2);
  for (const message of messages) console.log(message);
} finally {
  await database.close();
}
