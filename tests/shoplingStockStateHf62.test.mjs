import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";

const root = "public/shopling-stock-state-sync";

function searchFixture(policy, storage, { rows = [] } = {}) {
  const row = { textContent: "일자 상품등록일 오늘 1년" };
  const inputs = ["20261001", "20261104", ""].map((value, index) => ({
    value,
    name: index < 2 ? `date${index}` : "keyword",
    type: "text",
    disabled: false,
    getBoundingClientRect: () => ({
      top: index < 2 ? 10 : 50,
      left: 100 + 110 * index,
      width: 100,
      height: 20,
    }),
    closest: () => (index < 2 ? row : { textContent: "검색항목" }),
    dispatchEvent() {},
  }));
  const form = { querySelectorAll: () => inputs };
  const field = {
    form,
    selectedIndex: 0,
    options: [{ textContent: "옵션자체관리코드" }],
    closest: () => form,
  };
  inputs.forEach((input) => { input.form = form; });
  const context = vm.createContext({
    Intl,
    Date,
    Math,
    Map,
    document: form,
    location: { pathname: "/A6" },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  vm.runInContext(policy, context);
  return {
    helper: context.CommerceStockSearchV023,
    inputs,
    field,
    api: {
      scope: "job-1:execution-1:A6",
      getField: () => field,
      findInput: () => inputs[2],
      selectField: () => true,
      setInput: (input, value) => { input.value = value; return true; },
      sleep: async () => {},
      rows: () => rows,
      waitFor: async (callback) => callback(),
    },
  };
}

test("HF62 resumes the exact submitted A6 search after Shopling clears its controls without a second click", async () => {
  const policy = await readFile(`${root}/search-policy-v024.js`, "utf8");
  const storage = new Map();
  let clicks = 0;
  const first = searchFixture(policy, storage);
  first.api.clickSearch = () => {
    clicks += 1;
    throw new Error("navigation destroyed the original page context");
  };
  await assert.rejects(
    first.helper.search("옵션자체관리코드", "BCC3-2", first.api),
    /navigation destroyed/,
  );
  assert.equal(clicks, 1);

  const resumed = searchFixture(policy, storage, { rows: [{ id: "BCC3-2" }] });
  resumed.api.selectField = () => { throw new Error("must not reselect"); };
  resumed.api.setInput = () => { throw new Error("must not rewrite"); };
  resumed.api.clickSearch = () => { clicks += 1; return true; };
  const result = await resumed.helper.search(
    "옵션자체관리코드",
    "BCC3-2",
    resumed.api,
  );
  assert.equal(result.ok, true);
  assert.equal(result.resumedFromSubmittedTicket, true);
  assert.equal(clicks, 1);
});

test("HF62 watchdog ignores reload-only updatedAt writes and times out real inactivity", async () => {
  const source = await readFile(`${root}/background-v084.js`, "utf8");
  const now = Date.now();
  const active = {
    status: "RUNNING",
    stage: "A6",
    stageStartedAt: now - 4 * 60_000,
    updatedAt: now,
    job: { barcode: "BCC3-2", productKind: "SINGLE" },
  };
  const finishes = [];
  const factory = new Function(
    "chrome",
    "importScripts",
    "loadActive",
    "finish",
    "stageLabel",
    "findExactRoleTarget",
    "watchdog",
    `${source}\nreturn { watchdog };`,
  );
  const api = factory(
    {
      runtime: { getManifest: () => ({ version: "0.6.25" }) },
      alarms: { clear: async () => true },
    },
    () => {},
    async () => active,
    async (...args) => { finishes.push(args); },
    () => "A6 B코드 조회",
    async () => ({ tabId: 1 }),
    async () => {},
  );
  await api.watchdog();
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0][1], "FAILED");
  assert.equal(finishes[0][3].code, "STOCK_SYNC_IDLE_TIMEOUT");
  assert.equal(finishes[0][3].storageUpdatedAtIgnored, true);
});

test("HF62 package and both queue surfaces preserve isolated failures while continuing remaining B-codes", async () => {
  const [route, direct, operational, page] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf62/route.ts", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
  ]);
  assert.match(route, /const VERSION = "0\.6\.25"/);
  assert.match(route, /search-policy-v024\.js/);
  assert.match(route, /background-v084\.js/);
  assert.match(route, /EXECUTION_SCOPED_SUBMITTED_TICKET_NO_RECLICK/);
  assert.match(page, /download-hf71/);
  assert.match(page, /v0\.6\.34 다운로드/);
  assert.doesNotMatch(direct, /batch\.stopAfterBatch = true/);
  assert.doesNotMatch(operational, /batch\.stopAfterBatch = true/);
  assert.match(direct, /나머지 B코드 전송을 계속합니다/);
  assert.match(operational, /다음 B코드 전송을 계속합니다/);
});

test("HF62 package replacement preserves the current guarded policy while replacing only its prefix", async () => {
  const [template, oldPolicy, newPolicy] = await Promise.all([
    readFile(`${root}/content-shopling-v018.js`, "utf8"),
    readFile(`${root}/search-policy-v023.js`, "utf8"),
    readFile(`${root}/search-policy-v024.js`, "utf8"),
  ]);
  const normalized = (source) => source.replace(/\r\n?/g, "\n");
  const generated = normalized(
    buildStockWorkerV030(normalized(template), normalized(oldPolicy)),
  )
    .replace('  const START = "20130912";', '  const START = "20230101";')
    .replace(
      "2013-09-12~오늘 최대 검색기간 설정값 검증에 실패했습니다.",
      "2023-01-01~오늘 검색기간 설정값 검증에 실패했습니다.",
    );
  const boundary = generated.indexOf("\n(() => {", generated.indexOf("globalThis.CommerceStockSearchV023 ="));
  assert.equal(boundary > 0, true);
  const patched = `${normalized(newPolicy)}${generated.slice(boundary + 1)}`;
  assert.match(patched, /const START = "20230101"/);
  assert.doesNotMatch(patched, /const START = "20130912"/);
  assert.doesNotThrow(() => new Function(patched));
  assert.match(patched, /commerce-stock-search-v042/);
  assert.doesNotMatch(patched, /const resumed = Boolean\(ticket/);
});
