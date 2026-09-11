import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("receipt cycle permanent tests and real-browser scenarios are wired to CI", async () => {
  const workflow = await readFile(".github/workflows/purchase-cycle-closure-ci.yml", "utf8");
  assert.ok(workflow.includes("tests/internalChinaReceipt*.test.mjs"));
  assert.ok(workflow.includes("tests/purchaseCycle*.test.mjs"));
  assert.ok(workflow.includes("node scripts/verify-purchase-cycle-browser.mjs"));
  const script = await readFile("scripts/verify-purchase-cycle-browser.mjs", "utf8");
  assert.ok(script.includes("PurchaseCycleClosurePanel.tsx"));
  assert.ok(script.includes("Browser fixture attempted external network"));
});
