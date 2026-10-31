import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allSourcingVariantsAsSmall,
  loadManualPilotCatalog,
  loadSourcingBudgetPlan,
  manualPilotCatalogVariantsAsSmall,
  returnableSourcingBudgetKrw,
} from "../src/lib/sourcingBudgetPlan.ts";

const fingerprint = value => `sha256:${value.repeat(64)}`;
const validPlan = () => ({
  version: "sourcing-budget-plan-v1",
  sourceFingerprint: fingerprint("a"),
  planFingerprint: fingerprint("b"),
  blockers: [],
  allocation: { selected: [], availableCandidates: [], excluded: [] },
  reusedConfirmedVariants: [],
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

test("automatic sourcing selection picks one representative option per product", () => {
  const candidate = (conceptId, variantKeys) => ({
    conceptId,
    variants: variantKeys.map(variantKey => ({ variantKey })),
  });
  const plan = {
    ...validPlan(),
    allocation: {
      selected: [candidate("concept-1", ["v1"])],
      availableCandidates: [
        candidate("concept-1", ["v1", "v2"]),
        candidate("concept-2", ["v3"]),
      ],
      excluded: [],
    },
  };

  assert.deepEqual(allSourcingVariantsAsSmall(plan), [
    { conceptId: "concept-1", variantKey: "v1", storageSize: "S" },
    { conceptId: "concept-2", variantKey: "v3", storageSize: "S" },
  ]);
  assert.equal(allSourcingVariantsAsSmall(plan, { maxConcepts: 1, maxVariants: 10 }).length, 1);
  assert.equal(allSourcingVariantsAsSmall(plan, { maxConcepts: 20, maxVariants: 2 }).length, 2);
});

test("automatic manual-pilot selection uses the exact saved SKU and one B-code per product", () => {
  const candidate = (conceptId, skuLabel, variantKeys) => ({
    conceptId,
    skuLabel,
    variants: variantKeys.map(([variantKey, chinaOption]) => ({ variantKey, chinaOption })),
  });
  const catalog = {
    candidates: [
      candidate("manual-1", "브라", [["shoe", "신발"], ["bra", "브라"]]),
      candidate("manual-2", "여성", [["male", "남성"], ["female", "여성"]]),
    ],
  };

  assert.deepEqual(manualPilotCatalogVariantsAsSmall(catalog), [
    { conceptId: "manual-1", variantKey: "bra", storageSize: "S" },
    { conceptId: "manual-2", variantKey: "female", storageSize: "S" },
  ]);
  assert.equal(manualPilotCatalogVariantsAsSmall(catalog, { maxConcepts: 1 }).length, 1);
  assert.equal(manualPilotCatalogVariantsAsSmall(catalog, { maxVariants: 1 }).length, 1);
});

test("invalid sourcing fingerprints are rejected before being trusted", async () => {
  const source = await readFile("src/lib/sourcingBudgetPlan.ts", "utf8");
  assert.match(source, /FINGERPRINT\.test/);
  assert.match(source, /SOURCING_BUDGET_PLAN_RESPONSE_INVALID/);
  assert.ok(!source.includes("console.log(secret"));
});

test("only a complete, internally consistent sourcing plan releases unused cash", () => {
  const plan = {
    ...validPlan(),
    sourcingBudgetKrw: 200_000,
    readyForConfirmation: true,
    allocation: {
      budgetKrw: 200_000,
      alreadyReservedKrw: 30_000,
      availableBudgetKrw: 170_000,
      estimatedSpendKrw: 120_000,
      remainingBudgetKrw: 50_000,
      selected: [],
      availableCandidates: [],
      excluded: [],
    },
  };
  assert.equal(returnableSourcingBudgetKrw(plan), 50_000);
  assert.equal(returnableSourcingBudgetKrw({ ...plan, readyForConfirmation: false }), 0);
  assert.throws(
    () => returnableSourcingBudgetKrw({
      ...plan,
      allocation: { ...plan.allocation, remainingBudgetKrw: 50_001 },
    }),
    /SOURCING_BUDGET_PLAN_ALLOCATION_INVALID/,
  );
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

test("manual pilot catalog stays a read-only server integration", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://sourcing.example.test/api/integrations/manual-pilot-candidates");
    assert.equal(init.cache, "no-store");
    return Response.json({
      ok: true,
      catalog: {
        version: "manual-pilot-integration-catalog-v1",
        generatedAt: "2026-10-11T00:00:00.000Z",
        selectedConceptCount: 1,
        availableCandidateCount: 1,
        unavailableConceptIds: [],
        candidates: [{
          conceptId: "concept-1",
          canonicalNameKo: "틈새 청소 브러시",
          sourceUrl: "https://detail.1688.com/offer/817041594793.html",
          rawItemId: "raw-1",
          offerId: "817041594793",
          skuLabel: "브러시 단품",
          lane: "AI_CONDITIONAL",
          strictTestReady: false,
          reviewRequired: true,
          automaticOrderAllowed: false,
          finalQualityScore: 74,
          marketDemandScore: 80,
          unitPriceCny: 3,
          moq: 10,
          plannedCostKrw: 1200,
          minimumPilotCapitalKrw: 12000,
          targetSellingPriceKrw: 7900,
          aiDetailPreflightStatus: "CONDITIONAL",
          variants: [{
            variantKey: "variant-1",
            saleOption: "단품",
            chinaOption: "브러시 단품",
            unitPriceCny: 3,
            source: "VISIBLE_1688_OPTION",
            defaultStorageSize: null,
          }],
        }],
        sourceFingerprint: fingerprint("c"),
        businessWritesEnabled: false,
        externalOrderExecuted: false,
      },
    });
  };

  const catalog = await loadManualPilotCatalog({ env, requestTimeoutMs: 100 });
  assert.equal(catalog.availableCandidateCount, 1);
  assert.equal(catalog.candidates[0].automaticOrderAllowed, false);
});

test("purchase preflight shows selected sourcing products even when sourcing budget is zero", async () => {
  const page = await readFile("src/app/purchase-cycle-preflight/page.tsx", "utf8");
  assert.match(page, /loadManualPilotCatalog/);
  assert.match(page, /소싱엔진으로 소싱한 상품/);
  assert.match(page, /수동추가 · 발주 전 검수/);
  assert.match(page, /Promise\.allSettled/);
  assert.doesNotMatch(page, /automaticOrderAllowed\s*=\s*true/);
});
