import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/legacySeoRunJobServer.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createHarness() {
  const requests = [];
  const workerId = "worker-1";
  const job = {
    run_id: "run-1",
    owner_id: "owner-1",
    owner_email: "owner@example.com",
    batch_id: "batch-1",
    launch_item_id: "item-1",
    tracker_row_number: 1,
    model_number: "AAA001",
    product_name: "상품",
    source_url: "shopling://legacy/1",
    status: "running",
    stage: "collect_source",
    stage_index: 0,
    progress_percent: 0,
    message: "start",
    input_payload: { immutable: "input", nested: [1, 2, 3] },
    checkpoint_payload: { source: { large: "checkpoint" } },
    result_payload: {},
    error_message: "",
    attempt_count: 1,
    max_attempts: 5,
    not_before: null,
    lease_owner: workerId,
    lease_until: "2099-01-01T00:00:00.000Z",
    registration_status: "idle",
    registration_job_id: "",
    registration_request_id: "",
    registration_payload: { large: "registration" },
    run_created_at: "2026-09-13T00:00:00.000Z",
    started_at: "2026-09-13T00:00:00.000Z",
    completed_at: null,
    archived_at: null,
    created_at: "2026-09-13T00:00:00.000Z",
    updated_at: "2026-09-13T00:00:00.000Z",
  };

  const dependencies = {
    "@/lib/legacySeoPreflight": {
      prepareLegacySeoPreflight: async () => ({ results: [] }),
    },
    "@/lib/supabase/admin": {
      createSupabaseAdminHeaders: () => ({ apikey: "test" }),
    },
    "@/lib/productLaunchTrackerServer": {
      readProductLaunchError: () => "storage failed",
      readResponseJson: async (response) => response.json(),
    },
  };

  async function fetchMock(url, init = {}) {
    requests.push({ url: String(url), init });
    if (String(url).includes("/rpc/claim_next_legacy_seo_run_job")) {
      return Response.json({ claimed: true, job });
    }
    if (init.method === "PATCH") {
      const body = JSON.parse(String(init.body || "{}"));
      return Response.json([
        {
          run_id: job.run_id,
          status: body.status ?? "running",
          stage: body.stage ?? "analyze_identity",
          stage_index: body.stage_index ?? 1,
          progress_percent: body.progress_percent ?? 10,
          message: body.message ?? "patched",
          error_message: body.error_message ?? "",
          attempt_count: 1,
          max_attempts: 5,
          not_before: body.not_before ?? null,
          lease_owner: Object.prototype.hasOwnProperty.call(body, "lease_owner")
            ? body.lease_owner
            : workerId,
          lease_until: body.lease_until ?? "2099-01-01T00:00:00.000Z",
          registration_status: "idle",
          registration_job_id: "",
          registration_request_id: "",
          started_at: job.started_at,
          completed_at: body.completed_at ?? null,
          archived_at: null,
          created_at: job.created_at,
          updated_at: body.updated_at,
        },
      ]);
    }
    throw new Error(`Unexpected request: ${url}`);
  }

  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
    fetch: fetchMock,
    Response,
    AbortSignal,
    URLSearchParams,
    Date,
    JSON,
    Map,
    Set,
    Error,
    String,
    Number,
    Math,
  });
  return { exports, requests, workerId, job };
}

test("claimed worker checkpoint PATCH returns only hot columns and reconstructs state in memory", async () => {
  const h = createHarness();
  const config = { supabaseUrl: "https://example.invalid", secretKey: "secret" };
  const claimed = await h.exports.claimNextLegacySeoRunJob(config, h.workerId, 420);
  assert.equal(claimed.run_id, h.job.run_id);

  const nextCheckpoint = {
    source: { large: "checkpoint" },
    identity: { category: "주방" },
  };
  const patched = await h.exports.patchClaimedLegacySeoRunJob(
    config,
    h.job.run_id,
    h.workerId,
    {
      stage: "analyze_identity",
      stage_index: 1,
      progress_percent: 10,
      checkpoint_payload: nextCheckpoint,
    },
  );

  assert.deepEqual(patched.input_payload, h.job.input_payload);
  assert.deepEqual(patched.checkpoint_payload, nextCheckpoint);
  assert.deepEqual(patched.registration_payload, h.job.registration_payload);
  assert.equal(patched.stage, "analyze_identity");

  const firstPatch = h.requests.find((entry) => entry.init.method === "PATCH");
  assert.ok(firstPatch);
  const select = new URL(firstPatch.url).searchParams.get("select") || "";
  assert.doesNotMatch(
    select,
    /(^|,)(input_payload|checkpoint_payload|result_payload|registration_payload)(,|$)/,
  );
  assert.notEqual(select, "*");

  const finalPayload = { seoFinal: { searchKeywords: Array.from({ length: 10 }, (_, i) => `k${i}`) } };
  const completed = await h.exports.patchClaimedLegacySeoRunJob(
    config,
    h.job.run_id,
    h.workerId,
    {
      status: "ready",
      stage: "completed",
      progress_percent: 100,
      result_payload: finalPayload,
      lease_owner: null,
      lease_until: null,
      completed_at: "2026-09-13T01:00:00.000Z",
    },
  );

  assert.deepEqual(completed.checkpoint_payload, nextCheckpoint);
  assert.deepEqual(completed.result_payload, finalPayload);
  assert.equal(completed.status, "ready");
  assert.equal(completed.lease_owner, null);
  assert.equal(h.requests.length, 3, "claim + two PATCHes only; no extra full-row GET");
});

test("unexpected direct PATCH caller keeps compatibility full-row return path", async () => {
  const h = createHarness();
  const config = { supabaseUrl: "https://example.invalid", secretKey: "secret" };
  await h.exports.patchClaimedLegacySeoRunJob(config, h.job.run_id, h.workerId, {
    status: "running",
  });
  const patch = h.requests[0];
  const select = new URL(patch.url).searchParams.get("select") || "";
  assert.match(select, /checkpoint_payload/);
  assert.match(select, /result_payload/);
});
