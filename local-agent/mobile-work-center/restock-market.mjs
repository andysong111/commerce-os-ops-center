// Runs on an owned Shopling A4 tab. This submits only the existing product search.
export async function readRegisteredOffers(goodsKey) {
  const form = document.forms.namedItem("frm");
  const path = "/prod/prodLst.phtml";
  if (
    !/^\d{1,12}$/.test(goodsKey) ||
    location.origin !== "https://kt.shopling.co.kr" ||
    location.pathname !== path ||
    !form?.querySelector('[name="shop_YN"]')
  )
    return null;
  const exact = [
    ...(form.querySelector('select[name="srch_tp"]')?.options || []),
  ].find((o) => o.text.trim() === "샵플링상품코드");
  if (!exact) return null;
  const eDate = form.querySelector('[name="e_dt"]')?.value;
  if (!/^\d{8}$/.test(eDate || "")) return null;
  const fields = new URLSearchParams({
    mode: "item_srch",
    srch_tp: exact.value,
    srch_txt: goodsKey,
    srch_match: "equal",
    row_cnt: "25",
    srch_dt: "A",
    shop_YN: "Y",
    all_srch_no_term_btn: "Y",
    s_dt: "20130912",
    e_dt: eDate,
  });
  const res = await fetch(path, {
    method: "POST",
    body: fields,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return null;
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const ids = [...doc.querySelectorAll('input[type="checkbox"][name="chk[]"]')];
  if (
    doc.querySelector('[name="totalCnt"]')?.value !== "1" ||
    ids.length !== 1 ||
    ids[0].value !== goodsKey
  )
    return null;
  const trim = (c) => c.textContent.trim();
  const tables = [...doc.querySelectorAll("table")].filter((t) =>
    [...t.rows].some(
      (r) =>
        [...r.cells].map(trim).join("|") ===
        "상태|사이트|ID|몰상품코드|몰상품명|몰판매가",
    ),
  );
  if (tables.length !== 1) return null;
  const rows = [];
  for (const tr of tables[0].rows) {
    const c = [...tr.cells].map(trim);
    if (
      c[0] === "상태" ||
      !["도매꾹", "오너클랜", "스마트스토어", "카페24(1.9)"].includes(c[1])
    )
      continue;
    if (c.length !== 6) return null;
    const basePrice = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(c[5])
      ? Number(c[5].replaceAll(",", ""))
      : null;
    rows.push({
      status: c[0],
      site: c[1],
      account: c[2],
      code: c[3],
      basePrice,
    });
  }
  return rows;
}
