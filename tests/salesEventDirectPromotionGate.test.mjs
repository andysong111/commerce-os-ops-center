import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

async function loadGate(status) {
  const key = `directGate${randomUUID()}`;
  globalThis[key] = {
    "node:crypto": await import("node:crypto"),
    "@/lib/productMasterShoplingSalesEventSync": {
      loadProductMasterShoplingSalesEventSyncStatus: async () => status,
    },
  };
  let code = ts.transpileModule(
    await readFile("src/lib/salesEventDirectPromotionGate.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  code = code.replace(
    /import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];/g,
    (_, bindings, name) =>
      `const {${bindings.replace(/\bas\b/g, ":")}} = globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}];`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${key}`);
}

const fp = (letter) => `sha256:${letter.repeat(64)}`;
function status(state, overrides = {}) {
  return {
    configured: true,
    state,
    requestId: "sales-request-1",
    canaryVerified: state === "READY_FULL",
    report: {
      planFingerprint: fp("a"),
      eventFingerprint: fp("b"),
      sourceEventCount: 120,
      unmappedRows: 0,
      identityConflictCount: 0,
    },
    ...overrides,
  };
}

test("clean candidate can proceed directly to one-row canary", async () => {
  const gate = await loadGate(status("READY_CANARY"));
  const result = await gate.loadSalesEventDirectPromotionGate("canary");
  assert.equal(result.safeToApply, true);
  assert.equal(result.state, "CANDIDATE_CLEAN");
  assert.match(result.promotionFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.candidateParityFingerprint, null);
});

test("full write still requires the verified canary state", async () => {
  for (const input of [
    status("READY_CANARY"),
    status("READY_FULL", { canaryVerified: false }),
    status("READY_FULL", { report: { ...status("READY_FULL").report, unmappedRows: 1 } }),
  ]) {
    const gate = await loadGate(input);
    assert.equal((await gate.loadSalesEventDirectPromotionGate("full")).safeToApply, false);
  }
  const gate = await loadGate(status("READY_FULL"));
  const result = await gate.loadSalesEventDirectPromotionGate("full");
  assert.equal(result.safeToApply, true);
  assert.equal(result.state, "CANARY_VERIFIED");
});

test("wrong stage or dirty candidate remains blocked before Product Master writes", async () => {
  for (const input of [
    status("RUNNING"),
    status("READY_CANARY", { configured: false }),
    status("READY_CANARY", { requestId: null }),
    status("READY_CANARY", { report: null }),
    status("READY_CANARY", { report: { ...status("READY_CANARY").report, identityConflictCount: 1 } }),
  ]) {
    const gate = await loadGate(input);
    const result = await gate.loadSalesEventDirectPromotionGate("canary");
    assert.equal(result.safeToApply, false);
    assert.equal(result.promotionFingerprint, null);
  }
});
