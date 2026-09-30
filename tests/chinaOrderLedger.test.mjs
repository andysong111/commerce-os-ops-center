import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadLedgerModule() {
  const sourcePath = new URL("../src/lib/chinaOrderLedger.ts", import.meta.url);
  const source = (await readFile(sourcePath, "utf8")).replace(
    /^import \{ createSupabaseAdminClient \} from "@\/lib\/supabase\/admin";\s*/,
    "",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const directory = await mkdtemp(join(dirname(fileURLToPath(sourcePath)), ".ledger-test-"));
  const file = join(directory, "chinaOrderLedger.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const ledger = await loadLedgerModule();
const {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  normalizeChinaOrderCommitmentEvent,
  reduceChinaOrderCommitmentEvents,
  buildChinaOrderLedgerSummary,
  chinaOrderCommitmentCycleMonth,
  completedChinaOrderReceiptsByBarcodeForMonth,
} = ledger;

function event(overrides = {}) {
  return normalizeChinaOrderCommitmentEvent({
    sourceSystem: "china-order-manager",
    sourceLineId: "batch-1:line-1",
    sourceRunId: "batch-1",
    sourceEventId: "event-1",
    barcode: "BAA1-1",
    status: "RESERVED",
    requestedQuantity: 100,
    occurredAt: "2026-08-05T01:00:00.000Z",
    ...overrides,
  });
}

test("order, partial receipt and damage release produce one open commitment", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event(),
    event({
      sourceEventId: "event-2",
      status: "ORDERED",
      orderedQuantity: 90,
      occurredAt: "2026-08-05T02:00:00.000Z",
    }),
    event({
      sourceEventId: "event-3",
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: 40,
      cancelledQuantity: 5,
      occurredAt: "2026-08-05T03:00:00.000Z",
    }),
  ]);

  assert.equal(snapshot.status, "PARTIALLY_RECEIVED");
  assert.equal(snapshot.requestedQuantity, 100);
  assert.equal(snapshot.orderedQuantity, 90);
  assert.equal(snapshot.receivedQuantity, 40);
  assert.equal(snapshot.cancelledQuantity, 5);
  assert.equal(snapshot.committedQuantity, 100);
  assert.equal(snapshot.openQuantity, 55);
  assert.equal(snapshot.manualAddedQuantity, 0);
  assert.equal(snapshot.recommendationOpenQuantity, 55);
});

test("manual Draft add-ons stay in receiving open quantity but are excluded from next recommendation deduction", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event(),
    event({
      sourceEventId: "event-manual-1",
      requestedQuantity: 130,
      occurredAt: "2026-08-05T02:00:00.000Z",
      payload: {
        manualAddition: true,
        addedQuantity: 30,
        previousRequestedQuantity: 100,
        targetRequestedQuantity: 130,
      },
    }),
  ]);

  assert.equal(snapshot.requestedQuantity, 130);
  assert.equal(snapshot.openQuantity, 130);
  assert.equal(snapshot.manualAddedQuantity, 30);
  assert.equal(snapshot.recommendationOpenQuantity, 100);
});

test("manual-only B-code remains fully receivable while contributing zero pending deduction", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event({
      requestedQuantity: 40,
      payload: {
        manualAddition: true,
        addedQuantity: 40,
        previousRequestedQuantity: 0,
        targetRequestedQuantity: 40,
      },
    }),
  ]);

  assert.equal(snapshot.openQuantity, 40);
  assert.equal(snapshot.manualAddedQuantity, 40);
  assert.equal(snapshot.recommendationOpenQuantity, 0);
});

test("partial receiving still closes physical open quantity normally while manual add-on stays excluded", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event(),
    event({
      sourceEventId: "event-manual-1",
      requestedQuantity: 130,
      occurredAt: "2026-08-05T02:00:00.000Z",
      payload: { manualAddition: true, addedQuantity: 30 },
    }),
    event({
      sourceEventId: "event-receipt-1",
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: 50,
      occurredAt: "2026-08-05T03:00:00.000Z",
    }),
  ]);

  assert.equal(snapshot.openQuantity, 80);
  assert.equal(snapshot.recommendationOpenQuantity, 50);
});

test("final receipt closes the open commitment without double-counting", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event(),
    event({
      sourceEventId: "event-2",
      status: "ORDERED",
      orderedQuantity: 100,
      occurredAt: "2026-08-05T02:00:00.000Z",
    }),
    event({
      sourceEventId: "event-3",
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: 40,
      occurredAt: "2026-08-05T03:00:00.000Z",
    }),
    event({
      sourceEventId: "event-4",
      status: "RECEIVED",
      receivedQuantity: 95,
      cancelledQuantity: 5,
      occurredAt: "2026-08-05T04:00:00.000Z",
    }),
  ]);

  assert.equal(snapshot.status, "RECEIVED");
  assert.equal(snapshot.receivedQuantity, 95);
  assert.equal(snapshot.cancelledQuantity, 5);
  assert.equal(snapshot.openQuantity, 0);
  assert.equal(snapshot.recommendationOpenQuantity, 0);
});

test("completed prior-month receipts can cover the next purchase recommendation", () => {
  const received = reduceChinaOrderCommitmentEvents([
    event({ occurredAt: "2026-09-02T01:00:00.000Z" }),
    event({ sourceEventId: "event-2", status: "ORDERED", orderedQuantity: 1800, occurredAt: "2026-09-02T02:00:00.000Z" }),
    event({ sourceEventId: "event-3", status: "RECEIVED", receivedQuantity: 1800, occurredAt: "2026-09-17T02:00:00.000Z" }),
  ]);
  const coverage = completedChinaOrderReceiptsByBarcodeForMonth([received], "2026-09");
  assert.equal(coverage.get("BAA1-1").quantity, 1800);
  assert.equal(coverage.get("BAA1-1").latestReceivedAt, "2026-09-17T02:00:00.000Z");
  assert.equal(completedChinaOrderReceiptsByBarcodeForMonth([received], "2026-08").size, 0);
});

test("explicit purchase cycle prevents month-end events from leaking into the wrong month", () => {
  const received = reduceChinaOrderCommitmentEvents([
    event({
      occurredAt: "2026-09-30T05:00:00.000Z",
      payload: { cycleMonth: "2026-10" },
    }),
    event({
      sourceEventId: "event-2",
      status: "ORDERED",
      orderedQuantity: 100,
      occurredAt: "2026-09-30T05:05:00.000Z",
    }),
    event({
      sourceEventId: "event-3",
      status: "RECEIVED",
      receivedQuantity: 100,
      occurredAt: "2026-09-30T05:10:00.000Z",
    }),
  ]);

  assert.equal(chinaOrderCommitmentCycleMonth(received), "2026-10");
  assert.equal(
    completedChinaOrderReceiptsByBarcodeForMonth([received], "2026-09").size,
    0,
  );
  assert.equal(
    completedChinaOrderReceiptsByBarcodeForMonth([received], "2026-10").get(
      "BAA1-1",
    ).quantity,
    100,
  );
});

test("legacy commitments without an explicit cycle keep the Seoul calendar fallback", () => {
  const received = reduceChinaOrderCommitmentEvents([
    event({ occurredAt: "2026-09-30T16:00:00.000Z" }),
    event({
      sourceEventId: "event-2",
      status: "RECEIVED",
      receivedQuantity: 100,
      occurredAt: "2026-09-30T16:05:00.000Z",
    }),
  ]);

  assert.equal(chinaOrderCommitmentCycleMonth(received), "2026-10");
});

test("monthly purchase consumers use the explicit-cycle ledger resolver", async () => {
  const consumers = await Promise.all(
    [
      "src/app/china-order-manager/page.tsx",
      "src/lib/internalChinaMonthlyPurchaseClose.ts",
      "src/lib/monthlyPurchaseDraftConsolidation.ts",
      "src/lib/sourcingPurchaseIngress.ts",
    ].map((path) => readFile(path, "utf8")),
  );

  for (const source of consumers) {
    assert.match(source, /chinaOrderCommitmentCycleMonth\(row\)/);
    assert.doesNotMatch(
      source,
      /seoulCalendarMonth\(row\.reservedAt \|\| row\.updatedAt\)/,
    );
  }
});

test("ledger summary ignores duplicate event identities", () => {
  const stored = {
    source_event_id: "stored-event-1",
    started_at: "2026-08-05T01:00:00.000Z",
    input_snapshot: event(),
  };
  const summary = buildChinaOrderLedgerSummary([stored, stored]);
  assert.equal(summary.totalCommitments, 1);
  assert.equal(summary.duplicateEventCount, 1);
  assert.equal(summary.totalOpenQuantity, 100);
});

test("managed barcode and source-line identity are fail-closed", () => {
  assert.throws(
    () => event({ barcode: "1234567890" }),
    /CHINA_ORDER_BARCODE_INVALID/,
  );
  assert.throws(
    () =>
      reduceChinaOrderCommitmentEvents([
        event(),
        event({
          sourceLineId: "different-line",
          sourceEventId: "event-2",
          occurredAt: "2026-08-05T02:00:00.000Z",
        }),
      ]),
    /CHINA_ORDER_EVENT_IDENTITY_CONFLICT/,
  );
});

test("event API is idempotent, same-origin guarded and never executes external writes", async () => {
  const route = await readFile(
    "src/app/api/china-order-ledger/events/route.ts",
    "utf8",
  );
  assert.equal(CHINA_ORDER_EVENT_OPERATION_TYPE, "CHINA_ORDER_COMMITMENT_EVENT");
  assert.match(route, /CHINA_ORDER_EVENT_OPERATION_TYPE/);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /x-commerce-os-integration-secret/);
  assert.match(route, /on_conflict=source_event_id/);
  assert.match(route, /resolution=ignore-duplicates/);
  assert.doesNotMatch(route, /shopling/i);
  assert.doesNotMatch(route, /1688/);
  assert.doesNotMatch(route, /inventory.*update|price.*update/i);
});


test("latest source payload survives ledger reduction for pre-inbound sourcing metadata", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event({
      payload: {
        sourcingConfirmed: true,
        sourcingIntakeId: "11111111-1111-4111-8111-111111111111",
        modelNo: "AAA493",
        productName: "검증 신규상품",
        unitPriceCny: 8.5,
      },
    }),
    event({
      sourceEventId: "event-payload-2",
      requestedQuantity: 120,
      occurredAt: "2026-08-05T02:00:00.000Z",
      payload: {
        unitPriceCny: 8.7,
      },
    }),
    event({
      sourceEventId: "event-payload-3",
      status: "ORDERED",
      orderedQuantity: 120,
      occurredAt: "2026-08-05T03:00:00.000Z",
      payload: {
        orderNumber: "fixture-order",
      },
    }),
  ]);
  assert.equal(snapshot.latestPayload.modelNo, "AAA493");
  assert.equal(snapshot.latestPayload.productName, "검증 신규상품");
  assert.equal(snapshot.latestPayload.unitPriceCny, 8.7);
});
