import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const { normalizePurchaseDraftDiscontinuations } = await import(
  new URL("../src/lib/purchaseDraftDiscontinuationsCore.ts", import.meta.url)
);

async function loadServiceModule() {
  const sourcePath = new URL(
    "../src/lib/purchaseDraftDiscontinuations.ts",
    import.meta.url,
  );
  const coreUrl = new URL(
    "../src/lib/purchaseDraftDiscontinuationsCore.ts",
    import.meta.url,
  ).href;
  const source = (await readFile(sourcePath, "utf8"))
    .replace(
      /^import \{ loadFastPurchaseInternalDrafts \} from "@\/lib\/fastPurchaseInternalDraft";\s*/m,
      "const loadFastPurchaseInternalDrafts = async () => globalThis.__draftLedger;\n",
    )
    .replace(
      /import \{\s*appendPurchaseStrategyProductEvent,\s*loadPurchaseStrategyState,\s*PurchaseStrategyError,\s*\} from "@\/lib\/purchaseStrategyState";\s*/m,
      "const appendPurchaseStrategyProductEvent = async (input) => globalThis.__appendStrategy(input);\nconst loadPurchaseStrategyState = async () => globalThis.__strategyState();\nclass PurchaseStrategyError extends Error {}\n",
    )
    .replace(
      'from "@/lib/purchaseDraftDiscontinuationsCore"',
      `from ${JSON.stringify(coreUrl)}`,
    )
    .replace(
      'from "@/lib/purchaseDraftDiscontinuationsCore"',
      `from ${JSON.stringify(coreUrl)}`,
    );
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(sourcePath)), ".purchase-draft-discontinue-test-"),
  );
  const file = join(directory, "purchaseDraftDiscontinuations.ts");
  await writeFile(file, source);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("draft discontinuations normalize managed B-codes and preserve order", () => {
  assert.deepEqual(
    normalizePurchaseDraftDiscontinuations([" bbc1–1 ", "BAF1-1"]),
    ["BBC1-1", "BAF1-1"],
  );
});

test("draft discontinuations reject duplicates, invalid codes, and oversized batches", () => {
  assert.throws(
    () => normalizePurchaseDraftDiscontinuations(["BBC1-1", "bbc1-1"]),
    /PURCHASE_DRAFT_DISCONTINUATIONS_INVALID/,
  );
  assert.throws(
    () => normalizePurchaseDraftDiscontinuations(["AAA092"]),
    /PURCHASE_DRAFT_DISCONTINUATIONS_INVALID/,
  );
  assert.throws(
    () => normalizePurchaseDraftDiscontinuations(
      Array.from({ length: 51 }, (_, index) => `BAA${index + 1}-1`),
    ),
    /PURCHASE_DRAFT_DISCONTINUATIONS_INVALID/,
  );
});

test("draft discontinuation service reuses the permanent strategy ledger and stays inside the active draft", async () => {
  const service = await readFile(
    "src/lib/purchaseDraftDiscontinuations.ts",
    "utf8",
  );
  assert.match(service, /loadFastPurchaseInternalDrafts/);
  assert.match(service, /PURCHASE_DRAFT_DISCONTINUATIONS_OUTSIDE_DRAFT/);
  assert.match(service, /appendPurchaseStrategyProductEvent/);
  assert.match(service, /action: "DISCONTINUE"/);
  assert.match(service, /status !==\s*"DISCONTINUED"/);
  assert.match(service, /남은 재고|never changes[\s\S]*stock quantity/);
  assert.doesNotMatch(
    service,
    /storeInventoryOperationBatch|saveInternalChinaPurchaseDraft|mark.*Ordered|unitPriceCny/,
  );
});

test("draft discontinuation save is idempotent and records no inventory or order write", async () => {
  const events = [];
  globalThis.__draftLedger = {
    error: null,
    drafts: [{
      draftId: "fast-purchase-draft:1234567890abcdef1234",
      openQuantity: 10,
      lines: [{ barcode: "BBC1-1", openQuantity: 10 }],
    }],
  };
  globalThis.__strategyState = () => ({
    states: events.length
      ? [{ barcode: "BBC1-1", status: "DISCONTINUED" }]
      : [],
    productHistory: events.map((event, index) => ({
      ...event,
      sourceEventId: `event-${index + 1}`,
    })),
  });
  globalThis.__appendStrategy = async (input) => {
    events.push(input);
    return { sourceEventId: `event-${events.length}`, event: input };
  };
  const { storePurchaseDraftDiscontinuations } = await loadServiceModule();

  const first = await storePurchaseDraftDiscontinuations({
    draftId: "fast-purchase-draft:1234567890abcdef1234",
    barcodes: ["BBC1-1"],
  });
  const retry = await storePurchaseDraftDiscontinuations({
    draftId: "fast-purchase-draft:1234567890abcdef1234",
    barcodes: ["BBC1-1"],
  });

  assert.equal(first.savedCount, 1);
  assert.equal(retry.savedCount, 0);
  assert.equal(retry.alreadySavedCount, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "DISCONTINUE");
  assert.match(events[0].reason, /발주초안에서 단종예정 지정/);
  assert.equal(events[0].actor, "ops-center-purchase-draft");
  delete globalThis.__draftLedger;
  delete globalThis.__strategyState;
  delete globalThis.__appendStrategy;
});

test("draft discontinuation rejects a B-code outside the active draft before policy append", async () => {
  let appendCount = 0;
  globalThis.__draftLedger = {
    error: null,
    drafts: [{
      draftId: "fast-purchase-draft:1234567890abcdef1234",
      openQuantity: 10,
      lines: [{ barcode: "BBC1-1", openQuantity: 10 }],
    }],
  };
  globalThis.__strategyState = () => ({ states: [], productHistory: [] });
  globalThis.__appendStrategy = async () => {
    appendCount += 1;
  };
  const { storePurchaseDraftDiscontinuations } = await loadServiceModule();

  await assert.rejects(
    () => storePurchaseDraftDiscontinuations({
      draftId: "fast-purchase-draft:1234567890abcdef1234",
      barcodes: ["BAF1-1"],
    }),
    /PURCHASE_DRAFT_DISCONTINUATIONS_OUTSIDE_DRAFT/,
  );
  assert.equal(appendCount, 0);
  delete globalThis.__draftLedger;
  delete globalThis.__strategyState;
  delete globalThis.__appendStrategy;
});

test("draft workspace stages a fifth discontinue button and recalculates once", async () => {
  const workspace = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  );
  const recalculation = await readFile(
    "src/lib/purchaseCyclePreflightDraft.ts",
    "utf8",
  );
  assert.match(workspace, /grid-cols-5/);
  assert.match(workspace, />단종예정<\/button>/);
  assert.match(workspace, /stagedDiscontinuations/);
  assert.match(workspace, /discontinuedBarcodes,/);
  assert.match(workspace, /현재와 이후 발주 후보에서 영구 제외/);
  assert.match(recalculation, /storePurchaseDraftDiscontinuations/);
  assert.match(
    recalculation,
    /\.\.\.input\.excludedBarcodes,[\s\S]*\.\.\.discontinuedBarcodes/,
  );
  assert.match(recalculation, /externalOrderExecuted: false/);
});
