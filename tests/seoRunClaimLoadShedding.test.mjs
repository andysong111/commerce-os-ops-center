import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("SEO durable claim locks and sorts only the narrow run identity before loading JSON payloads", async () => {
  const sql = await read(
    "supabase/migrations/202608280008_optimize_seo_claim_and_remove_duplicate_wakeup.sql",
  );

  assert.match(sql, /select job\.run_id into v_run_id/i);
  assert.doesNotMatch(sql, /select job\.\* into v_job/i);
  assert.match(sql, /for update of job skip locked/i);
  assert.match(sql, /job\.attempt_count < job\.max_attempts/i);
  assert.match(sql, /job\.lease_until is null[\s\S]*?job\.lease_until <= now\(\)/i);
  assert.match(
    sql,
    /not exists \([\s\S]*?active\.owner_id = job\.owner_id[\s\S]*?active\.launch_item_id = job\.launch_item_id[\s\S]*?active\.status = 'running'[\s\S]*?active\.lease_until > now\(\)/i,
  );
  assert.match(sql, /where run_id = v_run_id[\s\S]*?returning \* into v_job/i);
  assert.match(sql, /to_jsonb\(v_job\)/i);
});

test("SEO claim has narrow candidate and same-item lease indexes", async () => {
  const sql = await read(
    "supabase/migrations/202608280008_optimize_seo_claim_and_remove_duplicate_wakeup.sql",
  );

  assert.match(sql, /seo_run_jobs_claim_order_narrow_idx/i);
  assert.match(sql, /\(not_before, run_created_at, created_at, run_id\)/i);
  assert.match(sql, /seo_run_jobs_active_item_lease_idx/i);
  assert.match(sql, /\(owner_id, launch_item_id, lease_until\)/i);
});

test("duplicate DB wakeup stays removed and the optimized worker is a critical dispatcher task", async () => {
  const [retirement, scheduler, vercelSource] = await Promise.all([
    read("supabase/migrations/202608280008_optimize_seo_claim_and_remove_duplicate_wakeup.sql"),
    read("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql"),
    read("vercel.json"),
  ]);
  const vercel = JSON.parse(vercelSource);

  assert.match(retirement, /cron\.unschedule/i);
  assert.doesNotMatch(retirement, /cron\.schedule\s*\(/i);
  assert.match(
    scheduler,
    /'seo-run-worker', '\/api\/cron\/seo-run-worker', 'critical', 10, true, 300, 60, 300/,
  );
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});

test("scored SEO checkpoints discard redundant discovery fanout before storage", async () => {
  const sql = await read(
    "supabase/migrations/202608280012_compact_seo_run_checkpoint_payload.sql",
  );

  assert.match(sql, /compact_seo_run_checkpoint_payload/);
  assert.match(sql, /jsonb_typeof\(new\.checkpoint_payload -> 'candidates'\) = 'array'/);
  assert.match(sql, /\{discovery,searchAdStats\}[\s\S]*?'\[\]'::jsonb/);
  assert.match(sql, /\{discovery,sourceTagsByKeyword\}[\s\S]*?'\{\}'::jsonb/);
  assert.match(sql, /\{discovery,candidates\}[\s\S]*?'\[\]'::jsonb/);
  assert.match(sql, /before insert or update of checkpoint_payload/);
  assert.match(sql, /status in \('queued', 'running'\)/);
  assert.doesNotMatch(sql, /delete from public\.seo_run_jobs/i);
  assert.doesNotMatch(sql, /result_payload\s*=/i);
});
