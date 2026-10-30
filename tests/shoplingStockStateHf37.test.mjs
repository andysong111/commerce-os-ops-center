import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchShoplingStockHf37Worker } from "../src/lib/shoplingStockHf37Patch.ts";

const legacyWorker = `
  const START = "20230101";
  const norm = (v) => String(v ?? "").replace(/\\s+/g, " ").trim();
  const digits = (v) => String(v ?? "").replace(/\\D/g, "");
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const todayKst = () => "20261029";
  const dateValue = (_input, value) => value;
  function datePair(form) {
    const namedStarts = [...form.querySelectorAll('input[name="s_dt"], input#s_dt')];
    const namedEnds = [...form.querySelectorAll('input[name="e_dt"], input#e_dt')];
    if (namedStarts.length === 1 && namedEnds.length === 1 && namedStarts[0] !== namedEnds[0]) {
      return [namedStarts[0], namedEnds[0]];
    }
    const inputs = [...form.querySelectorAll("input")].filter((el) => {
      const type = String(el.type || "text").toLowerCase();
      if (!["text", "date", "search"].includes(type) || !visible(el)) return false;
      const context = norm(el.closest("tr")?.textContent || el.parentElement?.textContent);
      return /^20\\d{6}$|^201\\d{5}$/.test(digits(el.value)) && /일자|날짜|기간|등록일|date/i.test(\`${"${context}"} ${"${el.name || \"\"}"} ${"${el.id || \"\"}"}\`);
    });
    const pairs = [];
    for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i], b = inputs[j], ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (Math.abs(ar.top - br.top) <= 18 && (a.closest("tr") === b.closest("tr") || Math.abs(ar.left - br.left) < 240)) pairs.push(ar.left <= br.left ? [a, b] : [b, a]);
    }
    return pairs.length === 1 ? pairs[0] : null;
  }
  function applyPeriod(form, setInput) {
    const pair = datePair(form);
    if (!pair) return { ok: false, code: "SEARCH_DATE_FIELDS_AMBIGUOUS", message: "검색 시작일·종료일을 정확히 특정하지 못해 검색을 차단했습니다." };
    const end = todayKst();
    for (const [index, value] of [START, end].entries()) if (digits(pair[index].value) !== value) setInput(pair[index], dateValue(pair[index], value));
    return { ok: digits(pair[0].value) === START && digits(pair[1].value) === end };
  }
  return { datePair, applyPeriod };
`;

function input({ name, row, top, left }) {
  return {
    name,
    id: "",
    type: "text",
    value: "",
    placeholder: "",
    disabled: false,
    parentElement: row,
    closest: () => row,
    getBoundingClientRect: () => ({ top, left, width: 100, height: 20 }),
  };
}

function fixture(extraDate = false) {
  const dateRow = { textContent: "일자 상품등록일 오늘 이번달 3개월 6개월 1년" };
  const searchRow = { textContent: "검색항목 옵션자체관리코드" };
  const inputs = [
    input({ name: "regStart", row: dateRow, top: 10, left: 100 }),
    input({ name: "regEnd", row: dateRow, top: 10, left: 230 }),
    input({ name: "keyword", row: searchRow, top: 50, left: 100 }),
  ];
  if (extraDate) inputs.splice(2, 0, input({ name: "otherDate", row: dateRow, top: 10, left: 360 }));
  const form = {
    querySelectorAll: (selector) => selector === "input" ? inputs : [],
  };
  const helper = new Function(patchShoplingStockHf37Worker(legacyWorker))();
  return { helper, inputs, form };
}

test("HF37 binds the unique empty A4 registration-date pair and fills 2023-to-today", () => {
  const f = fixture();
  const result = f.helper.applyPeriod(f.form, (element, value) => {
    element.value = value;
    return true;
  });
  assert.equal(result.ok, true);
  assert.equal(f.inputs[0].value, "20230101");
  assert.equal(f.inputs[1].value, "20261029");
  assert.equal(f.inputs[2].value, "");
});

test("HF37 remains fail-closed and records pre-search evidence when date fields are not unique", () => {
  const f = fixture(true);
  const result = f.helper.applyPeriod(f.form, () => true);
  assert.equal(result.code, "SEARCH_DATE_FIELDS_AMBIGUOUS");
  assert.equal(result.evidence.stage, "PRE_SEARCH_DATE_BINDING");
  assert.equal(result.evidence.mutationAttempted, false);
  assert.equal(result.evidence.dateCandidates.length, 3);
  assert.ok(f.inputs.every((element) => element.value === ""));
});

test("HF37 remains v0.6.5 while the UI requires HF49 and keeps a terminal result", async () => {
  const [route, page, planner, queue, hiddenBrowserCheck] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf37/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("scripts/inventory-ui-hidden-check.mjs", "utf8"),
  ]);
  assert.match(route, /getHf36Download/);
  assert.match(route, /const VERSION = "0\.6\.5"/);
  assert.match(page, /download-hf49/);
  assert.match(page, /v0\.6\.14 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 14\]/);
  assert.match(queue, /작업 종료 · 실패\/확인 필요/);
  assert.match(queue, /미반영 · 상품 검색 전에 안전 차단/);
  assert.match(queue, /자동 재시도: 안 함/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.14'/);
});
