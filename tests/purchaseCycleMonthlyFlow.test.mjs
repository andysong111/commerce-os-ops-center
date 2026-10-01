import assert from "node:assert/strict";
import test from "node:test";

import { summarizeMonthlyPurchaseProgress } from "../src/lib/purchaseCycleMonthlyFlow.ts";

test("reserved purchase drafts do not activate the actual inbound stage", () => {
  const progress = summarizeMonthlyPurchaseProgress(
    [
      {
        orderedQuantity: 0,
        receivedQuantity: 0,
        openQuantity: 2_998,
      },
    ],
    {
      orderCount: 0,
      lineCount: 25,
      totalQuantity: 2_998,
    },
  );

  assert.deepEqual(progress, {
    orderedQuantity: 0,
    receivedQuantity: 0,
    inboundOpenQuantity: 0,
    displayedOrderQuantity: 0,
    displayedOrderLineCount: 0,
    hasOrder: false,
  });
});

test("actual ordered commitments still activate and complete inbound progress", () => {
  const active = summarizeMonthlyPurchaseProgress(
    [
      { orderedQuantity: 10, receivedQuantity: 4, openQuantity: 6 },
      { orderedQuantity: 0, receivedQuantity: 0, openQuantity: 2_998 },
    ],
    { orderCount: 1, lineCount: 1, totalQuantity: 10 },
  );

  assert.deepEqual(active, {
    orderedQuantity: 10,
    receivedQuantity: 4,
    inboundOpenQuantity: 6,
    displayedOrderQuantity: 10,
    displayedOrderLineCount: 1,
    hasOrder: true,
  });

  const complete = summarizeMonthlyPurchaseProgress(
    [{ orderedQuantity: 10, receivedQuantity: 10, openQuantity: 0 }],
    null,
  );
  assert.equal(complete.inboundOpenQuantity, 0);
  assert.equal(complete.hasOrder, true);
  assert.equal(complete.displayedOrderQuantity, 10);
});
