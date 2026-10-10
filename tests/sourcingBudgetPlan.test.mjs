import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSourcingBudgetPlan } from "../src/lib/sourcingBudgetPlan.ts";

const fingerprint = value => `sha256:${value.repeat(64)}`;
const validPlan = () => ({
  version: "sourcing-budget-plan-v1",
  sourceFingerprint: fingerprint("a"),
  planFingerprint: fingerprint("b"),
  blockers: [],
  allocation: { selected: [], availableCandidates: [], excluded: [] },
  businessWritesEnabled: false,
  externalOrderExecuted: false,
});
const input = {
  targetCycleMonth: "2026-10",
  totalCashKrw: 1_000_000,
  sourcingBudgetPercent: 20,
  sourcingBudgetKrw: 200_000,
};
const env = {
  SOURCING_ENGINE_INTEGRATION_SECRET: "test-secret",
  SOURCING_ENGINE_PUBLIC_URL: "https://sourcing.example.test",
};

test("Ops sourcing budget bridge uses only the protected server integration", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /x-commerce-os-integration-secret/);
  assert.match(source, /x-vercel-protection-bypass/);
  assert.match(source, /SOURCING_ENGINE_INTEGRATION_SECRET/);
  assert.match(source, /SOURCING_ENGINE_PROTECTION_BYPASS/);
  assert.match(source, /cache: "no-store"/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_.*SECRET/);
});

test("Vercel protection bypass stays optional and server-only", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /protectionBypass\s*\?/);
  assert.match(source, /SOURCING_BUDGET_PROTECTION_BYPASS_INVALID/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SOURCING_ENGINE_PROTECTION_BYPASS/);
});

test("preview and final confirmation use separate GET and POST boundaries", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /api\/integrations\/sourcing-budget-plan\?/);
  assert.match(source, /api\/integrations\/sourcing-budget-plan\/confirm/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /businessWritesEnabled !== false/);
  assert.match(source, /externalOrderExecuted !== false/);
});

test("operator candidate preferences stay server-side and are sent to both preview and confirmation", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /params\.append\("preferredConceptId", conceptId\)/);
  assert.match(source, /preferredConceptIds\?: string\[\]/);
  assert.match(source, /params\.append\("variantSelection", JSON\.stringify\(selection\)\)/);
  assert.match(source, /variantSelections\?: SourcingVariantSelectionInput\[\]/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_.*preferred/i);
});

test("invalid sourcing fingerprints are rejected before being trusted", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /FINGERPRINT\.test/);
  assert.match(source, /SOURCING_BUDGET_PLAN_RESPONSE_INVALID/);
  assert.ok(!source.includes("console.log(secret"));
});

test("read-only sourcing preview retries a transient timeout and then succeeds", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.ok(init.signal instanceof AbortSignal);
    if (calls === 1) {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return Response.json({ ok: true, plan: validPlan() });
  };

  const plan = await loadSourcingBudgetPlan(input, {
    env,
    requestTimeoutMs: 100,
    maxAttempts: 2,
    retryDelayMs: 0,
  });

  assert.equal(calls, 2);
  assert.equal(plan.version, "sourcing-budget-plan-v1");
});

test("exhausted sourcing preview timeout is normalized to a stable error code", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };

  await assert.rejects(
    loadSourcingBudgetPlan(input, {
      env,
      requestTimeoutMs: 100,
      maxAttempts: 2,
      retryDelayMs: 0,
    }),
    { message: "SOURCING_BUDGET_ENGINE_TIMEOUT" },
  );
});

test("slow production sourcing reads get a visible loading state and a fail-fast timeout budget", async () => {
  const [bridgeSource, loadingSource] = await Promise.all([
    readFile("src/lib/sourcingBudgetPlan.ts", "utf8"),
    readFile("src/app/purchase-cycle-preflight/loading.tsx", "utf8"),
  ]);

  assert.match(bridgeSource, /PREVIEW_REQUEST_TIMEOUT_MS = 8_000/);
  assert.match(bridgeSource, /PREVIEW_REQUEST_MAX_ATTEMPTS = 1/);
  assert.match(loadingSource, /role="status"/);
  assert.match(loadingSource, /aria-busy="true"/);
  assert.match(loadingSource, /발주안 계산 중/);
  assert.match(loadingSource, /신규상품 후보를 확인하고 있습니다/);
  assert.match(loadingSource, /오래 기다리지 않고 확인 필요 상태로 화면을 엽니다/);
  assert.match(loadingSource, /1688 주문, 결제를 실행하지 않습니다/);
});
