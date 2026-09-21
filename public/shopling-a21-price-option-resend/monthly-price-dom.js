/* global collectMonthlyPricePage: false */
// Deliberately self-contained: Chrome serializes this function into an isolated
// world. Never submit a form, click controls or guess positional price fields.
function collectMonthlyPricePage(goodsKey) {
  const url = new URL(location.href);
  if (url.origin !== "https://a.shopling.co.kr" || url.pathname !== "/prod/prodShopInfo.phtml" || url.searchParams.get("mode") !== "price_chg" || url.searchParams.get("prod_id") !== goodsKey) return null;
  const names = {
    SMALL_00001: ["옥션"], SMALL_00002: ["지마켓", "G마켓"], SMALL_00003: ["11번가"], SMALL_00004: ["스마트스토어"],
    SMALL_00005: ["GS SHOP", "GS샵"], SMALL_00012: ["쿠팡"], SMALL_00014: ["카페24", "Cafe24"], SMALL_00019: ["신세계몰"],
    SMALL_00069: ["도매꾹"], SMALL_00071: ["도매창고"], SMALL_00101: ["카카오톡스토어"], SMALL_00107: ["오너클랜", "오늘클렌"],
    SMALL_00112: ["에이블리"], SMALL_00116: ["셀파"], SMALL_00130: ["롯데ON", "롯데온"], SMALL_00165: ["셀링콕"],
    SMALL_00168: ["인터파크"], SMALL_00179: ["투비즈온"], SMALL_00180: ["도매아토즈"], SMALL_00188: ["셀러어스"],
    SMALL_00190: ["도매의신"], SMALL_00194: ["토스쇼핑"],
  };
  const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => text(value).replace(/\s+/g, "").toLowerCase();
  const number = (value) => {
    const raw = text(value).replace(/,/g, "").replace(/원$/, "").trim();
    return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  };
  const value = (el) => {
    if (!el) return null;
    const control = el.matches?.("input,select,textarea") ? el : el.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select");
    return number(control ? control.value : el.textContent);
  };
  const rows = [];
  for (const table of document.querySelectorAll("table")) {
    const trs = [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
    let mapping = null;
    for (const row of trs) {
      const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
      const labels = cells.map((cell) => compact(cell.textContent));
      const sell = labels.findIndex((s) => /^(판매가|판매가격)(\(원\))?$/.test(s));
      const buy = labels.findIndex((s) => /^(매입가|매입가격|원가)(\(원\))?$/.test(s));
      const list = labels.findIndex((s) => /^(소비자가|소비자가격)(\(원\))?$/.test(s));
      if (sell >= 0 && buy >= 0 && list >= 0) { mapping = { row, sell, buy, list }; break; }
    }
    for (const row of trs) {
      if (row === mapping?.row) continue;
      const cells = [...row.querySelectorAll(":scope > td")];
      if (!cells.length) continue;
      const explicit = [...new Set((String(row.innerHTML).match(/SMALL_\d{5}/gi) || []).map((s) => s.toUpperCase()))];
      let mallKey = explicit.length === 1 ? explicit[0] : "";
      if (explicit.length > 1) continue;
      if (!mallKey) {
        const label = compact(cells.slice(0, 3).map((c) => c.textContent).join(" "));
        const matches = Object.entries(names).filter(([, aliases]) => aliases.some((alias) => label.includes(compact(alias))));
        if (matches.length !== 1) continue;
        mallKey = matches[0][0];
      }
      let sellPrice = null, purchasePrice = null, consumerPrice = null, source = "input_name";
      const found = { sell: [], buy: [], list: [] };
      for (const control of row.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select")) {
        const key = `${control.name || ""} ${control.id || ""}`.toLowerCase();
        if (/list[_-]?price|consumer/.test(key)) found.list.push(value(control));
        else if (/org[_-]?price|purchase|buy[_-]?price/.test(key)) found.buy.push(value(control));
        else if (/sale[_-]?price|sell[_-]?price/.test(key)) found.sell.push(value(control));
      }
      if (Object.values(found).every((values) => values.length === 1)) {
        sellPrice = found.sell[0]; purchasePrice = found.buy[0]; consumerPrice = found.list[0];
      } else if (mapping && cells.length > Math.max(mapping.sell, mapping.buy, mapping.list)) {
        sellPrice = value(cells[mapping.sell]); purchasePrice = value(cells[mapping.buy]); consumerPrice = value(cells[mapping.list]); source = "header";
      }
      if ([sellPrice, purchasePrice, consumerPrice].some((n) => n === null)) continue;
      rows.push({ mallKey, sellPrice, purchasePrice, consumerPrice, source });
    }
  }
  return rows.length ? { goodsKey, pageUrl: url.href, observedAt: Date.now(), rows } : null;
}
