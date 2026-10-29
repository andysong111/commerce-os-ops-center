import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchShoplingStockHf35Worker,
  SHOPLING_A6_REGISTRATION_START_HF35,
} from "../src/lib/shoplingStockHf35Patch.ts";

const workerFixture = `(() => {
  const START = "20130912";
  function clearA6DateScopeHF31() {
    const expectedDateRange = { start: "20220101", end: todayKst };
    if (false) return { message: "A6 상품등록기간을 2022-01-01부터 오늘까지 설정하지 못했습니다." };
    return { ok: true, dateScope: "2022_TO_TODAY" };
  }
  const oldMessage = "2013-09-12~오늘 최대 검색기간 설정값 검증에 실패했습니다.";
  function a6IdentityPairHF33(row) { return row.identity || null; }
  function a6RowEvidenceTextHF19(row) { return row.text; }
  function a6RowsFromDocumentHF19(doc, barcode) {
    const barcodeRegex = exactTokenRegex(barcode);
    return [...doc.querySelectorAll("tr")]
      .map((row) => ({ row, text: a6RowEvidenceTextHF19(row) }))
      .filter(({ text }) => barcodeRegex.test(text.toUpperCase()));
  }
  const notFound = "를 2022-01-01~오늘 범위에서 검색했지만 정확히 연결된 상품 행을 찾지 못했습니다.";
})();`;

test("HF35 reproduces BCB6-2's 8 products plus one search row and counts only the 8 product rows", () => {
  const patched = patchShoplingStockHf35Worker(workerFixture);
  const functionStart = patched.indexOf("  function a6RowsFromDocumentHF19");
  const functionEnd = patched.indexOf("\n  }", functionStart) + 4;
  const functionSource = patched.slice(functionStart, functionEnd);
  const exactTokenRegex = (token) => new RegExp(`(^|[^A-Z0-9])${token}(?=$|[^A-Z0-9])`, "i");
  const a6IdentityPairHF33 = (row) => row.identity || null;
  const a6RowEvidenceTextHF19 = (row) => row.text;
  const rowsFromDocument = new Function(
    "exactTokenRegex",
    "a6IdentityPairHF33",
    "a6RowEvidenceTextHF19",
    `${functionSource}; return a6RowsFromDocumentHF19;`,
  )(exactTokenRegex, a6IdentityPairHF33, a6RowEvidenceTextHF19);

  const searchConditionRow = {
    text: "옵션자체관리코드 BCB6-2 검색",
    identity: null,
    querySelector: () => null,
  };
  const productRows = Array.from({ length: 8 }, (_, index) => ({
    text: `${118000 + index}-${26252000 + index} BCB6-2 판매중`,
    identity: { goodsKey: String(118000 + index), optionId: String(26252000 + index) },
    querySelector: () => ({ value: `${118000 + index}_${26252000 + index}` }),
  }));
  const otherProduct = {
    text: "119999-26259999 BCB6-20 판매중",
    identity: { goodsKey: "119999", optionId: "26259999" },
    querySelector: () => ({ value: "119999_26259999" }),
  };
  const doc = { querySelectorAll: () => [searchConditionRow, ...productRows, otherProduct] };

  const matched = rowsFromDocument(doc, "BCB6-2");
  assert.equal(matched.length, 8);
  assert.deepEqual(matched.map((entry) => entry.identity.goodsKey), productRows.map((row) => row.identity.goodsKey));
});

test("HF35 keeps the A6 pre-search and common search date policy on one 2023-to-today range", () => {
  const patched = patchShoplingStockHf35Worker(workerFixture);
  assert.equal(SHOPLING_A6_REGISTRATION_START_HF35, "20230101");
  assert.match(patched, /const START = "20230101"/);
  assert.match(patched, /expectedDateRange = \{ start: "20230101", end: todayKst \}/);
  assert.match(patched, /dateScope: "2023_TO_TODAY"/);
  assert.doesNotMatch(patched, /20130912|20220101|2013-09-12|2022-01-01/);
});

test("HF35 packages v0.6.3 from HF34 and the stock-control UI requires that version", async () => {
  const [route, planner, page, queuePanel, operatorPanel] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf35/route.ts", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
  ]);
  assert.match(route, /getHf34Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.2"/);
  assert.match(route, /const VERSION = "0\.6\.3"/);
  assert.match(route, /patchShoplingStockHf35Worker/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 3\]/);
  assert.match(page, /download-hf35/);
  assert.match(page, /v0\.6\.3 다운로드/);
  assert.match(queuePanel, /v0\.6\.3로 업데이트해 주세요/);
  assert.match(operatorPanel, /v0\.6\.3로 업데이트/);
});
