import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/app/legacy-seo-bulk-cloud/LegacySeoBulkListFetchShim.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function harness(responses) {
  const calls = [];
  const queue = [...responses];
  let cleanup = null;
  const window = {
    location: { origin: "https://ops.example" },
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      const next = queue.shift();
      if (!next) throw new Error("No mocked response available");
      return typeof next === "function" ? next(input, init) : next.clone();
    },
  };
  const exports = {};
  const dependencies = {
    react: {
      useLayoutEffect(callback) {
        cleanup = callback();
      },
    },
  };
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
    window,
    Request,
    Response,
    URL,
    AbortSignal,
    Date,
    JSON,
    Map,
    Set,
    Promise,
    Number,
    String,
    Math,
  });
  exports.default();
  return { window, calls, cleanup: () => cleanup?.() };
}

const terminalLedger = {
  ok: true,
  jobs: [
    { run_id: "ready-1", status: "ready", registration_status: "idle" },
    { run_id: "failed-1", status: "failed", registration_status: "idle" },
    { run_id: "success-1", status: "ready", registration_status: "success" },
  ],
};

test("terminal SEO ledger is served from browser-local cache instead of polling every minute", async () => {
  const h = harness([
    Response.json(terminalLedger),
    Response.json({ ok: true, results: [] }),
    Response.json(terminalLedger),
  ]);

  const first = await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  assert.equal(first.status, 200);
  assert.equal((await first.json()).jobs.length, 3);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].input, /legacy-seo-run-jobs-lite\?items=false/);

  const cached = await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).jobs.length, 3);
  assert.equal(h.calls.length, 1, "terminal refresh must not hit the server again");

  const write = await h.window.fetch("/api/legacy-seo-run-jobs", {
    method: "POST",
    body: JSON.stringify({ action: "register", runIds: ["ready-1"] }),
  });
  assert.equal(write.status, 200);
  assert.equal(h.calls.length, 2);

  await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  assert.equal(h.calls.length, 3, "successful write invalidates the terminal cache");
  h.cleanup();
});

test("storage outage opens client backoff and repeated GETs do not reach the server", async () => {
  const h = harness([
    Response.json(
      { ok: false, code: "LEGACY_SEO_STORAGE_UNAVAILABLE" },
      { status: 503, headers: { "Retry-After": "60" } },
    ),
  ]);

  const first = await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  assert.equal(first.status, 503);
  assert.equal(h.calls.length, 1);

  const second = await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  assert.equal(second.status, 503);
  assert.equal(second.headers.get("x-ops-client-backoff"), "active");
  assert.ok(Number(second.headers.get("retry-after")) >= 299);
  assert.equal(h.calls.length, 1, "outage backoff must absorb repeated polling locally");
  h.cleanup();
});

test("active SEO or registration jobs are never terminal-cached", async () => {
  for (const job of [
    { run_id: "run", status: "running", registration_status: "idle" },
    { run_id: "reg", status: "ready", registration_status: "running" },
  ]) {
    const h = harness([
      Response.json({ ok: true, jobs: [job] }),
      Response.json({ ok: true, jobs: [job] }),
    ]);
    await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
    await h.window.fetch("/api/legacy-seo-run-jobs?items=false");
    assert.equal(h.calls.length, 2, `${job.run_id} must keep live polling`);
    h.cleanup();
  }
});

test("concurrent identical list reads are coalesced into one network request", async () => {
  let release;
  const deferred = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness([
    async () => {
      await deferred;
      return Response.json({
        ok: true,
        jobs: [{ run_id: "run", status: "running", registration_status: "idle" }],
      });
    },
  ]);

  const first = h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  const second = h.window.fetch("/api/legacy-seo-run-jobs?items=false");
  assert.equal(h.calls.length, 1);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(h.calls.length, 1);
  h.cleanup();
});
