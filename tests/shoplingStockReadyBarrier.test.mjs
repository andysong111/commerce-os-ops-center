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
              statusProbeOk: true,
              idleConfirmed: status === null,
            },
          });
        }
      });
    },
  };
  return { bridge, pingCount: () => pingCount };
}

function fakeStatusBridge(messages) {
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
      const status = messages[Math.min(pingCount, messages.length - 1)];
      pingCount += 1;
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            source: bridge,
            origin: bridge.location.origin,
            data: {
              type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS",
              ...status,
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

test("HF94 explicit idle receipt releases the first B-code without treating READY as authority", async () => {
  const { bridge } = fakeStatusBridge([
    {
      active: null,
      statusProbeOk: true,
      idleConfirmed: true,
    },
  ]);

  await waitForShoplingStockIdle({
    bridgeWindow: bridge,
    timeoutMs: 100,
    pollIntervalMs: 5,
  });
});

test("HF94 status-probe failure remains blocked and exposes the exact extension error", async () => {
  const { bridge } = fakeStatusBridge([
    {
      active: null,
      statusProbeOk: false,
      idleConfirmed: false,
      statusProbeCode: "HF94_IDLE_STATUS_MESSAGE_FAILED",
      statusProbeError: "서비스워커 응답이 없습니다.",
    },
  ]);

  await assert.rejects(
    waitForShoplingStockIdle({
      bridgeWindow: bridge,
      timeoutMs: 20,
      pollIntervalMs: 5,
    }),
    /HF94_IDLE_STATUS_MESSAGE_FAILED · 서비스워커 응답이 없습니다/,
  );
});

test("HF94 never treats an explicit non-idle receipt with no active payload as idle", async () => {
  const { bridge } = fakeStatusBridge([
    {
      active: null,
      statusProbeOk: true,
      idleConfirmed: false,
    },
  ]);

  await assert.rejects(
    waitForShoplingStockIdle({
      bridgeWindow: bridge,
      timeoutMs: 20,
      pollIntervalMs: 5,
    }),
    /작업 없음 상태를 명시적으로 확인하지 않았습니다/,
  );
});

test("HF94 ignores a legacy active-null status without the dedicated idle receipt", async () => {
  const { bridge } = fakeStatusBridge([{ active: null }]);

  await assert.rejects(
    waitForShoplingStockIdle({
      bridgeWindow: bridge,
      timeoutMs: 20,
      pollIntervalMs: 5,
    }),
    /전용 다음 작업 가능 확인 영수증을 받지 못했습니다/,
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

test("hidden-tab browser fixture acknowledges the production idle-status protocol", async () => {
  const fixture = await readFile("scripts/inventory-ui-hidden-check.mjs", "utf8");
  assert.match(fixture, /COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING/);
  assert.match(fixture, /COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY/);
  assert.match(fixture, /COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS/);
  assert.match(fixture, /active: null/);
  assert.match(fixture, /idleConfirmed: true/);
  assert.match(fixture, /statusProbeOk: true/);
});
