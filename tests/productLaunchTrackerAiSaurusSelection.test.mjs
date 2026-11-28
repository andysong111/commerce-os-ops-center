import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

test("AI 사우루스 작업판은 체크한 제작 가능 상품만 전달하고 SEO 캐시와 보관 행을 거른다", async () => {
  const rows = [
    { id: "general", eligible: true, checked: true },
    { id: "detail-only", eligible: true, checked: true },
    { id: "archived", eligible: false, checked: true },
    { id: "cached-seo", eligible: false, checked: true },
    { id: "unchecked", eligible: true, checked: false },
    { id: "disabled", eligible: true, checked: true, disabled: true },
  ];
  const table = { querySelectorAll(selector) {
    assert.equal(selector, "tr[data-id] input[data-ai-saurus-selection]:checked:not(:disabled)");
    return rows.filter((row) => row.eligible && row.checked && !row.disabled)
      .map(({ id }) => ({ closest: () => ({ dataset: { id } }) }));
  } };
  let clicked;
  let request;
  let destination;
  const button = { addEventListener(event, listener) { if (event === "click") clicked = listener; } };
  const elements = { "#ai-saurus-bulk-detail": button, "#ai-saurus-bulk-detail-status": {}, "#launch-table-body": table };
  const { open } = vm.runInNewContext(readFileSync("public/product-launch-tracker-app/ai-saurus-bulk-detail.js", "utf8") +
    "\n({ open: openWorkbench });", {
    document: { querySelector: (name) => elements[name], addEventListener() {} },
    MutationObserver: class { observe() {} },
    window: { top: { location: { assign(url) { destination = url; } } } },
    fetch: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ batch: { id: "fixture" } }) };
    },
  });
  assert.equal(typeof clicked, "function");
  assert.equal(button.disabled, false);
  assert.match(button.textContent, /2건/);
  await open();
  assert.equal(request.url, "/api/ai-saurus-bulk-detail");
  assert.equal(request.body.action, "create");
  assert.deepEqual(request.body.itemIds, ["general", "detail-only"]);
  assert.equal(destination, "/ai-saurus-bulk-detail?batch=fixture");
});

test("기존 카테고리 생성과 재출시 작업은 일반 상품 선택만 처리한다", () => {
  for (const file of ["category-ai-reliable.js", "category-ai.js", "relaunch-reset-fixed.js", "relaunch-reset.js"]) {
    const source = readFileSync(`public/product-launch-tracker-app/${file}`, "utf8");
    assert.ok(source.includes('row.querySelector("input.row-check:checked:not(:disabled)")'), file);
  }
});
