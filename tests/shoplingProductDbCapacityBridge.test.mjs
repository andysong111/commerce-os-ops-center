import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("Shopling plan parser reads the 10,000 maximum and 11,113 cumulative use", async () => {
  const script = await source(
    "public/shopling-account-title-bridge/content-shopling-product-db-capacity.js",
  );
  const context = vm.createContext({ console });
  vm.runInContext(script, context);
  const parse = context.__commerceOsParseShoplingProductDbCapacityText;
  assert.equal(typeof parse, "function");
  assert.deepEqual(
    { ...parse(`상품 DB\n10,000\n사용 상품 DB 수 (누적)\n11,113\n쇼핑몰 상품 등록\n25,000\n925`) },
    {
      maximumProductCodeCount: 10_000,
      usedProductCodeCount: 11_113,
    },
  );
  assert.equal(parse("상품 DB\n10,000\n사용 상품 DB 수 (누적)\n알 수 없음"), null);
});

test("v0.6.5 extension stores Shopling quota and syncs it only from the Ops page", async () => {
  const [manifestRaw, download, collector, sync, main] = await Promise.all([
    source("public/shopling-account-title-bridge/manifest.json"),
    source("src/app/api/shopling-account-title-bridge/download/route.ts"),
    source("public/shopling-account-title-bridge/content-shopling-product-db-capacity.js"),
    source("public/shopling-account-title-bridge/content-commerce-os-product-db-capacity-sync.js"),
    source("public/shopling-account-title-bridge/content-commerce-os-product-db-capacity-main.js"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  assert.match(download, /manifest\.version = "0\.6\.5"/);
  assert.match(download, /v0\.6\.5\.zip/);
  assert.ok(download.includes('"content-shopling-product-db-capacity.js"'));
  assert.ok(download.includes('"content-commerce-os-product-db-capacity-sync.js"'));
  assert.ok(download.includes('"content-commerce-os-product-db-capacity-main.js"'));
  assert.ok(
    manifest.content_scripts.some((entry) =>
      entry.js?.includes("content-shopling-product-db-capacity.js"),
    ),
  );
  assert.ok(
    manifest.content_scripts.some(
      (entry) =>
        entry.world === "MAIN" &&
        entry.js?.includes("content-commerce-os-product-db-capacity-main.js"),
    ),
  );
  assert.match(collector, /chrome\.storage\.local\.set/);
  assert.match(sync, /commerce-os-shopling-product-db-capacity-sync-request/);
  assert.match(main, /credentials: "same-origin"/);
  assert.match(main, /shopling-product-db-capacity-readback/);
  assert.match(sync, /data-commerce-os-shopling-product-db-capacity-bridge-ready/);
  assert.match(sync, /detail: JSON\.stringify\(payload\)/);
  assert.match(main, /setAttribute\(READY_ATTRIBUTE, "v1"\)/);
  assert.match(main, /detail: JSON\.stringify\(value\)/);
  for (const script of [collector, sync, main]) {
    assert.doesNotMatch(script, /\.click\s*\(|requestSubmit\s*\(|\.submit\s*\(/);
  }
});

test("v0.6.5 retries when isolated sync starts before the MAIN-world bridge", async () => {
  const [sync, main] = await Promise.all([
    source("public/shopling-account-title-bridge/content-commerce-os-product-db-capacity-sync.js"),
    source("public/shopling-account-title-bridge/content-commerce-os-product-db-capacity-main.js"),
  ]);
  const listeners = new Map();
  const documentListeners = new Map();
  const attributes = new Map();
  const timers = new Map();
  const storage = {
    commerceOsShoplingProductDbCapacityV1: {
      snapshotId: "00000000-0000-4000-8000-000000000001",
      source: "shopling-plan-dom-v1",
      observedAt: new Date().toISOString(),
      maximumProductCodeCount: 10_000,
      usedProductCodeCount: 11_113,
      evidence: { pathname: "/", pageTitle: "Shopling" },
    },
  };
  const requests = [];
  let nextTimerId = 1;

  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    addEventListener(type, listener) {
      const rows = listeners.get(type) ?? [];
      rows.push(listener);
      listeners.set(type, rows);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    setTimeout(listener) {
      const id = nextTimerId++;
      timers.set(id, listener);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const document = {
    visibilityState: "visible",
    documentElement: {
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
    },
    addEventListener(type, listener) {
      const rows = documentListeners.get(type) ?? [];
      rows.push(listener);
      documentListeners.set(type, rows);
    },
  };
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries(keys.map((key) => [key, storage[key]])));
        },
        set(value, callback) {
          Object.assign(storage, value);
          callback();
        },
      },
    },
  };
  const context = vm.createContext({
    chrome,
    console,
    CustomEvent,
    Date,
    document,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    },
    JSON,
    Number,
    String,
    window,
  });
  const flush = async () => {
    for (let pass = 0; pass < 10; pass += 1) await Promise.resolve();
  };
  const drainTimers = async () => {
    for (let pass = 0; pass < 10 && timers.size > 0; pass += 1) {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, listener] of pending) listener();
      await flush();
    }
  };

  vm.runInContext(sync, context);
  await drainTimers();
  assert.equal(requests.length, 0, "the isolated world must wait for MAIN readiness");

  vm.runInContext(main, context);
  await drainTimers();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/seo-listing-lifecycle/shopling-product-db-capacity-readback");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    snapshotId: "00000000-0000-4000-8000-000000000001",
    source: "shopling-plan-dom-v1",
    observedAt: storage.commerceOsShoplingProductDbCapacityV1.observedAt,
    maximumProductCodeCount: 10_000,
    usedProductCodeCount: 11_113,
    evidence: { pathname: "/", pageTitle: "Shopling" },
  });
  assert.equal(
    storage.commerceOsShoplingProductDbCapacityLastSyncedV1,
    "00000000-0000-4000-8000-000000000001",
  );
});
