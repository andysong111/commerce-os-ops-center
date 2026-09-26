/* global collectMonthlyPricePage: false, collectMonthlyRegisteredMarketPage: false, inspectMonthlyRegisteredMarketFrame: false, advanceMonthlyRegisteredMarketPage: false */
// These functions are deliberately self-contained. Chrome serializes each
// function into an isolated world, so do not depend on helpers outside the
// function body.

/**
 * Read Shopling's price-setting page. This is the source/preimage price only:
 * it is NOT evidence that a marketplace received the transmitted price.
 */
function collectMonthlyPricePage(goodsKey) {
  const url = new URL(location.href);
  if (
    url.origin !== "https://a.shopling.co.kr" ||
    url.pathname !== "/prod/prodShopInfo.phtml" ||
    url.searchParams.get("mode") !== "price_chg" ||
    url.searchParams.get("prod_id") !== goodsKey
  ) return null;

  const names = {
    SMALL_00001: ["옥션"], SMALL_00002: ["지마켓", "G마켓"], SMALL_00003: ["11번가"], SMALL_00004: ["스마트스토어", "네이버스마트스토어"],
    SMALL_00005: ["GS SHOP", "GS샵"], SMALL_00012: ["쿠팡"], SMALL_00014: ["카페24", "Cafe24"], SMALL_00019: ["신세계몰"],
    SMALL_00069: ["도매꾹"], SMALL_00071: ["도매창고"], SMALL_00101: ["카카오톡스토어", "카카오스토어"], SMALL_00107: ["오너클랜", "오늘클렌"],
    SMALL_00112: ["에이블리"], SMALL_00116: ["셀파"], SMALL_00130: ["롯데ON", "롯데온"], SMALL_00165: ["셀링콕"],
    SMALL_00168: ["인터파크"], SMALL_00179: ["투비즈온"], SMALL_00180: ["도매아토즈"], SMALL_00188: ["셀러어스", "셀리어스"],
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
    const control = el.matches?.("input,select,textarea")
      ? el
      : el.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select");
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
      if (sell >= 0 && buy >= 0 && list >= 0) {
        mapping = { row, sell, buy, list };
        break;
      }
    }
    for (const row of trs) {
      if (row === mapping?.row) continue;
      const cells = [...row.querySelectorAll(":scope > td")];
      if (!cells.length) continue;
      const explicit = [...new Set((String(row.innerHTML).match(/SMALL_\d{5}/gi) || []).map((s) => s.toUpperCase()))];
      let mallKey = explicit.length === 1 ? explicit[0] : "";
      if (explicit.length > 1) continue;
      if (!mallKey) {
        const label = compact(cells.slice(0, 4).map((c) => c.textContent).join(" "));
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
        sellPrice = found.sell[0];
        purchasePrice = found.buy[0];
        consumerPrice = found.list[0];
      } else if (mapping && cells.length > Math.max(mapping.sell, mapping.buy, mapping.list)) {
        sellPrice = value(cells[mapping.sell]);
        purchasePrice = value(cells[mapping.buy]);
        consumerPrice = value(cells[mapping.list]);
        source = "header";
      }
      if ([sellPrice, purchasePrice, consumerPrice].some((n) => n === null)) continue;
      rows.push({ mallKey, sellPrice, purchasePrice, consumerPrice, source });
    }
  }

  return rows.length
    ? { goodsKey, pageUrl: url.href, observedAt: Date.now(), rows }
    : null;
}

/**
 * Read ONLY the table opened from 상품조회/수정 -> 등록된 쇼핑몰 보기.
 * The expected GOODSKEY is tied to this browser tab via sessionStorage by the
 * read-only navigator below. We never accept the price-setting page itself as
 * marketplace readback evidence.
 */
function collectMonthlyRegisteredMarketPage(goodsKey) {
  const url = new URL(location.href);
  if (url.origin !== "https://a.shopling.co.kr" || !/^\d{5,9}$/.test(String(goodsKey || ""))) return null;

  const markerKey = "commerceOsMonthlyRegisteredMallGoodsKey";
  let marker = "";
  try { marker = String(sessionStorage.getItem(markerKey) || ""); } catch { /* ignore */ }
  const queryIdentity = [
    url.searchParams.get("prod_id"),
    url.searchParams.get("goods_key"),
    url.searchParams.get("goodsKey"),
    url.searchParams.get("commerce_os_monthly_market_goods"),
  ].filter(Boolean).map(String);
  if (marker !== goodsKey && !queryIdentity.includes(goodsKey)) return null;

  // This exact source page is only the price-setting target and is explicitly
  // forbidden as final marketplace evidence.
  if (
    url.pathname === "/prod/prodShopInfo.phtml" &&
    url.searchParams.get("mode") === "price_chg" &&
    url.searchParams.get("prod_id") === goodsKey
  ) return null;

  const names = {
    SMALL_00001: ["옥션"], SMALL_00002: ["지마켓", "G마켓"], SMALL_00003: ["11번가"], SMALL_00004: ["스마트스토어", "네이버스마트스토어"],
    SMALL_00005: ["GS SHOP", "GS샵"], SMALL_00012: ["쿠팡"], SMALL_00014: ["카페24", "Cafe24"], SMALL_00019: ["신세계몰"],
    SMALL_00069: ["도매꾹"], SMALL_00071: ["도매창고"], SMALL_00101: ["카카오톡스토어", "카카오스토어"], SMALL_00107: ["오너클랜", "오늘클렌"],
    SMALL_00112: ["에이블리"], SMALL_00116: ["셀파"], SMALL_00130: ["롯데ON", "롯데온"], SMALL_00165: ["셀링콕"],
    SMALL_00168: ["인터파크"], SMALL_00179: ["투비즈온"], SMALL_00180: ["도매아토즈"], SMALL_00188: ["셀러어스", "셀리어스"],
    SMALL_00190: ["도매의신"], SMALL_00194: ["토스쇼핑"],
  };
  const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => text(value).replace(/\s+/g, "").toLowerCase();
  const cellText = (cell) => {
    if (!cell) return "";
    const extra = [...cell.querySelectorAll("img[alt],img[title],input[value],select")]
      .map((node) => node.getAttribute?.("alt") || node.getAttribute?.("title") || node.value || "")
      .join(" ");
    return text(`${cell.textContent || ""} ${extra}`);
  };
  const money = (value) => {
    const matches = text(value).replace(/원/g, "").match(/[0-9][0-9,]*/g) || [];
    for (const raw of matches.reverse()) {
      const normalized = raw.replace(/,/g, "");
      if (/^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized))) return Number(normalized);
    }
    return null;
  };

  const marketRows = [];
  for (const table of document.querySelectorAll("table")) {
    const trs = [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
    let mapping = null;
    for (const row of trs) {
      const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
      const labels = cells.map((cell) => compact(cellText(cell)));
      const status = labels.findIndex((s) => /^(상태|판매상태|상품상태)$/.test(s));
      const site = labels.findIndex((s) => /^(사이트id|사이트아이디|사이트|쇼핑몰|쇼핑몰명|몰|몰명|판매처)$/.test(s));
      const code = labels.findIndex((s) => /^(몰상품코드|쇼핑몰상품코드|마켓상품코드|상품코드)$/.test(s));
      const name = labels.findIndex((s) => /^(몰상품명|쇼핑몰상품명|마켓상품명|상품명)$/.test(s));
      const price = labels.findIndex((s) => /^(몰판매가|쇼핑몰판매가|마켓판매가|현재판매가|판매가)(\(원\))?$/.test(s));
      if (status >= 0 && code >= 0 && price >= 0 && (site >= 0 || labels.some((s) => /쇼핑몰|몰명|사이트/.test(s)))) {
        mapping = { row, status, site, code, name, price };
        break;
      }
    }
    if (!mapping) continue;

    for (const row of trs) {
      if (row === mapping.row) continue;
      const cells = [...row.querySelectorAll(":scope > td")];
      const needed = [mapping.status, mapping.code, mapping.price, mapping.site, mapping.name].filter((n) => n >= 0);
      if (!cells.length || cells.length <= Math.max(...needed)) continue;

      const explicit = [...new Set((String(row.innerHTML).match(/SMALL_\d{5}/gi) || []).map((s) => s.toUpperCase()))];
      let mallKey = explicit.length === 1 ? explicit[0] : "";
      if (explicit.length > 1) continue;
      if (!mallKey) {
        const identityText = compact(
          mapping.site >= 0
            ? `${cellText(cells[mapping.site])} ${cellText(row)}`
            : cellText(row),
        );
        const matches = Object.entries(names).filter(([, aliases]) =>
          aliases.some((alias) => identityText.includes(compact(alias))),
        );
        if (matches.length !== 1) continue;
        mallKey = matches[0][0];
      }

      const sellPrice = money(cellText(cells[mapping.price]));
      if (sellPrice === null) continue;
      const status = cellText(cells[mapping.status]);
      const mallProductCode = cellText(cells[mapping.code]);
      const mallProductName = mapping.name >= 0 ? cellText(cells[mapping.name]) : "";
      if (!status || !mallProductCode) continue;
      marketRows.push({
        mallKey,
        status,
        mallProductCode,
        mallProductName,
        sellPrice,
        source: "registered_shop_table",
      });
    }
  }

  if (!marketRows.length) return null;
  return {
    goodsKey,
    marketPageUrl: url.href,
    marketObservedAt: Date.now(),
    marketEvidence: "REGISTERED_SHOP_TABLE",
    marketRows,
  };
}

/**
 * Find the one Shopling frame that actually owns the product-list/detail UI.
 * Shopling often renders the working page inside a child frame, so the
 * background worker must not assume the top document is the actionable page.
 */
function inspectMonthlyRegisteredMarketFrame(goodsKey) {
  if (location.origin !== "https://a.shopling.co.kr" || !/^\d{5,9}$/.test(String(goodsKey || ""))) {
    return { state: "INVALID_FRAME", score: -1, pageUrl: String(location.href || "") };
  }

  const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => text(value).replace(/\s+/g, "").toLowerCase();
  const controlText = (el) => text([
    el?.textContent, el?.innerText, el?.getAttribute?.("value"), el?.getAttribute?.("title"),
    el?.getAttribute?.("alt"), el?.querySelector?.("img")?.getAttribute?.("alt"),
    el?.querySelector?.("img")?.getAttribute?.("title"),
  ].filter(Boolean).join(" "));

  const registeredTable = [...document.querySelectorAll("table")].some((table) =>
    [...table.querySelectorAll("tr")].slice(0, 10).some((row) => {
      const labels = [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => compact(cell.textContent));
      return labels.some((label) => /^(상태|판매상태|상품상태)$/.test(label))
        && labels.some((label) => /^(몰상품코드|쇼핑몰상품코드|마켓상품코드|상품코드)$/.test(label))
        && labels.some((label) => /^(몰판매가|쇼핑몰판매가|마켓판매가|현재판매가|판매가)(\(원\))?$/.test(label));
    }),
  );
  if (registeredTable) return { state: "REGISTERED_TABLE", score: 100, pageUrl: location.href };

  const controls = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"],[onclick],img[alt],img[title]')];
  if (controls.some((el) => /등록된\s*쇼핑몰(?:\s*보기)?/i.test(controlText(el)))) {
    return { state: "REGISTERED_CONTROL", score: 95, pageUrl: location.href };
  }

  const body = text(document.body?.innerText || document.body?.textContent || "");
  const hasGoodsKey = body.includes(String(goodsKey)) || [...document.querySelectorAll("a[href],[onclick],form[action],input[name],input[value],button[value]")]
    .slice(0, 3000)
    .some((node) => [node.getAttribute("href"), node.getAttribute("onclick"), node.getAttribute("action"), node.getAttribute("name"), node.getAttribute("value")].filter(Boolean).join("=").includes(String(goodsKey)));
  const productList = /\/prod\/prodLst\.phtml$/i.test(location.pathname)
    || (/총\s*조회수/.test(body) && /상품조회|상품수정|검색관리/.test(body));
  if (productList && hasGoodsKey) return { state: "PRODUCT_LIST_WITH_GOODS", score: 90, pageUrl: location.href };
  if (productList) return { state: "PRODUCT_LIST", score: 80, pageUrl: location.href };

  if (/\/prod\/prodShopInfo\.phtml$/i.test(location.pathname) && new URLSearchParams(location.search).get("mode") !== "price_chg") {
    return { state: "PRODUCT_DETAIL", score: 70, pageUrl: location.href };
  }

  if (/로그인|login|아이디\s*[:：]?|비밀번호\s*[:：]?/i.test(body.slice(0, 2200)) && !/총\s*조회수|상품조회|상품수정/.test(body)) {
    return { state: "LOGIN_REQUIRED", score: 60, pageUrl: location.href };
  }
  return { state: "SHOPLING_OTHER", score: 10, pageUrl: location.href };
}
/**
 * Read-only navigator for GOODSKEY -> 상품조회/수정 -> 등록된 쇼핑몰 보기.
 * It may submit a search form or click a view/navigation control, but never
 * clicks save, price-change, transmission, deletion or status-mutation controls.
 */
function advanceMonthlyRegisteredMarketPage(goodsKey) {
  if (location.origin !== "https://a.shopling.co.kr" || !/^\d{5,9}$/.test(String(goodsKey || ""))) {
    return { state: "INVALID_PAGE" };
  }
  const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => text(value).replace(/\s+/g, "").toLowerCase();
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const controlText = (el) => text([
    el?.textContent,
    el?.innerText,
    el?.getAttribute?.("value"),
    el?.getAttribute?.("title"),
    el?.getAttribute?.("alt"),
    el?.querySelector?.("img")?.getAttribute?.("alt"),
    el?.querySelector?.("img")?.getAttribute?.("title"),
  ].filter(Boolean).join(" "));
  const tableLooksRegistered = () => [...document.querySelectorAll("table")].some((table) => {
    const rows = [...table.querySelectorAll("tr")].slice(0, 8);
    return rows.some((row) => {
      const labels = [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => compact(cell.textContent));
      return labels.some((s) => /^(상태|판매상태|상품상태)$/.test(s))
        && labels.some((s) => /^(몰상품코드|쇼핑몰상품코드|마켓상품코드|상품코드)$/.test(s))
        && labels.some((s) => /^(몰판매가|쇼핑몰판매가|마켓판매가|현재판매가|판매가)(\(원\))?$/.test(s));
    });
  });
  const setMarker = () => {
    try { sessionStorage.setItem("commerceOsMonthlyRegisteredMallGoodsKey", goodsKey); } catch { /* ignore */ }
  };
  setMarker();
  if (tableLooksRegistered()) return { state: "READY", pageUrl: location.href };

  const body = text(document.body?.innerText || document.body?.textContent || "");
  if (/로그인|login|아이디\s*[:：]?|비밀번호\s*[:：]?/i.test(body.slice(0, 2200)) && !/총\s*조회수|상품조회|상품수정/.test(body)) {
    return { state: "LOGIN_REQUIRED" };
  }

  const rowHasGoodsKey = (row) => {
    const escaped = goodsKey.replace(/[.*+?^${\}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`);
    if (pattern.test(text(row.textContent || ""))) return true;
    const raw = [...row.querySelectorAll("a[href],[onclick],input[name],input[value],button[value]")]
      .map((node) => [
        node.getAttribute("href"),
        node.getAttribute("onclick"),
        node.getAttribute("name"),
        node.getAttribute("value"),
      ].filter(Boolean).join("="))
      .join(" ");
    return pattern.test(raw);
  };
  const safeNavigateOrClick = (el) => {
    if (!(el instanceof Element)) return false;
    const href = el.getAttribute("href") || el.closest("a[href]")?.getAttribute("href") || "";
    if (href && !/^javascript:/i.test(href)) {
      try {
        const target = new URL(href, location.href);
        if (target.origin === location.origin) {
          location.href = target.href;
          return true;
        }
      } catch { /* click fallback */ }
    }
    const onclick = String(el.getAttribute("onclick") || el.closest("[onclick]")?.getAttribute("onclick") || "");
    const match = onclick.match(/["']([^"']+(?:prod|mall|shop)[^"']*\.phtml[^"']*)["']/i);
    if (match) {
      try {
        const target = new URL(match[1], location.href);
        if (target.origin === location.origin) {
          location.href = target.href;
          return true;
        }
      } catch { /* click fallback */ }
    }
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    }
    return false;
  };

  if (/\/prod\/prodLst\.phtml$/i.test(location.pathname)) {
    const rows = [...document.querySelectorAll("tr")].filter((row) => row.querySelectorAll(":scope > td").length >= 3);
    const exactRows = rows.filter(rowHasGoodsKey);
    if (!exactRows.length) {
      const searchLabels = ["샵플링상품코드", "상품등록번호", "상품검색용코드", "상품번호", "상품키", "Goods Key", "goods key"];
      let select = null;
      let option = null;
      let selectedLabel = "";
      let best = -1;
      for (const candidate of [...document.querySelectorAll("select")].filter(visible)) {
        for (const opt of candidate.options) {
          const label = text(opt.textContent);
          const normalized = compact(label);
          let score = -1;
          const exactIndex = searchLabels.findIndex((wanted) => compact(wanted) === normalized);
          if (exactIndex >= 0) score = 120 - exactIndex * 5;
          else if (/샵플링.*상품코드/.test(normalized)) score = 90;
          else if (/^(?:상품코드|goodskey)$/.test(normalized)) score = 40;
          if (score > best) { best = score; select = candidate; option = opt; selectedLabel = label; }
        }
      }
      if (!(select instanceof HTMLSelectElement) || !(option instanceof HTMLOptionElement) || best < 40) {
        return { state: "SEARCH_FIELD_MISSING", pageUrl: location.href };
      }

      const setControlValue = (control, value) => {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value");
        if (descriptor?.set) descriptor.set.call(control, value);
        else control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
        return text(control.value) === text(value);
      };

      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (select.value !== option.value) return { state: "SEARCH_FIELD_SET_FAILED", fieldLabel: selectedLabel, pageUrl: location.href };

      const form = select.form || select.closest("form") || document;
      const editable = (root) => [...root.querySelectorAll("input,textarea")].filter((input) => {
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
        if (!visible(input) || input.disabled || input.readOnly) return false;
        if (input instanceof HTMLTextAreaElement) return true;
        const type = text(input.getAttribute("type") || input.type || "text").toLowerCase();
        return !["hidden","button","submit","reset","image","checkbox","radio","file","date","month","week","time","datetime-local","color","range","number"].includes(type);
      });
      const candidates = [
        ...editable(select.closest("tr") || document),
        ...editable(form),
        ...editable(document),
      ].filter((input, index, all) => all.indexOf(input) === index);
      const fieldRect = select.getBoundingClientRect();
      let input = null;
      let inputScore = -999;
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        const context = text(candidate.closest("tr")?.textContent || candidate.parentElement?.textContent || "");
        let score = 0;
        if (candidate.closest("tr") === select.closest("tr")) score += 40;
        if (candidate.form && select.form && candidate.form === select.form) score += 8;
        if (/검색항목|다중검색|자사상품코드|옵션자체관리코드|모델번호|상품등록번호|샵플링상품코드|상품검색용코드|상품번호|상품키|goods key/i.test(context)) score += 18;
        if (/search|find|query|keyword|sch/i.test(`${candidate.name || ""} ${candidate.id || ""}`)) score += 8;
        if (/가격검색|일자|날짜/i.test(context)) score -= 25;
        if (/^20\d{6}$/.test(text(candidate.value).replace(/\D/g, ""))) score -= 30;
        const vertical = Math.abs(fieldRect.top - rect.top);
        if (vertical <= 18) score += 25; else score -= Math.min(25, vertical / 12);
        if (rect.left >= fieldRect.left) score += 6;
        score -= Math.min(12, Math.abs(rect.left - fieldRect.right) / 45);
        if (score > inputScore) { input = candidate; inputScore = score; }
      }
      if (!input || inputScore < 0) return { state: "SEARCH_INPUT_MISSING", fieldLabel: selectedLabel, pageUrl: location.href };
      if (!setControlValue(input, goodsKey)) return { state: "SEARCH_INPUT_SET_FAILED", fieldLabel: selectedLabel, pageUrl: location.href };

      const digits = (value) => String(value ?? "").replace(/\D/g, "");
      const todayKst = () => {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
        return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value || "").join("");
      };
      const dateValue = (control, value) => {
        const old = String(control.value || "");
        const separator = control.type === "date" || old.includes("-") ? "-" : old.includes("/") ? "/" : old.includes(".") ? "." : "";
        return [value.slice(0,4), value.slice(4,6), value.slice(6)].join(separator);
      };
      const dateInputs = [...form.querySelectorAll("input")].filter((control) => {
        const type = String(control.type || "text").toLowerCase();
        if (!["text","date","search"].includes(type) || !visible(control) || control.disabled || control.readOnly) return false;
        const context = text(control.closest("tr")?.textContent || control.parentElement?.textContent || "");
        return /일자|날짜|기간|등록일|date/i.test(`${context} ${control.name || ""} ${control.id || ""}`) && /^20\d{6}$|^201\d{5}$/.test(digits(control.value));
      });
      let datePair = null;
      const pairs = [];
      for (let left = 0; left < dateInputs.length; left += 1) for (let right = left + 1; right < dateInputs.length; right += 1) {
        const a = dateInputs[left], b = dateInputs[right], ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        if (Math.abs(ar.top - br.top) <= 18 && (a.closest("tr") === b.closest("tr") || Math.abs(ar.left - br.left) < 240)) pairs.push(ar.left <= br.left ? [a,b] : [b,a]);
      }
      if (pairs.length === 1) datePair = pairs[0];
      const searchPeriod = { start: "", end: "" };
      if (datePair) {
        const startDate = "20130912";
        const endDate = todayKst();
        if (digits(datePair[0].value) !== startDate && !setControlValue(datePair[0], dateValue(datePair[0], startDate))) return { state: "SEARCH_DATE_SET_FAILED", pageUrl: location.href };
        if (digits(datePair[1].value) !== endDate && !setControlValue(datePair[1], dateValue(datePair[1], endDate))) return { state: "SEARCH_DATE_SET_FAILED", pageUrl: location.href };
        searchPeriod.start = digits(datePair[0].value);
        searchPeriod.end = digits(datePair[1].value);
        if (searchPeriod.start !== startDate || searchPeriod.end !== endDate) return { state: "SEARCH_DATE_VERIFY_FAILED", period: searchPeriod, pageUrl: location.href };
      }

      const ticketKey = `commerceOsMonthlyRegisteredSearchV0511:${goodsKey}`;
      let ticket = null;
      try { ticket = JSON.parse(sessionStorage.getItem(ticketKey) || "null"); } catch { ticket = null; }
      const ticketAge = ticket ? Date.now() - Number(ticket.at || 0) : Number.POSITIVE_INFINITY;
      if (ticket && ticket.goodsKey === goodsKey && ticketAge < 30_000) {
        return { state: "SEARCH_WAITING", ageMs: ticketAge, fieldLabel: selectedLabel, period: searchPeriod, pageUrl: location.href };
      }
      if (ticket && ticket.goodsKey === goodsKey && ticketAge >= 30_000 && ticketAge < 90_000) {
        return { state: "SEARCH_RESULT_NOT_FOUND", ageMs: ticketAge, fieldLabel: selectedLabel, period: searchPeriod, pageUrl: location.href };
      }

      const root = input.form || input.closest("table") || document;
      const buttons = [...root.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick]')]
        .filter((element) => visible(element) && /^(검색|조회)$/.test(controlText(element)));
      const inputRect = input.getBoundingClientRect();
      buttons.sort((left, right) => Math.abs(left.getBoundingClientRect().top - inputRect.top) - Math.abs(right.getBoundingClientRect().top - inputRect.top));
      try { sessionStorage.setItem(ticketKey, JSON.stringify({ at: Date.now(), goodsKey, fieldLabel: selectedLabel, period: searchPeriod })); } catch { return { state: "SEARCH_CONTINUATION_STORAGE_FAILED", pageUrl: location.href }; }
      const button = buttons[0] || null;
      if (button) {
        try {
          button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          button.click();
          return { state: "SEARCH_SUBMITTED", fieldLabel: selectedLabel, period: searchPeriod, pageUrl: location.href };
        } catch { return { state: "SEARCH_CLICK_FAILED", pageUrl: location.href }; }
      }
      if (form instanceof HTMLFormElement) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return { state: "SEARCH_SUBMITTED", fieldLabel: selectedLabel, period: searchPeriod, pageUrl: location.href };
      }
      return { state: "SEARCH_BUTTON_MISSING", fieldLabel: selectedLabel, pageUrl: location.href };
    }

    // Some Shopling layouts expose the registered-mall viewer directly in the
    // list row. Prefer it before opening the product detail.
    for (const row of exactRows) {
      const controls = [...row.querySelectorAll('a,button,input[type="button"],input[type="submit"],[onclick],img[alt],img[title]')];
      const registered = controls.find((el) => /등록된\s*쇼핑몰(?:\s*보기)?/i.test(controlText(el)));
      if (registered && safeNavigateOrClick(registered)) return { state: "REGISTERED_VIEW_OPENED" };
    }

    for (const row of exactRows) {
      const controls = [...row.querySelectorAll('a,button,input[type="button"],[onclick],img[alt],img[title]')];
      const strong = controls.find((el) => {
        const label = controlText(el);
        const raw = `${el.getAttribute?.("href") || ""} ${el.getAttribute?.("onclick") || ""}`;
        return /상품\s*조회\s*\/\s*수정|조회\s*\/\s*수정/i.test(label)
          || (/prodShopInfo\.phtml/i.test(raw) && new RegExp(`(?:prod_id|goods_key)[^0-9]*${goodsKey}(?:\\D|$)`, "i").test(raw));
      });
      if (strong && safeNavigateOrClick(strong)) return { state: "DETAIL_OPENED" };
      const fallback = controls.find((el) => /^(?:수정|상품\s*수정)$/.test(controlText(el)));
      if (fallback && safeNavigateOrClick(fallback)) return { state: "DETAIL_OPENED" };
    }

    // The exact GOODSKEY row is already proven above. Some Shopling layouts
    // hide the detail action behind an image/JS handler whose label cannot be
    // read reliably. In that case use the canonical read-only product detail
    // URL instead of failing on a presentation-only control.
    const directDetail = new URL("/prod/prodShopInfo.phtml", location.origin);
    directDetail.searchParams.set("mode", "modify");
    directDetail.searchParams.set("prod_id", goodsKey);
    location.href = directDetail.href;
    return { state: "DETAIL_OPENED_DIRECT", pageUrl: directDetail.href };
  }

  const controls = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"],[onclick],img[alt],img[title]')];
  const registered = controls.find((el) => /등록된\s*쇼핑몰(?:\s*보기)?/i.test(controlText(el)));
  if (registered && safeNavigateOrClick(registered)) return { state: "REGISTERED_VIEW_OPENED" };

  if (/등록된\s*쇼핑몰|몰판매가|쇼핑몰판매가/.test(body)) return { state: "WAITING_FOR_REGISTERED_TABLE" };
  return { state: "REGISTERED_VIEW_CONTROL_MISSING", pageUrl: location.href };
}
