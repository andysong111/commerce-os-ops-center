import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchHf77MainWorldSource } from "../src/lib/shoplingStockHf77Patch.ts";

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.view = options.view;
  }
}

class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail;
  }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
  }
  matches() { return false; }
  querySelectorAll() { return []; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  dispatchEvent() { return true; }
  click() { this.clicked = (this.clicked || 0) + 1; }
}

class FakeHtmlElement extends FakeElement {}
class FakeInputElement extends FakeHtmlElement {}
class FakeSelectElement extends FakeHtmlElement {}
class FakeTableElement extends FakeHtmlElement {}
class FakeCaptionElement extends FakeHtmlElement {}

function executeMain(source, { documentElement = null } = {}) {
  const listeners = new Map();
  const emitted = [];
  const target = new FakeHtmlElement();
  const observerCalls = [];
  const document = {
    body: null,
    title: "Shopling A21",
    documentElement,
    querySelectorAll: () => [],
    querySelector: (selector) => selector.includes("hf77-token") ? target : null,
    createElement: () => new FakeInputElement(),
  };
  const window = {
    alert: () => {},
    confirm: () => false,
    setTimeout: (callback) => { callback(); return 1; },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatchEvent(event) {
      emitted.push(event);
      for (const handler of listeners.get(event.type) || []) handler(event);
      return true;
    },
  };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(root) {
      if (!root) throw new TypeError("parameter 1 is not of type Node");
      observerCalls.push(root);
    }
  }

  const run = new Function(
    "document", "window", "location", "Element", "HTMLElement",
    "HTMLInputElement", "HTMLSelectElement", "HTMLTableElement",
    "HTMLTableCaptionElement", "MutationObserver", "CustomEvent", "Event",
    "MouseEvent", "CSS", source,
  );
  run(
    document, window, { href: "https://a.shopling.co.kr/a21" }, FakeElement,
    FakeHtmlElement, FakeInputElement, FakeSelectElement, FakeTableElement,
    FakeCaptionElement, FakeMutationObserver, FakeCustomEvent, FakeEvent,
    FakeEvent, { escape: (value) => String(value) },
  );
  return { document, window, listeners, emitted, observerCalls, target };
}

test("HF77 reproduces the v0.6.39 document_start crash before the click listener", async () => {
  const legacy = await readFile("public/shopling-stock-state-sync/main-shopling.js", "utf8");
  assert.throws(
    () => executeMain(legacy),
    /parameter 1 is not of type Node/,
  );
});

test("HF77 installs the click listener while the DOM root is absent, then starts observation later", async () => {
  const legacy = await readFile("public/shopling-stock-state-sync/main-shopling.js", "utf8");
  const source = patchHf77MainWorldSource(legacy);
  const runtime = executeMain(source);

  assert.equal(runtime.observerCalls.length, 0);
  assert.equal(runtime.listeners.get("commerce-os-stock-main-click")?.length, 1);
  assert.equal(runtime.listeners.get("DOMContentLoaded")?.length, 1);

  const root = new FakeElement();
  runtime.document.documentElement = root;
  runtime.window.dispatchEvent(new FakeEvent("DOMContentLoaded"));
  assert.deepEqual(runtime.observerCalls, [root]);

  runtime.target.setAttribute("data-commerce-os-stock-click-token", "hf77-token");
  runtime.window.dispatchEvent(new FakeCustomEvent("commerce-os-stock-main-click", {
    detail: { token: "hf77-token" },
  }));
  const result = runtime.emitted.find((event) =>
    event.type === "commerce-os-stock-main-click-result" && event.detail?.token === "hf77-token"
  );
  assert.equal(result?.detail?.ok, true);
  assert.equal(runtime.target.clicked, 1);
});

test("HF77 download contract packages v0.6.40 and makes it the required stock-sync version", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf77/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.39"/);
  assert.match(route, /const VERSION = "0\.6\.40"/);
  assert.match(route, /SURVIVES_MISSING_DOCUMENT_ELEMENT/);
  assert.match(route, /ONE_ASSIGNMENT_PER_COMPATIBLE_GROUP_UP_TO_200/);
  assert.match(page, /download-hf77/);
  assert.match(page, /v0\.6\.40 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 40\]/);
  assert.match(workflow, /shoplingStockStateHf77\.test\.mjs/);
});
