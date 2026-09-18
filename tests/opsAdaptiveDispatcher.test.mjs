import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  vercelText,
  migration,
  storageMigration,
  fairnessMigration,
  registry,
  route,
  pulse,
] = await Promise.all([
  read("vercel.json"),
  read("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql"),
  read("supabase/migrations/202608280011_ops_storage_maintenance.sql"),
  read("supabase/migrations/20260918084500_stage8_dispatcher_maintenance_priority_guard.sql"),
  read("src/lib/opsAdaptiveDispatcher.ts"),
  read("src/app/api/cron/ops-dispatcher/route.ts"),
  read("src/lib/seoRunWorkerPulse.ts"),
]);

const vercel = JSON.parse(vercelText);

const TASKS = [
  "seo-run-worker",
  "detail-page-jobs",
  "shopling-price-bulk-auto",
  "product-decision-live-refresh",
  "product-master-shopling-diagnostic",
  "product-master-shopling-sales-backfill",
  "product-master-shopling-sales-incremental",
  "product-master-shopling-sales-events",
  "stage8-canonical-demand-parity",
  "stage8-canonical-sales-event-incremental-shadow",
  "stage8-canonical-event-mismatch-evidence",
  "stage8-canonical-sales-event-full-audit",
  "receipt-live-price-proposals",
  "receipt-live-price-canary-preflight",
  "price-grade-receipt-shadow-bootstrap",
  "ops-storage-maintenance",
];

test("Vercel exposes one scheduler heartbeat instead of independent cron fanout", () => {
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});

test("dispatcher catalog keeps all existing workers durable behind one global lease", () => {
  assert.match(migration, /create table if not exists public\.ops_dispatch_state/);
  assert.match(migration, /create table if not exists public\.ops_dispatch_tasks/);
  assert.match(migration, /claim_next_ops_dispatch_task/);
  assert.match(migration, /finish_ops_dispatch_task/);
  assert.match(migration, /wake_ops_dispatch_task/);
  assert.match(migration, /for update of task skip locked/);
  assert.match(migration, /v_state\.mode <> 'recovery' or task\.workload_class = 'critical'/);
  assert.doesNotMatch(migration, /ops_dispatch_task_history/);
  for (const task of TASKS) {
    assert.match(migration, new RegExp(`'${task.replaceAll("-", "\\-")}'`));
    assert.match(registry, new RegExp(`"${task.replaceAll("-", "\\-")}"`));
  }
});

test("dispatcher invokes one existing handler in-process and records compact state", () => {
  assert.match(route, /claimNextOpsDispatchTask/);
  assert.match(route, /invokeOpsDispatchTask/);
  assert.match(route, /finishOpsDispatchTask/);
  assert.match(route, /maxDuration = 300/);
  assert.match(route, /timingSafeEqual/);
  assert.match(registry, /await import\("@\/app\/api\/cron\/seo-run-worker\/route"\)/);
  assert.match(registry, /compactDispatchResult/);
  assert.doesNotMatch(registry, /fetch\(new URL\(task\.routePath/);
});

test("database pressure opens a recovery circuit and pauses noncritical work", () => {
  assert.match(migration, /mode = 'recovery'/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /consecutive_database_failures/);
  assert.match(registry, /statement timeout/);
  assert.match(registry, /not accepting connections/);
});

test("scheduled and enqueue SEO workers share one durable global pulse", () => {
  assert.match(pulse, /claimSeoRunWorkerPulse/);
  assert.match(pulse, /finishSeoRunWorkerPulse/);
  assert.match(pulse, /localPulsePromise/);
  assert.match(pulse, /wakeOpsDispatchTask\("seo-run-worker"/);
  assert.match(pulse, /processSeoRunQueue/);
});

test("hot storage stays bounded without deleting business evidence", () => {
  assert.match(storageMigration, /run_ops_storage_maintenance/);
  assert.match(storageMigration, /status = 'ready'/);
  assert.match(storageMigration, /registration_status = 'success'/);
  assert.match(storageMigration, /set archived_at = now\(\)/);
  assert.match(storageMigration, /cron\.job_run_details/);
  assert.match(storageMigration, /net\._http_response/);
  assert.doesNotMatch(storageMigration, /delete from public\.commerce_operation_runs/i);
  assert.doesNotMatch(storageMigration, /delete from public\.seo_run_jobs/i);
});


test("maintenance work cannot starve critical or Stage 8 operational workers", () => {
  assert.match(
    fairnessMigration,
    /when 'legacy-shopling-image-repair' then 850/,
  );
  assert.match(
    fairnessMigration,
    /where workload_class = 'maintenance'[\s\S]*priority < 800/,
  );
  assert.match(
    fairnessMigration,
    /check \(workload_class <> 'maintenance' or priority >= 800\)/,
  );
  assert.match(
    fairnessMigration,
    /ops_dispatch_tasks_maintenance_priority_guard/,
  );
});
