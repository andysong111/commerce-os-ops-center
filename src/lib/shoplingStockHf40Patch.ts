function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const HF39_ROLE_ORDER = `      else if (hasExact("옵션자체관리코드")) role = "A6";
      else if ((path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) || (/상품조회수정/i.test(text) && /검색항목/i.test(text))) role = "A4";
      else if (hasExact("샵플링상품코드") && /쇼핑몰상품수정/i.test(text) && /상품\\s*수정전송/i.test(text)) role = "A21_LIST";`;

const HF40_EXACT_PATH_ROLES = `      else if (hasExact("옵션자체관리코드")) role = "A6";
      else if (path === "/prodlinkage/goods_prod_join_list.phtml" && hasExact("샵플링상품코드") && /쇼핑몰상품수정/i.test(text) && /상품\\s*수정전송/i.test(text)) role = "A21_LIST";
      else if (path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) role = "A4";`;

export function patchShoplingStockHf40Coordinator(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    HF39_ROLE_ORDER,
    HF40_EXACT_PATH_ROLES,
    "shopling_stock_hf40_exact_path_roles",
  );
}
