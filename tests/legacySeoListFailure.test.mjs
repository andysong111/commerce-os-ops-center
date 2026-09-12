import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/app/api/legacy-seo-run-jobs-lite/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ jobs = [], items = [], authStatus, authError } = {}) {
  const calls = [];
  const warnings = [];
  const exports = {};
  const dependencies = {
    "@/lib/productLaunchTrackerServer": {
      async readProductLaunchStorageJson(url, init, options) {
        calls.push({ url, init, options });
        const value = url.includes("/legacy_seo_run_jobs?") ? jobs : items;
        if (value instanceof Error || value?.reject === true) throw value;
        return { body: value };
      },
    },
    "@/lib/supabase/admin": { createSupabaseAdminHeaders: () => ({ apikey: "test-key-never-expose" }) },
    "@/lib/seoTitleLedgerServer": {
      async requireSeoTitleLedgerContext() {
        if (authError) throw authError;
        if (authStatus) return { ok: false, response: Response.json({ ok: false, code: "AUTH_REQUIRED" }, { status: authStatus }) };
        return { ok: true, value: { config: { supabaseUrl: "https://test.invalid", secretKey: "test-key-never-expose" }, identity: { userId: "owner-1" } } };
      },
    },
  };
  vm.runInNewContext(compiled, {
    exports, require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
    URLSearchParams, Response, crypto: { randomUUID },
    console: { warn: (...args) => warnings.push(args) },
    Date,
    Math,
  });
  return { calls, warnings, get: (query = "") => exports.GET({ nextUrl: new URL(`https://ops.invalid/api/legacy-seo-run-jobs-lite${query}`) }) };
}

const readyJob = { run_id: "run-1", status: "ready", registration_status: "idle", result_payload: { seoFinal: { searchKeywords: ["retained"] } } };

test("normal ledger preserves FINAL payload and owner filters without reading catalog", async () => {
  const h = harness({ jobs: [readyJob] });
  const response = await h.get("?items=false");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.jobs.length, 1);
  assert.deepEqual(body.jobs[0].result_payload, readyJob.result_payload);
  assert.equal(body.jobsAvailable, true);
  assert.equal(body.itemsAvailable, false);
  assert.equal(h.calls.length, 1);
  const url = new URL(h.calls[0].url);
  assert.equal(url.searchParams.get("owner_id"), "eq.owner-1");
  assert.equal(url.searchParams.get("archived_at"), "is.null");
  assert.doesNotMatch(url.searchParams.get("select"), /checkpoint_payload|registration_payload/);
  assert.equal(h.calls[0].init.method, undefined);
  assert.equal(h.calls[0].options.attempts, 1);
});

test("true empty success remains distinct from unavailable data", async () => {
  const response = await harness().get();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.jobs, []);
  assert.deepEqual(body.items, []);
  assert.equal(body.jobsAvailable, true);
  assert.equal(body.itemsAvailable, true);
});

for (const [name, failure] of [
  ["PGRST002 schema initialization", new Error("PGRST002: Could not query the database for the schema cache. Retrying. secret https://private.invalid")],
  ["AbortError", Object.assign(new Error("This operation was aborted"), { name: "AbortError" })],
  ["plain-object timeout", { reject: true, name: "TimeoutError", message: "signal timed out" }],
]) {
  test(`${name} produces traceable 503, never an empty successful ledger`, async () => {
    const h = harness({ jobs: failure });
    const response = await h.get("?items=false");
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.ok(Number(response.headers.get("retry-after")) >= 299);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(body.ok, false);
    assert.equal(body.canRegister, false);
    assert.equal(body.code, "LEGACY_SEO_STORAGE_UNAVAILABLE");
    assert.equal("jobs" in body, false);
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify([body, h.warnings]), /private\.invalid|test-key-never-expose|secret/);
    assert.match(body.message, /실제 상품 수가 아닙니다/);
  });
}

test("first transient failure opens a server circuit so repeated GET does not hit storage again", async () => {
  const h = harness({ jobs: new Error("PGRST002: schema cache") });
  const first = await h.get("?items=false");
  assert.equal(first.status, 503);
  assert.equal(h.calls.length, 1);

  const second = await h.get("?items=false");
  const body = await second.json();
  assert.equal(second.status, 503);
  assert.equal(second.headers.get("x-ops-storage-circuit"), "open");
  assert.equal(body.code, "LEGACY_SEO_STORAGE_UNAVAILABLE");
  assert.equal(body.dependencyCode, "PGRST002");
  assert.equal(h.calls.length, 1, "open circuit must absorb repeated polling without storage access");
});

test("catalog-only failure no longer returns HTTP 200 with empty items", async () => {
  const h = harness({ items: new Error("PGRST002: schema cache") });
  const response = await h.get("?jobs=false&items=true");
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal("items" in body, false);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /product_launch_items/);
  assert.equal(h.calls[0].options.attempts, 1);
});

test("combined read retains successful ledger but marks catalog as unknown, not empty", async () => {
  const h = harness({ jobs: [readyJob], items: new Error("PGRST002: schema cache") });
  const response = await h.get();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.jobs.length, 1);
  assert.equal(body.items, null);
  assert.equal(body.itemsAvailable, false);
  assert.equal(body.jobsAvailable, true);
  assert.equal(body.warnings.length, 1);
});

for (const kind of ["jobs", "items"]) {
  test(`malformed successful ${kind} response is not accepted as empty data`, async () => {
    const h = harness({ [kind]: { message: "not a row array" } });
    const response = await h.get(kind === "jobs" ? "?items=false" : "?jobs=false");
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.code, "LEGACY_SEO_LIST_FAILED");
  });
}

for (const status of [401, 403]) {
  test(`authentication ${status} is preserved with zero storage calls`, async () => {
    const h = harness({ authStatus: status });
    assert.equal((await h.get()).status, status);
    assert.equal(h.calls.length, 0);
  });
}

test("unexpected context rejection is contained without exposing exception text", async () => {
  const h = harness({ authError: new Error("secret https://private.invalid") });
  const response = await h.get();
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(body), /private\.invalid|secret/);
  assert.equal(h.calls.length, 0);
});

test("successful live reads are not persisted as a server cache", async () => {
  const jobs = [];
  const h = harness({ jobs });
  assert.equal((await (await h.get("?items=false")).json()).jobs.length, 0);
  jobs.push(readyJob);
  assert.equal((await (await h.get("?items=false")).json()).jobs.length, 1);
  assert.equal(h.calls.length, 2);
});
