import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ts from "typescript";

// Execute the REAL TS implementations with explicit in-memory boundaries.
// No production credentials, network, Product Master write, or purchase calls.
async function load(file, deps = {}) {
  const key = `salesRefresh${randomUUID()}`;
  globalThis[key] = deps;
  let code = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  code = code.replace(/import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];/g, (_, bindings, name) => {
    assert.ok(name in deps, `missing dependency ${name}`);
    return `const {${bindings.replace(/\bas\b/g, ":")}} = globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}];`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${key}`);
}
const policy = await load("src/lib/salesEventRefreshPolicy.ts");
const fp = `sha256:${"a".repeat(64)}`, planningFp = `sha256:${"b".repeat(64)}`;
const oldId = "95c910a4-88ff-4c05-b181-9d57ab497bc0";
const input = { expectedRequestId: oldId, expectedPlanFingerprint: fp, confirmation: "REFRESH_CANDIDATE" };
const oldTime = "2026-09-07T14:32:29.432Z";
function current(state = "READY_CANARY") {
  return { configured: true, state, requestId: oldId, analysisAsOf: oldTime, report: { planFingerprint: fp } };
}
for (const state of policy.SALES_EVENT_REFRESH_STATES) {
  test(`explicit refresh accepts terminal candidate ${state}`, () => {
    policy.assertSalesEventRefreshAllowed(current(state), input, Date.parse("2026-09-14T00:00:00Z"));
  });
}
for (const state of ["IDLE", "QUEUED", "RUNNING", "FAILED", "UNKNOWN"]) {
  test(`refresh refuses ${state} without cancelling or deleting it`, () => {
    assert.throws(() => policy.assertSalesEventRefreshAllowed(current(state), input), { code: "SALES_EVENT_REFRESH_STATE_BLOCKED" });
  });
}
test("refresh requires exact context, explicit confirmation, configuration, and a newer real time", () => {
  for (const bad of [{ ...input, expectedRequestId: "" }, { ...input, expectedPlanFingerprint: "nope" }]) {
    assert.throws(() => policy.parseSalesEventRefreshInput(bad), { status: 400 });
  }
  assert.throws(() => policy.parseSalesEventRefreshInput({ ...input, confirmation: "FULL" }), { status: 400 });
  assert.throws(() => policy.assertSalesEventRefreshAllowed({ ...current(), requestId: randomUUID() }, input), { code: "SALES_EVENT_REFRESH_CONTEXT_CHANGED" });
  assert.throws(() => policy.assertSalesEventRefreshAllowed({ ...current(), report: null }, input), { code: "SALES_EVENT_REFRESH_CONTEXT_CHANGED" });
  assert.throws(() => policy.assertSalesEventRefreshAllowed({ ...current(), configured: false }, input), { status: 503 });
  for (const time of [NaN, Date.parse(oldTime), Date.parse(oldTime) - 1]) {
    assert.throws(() => policy.assertSalesEventRefreshAllowed(current(), input, time), { code: "SALES_EVENT_REFRESH_TIME_INVALID" });
  }
});
function memoryAdmin(rows = []) {
  let owner = null;
  return {
    async rpc(name, { p_token }) {
      if (name === "claim_sales_event_mutation_lock") {
        if (owner) return { data: false, error: null };
        owner = p_token; return { data: true, error: null };
      }
      assert.equal(name, "release_sales_event_mutation_lock");
      const released = owner === p_token; if (released) owner = null;
      return { data: released, error: null };
    },
    from(name) {
      assert.equal(name, "commerce_operation_runs");
      const filters = [];
      return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, order() { return this; },
        async limit(n) { return { error: null, data: rows.filter((r) => filters.every(([k, v]) => r[k] === v)).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, n) }; },
      };
    },
  };
}
async function guardFor(admin) {
  return load("src/lib/salesEventMutationGuard.ts", {
    "node:crypto": { randomUUID }, "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin },
    "@/lib/salesEventRefreshPolicy": policy,
  });
}
test("persistent mutation guard excludes concurrent refresh/apply and releases after failure", async () => {
  const guard = await guardFor(memoryAdmin());
  let unblock; const pause = new Promise((resolve) => { unblock = resolve; });
  let started; const ready = new Promise((resolve) => { started = resolve; });
  const first = guard.withSalesEventMutationGuard(async () => { started(); await pause; throw new Error("simulated work failure"); });
  await ready;
  await assert.rejects(guard.withSalesEventMutationGuard(async () => assert.fail("second mutation ran")), { code: "SALES_EVENT_MUTATION_BUSY" });
  unblock(); await assert.rejects(first, /simulated work failure/);
  assert.equal(await guard.withSalesEventMutationGuard(async () => 7), 7);
});
test("missing/ambiguous DB lock fails closed before work", async () => {
  for (const admin of [null, { rpc: async () => ({ data: null, error: { message: "migration missing" } }) }, { rpc: async () => ({ data: {}, error: null }) }]) {
    const guard = await guardFor(admin);
    await assert.rejects(guard.withSalesEventMutationGuard(async () => assert.fail("unguarded work")), { code: "SALES_EVENT_LOCK_UNAVAILABLE" });
  }
});
test("lost release preserves accepted result instead of encouraging duplicate enqueue", async () => {
  let calls = 0;
  const guard = await guardFor({ rpc: async () => { if (calls++) throw new Error("release transport"); return { data: true, error: null }; } });
  assert.equal(await guard.withSalesEventMutationGuard(async () => "persisted"), "persisted");
});
test("real creator appends a fresh pinned request, preserves history, and rejects stale retry", async (t) => {
  const env = { PRODUCT_MASTER_INTEGRATION_SECRET: "test-only", PRODUCT_MASTER_BASE_URL: "https://master.invalid", NEXT_PUBLIC_SUPABASE_URL: "https://db.invalid", SUPABASE_SECRET_KEY: "test-only" };
  const beforeEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const [k, v] of Object.entries(beforeEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const oldRequest = { requestId: oldId, analysisAsOf: oldTime, analysisStartDate: "2025-09-12", analysisEndDate: "2026-09-07", planningGeneratedAt: oldTime, planningContentFingerprint: planningFp, ranges: [{ start: "2025-09-12", end: "2026-09-07" }], createdAt: oldTime };
  const correlation = `product-master-sales-events:${oldId}`;
  const rows = [
    { operation_type: "PRODUCT_MASTER_SHOPLING_SALES_EVENT_REQUEST", input_snapshot: oldRequest, started_at: oldTime },
    { operation_type: "PRODUCT_MASTER_SHOPLING_SALES_EVENT_REPORT", correlation_id: correlation, result_snapshot: { planFingerprint: fp, unmappedRows: 0, identityConflictCount: 0 }, started_at: oldTime },
  ];
  const historical = structuredClone(rows); const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      assert.equal(new URL(url).hostname, "db.invalid"); assert.ok(url.includes("/commerce_operation_runs?"));
      const batch = JSON.parse(options.body); assert.equal(batch.length, 1);
      assert.equal(batch[0].operation_type, "PRODUCT_MASTER_SHOPLING_SALES_EVENT_REQUEST");
      writes.push(batch[0]); rows.push(batch[0]); return Response.json([{ id: randomUUID() }]);
    }
    assert.equal(new URL(url).hostname, "master.invalid"); return Response.json({ ok: true });
  };
  const admin = memoryAdmin(rows), guard = await guardFor(admin);
  const module = await load("src/lib/productMasterShoplingSalesEventSync.ts", {
    "@/lib/salesEventMutationGuard": guard, "@/lib/salesEventRefreshPolicy": policy,
    "node:crypto": await import("node:crypto"),
    "@/lib/productMasterShoplingSalesEventEngine": { PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS: 360 },
    "@/lib/productDecisionLiveRefresh": { loadProductPlanningSnapshot: async () => ({ generatedAt: "2026-09-14T00:00:00Z", contentFingerprint: planningFp }) },
    "@/lib/shopling/shoplingReadClient": { shoplingReadConfigFromEnv: () => ({}), splitShoplingDateRange: (start, end) => [{ start, end }] },
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin, createSupabaseAdminHeaders: () => ({}) },
  });
  const created = await module.createProductMasterShoplingSalesEventSyncRequest(input);
  assert.notEqual(created.requestId, oldId); assert.ok(Date.parse(created.analysisAsOf) > Date.parse(oldTime));
  assert.equal(created.planningContentFingerprint, planningFp);
  assert.deepEqual(rows.slice(0, 2), historical); assert.equal(writes.length, 1);
  assert.equal(writes[0].input_snapshot.refreshesRequestId, oldId);
  assert.equal(writes[0].input_snapshot.previousPlanFingerprint, fp);
  assert.equal(writes[0].input_snapshot.supersedesRequestId, undefined, "refresh is NOT same-time recovery/chunk reuse");
  const status = await module.loadProductMasterShoplingSalesEventSyncStatus();
  assert.equal(status.state, "QUEUED"); assert.equal(status.report, null); assert.equal(status.canaryVerified, false);
  await assert.rejects(module.createProductMasterShoplingSalesEventSyncRequest(input), { code: "SALES_EVENT_REFRESH_CONTEXT_CHANGED" });
  assert.equal(writes.length, 1);
});
async function routeWith(overrides = {}) {
  const calls = []; const guard = await guardFor(memoryAdmin());
  const deps = {
    "@/lib/salesEventMutationGuard": guard, "@/lib/salesEventRefreshPolicy": policy,
    "@/lib/productMasterShoplingSalesEventSync": {
      createProductMasterShoplingSalesEventSyncRequest: async (value) => { calls.push(["create", value]); return { requestId: randomUUID(), ranges: [], analysisAsOf: "2026-09-14T00:00:00Z" }; },
      loadProductMasterShoplingSalesEventSyncStatus: async () => current(),
      applyProductMasterShoplingSalesEvents: async (mode, plan) => { calls.push(["apply", mode, plan]); return { ok: true }; },
      runProductMasterShoplingSalesEventSyncStep: async () => { calls.push(["step"]); return { processed: false }; },
    },
    "@/lib/productMasterShoplingSalesEventRecovery": {},
    "@/lib/stage8CandidatePromotionGate": { loadCandidatePromotionGate: async () => ({ safeToApply: false, message: "not ready" }) },
    "@/lib/opsLoginBypass": { isSameOriginOpsRequest: (req) => req.headers.get("origin") === "https://ops.invalid" },
    "@/lib/opsAdaptiveDispatcher": { wakeOpsDispatchTask: async () => { calls.push(["wake"]); return true; } },
  };
  Object.assign(deps, overrides);
  return { route: await load("src/app/api/product-master/shopling-sales-events/route.ts", deps), calls, deps };
}
function req(body, origin = "https://ops.invalid") {
  return new Request("https://ops.invalid/api/product-master/shopling-sales-events", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
test("actual refresh route accepts only explicit pinned input and never calls apply", async () => {
  const { route, calls } = await routeWith();
  const response = await route.POST(req({ action: "refresh", ...input }));
  assert.equal(response.status, 202); const payload = await response.json();
  assert.equal(payload.canonicalWritesEnabled, false); assert.equal(payload.approvalGranted, false);
  assert.deepEqual(calls.map((c) => c[0]), ["create", "wake"]);
});
test("actual route rejects unauthenticated, unknown action, malformed JSON, and unconfirmed refresh before any mutation", async () => {
  for (const request of [req({ action: "refresh", ...input }, "https://other.invalid"), req({ action: "typo" }), req({ action: "refresh" }), req(null), new Request("https://ops.invalid/api", { method: "POST", headers: { origin: "https://ops.invalid" }, body: "{" })]) {
    const { route, calls } = await routeWith(); const response = await route.POST(request);
    assert.ok([400, 401].includes(response.status)); assert.deepEqual(calls, []);
  }
});
test("legacy start still reuses READY_CANARY, not a surprise refresh", async () => {
  const { route, calls } = await routeWith(); const response = await route.POST(req({ action: "start" }));
  assert.equal((await response.json()).alreadyActive, true); assert.deepEqual(calls.map((c) => c[0]), ["wake"]);
});
test("failed wake after durable refresh reports accepted without automatic re-enqueue", async () => {
  const { route, calls } = await routeWith({ "@/lib/opsAdaptiveDispatcher": { wakeOpsDispatchTask: async () => { throw new Error("wake down"); } } });
  const response = await route.POST(req({ action: "refresh", ...input })); const payload = await response.json();
  assert.equal(response.status, 202); assert.equal(payload.accepted, true); assert.equal(payload.wakeRequested, false);
  assert.deepEqual(calls.map((c) => c[0]), ["create"]);
});
test("actual canary/full route blocks old or missing promotion context; allows matching gate under lock", async () => {
  for (const action of ["canary", "full"]) {
    for (const gate of [
      { safeToApply: false, candidatePlanFingerprint: fp, promotionFingerprint: "proof" },
      { safeToApply: true, candidatePlanFingerprint: "wrong", promotionFingerprint: "proof" },
      { safeToApply: true, candidatePlanFingerprint: fp, promotionFingerprint: null },
      { safeToApply: true, candidatePlanFingerprint: fp, promotionFingerprint: "proof" },
    ]) {
      const { route, calls } = await routeWith({ "@/lib/stage8CandidatePromotionGate": { loadCandidatePromotionGate: async () => gate } });
      const response = await route.POST(req({ action, planFingerprint: fp, confirmation: action.toUpperCase() }));
      const allowed = gate.safeToApply && gate.candidatePlanFingerprint === fp && gate.promotionFingerprint;
      assert.equal(response.status, allowed ? 200 : 409); assert.equal(calls.filter((c) => c[0] === "apply").length, allowed ? 1 : 0);
    }
  }
});
test("all existing creators/recovery and publication use shared guard; refresh cannot promote", async () => {
  const sync = await readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8");
  const recovery = await readFile("src/lib/productMasterShoplingSalesEventRecovery.ts", "utf8");
  const route = await readFile("src/app/api/product-master/shopling-sales-events/route.ts", "utf8");
  assert.match(sync, /createProductMasterShoplingSalesEventSyncRequest[\s\S]*return withSalesEventMutationGuard/);
  assert.match(recovery, /return withSalesEventMutationGuard\(recoverSalesEventRequestUnderLock\)/);
  assert.match(route, /withSalesEventMutationGuard\(async \(\) => \{[\s\S]*loadCandidatePromotionGate\(\)[\s\S]*applyProductMasterShoplingSalesEvents/);
});
