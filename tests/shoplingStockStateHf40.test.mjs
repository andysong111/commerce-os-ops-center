import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { patchShoplingStockHf38Background } from "../src/lib/shoplingStockHf38Patch.ts";
import { patchShoplingStockHf39Coordinator } from "../src/lib/shoplingStockHf39Patch.ts";
import { patchShoplingStockHf40Coordinator } from "../src/lib/shoplingStockHf40Patch.ts";

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

async function patchedCoordinator() {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v030.js",
    "utf8",
  );
  const hf12 = legacy.replace(
    'else if (/상품조회수정/i.test(text) && /검색항목/i.test(text)) role = "A4";',
    'else if ((path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) || (/상품조회수정/i.test(text) && /검색항목/i.test(text))) role = "A4";',
  );
  return patchShoplingStockHf40Coordinator(
    patchShoplingStockHf39Coordinator(
      patchShoplingStockHf38Background(hf12),
    ),
  );
}

async function scanFixture({ pathname, text }) {
  const patched = await patchedCoordinator();
  new Function(patched);
  const scanSource = extractFunction(patched, "async function scanFramesV030(tabId)");
  const chrome = {
    scripting: {
      async executeScript(request) {
        return [{ frameId: 0, result: request.func() }];
      },
    },
  };
  const oldDocument = globalThis.document;
  const oldLocation = globalThis.location;
  globalThis.document = {
    body: { innerText: text },
    documentElement: { innerText: text },
    title: "샵플링 [쇼핑몰통합관리솔루션]",
    querySelectorAll(selector) {
      if (selector === "select") {
        return [{ options: [{ textContent: "샵플링상품코드" }] }];
      }
      if (selector === "a[href]") {
        return [{ getAttribute: () => "/logout.phtml" }];
      }
      return [];
    },
  };
  globalThis.location = {
    pathname,
    href: `https://a.shopling.co.kr${pathname}`,
  };
  try {
    const scan = new Function("chrome", `${scanSource}; return scanFramesV030;`)(
      chrome,
    );
    return (await scan(41))[0].result;
  } finally {
    globalThis.document = oldDocument;
    globalThis.location = oldLocation;
  }
}

test("HF40 keeps the live A21 page A21 even when shared navigation contains A4 text", async () => {
  const result = await scanFixture({
    pathname: "/prodlinkage/goods_prod_join_list.phtml",
    text: [
      "[A] 상품 [4] 상품조회수정 [21] 쇼핑몰상품수정",
      "§ 상품 > [A21] 쇼핑몰상품수정",
      "검색항목 샵플링상품코드 상품 수정전송",
    ].join(" "),
  });
  assert.equal(result.role, "A21_LIST");
  assert.equal(result.hasGoodsKey, true);
  assert.equal(result.authenticated, true);
});

test("HF40 recognizes A4 only on the exact product-list path", async () => {
  const result = await scanFixture({
    pathname: "/prod/prodlst.phtml",
    text: "§ 상품 > [A4] 상품조회수정 검색항목 샵플링상품코드",
  });
  assert.equal(result.role, "A4");
});

test("HF40 publishes v0.6.8 and blocks the live-failed HF39 package", async () => {
  const [route, page, planner, queue, hiddenBrowserCheck, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf40/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("scripts/inventory-ui-hidden-check.mjs", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /getHf39Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.7"/);
  assert.match(route, /const VERSION = "0\.6\.8"/);
  assert.match(route, /HF40_EXACT_A4_A21_PATH_ROLE/);
  assert.match(page, /download-hf40/);
  assert.match(page, /v0\.6\.8 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 8\]/);
  assert.match(queue, /v0\.6\.8로 업데이트/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.8'/);
  assert.match(workflow, /shoplingStockStateHf40\.test\.mjs/);
});
