import assert from "node:assert/strict";
import test from "node:test";
import {
  findProductByModelNo,
  findProductsByText,
  getProductMasterItems,
} from "../src/lib/productMaster.ts";
import {
  getProductMasterStorage,
} from "../src/lib/productMasterStorage.ts";
import {
  createInMemoryProductMasterStorage,
  InMemoryProductMasterStorage,
} from "../src/lib/productMasterStore.ts";

test("finds a Product Master item by exact model number", () => {
  const product = findProductByModelNo(" AAA179 ");

  assert.equal(product?.modelNo, "aaa179");
  assert.equal(product?.modelName, "닭물통 니플형");
  assert.equal(product?.optionName, "단품");
});

test("finds Product Master items by model, display, and option text inclusion", () => {
  const modelMatches = findProductsByText("신청 품목: 무타공 스티커 후크");
  const optionMatches = findProductsByText("말발굽 고리링 골드 200개");

  assert.equal(modelMatches[0]?.modelNo, "aaa419");
  assert.equal(optionMatches.length, 1);
  assert.equal(optionMatches[0]?.id, "aaa270-gold");
  assert.match(optionMatches[0]?.displayName ?? "", /말발굽 고리링/);
});

test("returns an empty result for unmatched text", () => {
  assert.deepEqual(findProductsByText("등록되지 않은 완전히 새로운 상품"), []);
});

test("returns detached Product Master item records", () => {
  const items = getProductMasterItems();
  const originalModelName = items[0].modelName;
  items[0].modelName = "changed locally";

  assert.equal(getProductMasterItems()[0].modelName, originalModelName);
});

const adapterItem = {
  id: "adapter-001-blue",
  modelNo: "adapter-001",
  modelName: "Adapter Test Product",
  optionName: "Blue",
  barcode: "1234567890123",
  origin: "MADE IN TEST",
  displayName: "Adapter Test Product · Blue",
  memo: "initial memo",
};

test("supports Product Master adapter create, list, get, update, and delete", () => {
  const storage = createInMemoryProductMasterStorage();

  const created = storage.create(adapterItem);
  assert.deepEqual(created, adapterItem);
  assert.deepEqual(storage.list(), [adapterItem]);
  assert.deepEqual(storage.get(adapterItem.id), adapterItem);

  created.modelName = "mutated outside storage";
  assert.equal(storage.get(adapterItem.id)?.modelName, adapterItem.modelName);

  const updated = storage.update(adapterItem.id, {
    displayName: "Adapter Test Product · Updated Blue",
    memo: "updated memo",
  });
  assert.equal(updated?.memo, "updated memo");
  assert.equal(
    storage.get(adapterItem.id)?.displayName,
    "Adapter Test Product · Updated Blue",
  );
  assert.equal(storage.update("missing", { memo: "ignored" }), undefined);

  assert.equal(storage.delete(adapterItem.id), true);
  assert.equal(storage.get(adapterItem.id), undefined);
  assert.equal(storage.delete(adapterItem.id), false);
});

test("adapter performs exact model number and text inclusion lookups", () => {
  const storage = createInMemoryProductMasterStorage([
    adapterItem,
    {
      ...adapterItem,
      id: "adapter-001-red",
      optionName: "Red",
      displayName: "Adapter Test Product · Red",
    },
  ]);

  assert.equal(storage.findByModelNo(" ADAPTER-001 ")?.id, adapterItem.id);
  assert.equal(storage.findByModelNo("missing"), undefined);
  assert.deepEqual(
    storage.findByText("shipment adapter-001 red").map((item) => item.id),
    ["adapter-001-red"],
  );
  assert.equal(storage.findByText("Adapter Test Product").length, 2);
  assert.deepEqual(storage.findByText("unmatched product text"), []);
});

test("default Product Master provider returns the seeded memory adapter", () => {
  const storage = getProductMasterStorage();

  assert.ok(storage instanceof InMemoryProductMasterStorage);
  assert.equal(storage, getProductMasterStorage());
  assert.ok(storage.list().some((item) => item.modelNo === "aaa179"));
});
