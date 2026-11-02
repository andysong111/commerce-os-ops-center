import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingStockRetransmissionRequest,
  isCurrentShoplingRetransmissionIdentity,
} from "../src/lib/inventoryShoplingRetransmissionPlan.ts";
const blocked = new Set(["BCC6-2", "BAB3-1", "BCB2-1", "BDB2-1"]);
const onSale = new Set(["BBB8-1", "BCC5-1", "BCC5-2"]);
const existingPending = new Set(["BCG5-2", "BCG5-3"]);
const codes = [
  "BCC6-2", "BCG5-2", "BCG5-3", "BAB3-1", "BAE4-1", "BAF1-1", "BBA7-1",
  "BBB3-2", "BBB4-3", "BBB8-1", "BBC3-3", "BBD3-1", "BBD8-1", "BCA5-1",
  "BCB2-1", "BCB6-2", "BCC2-1", "BCC5-1", "BCC5-2", "BCC5-3", "BCC6-1",
  "BCF8-3", "BDB2-1", "BDE7-3", "BZZ341-1",
];

test("owner screenshot fixture creates exactly 21 audited Shopling-only items", () => {
  const request = buildShoplingStockRetransmissionRequest({
    state: "READY", fingerprint: "sha256:fixture",
    rows: codes.map((barcode) => ({
      barcode, productName: `상품 ${barcode}`, modelNo: `MODEL-${barcode}`,
      productKind: barcode === "BBB4-3" ? "SINGLE" : "OPTION",
      desiredStatus: onSale.has(barcode) ? "ON_SALE" : "SOLD_OUT",
      desiredSince: "2026-10-31T00:00:00.000Z", syncNeeded: existingPending.has(barcode),
      syncBlocked: blocked.has(barcode), inventoryQuantityKnown: true,
      manualStatusOnly: barcode === "BCC5-1" || barcode === "BCC5-2",
      salesCoverageReady: !blocked.has(barcode),
    })),
  }, "owner-request-fixture", "2026-11-01T00:00:00.000Z", "사용자 요청");
  assert.equal(request.items.length, 21);
  assert.equal(request.items.filter((item) => item.desiredStatus === "SOLD_OUT").length, 18);
  assert.equal(request.items.filter((item) => item.desiredStatus === "ON_SALE").length, 3);
  assert.equal(request.items.filter((item) => item.mode === "EXISTING_PENDING").length, 2);
  assert.equal(request.items.filter((item) => item.mode === "REPLAY").length, 19);
  assert.deepEqual(request.items.filter((item) => item.mode === "EXISTING_PENDING").map((item) => item.barcode), ["BCG5-2", "BCG5-3"]);
  assert.deepEqual(request.items.filter((item) => blocked.has(item.barcode)), []);
  assert.ok(request.items.every((item) => item.modelNo?.startsWith("MODEL-")));
});

test("retransmission list route is inventory-history neutral and verifies its write", async () => {
  const source = await readFile("src/app/api/inventory-stock-control/retransmission/route.ts", "utf8");
  assert.match(source, /storeShoplingStockRetransmissionRequest/);
  assert.match(source, /loadShoplingStockRetransmissionState/);
  assert.match(source, /재고 기준과 판매 이력은 변경하지 않았습니다/);
  assert.doesNotMatch(source, /INVENTORY_STOCKOUT_RESET_OPERATION_TYPE/);
  assert.doesNotMatch(source, /INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE/);
});

test("operational queue merges pending replay jobs with exact request ids", async () => {
  const [route, ledger] = await Promise.all([
    readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8"),
    readFile("src/lib/inventoryShoplingRetransmission.ts", "utf8"),
  ]);
  assert.match(route, /loadShoplingStockRetransmissionState/);
  assert.match(route, /retransmissionRequestId/);
  assert.match(route, /retransmissionOnly: true/);
  assert.match(ledger, /order\("started_at", \{ ascending: false \}\)/);
  assert.match(ledger, /\.reverse\(\)/);
});

test("explicit B-code command bypasses only canonical coverage uncertainty", () => {
  const current = {
    desiredStatus: "SOLD_OUT",
    productKind: "OPTION",
    desiredSince: "2026-11-02T10:05:28.000Z",
    syncBlocked: true,
    syncBlockReason:
      "품절 초기화 이후의 Canonical 판매 범위를 완전히 확인하지 못했습니다.",
  };
  const command = {
    desiredStatus: "SOLD_OUT",
    productKind: "OPTION",
    desiredSince: current.desiredSince,
    directOperatorCommand: true,
  };
  assert.equal(isCurrentShoplingRetransmissionIdentity(current, command), true);
  assert.equal(
    isCurrentShoplingRetransmissionIdentity(current, {
      ...command,
      directOperatorCommand: false,
    }),
    false,
  );
  assert.equal(
    isCurrentShoplingRetransmissionIdentity(
      {
        ...current,
        syncBlockReason:
          "이전 Shopling 실행이 STARTED/UNCERTAIN 상태라 중복 실행을 차단했습니다.",
      },
      command,
    ),
    false,
  );
  assert.equal(
    isCurrentShoplingRetransmissionIdentity(current, {
      ...command,
      desiredSince: "2026-11-02T10:05:29.000Z",
    }),
    false,
  );
});

test("direct B-code commands stay in the runnable queue instead of the coverage exception list", async () => {
  const [queue, overview] = await Promise.all([
    readFile(
      "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
      "utf8",
    ),
    readFile(
      "src/components/china-order-manager/InventoryStockOverviewPanel.tsx",
      "utf8",
    ),
  ]);
  assert.match(queue, /directCommandBarcodes/);
  assert.match(queue, /!directCommandBarcodes\.has\(row\.barcode\)/);
  assert.match(queue, /directOperatorCommand: job\.directOperatorCommand === true/);
  assert.match(overview, /!row\.syncNeeded \? row\.manualStatusOnly/);
});
