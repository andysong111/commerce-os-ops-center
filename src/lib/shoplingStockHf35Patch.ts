export const SHOPLING_A6_REGISTRATION_START_HF35 = "20230101";

function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const ROWS_BEFORE = `  function a6RowsFromDocumentHF19(doc, barcode) {
    const barcodeRegex = exactTokenRegex(barcode);
    return [...doc.querySelectorAll("tr")]
      .map((row) => ({ row, text: a6RowEvidenceTextHF19(row) }))
      .filter(({ text }) => barcodeRegex.test(text.toUpperCase()));
  }`;

const ROWS_AFTER = `  function a6RowsFromDocumentHF19(doc, barcode) {
    const barcodeRegex = exactTokenRegex(barcode);
    return [...doc.querySelectorAll("tr")]
      .map((row) => {
        const text = a6RowEvidenceTextHF19(row);
        const resultCheckbox = row?.querySelector?.('input[name="chk[]"]') || row?.querySelector?.('input[type="checkbox"]');
        return { row, text, identity: a6IdentityPairHF33(row, text), resultCheckbox };
      })
      .filter(({ text, identity, resultCheckbox }) => Boolean(resultCheckbox) && Boolean(identity) && barcodeRegex.test(text.toUpperCase()));
  }`;

export function patchShoplingStockHf35Worker(source: string) {
  let worker = source;
  worker = replaceOnce(
    worker,
    '  const START = "20130912";',
    `  const START = "${SHOPLING_A6_REGISTRATION_START_HF35}";`,
    "shopling_stock_hf35_common_search_start",
  );
  worker = replaceOnce(
    worker,
    'const expectedDateRange = { start: "20220101", end: todayKst };',
    `const expectedDateRange = { start: "${SHOPLING_A6_REGISTRATION_START_HF35}", end: todayKst };`,
    "shopling_stock_hf35_a6_date_start",
  );
  worker = replaceOnce(
    worker,
    "A6 상품등록기간을 2022-01-01부터 오늘까지 설정하지 못했습니다.",
    "A6 상품등록기간을 2023-01-01부터 오늘까지 설정하지 못했습니다.",
    "shopling_stock_hf35_a6_date_message",
  );
  worker = replaceOnce(
    worker,
    'dateScope: "2022_TO_TODAY"',
    'dateScope: "2023_TO_TODAY"',
    "shopling_stock_hf35_a6_date_scope",
  );
  worker = replaceOnce(
    worker,
    "를 2022-01-01~오늘 범위에서 검색했지만 정확히 연결된 상품 행을 찾지 못했습니다.",
    "를 2023-01-01~오늘 범위에서 검색했지만 정확히 연결된 상품 행을 찾지 못했습니다.",
    "shopling_stock_hf35_a6_not_found_message",
  );
  worker = replaceOnce(
    worker,
    "2013-09-12~오늘 최대 검색기간 설정값 검증에 실패했습니다.",
    "2023-01-01~오늘 검색기간 설정값 검증에 실패했습니다.",
    "shopling_stock_hf35_common_search_message",
  );
  worker = replaceOnce(
    worker,
    ROWS_BEFORE,
    ROWS_AFTER,
    "shopling_stock_hf35_a6_product_rows_only",
  );
  return worker;
}
