import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/lib/shoplingTitleWorkflowSeparation.ts", import.meta.url), "utf8");
const guard = source.match(/const MANUAL_BUSY_GUARD = String\.raw`([\s\S]*?)`;/)?.[1];
assert.ok(guard, "actual generated guard exists");
assert.match(source, /encoder\.encode\(root \+ "\\n" \+ MANUAL_BUSY_GUARD \+ AUTHORIZE_MANUAL_PAGE\)/);

function harness({ status, legacyBusy = false, storageFails = false } = {}) {
  const calls = { lifecycle: 0, price: 0 };
  const context = vm.createContext({
    chrome: { storage: { session: { get: async (key) => {
      assert.equal(key, "commerceOsShoplingTitleBatchRunV064");
      if (storageFails) throw new Error("read failed");
      return { [key]: status ? { status } : null };
    } } } },
    lifecycleOtherShoplingWorkerBusy: async () => { calls.lifecycle += 1; return legacyBusy; },
    priceReadbackOtherWorkerBusy: async () => { calls.price += 1; return legacyBusy; },
  });
  vm.runInContext(guard, context);
  return { context, calls };
}

test("both workers yield to the new manual title session without invoking old checks", async () => {
  const { context, calls } = harness({ status: "running" });
  assert.equal(await context.lifecycleOtherShoplingWorkerBusy(), true);
  assert.equal(await context.priceReadbackOtherWorkerBusy(), true);
  assert.deepEqual(calls, { lifecycle: 0, price: 0 });
});

test("completed or absent manual jobs retain the existing busy checks", async () => {
  for (const status of [undefined, "completed"]) for (const legacyBusy of [true, false]) {
    const { context, calls } = harness({ status, legacyBusy });
    assert.equal(await context.lifecycleOtherShoplingWorkerBusy(), legacyBusy);
    assert.equal(await context.priceReadbackOtherWorkerBusy(), legacyBusy);
    assert.deepEqual(calls, { lifecycle: 1, price: 1 });
  }
});

test("manual-session read failure blocks conflicting work rather than guessing idle", async () => {
  const { context, calls } = harness({ storageFails: true });
  assert.equal(await context.lifecycleOtherShoplingWorkerBusy(), true);
  assert.equal(await context.priceReadbackOtherWorkerBusy(), true);
  assert.deepEqual(calls, { lifecycle: 0, price: 0 });
});
