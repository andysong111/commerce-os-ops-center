import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.doesNotMatch(source, /NEXT_PUBLIC_.*preferred/i);
});

test("invalid sourcing fingerprints are rejected before being trusted", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /FINGERPRINT\.test/);
  assert.match(source, /SOURCING_BUDGET_PLAN_RESPONSE_INVALID/);
  assert.ok(!source.includes("console.log(secret"));
});
