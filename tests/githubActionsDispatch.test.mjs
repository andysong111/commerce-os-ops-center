import assert from "node:assert/strict";
import test from "node:test";

import { dispatchGitHubActionsWorkflow } from "../src/lib/githubActionsDispatch.ts";

test("dispatch client sends POST to the workflow_dispatch URL and treats 204 as success", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };

  try {
    const result = await dispatchGitHubActionsWorkflow({
      owner: "andysong111",
      repo: "andysong111-keyword-engine-soon",
      workflowFile: "keyword-engine-runner.yml",
      ref: "main",
      inputs: { goods_key: "BATH001", seed_keyword: "bath towel", mode: "dry_run" },
      token: "secret-test-token",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.github.com/repos/andysong111/andysong111-keyword-engine-soon/actions/workflows/keyword-engine-runner.yml/dispatches");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer secret-test-token");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      ref: "main",
      inputs: { goods_key: "BATH001", seed_keyword: "bath towel", mode: "dry_run" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.doesNotMatch(JSON.stringify(result), /secret-test-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
