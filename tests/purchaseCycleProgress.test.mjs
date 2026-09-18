import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [engine, page, module, registry] = await Promise.all([
  read("src/lib/purchaseCycleProgress.ts"),
  read("src/app/purchase-cycle-progress/page.tsx"),
  read("src/lib/purchaseCycleProgressModule.ts"),
  read("src/lib/opsModuleRegistry.ts"),
]);

test("purchase cycle progress waits on automatic sales collection without granting writes", () => {
  assert.match(engine, /sales\.state === "QUEUED" \|\| sales\.state === "RUNNING"/);
  assert.match(engine, /AUTOMATIC_PROGRESS/);
  assert.match(engine, /writesEnabled: false/);
});

test("CANARY and FULL remain explicit owner-action boundaries", () => {
  assert.match(engine, /sales\.state === "READY_CANARY" && gate\?\.safeToApply/);
  assert.match(engine, /operatorAction = "1건 CANARY 적재 승인"/);
  assert.match(engine, /sales\.state === "READY_FULL" && gate\?\.safeToApply/);
  assert.match(engine, /operatorAction = "검증된 FULL 적재 승인"/);
  assert.doesNotMatch(engine, /applyProductMasterShoplingSalesEvents/);
});

test("post-FULL progress requires persisted reconciliation before inventory and shadow readiness", () => {
  const rec = engine.indexOf("loadPostApplyCanonicalReconciliation");
  const purchase = engine.indexOf("loadInventoryVerificationPriority");
  assert.ok(rec >= 0);
  assert.ok(purchase > rec);
  assert.match(engine, /reconciliation\?\.ready/);
  assert.match(engine, /purchase\?\.state === "READY" && purchase\.purchaseShadowReady/);
});

test("dashboard makes the current human handoff explicit and remains status-only", () => {
  assert.match(page, /CURRENT HANDOFF/);
  assert.match(page, /현재 사람 개입 없이 자동 진행 중/);
  assert.match(page, /CANARY, FULL, 실제 발주·결제/);
  assert.doesNotMatch(page, /fetch\(|method="post"|server action/i);
});

test("progress dashboard is registered as an OPS module", () => {
  assert.match(module, /id: "purchase-cycle-progress"/);
  assert.match(module, /route: "\/purchase-cycle-progress"/);
  assert.match(registry, /purchaseCycleProgressModule/);
});
