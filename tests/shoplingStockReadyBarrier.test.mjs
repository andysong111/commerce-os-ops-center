import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { waitForShoplingStockIdle } from "../src/lib/shoplingStockReadyBarrier.ts";

function fakeBridge(statuses) {
  const listeners = new Set();
  let pingCount = 0;
  const bridge = {
    location: { origin: "https://commerce-os.example" },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    postMessage(message) {
      if (message.type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING") return;
      const status = statuses[Math.min(pingCount, statuses.length - 1)];
      pingCount += 1;
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            source: bridge,
            origin: bridge.location.origin,
            data: {
              type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS",
              active: status,
            },
          });
        }
      });
    },
  };
  return { bridge, pingCount: () => pingCount };
}

test("real BBF8-1 stale lock is polled until the extension explicitly reports idle", async () => {
  const { bridge, pingCount } = fakeBridge([
    { status: "RUNNING", job: { jobId: "bbf8", barcode: "BBF8-1" } },
    null,
  ]);

  await waitForShoplingStockIdle({
    bridgeWindow: bridge,
    timeoutMs: 100,
    pollIntervalMs: 5,
  });

  assert.ok(pingCount() >= 2);
});

test("a lock that never clears fails closed instead of starting the next B-code", async () => {
  const { bridge } = fakeBridge([
    { status: "RUNNING", job: { jobId: "bbf8", barcode: "BBF8-1" } },
  ]);

  await assert.rejects(
    waitForShoplingStockIdle({
      bridgeWindow: bridge,
      timeoutMs: 20,
      pollIntervalMs: 5,
    }),
    /SHOPLING_STOCK_EXTENSION_NOT_IDLE: BBF8-1/,
  );
});

test("both direct input and operational queue gate STARTED recording behind the idle barrier", async () => {
  const [direct, queue] = await Promise.all([
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
  ]);

  for (const source of [direct, queue]) {
    const barrier = source.indexOf("await waitForShoplingStockIdle()");
    const started = source.indexOf('"STARTED"', barrier);
    assert.ok(barrier >= 0, "idle barrier must be present");
    assert.ok(started > barrier, "STARTED must be recorded only after explicit idle acknowledgement");
  }
  assert.doesNotMatch(
    direct,
    /COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY[\s\S]{0,1200}launchNextRef\.current/,
    "READY alone must not launch a queued B-code before STATUS confirms idle",
  );
});
