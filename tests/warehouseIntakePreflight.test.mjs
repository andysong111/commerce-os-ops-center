import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as core from "../src/lib/warehouseIntakePreflight.ts";
import * as guard from "../src/lib/opsLoginBypass.ts";
import { WarehouseCapacityBridgeError } from "../src/lib/warehouseCapacityBridge.ts";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const input = { productCount: 2, optionsPerProduct: 3, slotsPerSku: 1, committedSlots: 2 };
function snapshot(overrides = {}) {
  return {
    generatedAt: new Date(NOW).toISOString(), registryComplete: true,
    sourcingIntakeGate: "READY", freeRegisteredSlotCount: 10, reserveSlotCount: 2,
    safeImmediateNewSkuCapacity: 8, unregisteredOccupiedLocationCount: 0,
    occupiedBlockedLocationCount: 0, occupancyCollisionCount: 0,
    ...overrides,
  };
}

test("two products with three options consume six slots after reserve and unallocated inbound commitments", () => {
  const result = core.evaluateWarehouseIntakePreflight(snapshot(), input, NOW);
  assert.equal(result.requestedSkuCount, 6);
  assert.equal(result.requiredSlots, 6);
  assert.equal(result.availableSlots, 6);
  assert.equal(result.maxProductCountBySpace, 2);
  assert.equal(result.shortfallSlots, 0);
  assert.equal(result.decision, "SPACE_ONLY_FITS");
  assert.equal(result.executionAllowed, false);
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.capacityBasis, "LOCATION_CODE_COUNT_ONLY");
});

test("bulky options may consume multiple slots; product capacity is rounded down", () => {
  const result = core.evaluateWarehouseIntakePreflight(snapshot(), { ...input, slotsPerSku: 2, committedSlots: 1 }, NOW);
  assert.equal(result.requiredSlots, 12);
  assert.equal(result.availableSlots, 7);
  assert.equal(result.maxProductCountBySpace, 1);
  assert.equal(result.shortfallSlots, 5);
  assert.equal(result.decision, "SPACE_SHORTFALL");
});

test("future clearance forecasts never turn zero current space into a purchasing pass", () => {
  const result = core.evaluateWarehouseIntakePreflight(snapshot({
    freeRegisteredSlotCount: 0, safeImmediateNewSkuCapacity: 0,
    forecastNewSkuCapacity: 900, trustedExitCandidateLocationCount: 900,
  }), { ...input, committedSlots: 0 }, NOW);
  assert.equal(result.availableSlots, 0);
  assert.equal(result.decision, "SPACE_SHORTFALL");
  assert.equal(result.executionAllowed, false);
});

test("incomplete registry, gate conflicts and malformed upstream counts fail closed", () => {
  for (const changes of [
    { registryComplete: false }, { sourcingIntakeGate: "WAITING_PHYSICAL_REGISTRY_CONFIRMATION" },
    { unregisteredOccupiedLocationCount: 1 }, { occupiedBlockedLocationCount: 1 },
    { occupancyCollisionCount: 1 }, { occupancyCollisionCount: undefined },
    { safeImmediateNewSkuCapacity: null }, { safeImmediateNewSkuCapacity: 100 },
    { freeRegisteredSlotCount: "10" }, { reserveSlotCount: -1 },
  ]) {
    const result = core.evaluateWarehouseIntakePreflight(snapshot(changes), input, NOW);
    assert.equal(result.decision, "BLOCKED");
    assert.equal(result.availableSlots, null);
    assert.equal(result.maxProductCountBySpace, null);
    assert.equal(result.shortfallSlots, null);
    assert.equal(result.executionAllowed, false);
  }
});

test("stale, invalid and far-future snapshots are blocked; freshness boundary is inclusive", () => {
  for (const generatedAt of ["invalid", new Date(NOW - 300001).toISOString(), new Date(NOW + 30001).toISOString()]) {
    const result = core.evaluateWarehouseIntakePreflight(snapshot({ generatedAt }), input, NOW);
    assert.equal(result.decision, "BLOCKED");
    assert.ok(result.reasons.includes("STALE_OR_INVALID_SNAPSHOT"));
  }
  for (const offset of [-300000, 30000]) {
    const result = core.evaluateWarehouseIntakePreflight(snapshot({ generatedAt: new Date(NOW + offset).toISOString() }), input, NOW);
    assert.equal(result.decision, "SPACE_ONLY_FITS");
  }
});

test("all assumptions are explicit; missing pending commitments cannot silently become zero", () => {
  const { committedSlots: _committed, ...missing } = input;
  assert.throws(() => core.parseWarehouseIntakeInput(missing), /INVALID_COMMITTED_SLOTS/);
  for (const key of Object.keys(input)) {
    for (const bad of [null, true, false, "", " ", -1, 1.5, NaN, Infinity, {}, [], "1e3", 100001]) {
      assert.throws(() => core.parseWarehouseIntakeInput({ ...input, [key]: bad }), /INVALID_/);
    }
  }
  assert.equal(core.parseWarehouseIntakeInput({ ...input, committedSlots: "0" }).committedSlots, 0);
});

test("commitments exceeding free space clamp to zero and never become negative capacity", () => {
  const result = core.evaluateWarehouseIntakePreflight(snapshot(), { ...input, committedSlots: 100 }, NOW);
  assert.equal(result.availableSlots, 0);
  assert.equal(result.maxProductCountBySpace, 0);
  assert.equal(result.shortfallSlots, 6);
});

test("preflight remains immutable and preserves reserve across 144 input combinations", () => {
  let cases = 0;
  for (let free = 0; free < 4; free += 1) {
    for (let reserve = 0; reserve < 4; reserve += 1) {
      for (let pending = 0; pending < 3; pending += 1) {
        for (let options = 1; options < 4; options += 1) {
          const source = Object.freeze(snapshot({ freeRegisteredSlotCount: free, reserveSlotCount: reserve, safeImmediateNewSkuCapacity: Math.max(0, free - reserve) }));
          const result = core.evaluateWarehouseIntakePreflight(source, { ...input, optionsPerProduct: options, committedSlots: pending }, NOW);
          assert.equal(result.availableSlots, Math.max(0, free - reserve - pending));
          assert.equal(result.maxProductCountBySpace, Math.floor(result.availableSlots / options));
          assert.equal(result.executionAllowed, false);
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 144);
});

async function routeFixture(upstreamError) {
  const source = await readFile(new URL("../src/app/api/warehouse-capacity/intake-preflight/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let reads = 0;
  let current = snapshot({ generatedAt: new Date().toISOString() });
  const bridge = {
    WarehouseCapacityBridgeError,
    getWarehouseCapacitySnapshot: async () => {
      reads += 1;
      if (upstreamError) throw upstreamError;
      return current;
    },
  };
  const exported = {};
  runInNewContext(compiled, {
    exports: exported, Request, Response, URL,
    require: (name) => {
      if (name === "@/lib/opsLoginBypass") return guard;
      if (name === "@/lib/warehouseCapacityBridge") return bridge;
      if (name === "@/lib/warehouseIntakePreflight") return core;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { exported, reads: () => reads, setSnapshot: (value) => { current = value; } };
}

function request(query = new URLSearchParams(input).toString(), headers = { origin: "https://ops.example" }) {
  return new Request(`https://ops.example/api/warehouse-capacity/intake-preflight?${query}`, { headers });
}

test("actual preflight route rejects absent/cross-site origin before any upstream read", async () => {
  const route = await routeFixture();
  for (const headers of [{}, { origin: "https://unrelated.example" }]) {
    const response = await route.exported.GET(request(undefined, headers));
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(route.reads(), 0);
  assert.equal(route.exported.POST, undefined);
  assert.equal(route.exported.PATCH, undefined);
});

test("actual route rejects missing, duplicate and malformed input without upstream reads", async () => {
  const route = await routeFixture();
  for (const query of ["", "productCount=1", `${new URLSearchParams(input)}&productCount=3`, new URLSearchParams({ ...input, committedSlots: "" }).toString()]) {
    const response = await route.exported.GET(request(query));
    assert.equal(response.status, 400);
  }
  assert.equal(route.reads(), 0);
});

test("actual route returns current read-only space result and refreshes instead of reusing a prior pass", async () => {
  const route = await routeFixture();
  const first = await route.exported.GET(request());
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control"), /no-store/);
  assert.equal((await first.json()).preflight.decision, "SPACE_ONLY_FITS");
  route.setSnapshot(snapshot({ generatedAt: new Date().toISOString(), registryComplete: false }));
  const next = await route.exported.GET(request());
  assert.equal((await next.json()).preflight.decision, "BLOCKED");
  assert.equal(route.reads(), 2);
});

test("actual route preserves dependency errors and never fabricates a successful preflight", async () => {
  const route = await routeFixture(new WarehouseCapacityBridgeError("PRODUCT_MASTER_CAPACITY_TIMEOUT", "테스트 시간초과", 504));
  const response = await route.exported.GET(request());
  assert.equal(response.status, 504);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.preflight, undefined);
});
