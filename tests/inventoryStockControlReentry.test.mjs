import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadInventoryPureHelpers() {
  const sourcePath = new URL("../src/lib/inventoryStockControl.ts", import.meta.url);
  let source = await readFile(sourcePath, "utf8");
  source = source.replace(/^import .*?;\s*$/gms, (match) => {
    // Remove only the top import block; the pure helpers under test have no runtime dependency on it.
    return match.includes("function object") ? match : "";
  });
  source = source.replace(/^(import[\s\S]*?)(?=export const INVENTORY_STOCKOUT_RESET_OPERATION_TYPE)/, "");
  source += "\nexport { receiptPointsFromRows, stateTransition };\n";
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const directory = await mkdtemp(join(dirname(sourcePath.pathname), ".inventory-reentry-test-"));
  const file = join(directory, "inventoryStockControl.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const { receiptPointsFromRows, stateTransition } = await loadInventoryPureHelpers();

const resetAt = "2026-09-01T00:00:00.000Z";

function point(occurredAt, delta, order = delta >= 0 ? 0 : 1, type = delta >= 0 ? "RECEIPT" : "SALE") {
  return { occurredAt, delta, order, type };
}

test("confirmed receipt after stockout reset restores desired Shopling state to ON_SALE", () => {
  const transition = stateTransition(resetAt, [
    point("2026-09-02T00:00:00.000Z", 5),
  ]);
  assert.equal(transition.quantityOnHand, 5);
  assert.equal(transition.desired, "ON_SALE");
  assert.equal(transition.desiredSince, "2026-09-02T00:00:00.000Z");
});

test("sales after restock keep ON_SALE while exact inventory remains positive", () => {
  const transition = stateTransition(resetAt, [
    point("2026-09-02T00:00:00.000Z", 10),
    point("2026-09-03T00:00:00.000Z", -4),
  ]);
  assert.equal(transition.quantityOnHand, 6);
  assert.equal(transition.desired, "ON_SALE");
  assert.equal(transition.desiredSince, "2026-09-02T00:00:00.000Z");
});

test("inventory returning to zero switches to SOLD_OUT and a later receipt switches back to ON_SALE", () => {
  const transition = stateTransition(resetAt, [
    point("2026-09-02T00:00:00.000Z", 5),
    point("2026-09-03T00:00:00.000Z", -5),
    point("2026-09-04T00:00:00.000Z", 3),
  ]);
  assert.equal(transition.quantityOnHand, 3);
  assert.equal(transition.desired, "ON_SALE");
  assert.equal(transition.desiredSince, "2026-09-04T00:00:00.000Z");
});

test("cumulative China receipt events produce only incremental stock deltas", () => {
  const rows = [
    {
      started_at: "2026-09-02T00:00:00.000Z",
      input_snapshot: {
        sourceSystem: "china-order-manager",
        sourceLineId: "draft-1:line-1",
        barcode: "BZZ341-1",
        status: "PARTIALLY_RECEIVED",
        requestedQuantity: 10,
        orderedQuantity: 10,
        receivedQuantity: 4,
        occurredAt: "2026-09-02T00:00:00.000Z",
      },
    },
    {
      started_at: "2026-09-03T00:00:00.000Z",
      input_snapshot: {
        sourceSystem: "china-order-manager",
        sourceLineId: "draft-1:line-1",
        barcode: "BZZ341-1",
        status: "RECEIVED",
        requestedQuantity: 10,
        orderedQuantity: 10,
        receivedQuantity: 10,
        occurredAt: "2026-09-03T00:00:00.000Z",
      },
    },
  ];
  const points = receiptPointsFromRows(rows);
  assert.deepEqual(points.map((row) => row.delta), [4, 6]);
  assert.equal(points.reduce((sum, row) => sum + row.delta, 0), 10);
});

test("Shopling ON_SALE API maps to status B and preserves the existing option quantity", async () => {
  const source = await readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8");
  assert.match(source, /return desired === "SOLD_OUT" \? "C" : "B"/);
  assert.match(source, /<optStatus>\$\{target\}<\/optStatus>/);
  assert.match(source, /<optQty>\$\{variant\.optionQuantity\}<\/optQty>/);
  assert.match(source, /after\.optionQuantity !== before\.optionQuantity/);
  assert.match(source, /SHOPLING_OPTION_READBACK_QTY_MISMATCH/);
});

test("option stock-sync extension accepts ON_SALE and forwards desiredStatus through the API bridge", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v052.js", "utf8");
  assert.match(background, /\["SOLD_OUT", "ON_SALE"\]\.includes\(desiredStatus\)/);
  assert.match(background, /job:\s*\{[\s\S]*\.\.\.active\.job,[\s\S]*goodsKeys:/);
  assert.match(background, /API 상태변경 → A21 전건 직렬송신/);
});

test("SINGLE route keeps A4 as the first mutation and A21 as the sale-status transmission stage", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v052.js", "utf8");
  assert.match(background, /productKind === "OPTION" \? \["A6", "A21_LIST"\] : \["A4", "A21_LIST"\]/);
  assert.match(background, /stage: "A4"/);
  assert.match(background, /A4 → A21 상품판매상태 송신/);
});

test("HF11 SINGLE A21 list delegates row selection to the literal price-extension engine without altering HF10 OPTION core", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v056.js", "utf8");
  assert.match(background, /importScripts\("background-v055\.js"\)/);
  assert.match(background, /PRICE_EXTENSION_CONTENT_A21_LITERAL_SINGLE_LIST_ONLY/);
  assert.match(background, /active\.job\?\.productKind === "SINGLE"/);
  assert.match(background, /goodsKeys: \[goodsKey\]/);
  assert.match(background, /type: CANONICAL_ASSIGN/);
});

test("HF11 SINGLE popup sends only product sale status and maps both SOLD_OUT and ON_SALE explicitly", async () => {
  const popup = await readFile("public/shopling-stock-state-sync/content-stock-single-popup-v011.js", "utf8");
  assert.match(popup, /상품판매상태송신/);
  assert.match(popup, /desiredStatus === "SOLD_OUT" \? "품절" : desiredStatus === "ON_SALE" \? "판매중"/);
  assert.match(popup, /\^상품수정\\s\*송신\$/);
  assert.match(popup, /clickViaMain\(button\)/);
  assert.doesNotMatch(popup, /옵션송신만/);
});

test("HF11 SINGLE result waits for a stable product-complete footer and closes only its managed result window/tab", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v056.js", "utf8");
  assert.match(background, /STABLE_MS = 2_500/);
  assert.match(background, /productComplete: \/상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(background, /closeManagedSinglePopup/);
  assert.match(background, /chrome\.windows\.remove\(windowId\)/);
  assert.match(background, /chrome\.tabs\.remove\(tabId\)/);
});
