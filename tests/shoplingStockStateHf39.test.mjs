import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { patchShoplingStockHf38Background } from "../src/lib/shoplingStockHf38Patch.ts";
import {
  patchShoplingStockHf39Coordinator,
  patchShoplingStockHf39SingleBatch,
} from "../src/lib/shoplingStockHf39Patch.ts";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

test("HF39 classifies the exact A4 launcher before the stricter A21 list role", async () => {
  const legacy = await readFile("public/shopling-stock-state-sync/background-v030.js", "utf8");
  const hf12 = legacy.replace(
    'else if (/상품조회수정/i.test(text) && /검색항목/i.test(text)) role = "A4";',
    'else if ((path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) || (/상품조회수정/i.test(text) && /검색항목/i.test(text))) role = "A4";',
  );
  assert.notEqual(hf12, legacy);
  const hf38 = patchShoplingStockHf38Background(hf12);
  const patched = patchShoplingStockHf39Coordinator(hf38);
  new Function(patched);

  const a4 = 'else if ((path === "/prod/prodlst.phtml"';
  const a21 = 'else if (hasExact("샵플링상품코드") && /쇼핑몰상품수정/i.test(text) && /상품\\s*수정전송/i.test(text)) role = "A21_LIST";';
  assert.ok(patched.indexOf(a4) < patched.indexOf(a21));
  assert.ok(patched.includes(a21));
  assert.doesNotMatch(
    patched,
    /hasExact\("샵플링상품코드"\) && \(\/쇼핑몰상품수정\/i\.test\(text\) \|\|/,
  );
  assert.match(patched, /HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER/);
});

test("HF39 waits for the canonical A21 worker and injects it at most once", async () => {
  const legacy = await readFile("public/shopling-stock-state-sync/background-v057.js", "utf8");
  const patched = patchShoplingStockHf39SingleBatch(legacy);
  new Function(patched);
  const source = extractFunction(
    patched,
    "async function ensureCanonicalListWorkerV057(target)",
  );
  let probes = 0;
  let injections = 0;
  const chrome = {
    tabs: {
      sendMessage: async () => {
        probes += 1;
        return probes >= 4 ? { ok: true, role: "A21_LIST" } : null;
      },
    },
    scripting: {
      executeScript: async () => {
        injections += 1;
      },
    },
  };
  const factory = new Function(
    "chrome",
    "sleep",
    "CANONICAL_IDENTIFY",
    "CANONICAL_LIST_SCRIPT",
    `${source}; return ensureCanonicalListWorkerV057;`,
  );
  const ensureWorker = factory(chrome, async () => {}, "IDENTIFY", "worker.js");
  const ready = await ensureWorker({ tabId: 41, frameId: 0 });
  assert.equal(ready, true);
  assert.equal(probes, 4);
  assert.equal(injections, 1);
});

test("HF39 remains v0.6.7 while the UI requires HF42", async () => {
  const [route, page, planner, queue, hiddenBrowserCheck, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf39/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("scripts/inventory-ui-hidden-check.mjs", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /getHf38Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.6"/);
  assert.match(route, /const VERSION = "0\.6\.7"/);
  assert.match(route, /HF39_A4_A21_EXACT_ROLE_AND_WORKER_READY/);
  assert.match(route, /BBB4-3_A6_RESOLVED_12_GOODS_KEYS/);
  assert.match(page, /download-hf47/);
  assert.match(page, /v0\.6\.12 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 12\]/);
  assert.match(queue, /A4\/A21 역할 오인/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.12'/);
  assert.match(workflow, /shoplingStockStateHf39\.test\.mjs/);
});
