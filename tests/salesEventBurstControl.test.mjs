import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [controls, route] = await Promise.all([
  readFile("src/app/stage8-sales-events/SalesEventSyncControls.tsx", "utf8"),
  readFile("src/app/api/product-master/shopling-sales-events/route.ts", "utf8"),
]);

test("queued sales refresh uses the bounded one-click burst instead of one manual range", () => {
  assert.match(controls, /act\("run-burst"\)/);
  assert.match(controls, /남은 구간 한 번에 처리/);
  assert.match(controls, /남은 판매 구간을 한 번에 처리 중입니다/);
  assert.doesNotMatch(controls, /act\("run-next"\)/);

  assert.match(route, /OPERATOR_BURST_MAX_STEPS = 60/);
  assert.match(route, /OPERATOR_BURST_BUDGET_MS = 240_000/);
  assert.match(route, /action === "run-burst"/);
  assert.match(route, /runOperatorBurst\(\)/);
});
