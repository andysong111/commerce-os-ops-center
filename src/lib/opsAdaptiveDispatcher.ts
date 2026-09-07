import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;
type AdminRpcResult = {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
};
type OpsAdmin = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<AdminRpcResult>;
};
type CronHandler = (request: NextRequest) => Response | Promise<Response>;

type RegistryEntry = {
  routePath: string;
  load: () => Promise<CronHandler>;
};

export type OpsDispatchTask = {
  taskKey: string;
  routePath: string;
  workloadClass: "critical" | "operational" | "diagnostic" | "maintenance";
  priority: number;
  timeoutSeconds: number;
  normalIntervalSeconds: number;
  busyIntervalSeconds: number;
  recoveryIntervalSeconds: number;
};

export type OpsDispatchClaim = {
  claimed: boolean;
  reason: string;
  mode: "normal" | "recovery";
  recoveryUntil: string | null;
  nextDueAt: string | null;
  task: OpsDispatchTask | null;
};

export type OpsDispatchExecution = {
  status: number;
  ok: boolean;
  busy: boolean;
  databasePressure: boolean;
  durationMs: number;
  body: UnknownRecord;
  compactResult: UnknownRecord;
};

const REGISTRY: Record<string, RegistryEntry> = {
  "seo-run-worker": {
    routePath: "/api/cron/seo-run-worker",
    load: async () =>
      (await import("@/app/api/cron/seo-run-worker/route")).GET as CronHandler,
  },
  "legacy-seo-run-worker": {
    routePath: "/api/cron/legacy-seo-run-worker",
    load: async () =>
      (await import("@/app/api/cron/legacy-seo-run-worker/route")).GET as CronHandler,
  },
  "legacy-shopling-launch-backfill-dry": {
    routePath: "/api/cron/legacy-shopling-launch-backfill?mode=dry-run",
    load: async () =>
      (await import("@/app/api/cron/legacy-shopling-launch-backfill/route")).GET as CronHandler,
  },
  "legacy-shopling-launch-backfill-apply": {
    routePath: "/api/cron/legacy-shopling-launch-backfill?mode=apply",
    load: async () =>
      (await import("@/app/api/cron/legacy-shopling-launch-backfill/route")).GET as CronHandler,
  },
  "legacy-shopling-image-repair": {
    routePath: "/api/cron/legacy-shopling-image-repair",
    load: async () =>
      (await import("@/app/api/cron/legacy-shopling-image-repair/route")).GET as CronHandler,
  },
  "detail-page-jobs": {
    routePath: "/api/cron/detail-page-jobs",
    load: async () =>
      (await import("@/app/api/cron/detail-page-jobs/route")).GET as CronHandler,
  },
  "shopling-price-bulk-auto": {
    routePath: "/api/cron/shopling-price-bulk-auto",
    load: async () =>
      (await import("@/app/api/cron/shopling-price-bulk-auto/route")).GET as CronHandler,
  },
  "product-decision-live-refresh": {
    routePath: "/api/cron/product-decision-live-refresh",
    load: async () =>
      (await import("@/app/api/cron/product-decision-live-refresh/route")).GET as CronHandler,
  },
  "product-lifecycle-refresh": {
    routePath: "/api/cron/product-lifecycle-refresh",
    load: async () =>
      (await import("@/app/api/cron/product-lifecycle-refresh/route")).GET as CronHandler,
  },
  "product-master-shopling-diagnostic": {
    routePath: "/api/cron/product-master-shopling-diagnostic",
    load: async () =>
      (await import("@/app/api/cron/product-master-shopling-diagnostic/route")).GET as CronHandler,
  },
  "product-master-shopling-sales-backfill": {
    routePath: "/api/cron/product-master-shopling-sales-backfill",
    load: async () =>
      (await import("@/app/api/cron/product-master-shopling-sales-backfill/route")).GET as CronHandler,
  },
  "product-master-shopling-sales-incremental": {
    routePath: "/api/cron/product-master-shopling-sales-incremental",
    load: async () =>
      (await import("@/app/api/cron/product-master-shopling-sales-incremental/route")).GET as CronHandler,
  },
  "product-master-shopling-sales-events": {
    routePath: "/api/cron/product-master-shopling-sales-events",
    load: async () =>
      (await import("@/app/api/cron/product-master-shopling-sales-events/route")).GET as CronHandler,
  },
  "stage8-canonical-demand-parity": {
    routePath: "/api/cron/stage8-canonical-demand-parity",
    load: async () =>
      (await import("@/app/api/cron/stage8-canonical-demand-parity/route")).GET as CronHandler,
  },
  "stage8-canonical-sales-event-incremental-shadow": {
    routePath: "/api/cron/stage8-canonical-sales-event-incremental-shadow",
    load: async () =>
      (await import("@/app/api/cron/stage8-canonical-sales-event-incremental-shadow/route")).GET as CronHandler,
  },
  "stage8-canonical-event-mismatch-evidence": {
    routePath: "/api/cron/stage8-canonical-event-mismatch-evidence",
    load: async () =>
      (await import("@/app/api/cron/stage8-canonical-event-mismatch-evidence/route")).GET as CronHandler,
  },
  "stage8-canonical-sales-event-full-audit": {
    routePath: "/api/cron/stage8-canonical-sales-event-full-audit",
    load: async () =>
      (await import("@/app/api/cron/stage8-canonical-sales-event-full-audit/route")).GET as CronHandler,
  },
  "receipt-live-price-proposals": {
    routePath: "/api/cron/receipt-live-price-proposals",
    load: async () =>
      (await import("@/app/api/cron/receipt-live-price-proposals/route")).GET as CronHandler,
  },
  "receipt-live-price-canary-preflight": {
    routePath: "/api/cron/receipt-live-price-canary-preflight",
    load: async () =>
      (await import("@/app/api/cron/receipt-live-price-canary-preflight/route")).GET as CronHandler,
  },
  "price-grade-receipt-shadow-bootstrap": {
    routePath: "/api/cron/price-grade-receipt-shadow-bootstrap",
    load: async () =>
      (await import("@/app/api/cron/price-grade-receipt-shadow-bootstrap/route")).GET as CronHandler,
  },
  "ops-storage-maintenance": {
    routePath: "/api/cron/ops-storage-maintenance",
    load: async () =>
      (await import("@/app/api/cron/ops-storage-maintenance/route")).GET as CronHandler,
  },
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function rpcData(result: AdminRpcResult, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return record(result.data);
}

export async function claimNextOpsDispatchTask(
  admin: OpsAdmin,
  workerId: string,
  leaseSeconds = 300,
): Promise<OpsDispatchClaim> {
  const body = rpcData(
    await admin.rpc("claim_next_ops_dispatch_task", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    }),
    "OPS dispatcher claim failed",
  );
  const rawTask = record(body.task);
  const taskKey = text(rawTask.task_key);
  const task: OpsDispatchTask | null = taskKey
    ? {
        taskKey,
        routePath: text(rawTask.route_path),
        workloadClass: normalizeWorkloadClass(rawTask.workload_class),
        priority: integer(rawTask.priority, 100),
        timeoutSeconds: integer(rawTask.timeout_seconds, 240),
        normalIntervalSeconds: integer(rawTask.normal_interval_seconds, 3600),
        busyIntervalSeconds: integer(rawTask.busy_interval_seconds, 300),
        recoveryIntervalSeconds: integer(rawTask.recovery_interval_seconds, 21600),
      }
    : null;
  return {
    claimed: body.claimed === true && Boolean(task),
    reason: text(body.reason),
    mode: text(body.mode) === "recovery" ? "recovery" : "normal",
    recoveryUntil: nullableText(body.recovery_until),
    nextDueAt: nullableText(body.next_due_at),
    task,
  };
}

export async function finishOpsDispatchTask(
  admin: OpsAdmin,
  input: {
    workerId: string;
    taskKey: string;
    outcome: "success" | "failure" | "skipped";
    httpStatus?: number | null;
    busy?: boolean;
    databasePressure?: boolean;
    result?: UnknownRecord;
    error?: string;
  },
) {
  return rpcData(
    await admin.rpc("finish_ops_dispatch_task", {
      p_worker_id: input.workerId,
      p_task_key: input.taskKey,
      p_outcome: input.outcome,
      p_http_status: input.httpStatus ?? null,
      p_busy: input.busy === true,
      p_database_pressure: input.databasePressure === true,
      p_result: input.result ?? {},
      p_error: text(input.error).slice(0, 2000),
    }),
    "OPS dispatcher finish failed",
  );
}

export async function wakeOpsDispatchTask(taskKey: string, delaySeconds = 0) {
  const admin = await createSupabaseAdminClient();
  if (!admin) return false;
  const result = await admin.rpc("wake_ops_dispatch_task", {
    p_task_key: taskKey,
    p_delay_seconds: Math.max(0, Math.min(86_400, Math.trunc(delaySeconds))),
  });
  if (result.error) {
    console.error("[ops-dispatcher] task wake failed", {
      taskKey,
      error: result.error.message,
    });
    return false;
  }
  return record(result.data).woken === true;
}

export async function invokeOpsDispatchTask(
  task: OpsDispatchTask,
  origin: string,
  cronSecret: string,
): Promise<OpsDispatchExecution> {
  const entry = REGISTRY[task.taskKey];
  if (!entry) throw new Error(`등록되지 않은 OPS dispatcher task입니다: ${task.taskKey}`);
  if (entry.routePath !== task.routePath) {
    throw new Error(
      `OPS dispatcher route drift: ${task.taskKey} DB=${task.routePath} CODE=${entry.routePath}`,
    );
  }

  const handler = await entry.load();
  const innerRequest = new NextRequest(new URL(task.routePath, origin), {
    method: "GET",
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "x-commerce-ops-dispatcher": "1",
      "x-commerce-ops-task": task.taskKey,
    },
  });
  const startedAt = Date.now();
  const response = await handler(innerRequest);
  const durationMs = Date.now() - startedAt;
  const body = await responseBody(response);
  const ok = response.ok && body.ok !== false;
  const busy = ok && taskBusy(task.taskKey, body);
  const databasePressure = !ok && isDatabasePressure(response.status, body);
  return {
    status: response.status,
    ok,
    busy,
    databasePressure,
    durationMs,
    body,
    compactResult: compactDispatchResult(body, durationMs),
  };
}

async function responseBody(response: Response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return { message: raw.slice(0, 2000) };
  }
}

function taskBusy(taskKey: string, body: UnknownRecord) {
  const state = text(body.state).toUpperCase();
  if (taskKey === "seo-run-worker") {
    return integer(body.claimedCount) > 0 || integer(body.queuedCount) > 0;
  }
  if (taskKey === "detail-page-jobs") {
    return (
      integer(body.recovered) > 0 ||
      integer(body.repaired) > 0 ||
      integer(body.stopped) > 0
    );
  }
  if (taskKey === "shopling-price-bulk-auto") {
    return integer(body.processed_job_count) > 0;
  }
  return (
    body.busy === true ||
    body.processed === true ||
    integer(body.processedCount) > 0 ||
    integer(body.processed_count) > 0 ||
    ["QUEUED", "RUNNING", "PENDING"].includes(state)
  );
}

function isDatabasePressure(status: number, body: UnknownRecord) {
  if (status < 500) return false;
  const message = JSON.stringify(body).toLowerCase();
  return [
    "supabase",
    "pgrst",
    "postgres",
    "database",
    "schema cache",
    "statement timeout",
    "connection pool",
    "could not query",
    "not accepting connections",
    "rest timeout",
  ].some((token) => message.includes(token));
}

function compactDispatchResult(body: UnknownRecord, durationMs: number) {
  const compact = compactValue(body, 0);
  return {
    durationMs,
    body: record(compact),
  };
}

function compactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) {
    if (Array.isArray(value)) return { itemCount: value.length };
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return {
      itemCount: value.length,
      sample: value.slice(0, 5).map((entry) => compactValue(entry, depth + 1)),
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .slice(0, 30)
        .map(([key, entry]) => [key, compactValue(entry, depth + 1)]),
    );
  }
  return text(value).slice(0, 500);
}

function normalizeWorkloadClass(value: unknown): OpsDispatchTask["workloadClass"] {
  const normalized = text(value);
  if (
    normalized === "critical" ||
    normalized === "operational" ||
    normalized === "diagnostic" ||
    normalized === "maintenance"
  ) {
    return normalized;
  }
  return "diagnostic";
}
