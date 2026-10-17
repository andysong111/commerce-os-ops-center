import {
  activateChromeTarget,
  CdpSession,
  fetchJson,
  listChromeTargets,
  withBrowserCdpTarget,
} from "./chrome-cdp.mjs";

const CART_URL = "https://cart.1688.com/cart.htm";
const DEFAULT_TIMEOUT_MS = 20_000;
const OFFER_NAVIGATION_TIMEOUT_MS = 60_000;
const OFFER_HYDRATION_TIMEOUT_MS = 15_000;
const OFFER_RETRY_COUNT = 2;
const SECURITY_CHALLENGE_WAIT_MS = 180_000;
const SECURITY_CHALLENGE_POLL_MS = 1_000;
const SECURITY_CHALLENGE_FRESH_TARGET_RETRIES = 2;
const FORBIDDEN_ORDER_TEXT = /提交订单|确认下单|立即下单|立即付款|确认付款|支付|pay\s*now/i;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function is1688Page(target, origins) {
  return target?.type === "page" && origins.some((origin) => String(target.url || "").startsWith(origin));
}

async function ensure1688Target(config, firstUrl, dependencies = {}) {
  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const listing = await listTargets(config);
  if (!listing.available) {
    fail("ALIBABA1688_CHROME_UNAVAILABLE", "1688 전용 Chrome에 연결하지 못했습니다.");
  }
  const origins = config.alibaba1688Origins || ["https://detail.1688.com/", "https://cart.1688.com/", "https://trade.1688.com/"];
  const existing = listing.targets.find((target) => is1688Page(target, origins));
  if (existing) return existing;

  return create1688Target(config, firstUrl, dependencies);
}

async function create1688Target(config, firstUrl, dependencies = {}) {
  const createTarget = dependencies.createTarget || (async (url) => {
    const response = await fetch(`${config.chromeDebugBaseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return response.json();
  });
  const created = await createTarget(firstUrl);
  if (!created?.id) {
    fail("ALIBABA1688_TARGET_CREATE_FAILED", "1688 전용 Chrome 탭을 열지 못했습니다.");
  }
  return created;
}

async function close1688Target(config, target, dependencies = {}) {
  if (!target?.id) return false;
  const closeTarget = dependencies.closeTarget || (async (targetId) => {
    const response = await fetch(`${config.chromeDebugBaseUrl}/json/close/${encodeURIComponent(targetId)}`, {
      cache: "no-store",
    });
    return response.ok;
  });
  return Boolean(await closeTarget(target.id).catch(() => false));
}

async function create1688WindowTarget(config, firstUrl, dependencies = {}) {
  const createWindowTarget = dependencies.createWindowTarget;
  if (createWindowTarget) {
    const created = await createWindowTarget(firstUrl);
    if (created?.id) return created;
    fail("ALIBABA1688_TARGET_CREATE_FAILED", "1688 전용 Chrome 새 창을 열지 못했습니다.");
  }

  const version = await fetchJson(`${config.chromeDebugBaseUrl}/json/version`, 5_000);
  if (!version?.webSocketDebuggerUrl) {
    fail("ALIBABA1688_CHROME_UNAVAILABLE", "1688 전용 Chrome에 연결하지 못했습니다.");
  }
  const browserSession = new CdpSession(version.webSocketDebuggerUrl);
  await browserSession.connect(5_000);
  try {
    const created = await browserSession.send("Target.createTarget", {
      url: firstUrl,
      newWindow: true,
    }, 5_000);
    if (!created?.targetId) {
      fail("ALIBABA1688_TARGET_CREATE_FAILED", "1688 전용 Chrome 새 창을 열지 못했습니다.");
    }
    return { id: created.targetId, type: "page", title: "", url: firstUrl };
  } finally {
    await browserSession.close();
  }
}

async function evaluate(session, expression, timeoutMs = DEFAULT_TIMEOUT_MS, userGesture = false) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture,
  }, timeoutMs);
  if (result.exceptionDetails) {
    fail("ALIBABA1688_PAGE_EVALUATION_FAILED", "1688 화면을 읽는 중 오류가 발생했습니다.");
  }
  return result.result?.value;
}

async function navigate(session, url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  await session.send("Network.enable", {}, timeoutMs);
  await session.send("Network.deleteCookies", {
    name: "oversealanguage",
    domain: ".1688.com",
  }, timeoutMs);
  await session.send("Network.setExtraHTTPHeaders", {
    headers: { "Accept-Language": "zh-CN,zh;q=0.9" },
  }, timeoutMs);
  await session.send("Page.enable", {}, timeoutMs);
  await session.send("Page.navigate", { url }, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(session, `({ href: location.href, readyState: document.readyState })`, timeoutMs).catch(() => null);
    if (state?.readyState === "complete" || state?.readyState === "interactive") {
      await sleep(700);
      return state;
    }
    await sleep(200);
  }
  fail("ALIBABA1688_NAVIGATION_TIMEOUT", "1688 화면 로딩이 제한 시간을 초과했습니다.", { url });
}

function offerProbe() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
  const titleText = String(document.title || "").replace(/\s+/g, " ").trim();
  const leadingBodyText = bodyText.slice(0, 2500);
  const currentHref = String(location.href || "");
  const globals = globalThis.FE_GLOBALS;
  const explicitUnauthenticated = Boolean(globals)
    && Object.prototype.hasOwnProperty.call(globals, "loginId")
    && !globals.loginId;
  const loginRequired = /passport\.1688\.com|login\.1688\.com/i.test(location.href)
    || /请先登录|登录后查看|账号登录/.test(bodyText.slice(0, 1500))
    || explicitUnauthenticated
    || /^PC-UNLOGIN-/i.test(String(globalThis.GL_PAGE_ID || ""))
    || Boolean(document.querySelector("button.login-button,[class~='login-button'],a[href*='login.1688.com'],a[href*='passport.1688.com']"));
  const offerOffline = /商品已下架|商品不存在|货品已下架|已下架|页面不存在|您访问的页面不存在|找不到该页面/.test(leadingBodyText)
    || /(?:^|\s)404(?:\s*(?:Not Found|页面不存在|错误))?(?:\s|$)/i.test(titleText)
    || /404.{0,40}(?:页面不存在|Not Found|找不到)/i.test(leadingBodyText.slice(0, 600))
    || /(?:[?&=./_-])notfound(?:[&#./_-]|$)/i.test(currentHref);
  const blockedReason = offerOffline
    ? "OFFER_OFFLINE"
    : /滑块|安全验证|验证码|访问过于频繁|异常流量|슬라이더|보안 인증|인증을 완료|밀어서 확인|정상 접속/.test(bodyText.slice(0, 2500))
      ? "SECURITY_CHALLENGE"
      : "";
  const challengeFailed = blockedReason === "SECURITY_CHALLENGE"
    && /잘못|새로\s*고침|刷新|重试|重新验证|error\s*:/i.test(leadingBodyText);
  const selectors = [
    ".expand-view-item .item-label[title]",
    "[data-sku-id]",
    "[data-sku-prop]",
    "[data-value]",
    "[role='radio']",
    "[class*='sku'] [class*='item']",
    "[class*='prop'] [class*='item']",
  ];
  const seen = new Set();
  const options = [];
  for (const element of document.querySelectorAll(selectors.join(","))) {
    if (!visible(element)) continue;
    const name = String(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "")
      .replace(/\s+/g, " ").trim();
    if (!name || name.length > 120 || seen.has(name)) continue;
    if (/加入进货单|加入购物车|立即订购|数量|起批/.test(name)) continue;
    if (/¥|￥|库存\s*\d*\s*件|^规格$|展开已售罄/.test(name)) continue;
    seen.add(name);
    const row = element.closest(".expand-view-item");
    const quantityInput = row?.querySelector("input[role='spinbutton'],input.ant-input-number-input");
    const disabled = element.matches("[disabled],[aria-disabled='true']")
      || Boolean(quantityInput?.disabled)
      || /disabled|sold.?out|不可选|缺货/.test(`${String(element.className)} ${String(row?.className || "")}`);
    options.push({ name, purchasable: !disabled });
  }
  const buttons = Array.from(document.querySelectorAll("button,a,[role='button']"))
    .filter(visible)
    .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim());
  const canAdd = buttons.some((label) => /加入进货单|加入购物车|加采购车/.test(label));
  return {
    href: currentHref,
    title: document.title,
    bodyTextLength: bodyText.length,
    loginRequired,
    blockedReason: blockedReason || (!canAdd && !loginRequired ? "ADD_CONTROL_NOT_FOUND" : ""),
    challengeFailed,
    canAdd,
    singleSku: canAdd && options.length === 0,
    options,
  };
}

async function waitForOfferSecurityChallenge(session, item, initialInspection) {
  const deadline = Date.now() + SECURITY_CHALLENGE_WAIT_MS;
  let inspection = initialInspection;

  while (Date.now() < deadline) {
    if (inspection?.blockedReason === "SECURITY_CHALLENGE") {
      // A rejected slider tends to keep the current renderer in the same failed
      // verification session. Let the caller replace this tab with a fresh one
      // that starts again from the exact offer URL.
      if (inspection?.challengeFailed) return { ...inspection, freshTargetRequired: true };
      await sleep(SECURITY_CHALLENGE_POLL_MS);
      inspection = await evaluate(session, ALIBABA1688_OFFER_PROBE_EXPRESSION, OFFER_NAVIGATION_TIMEOUT_MS)
        .catch(() => inspection);
      continue;
    }

    const expectedOfferLoaded = String(inspection?.href || "").includes(String(item.offerId || ""));
    if (expectedOfferLoaded && (inspection?.canAdd || inspection?.blockedReason === "OFFER_OFFLINE" || inspection?.loginRequired)) {
      return inspection;
    }

    // Successful verification can redirect to the 1688 home page. Return to
    // the exact offer and continue only after its controls have hydrated.
    await navigate(session, item.offerUrl, OFFER_NAVIGATION_TIMEOUT_MS).catch(() => null);
    await sleep(SECURITY_CHALLENGE_POLL_MS);
    inspection = await evaluate(session, ALIBABA1688_OFFER_PROBE_EXPRESSION, OFFER_NAVIGATION_TIMEOUT_MS)
      .catch(() => inspection);
  }

  return inspection;
}

async function inspectLoadedOffer(session, item) {
  let lastInspection = null;
  let lastNavigationError = null;
  for (let attempt = 1; attempt <= OFFER_RETRY_COUNT; attempt += 1) {
    try {
      await navigate(session, item.offerUrl, OFFER_NAVIGATION_TIMEOUT_MS);
      lastNavigationError = null;
    } catch (error) {
      if (error?.code !== "ALIBABA1688_NAVIGATION_TIMEOUT" && error?.code !== "CDP_COMMAND_TIMEOUT") throw error;
      lastNavigationError = error;
    }

    const hydrationDeadline = Date.now() + OFFER_HYDRATION_TIMEOUT_MS;
    while (Date.now() < hydrationDeadline) {
      const value = await evaluate(session, ALIBABA1688_OFFER_PROBE_EXPRESSION, OFFER_NAVIGATION_TIMEOUT_MS)
        .catch(() => null);
      if (value) lastInspection = value;
      if (value?.loginRequired
        || value?.blockedReason === "SECURITY_CHALLENGE"
        || value?.blockedReason === "OFFER_OFFLINE"
        || value?.canAdd) {
        return value;
      }
      await sleep(750);
    }

    const expectedOfferLoaded = String(lastInspection?.href || "").includes(String(item.offerId || ""))
      && Number(lastInspection?.bodyTextLength || 0) >= 150;
    if (!lastNavigationError && expectedOfferLoaded) return lastInspection;

    // A slow 1688 response must not be confused with a closed supplier or a
    // discontinued listing. Reload once, then require an explicit 404/down
    // marker before returning OFFER_OFFLINE.
    if (attempt < OFFER_RETRY_COUNT) await sleep(1_000);
  }

  fail("ALIBABA1688_OFFER_LOAD_TIMEOUT", "1688 상품 화면이 아직 완전히 열리지 않았습니다. 잠시 후 5번 업무를 다시 실행하세요.", {
    offerId: item.offerId,
    url: item.offerUrl,
    href: lastInspection?.href || "",
    title: lastInspection?.title || "",
    retryable: true,
  });
}

async function addVariantProbe(item) {
  const forbiddenOrderText = /提交订单|确认下单|立即付款|确认付款|支付|pay\s*now/i;
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const buttons = Array.from(document.querySelectorAll("button,a,[role='button']")).filter(visible);
  const addButtons = buttons.filter((element) => /加入进货单|加入购物车|加采购车/.test(String(element.textContent || "")));
  if (addButtons.length !== 1) return { ok: false, code: "ADD_CONTROL_AMBIGUOUS", count: addButtons.length };
  if (forbiddenOrderText.test(String(addButtons[0].textContent || ""))) return { ok: false, code: "FORBIDDEN_ORDER_CONTROL" };

  const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
    .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
  const perSkuRows = Array.from(document.querySelectorAll(".expand-view-item")).filter(visible).map((row) => ({
    row,
    labels: Array.from(row.querySelectorAll(".item-label[title],[data-sku-id],[data-value]"))
      .map((element) => String(element.getAttribute("title") || element.getAttribute("aria-label") || element.textContent || "").normalize("NFKC").trim())
      .filter(Boolean),
    input: row.querySelector("input[role='spinbutton'],input.ant-input-number-input"),
  })).filter((entry) => entry.input && !entry.input.disabled);
  if (perSkuRows.length > 0) {
    const singleSku = optionNames.length === 1 && normalize(optionNames[0]) === normalize("단품");
    const matchingRows = perSkuRows.filter((entry) => {
      if (singleSku) return perSkuRows.length === 1;
      const normalizedLabels = entry.labels.map(normalize);
      const normalizedText = normalize(entry.row.innerText || "");
      return optionNames.every((optionName) => (
        normalizedLabels.includes(normalize(optionName)) || normalizedText.includes(normalize(optionName))
      ));
    });
    if (matchingRows.length !== 1) {
      return { ok: false, code: "OPTION_MATCH_COUNT_INVALID", optionNames, count: matchingRows.length };
    }
    const input = matchingRows[0].input;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    input.focus();
    if (setter) setter.call(input, String(item.quantity));
    else input.value = String(item.quantity);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(item.quantity) }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (Number(input.value) !== Number(item.quantity)) {
      return { ok: false, code: "QUANTITY_SET_FAILED", expected: item.quantity, actual: input.value };
    }
    addButtons[0].click();
    return { ok: true, clicked: true, quantity: Number(input.value), ui: "PER_SKU_QUANTITY" };
  }

  if (!(optionNames.length === 1 && normalize(optionNames[0]) === normalize("단품"))) {
    const selectors = "[data-sku-id],[data-sku-prop],[data-value],[role='radio'],[class*='sku'] [class*='item'],[class*='prop'] [class*='item']";
    for (const optionName of optionNames) {
      const matches = Array.from(document.querySelectorAll(selectors)).filter((element) => {
        if (!visible(element)) return false;
        const name = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
        return normalize(name) === normalize(optionName);
      });
      if (matches.length !== 1) return { ok: false, code: "OPTION_MATCH_COUNT_INVALID", optionName, count: matches.length };
      matches[0].click();
    }
  }

  let scope = addButtons[0].parentElement;
  let quantityInputs = [];
  for (let depth = 0; scope && depth < 7; depth += 1, scope = scope.parentElement) {
    quantityInputs = Array.from(scope.querySelectorAll("input[type='number'],input[class*='amount'],input[class*='quantity'],input[class*='count'],input[aria-label*='数量']")).filter(visible);
    if (quantityInputs.length === 1) break;
  }
  if (quantityInputs.length !== 1) return { ok: false, code: "QUANTITY_CONTROL_AMBIGUOUS", count: quantityInputs.length };
  const input = quantityInputs[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, String(item.quantity));
  else input.value = String(item.quantity);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(item.quantity) }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
  addButtons[0].click();
  return { ok: true, clicked: true, quantity: item.quantity };
}

function preparePerSkuQuantityProbe(item) {
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
    .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
  const rows = Array.from(document.querySelectorAll(".expand-view-item")).filter(visible).map((row) => ({
    row,
    labels: Array.from(row.querySelectorAll(".item-label[title],[data-sku-id],[data-value]"))
      .map((element) => String(element.getAttribute("title") || element.getAttribute("aria-label") || element.textContent || "").normalize("NFKC").trim())
      .filter(Boolean),
    input: row.querySelector("input[role='spinbutton'],input.ant-input-number-input"),
  })).filter((entry) => entry.input && !entry.input.disabled);
  if (rows.length === 0) return { handled: false };
  const singleSku = optionNames.length === 1 && normalize(optionNames[0]) === normalize("단품");
  const matches = rows.filter((entry) => {
    if (singleSku) return rows.length === 1;
    const normalizedLabels = entry.labels.map(normalize);
    const normalizedText = normalize(entry.row.innerText || "");
    return optionNames.every((optionName) => (
      normalizedLabels.includes(normalize(optionName)) || normalizedText.includes(normalize(optionName))
    ));
  });
  if (matches.length !== 1) {
    return { handled: true, ok: false, code: "OPTION_MATCH_COUNT_INVALID", optionNames, count: matches.length };
  }
  matches[0].input.focus();
  matches[0].input.select();
  return { handled: true, ok: true, currentValue: matches[0].input.value };
}

function clickPreparedPerSkuAddProbe(item) {
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
    .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
  const rows = Array.from(document.querySelectorAll(".expand-view-item")).filter(visible).map((row) => ({
    row,
    labels: Array.from(row.querySelectorAll(".item-label[title],[data-sku-id],[data-value]"))
      .map((element) => String(element.getAttribute("title") || element.getAttribute("aria-label") || element.textContent || "").normalize("NFKC").trim())
      .filter(Boolean),
    input: row.querySelector("input[role='spinbutton'],input.ant-input-number-input"),
  })).filter((entry) => entry.input && !entry.input.disabled);
  const singleSku = optionNames.length === 1 && normalize(optionNames[0]) === normalize("단품");
  const matches = rows.filter((entry) => {
    if (singleSku) return rows.length === 1;
    const normalizedLabels = entry.labels.map(normalize);
    const normalizedText = normalize(entry.row.innerText || "");
    return optionNames.every((optionName) => (
      normalizedLabels.includes(normalize(optionName)) || normalizedText.includes(normalize(optionName))
    ));
  });
  if (matches.length !== 1) return { ok: false, code: "OPTION_MATCH_COUNT_INVALID", count: matches.length };
  const actualQuantity = Number(matches[0].input.value);
  if (actualQuantity !== Number(item.quantity)) {
    return { ok: false, code: "QUANTITY_SET_FAILED", expected: item.quantity, actual: matches[0].input.value };
  }
  const buttons = Array.from(document.querySelectorAll("button,a,[role='button']")).filter(visible);
  const addButtons = buttons.filter((element) => /加入进货单|加入购物车|加采购车/.test(String(element.textContent || "")));
  if (addButtons.length !== 1) return { ok: false, code: "ADD_CONTROL_AMBIGUOUS", count: addButtons.length };
  const buttonRect = addButtons[0].getBoundingClientRect();
  return {
    ok: true,
    clicked: false,
    quantity: actualQuantity,
    ui: "PER_SKU_QUANTITY",
    buttonCenter: {
      x: buttonRect.x + buttonRect.width / 2,
      y: buttonRect.y + buttonRect.height / 2,
    },
  };
}

function cartSnapshotProbe(items) {
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const result = [];
  for (const item of items) {
    const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
      .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
    const anchors = Array.from(document.querySelectorAll(`a[href*="/offer/${item.offerId}.html"]`)).filter(visible);
    const matchedRows = new Set();
    for (const anchor of anchors) {
      const groupRoot = anchor.closest("tbody") || anchor.closest("table");
      const currentRows = groupRoot
        ? Array.from(groupRoot.querySelectorAll("tr[data-cart-id],tr[class*='item--container']"))
        : [];
      const matchingCurrentRows = currentRows.filter((row) => {
        const rowText = String(row.innerText || "").replace(/\s+/g, " ").trim();
        return optionNames.every((optionName) => (
          normalize(optionName) === normalize("단품") ? currentRows.length === 1 : normalize(rowText).includes(normalize(optionName))
        ));
      });
      for (const row of matchingCurrentRows) {
        const input = row.querySelector("input[aria-valuemin][aria-valuemax],input[type='number'],input[class*='amount'],input[class*='quantity'],input[class*='count']");
        if (!input || matchedRows.has(row)) continue;
        matchedRows.add(row);
        const sellerRoot = row.closest("[data-seller-id],[data-shop-id],[class*='shop-container'],[class*='supplier'],[class*='seller'],[class*='shop']") || groupRoot;
        const sellerAnchor = sellerRoot?.querySelector("a[href*='winport.1688.com'],a[href*='company.1688.com'],a[href*='1688.com'][class*='shop']");
        const sellerId = sellerRoot?.getAttribute("data-seller-id")
          || sellerRoot?.getAttribute("data-shop-id")
          || sellerAnchor?.href || "";
        result.push({
          offerId: item.offerId,
          optionName: item.optionName,
          quantity: Number(input.value),
          sellerId,
          lineMarker: row.getAttribute("data-cart-id") || row.getAttribute("data-item-id") || `${item.offerId}:${item.optionName}`,
        });
      }
      if (matchingCurrentRows.length > 0) continue;
      let row = anchor;
      for (let depth = 0; row && depth < 10; depth += 1, row = row.parentElement) {
        const input = row.querySelector("input[type='number'],input[class*='amount'],input[class*='quantity'],input[class*='count']");
        if (!input) continue;
        const rowText = String(row.innerText || "").replace(/\s+/g, " ").trim();
        if (!optionNames.every((optionName) => normalize(optionName) === normalize("단품") || normalize(rowText).includes(normalize(optionName)))) continue;
        if (matchedRows.has(row)) break;
        matchedRows.add(row);
        const sellerAnchor = row.closest("[data-seller-id],[data-shop-id],[class*='supplier'],[class*='seller'],[class*='shop']")?.querySelector("a[href*='1688.com']")
          || row.querySelector("a[href*='winport.1688.com'],a[href*='company.1688.com']");
        const sellerId = row.closest("[data-seller-id]")?.getAttribute("data-seller-id")
          || row.closest("[data-shop-id]")?.getAttribute("data-shop-id")
          || sellerAnchor?.href || "";
        result.push({
          offerId: item.offerId,
          optionName: item.optionName,
          quantity: Number(input.value),
          sellerId,
          lineMarker: row.getAttribute("data-cart-id") || row.getAttribute("data-item-id") || `${item.offerId}:${item.optionName}`,
        });
        break;
      }
    }
  }
  return {
    href: location.href,
    loginRequired: /passport\.1688\.com|login\.1688\.com/i.test(location.href),
    securityChallenge: /滑块|安全验证|验证码|异常流量|슬라이더|보안 인증|인증을 완료|밀어서 확인|정상 접속/.test((document.body?.innerText || "").slice(0, 2500)),
    cartRowCount: document.querySelectorAll("tr[data-cart-id],tr[class*='item--container']").length,
    lines: result,
  };
}

function setCartQuantityProbe(action) {
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const anchors = Array.from(document.querySelectorAll(`a[href*="/offer/${action.item.offerId}.html"]`));
  const optionNames = (Array.isArray(action.item.optionNames) ? action.item.optionNames : String(action.item.optionName || "").split(/[,，]/u))
    .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
  const matches = [];
  const matchedRows = new Set();
  for (const anchor of anchors) {
    const groupRoot = anchor.closest("tbody") || anchor.closest("table");
    const currentRows = groupRoot
      ? Array.from(groupRoot.querySelectorAll("tr[data-cart-id],tr[class*='item--container']"))
      : [];
    for (const row of currentRows) {
      const input = row.querySelector("input[aria-valuemin][aria-valuemax],input[type='number'],input[class*='amount'],input[class*='quantity'],input[class*='count']");
      const rowText = row.innerText || "";
      if (!input || !optionNames.every((optionName) => (
        normalize(optionName) === normalize("단품") ? currentRows.length === 1 : normalize(rowText).includes(normalize(optionName))
      ))) continue;
      if (matchedRows.has(row)) continue;
      matchedRows.add(row);
      matches.push({ row, input });
    }
    if (currentRows.length > 0) continue;
    let row = anchor;
    for (let depth = 0; row && depth < 10; depth += 1, row = row.parentElement) {
      const input = row.querySelector("input[type='number'],input[class*='amount'],input[class*='quantity'],input[class*='count']");
      if (!input) continue;
      const rowText = row.innerText || "";
      if (!optionNames.every((optionName) => normalize(optionName) === normalize("단품") || normalize(rowText).includes(normalize(optionName)))) continue;
      if (matchedRows.has(row)) break;
      matchedRows.add(row);
      matches.push({ row, input });
      break;
    }
  }
  if (matches.length !== 1) return { ok: false, code: "CART_LINE_MATCH_COUNT_INVALID", count: matches.length };
  const input = matches[0].input;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, String(action.quantity));
  else input.value = String(action.quantity);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
  return { ok: true, quantity: Number(input.value) };
}

function selectTargetsAndPreviewProbe(items, togglePending = false) {
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const targetRows = new Set();
  for (const item of items) {
    const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
      .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
    const anchors = Array.from(document.querySelectorAll(`a[href*="/offer/${item.offerId}.html"]`));
    const matchingRows = [];
    const matchedRows = new Set();
    for (const anchor of anchors) {
      const groupRoot = anchor.closest("tbody") || anchor.closest("table");
      const currentRows = groupRoot
        ? Array.from(groupRoot.querySelectorAll("tr[data-cart-id],tr[class*='item--container']"))
        : [];
      for (const row of currentRows) {
        const rowText = row.innerText || "";
        if (!optionNames.every((optionName) => (
          normalize(optionName) === normalize("단품") ? currentRows.length === 1 : normalize(rowText).includes(normalize(optionName))
        ))) continue;
        if (matchedRows.has(row)) continue;
        matchedRows.add(row);
        matchingRows.push(row);
      }
      if (currentRows.length > 0) continue;
      let row = anchor;
      for (let depth = 0; row && depth < 10; depth += 1, row = row.parentElement) {
        if (!row.querySelector("input[type='number'],input[class*='amount'],input[class*='quantity'],input[class*='count']")) continue;
        const rowText = row.innerText || "";
        if (!optionNames.every((optionName) => normalize(optionName) === normalize("단품") || normalize(rowText).includes(normalize(optionName)))) continue;
        if (matchedRows.has(row)) break;
        matchedRows.add(row);
        matchingRows.push(row);
        break;
      }
    }
    if (matchingRows.length !== 1) return { ok: false, code: "TARGET_ROW_MATCH_COUNT_INVALID", item, count: matchingRows.length };
    targetRows.add(matchingRows[0]);
  }

  const cartRows = Array.from(document.querySelectorAll("tr[data-cart-id],tr[class*='item--container']"));
  const pending = [];
  for (const row of cartRows) {
    const checkbox = row.querySelector("input[type='checkbox']");
    if (!checkbox || checkbox.checked === targetRows.has(row)) continue;
    pending.push(checkbox);
  }
  const checkbox = pending[0] || null;
  if (checkbox && togglePending) {
    checkbox.scrollIntoView({ block: "center", inline: "center" });
    checkbox.focus({ preventScroll: true });
    checkbox.click();
  }
  const rect = checkbox?.getBoundingClientRect();
  return {
    ok: true,
    selectedCount: targetRows.size,
    cartRowCount: cartRows.length,
    pendingCount: pending.length,
    checkboxClicks: rect ? [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }] : [],
  };
}

function settlementButtonProbe(clickButton = false) {
  const forbiddenOrderText = /提交订单|确认下单|立即下单|立即付款|确认付款|支付|pay\s*now/i;
  const settlement = Array.from(document.querySelectorAll("button,a,[role='button']")).filter((element) => {
    const label = String(element.textContent || "").replace(/\s+/g, " ").trim();
    return /^去?结算(?:\s*\(?.*\)?)?$/.test(label) && !forbiddenOrderText.test(label);
  });
  if (settlement.length !== 1) return { ok: false, code: "SETTLEMENT_CONTROL_AMBIGUOUS", count: settlement.length, href: location.href };
  const button = settlement[0];
  button.scrollIntoView({ block: "center", inline: "center" });
  const buttonRect = button.getBoundingClientRect();
  const center = {
    x: buttonRect.x + buttonRect.width / 2,
    y: buttonRect.y + buttonRect.height / 2,
  };
  const hit = document.elementFromPoint(center.x, center.y);
  const disabled = Boolean(button.disabled) || button.getAttribute("aria-disabled") === "true";
  if (clickButton && !disabled) button.click();
  return {
    ok: true,
    href: location.href,
    disabled,
    clicked: clickButton && !disabled,
    buttonCenter: center,
    hitText: String(hit?.textContent || "").replace(/\s+/g, " ").trim(),
  };
}

function checkoutSubmitOrderProbe(clickButton = false) {
  const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const allMatches = Array.from(document.querySelectorAll("q-button,button,a,[role='button'],.button-wrapper"))
    .filter((element) => visible(element) && /^提交订单(?:\s|≈|¥|￥|$)/.test(clean(element.textContent)));
  const matches = allMatches.filter((element) => !allMatches.some((other) => other !== element && element.contains(other)));
  if (matches.length !== 1) {
    return { ok: false, code: "ORDER_SUBMIT_CONTROL_AMBIGUOUS", count: matches.length, href: location.href };
  }
  const button = matches[0];
  button.scrollIntoView({ block: "center", inline: "center" });
  const rect = button.getBoundingClientRect();
  const label = clean(button.textContent);
  const cnyMatch = label.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
  const disabled = Boolean(button.disabled) || button.getAttribute("aria-disabled") === "true";
  if (clickButton && !disabled) button.click();
  return {
    ok: true,
    href: location.href,
    label,
    totalCny: cnyMatch ? Number(cnyMatch[1]) : null,
    disabled,
    clicked: clickButton && !disabled,
    buttonCenter: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
  };
}

function paymentSelectionProbe() {
  const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const href = location.href;
  const textParts = [document.body?.innerText || ""];
  const visitOpenShadows = (root) => {
    for (const element of root.querySelectorAll?.("*") || []) {
      if (!element.shadowRoot) continue;
      textParts.push(element.shadowRoot.textContent || "");
      visitOpenShadows(element.shadowRoot);
    }
  };
  visitOpenShadows(document);
  const bodyText = clean(textParts.join(" "));
  const loginRequired = /passport\.1688\.com|login\.1688\.com/i.test(href)
    || /请先登录|登录后查看|账号登录/.test(bodyText.slice(0, 1500));
  const securityChallenge = /滑块|安全验证|验证码|访问过于频繁|异常流量|슬라이더|보안 인증|인증을 완료|밀어서 확인|정상 접속/.test(bodyText.slice(0, 2500));
  const checkoutStillVisible = /\/order\/smart_make_order\.htm/i.test(href)
    || Array.from(document.querySelectorAll("q-button,button,a,[role='button'],.button-wrapper"))
      .some((element) => /^提交订单(?:\s|≈|¥|￥|$)/.test(clean(element.textContent)));
  const paymentMarker = /选择(?:支付|付款)方式|(?:支付|付款)方式|收银台|支付宝|网商银行|银行卡|付款账户/.test(bodyText.slice(0, 8000));
  const paymentUrl = /cashier|payment|pay(?:ment)?[\/_-]|trade[_-]?pay|alipay/i.test(href);
  const orderRefs = [];
  for (const match of bodyText.matchAll(/(?:订单号|订单编号|交易号)\s*[:：]?\s*([A-Za-z0-9_-]{8,40})/g)) {
    if (!orderRefs.includes(match[1])) orderRefs.push(match[1]);
  }
  const url = new URL(href);
  for (const key of ["orderId", "orderIds", "tradeNo", "outTradeNo", "bizOrderId"]) {
    for (const value of url.searchParams.getAll(key).flatMap((item) => item.split(/[,_]/))) {
      const normalized = clean(value);
      if (/^[A-Za-z0-9-]{8,40}$/.test(normalized) && !orderRefs.includes(normalized)) orderRefs.push(normalized);
    }
  }
  return {
    href,
    title: document.title,
    loginRequired,
    securityChallenge,
    checkoutStillVisible,
    paymentSelectionConfirmed: !checkoutStillVisible && !loginRequired && !securityChallenge && paymentMarker,
    orderRefs,
  };
}

export function chooseAlibaba1688ShippingPreference(group) {
  const merchant = Number(group?.merchant?.priceCny);
  const official = Number(group?.official?.priceCny);
  const merchantAvailable = group?.merchant?.available === true && Number.isFinite(merchant) && merchant >= 0;
  const officialAvailable = group?.official?.available === true && Number.isFinite(official) && official >= 0;
  if (!merchantAvailable && !officialAvailable) {
    return { ok: false, method: "", tier: "", reason: "SHIPPING_PRICE_UNAVAILABLE" };
  }
  const method = officialAvailable && (!merchantAvailable || official < merchant) ? "OFFICIAL" : "MERCHANT";
  const standardAvailable = Array.isArray(group?.tiers)
    && group.tiers.some((tier) => tier?.code === "STANDARD" && tier?.available === true);
  return {
    ok: true,
    method,
    tier: method === "OFFICIAL" && standardAvailable ? "STANDARD" : "",
    reason: method === "OFFICIAL" ? "OFFICIAL_CHEAPER" : "MERCHANT_NOT_MORE_EXPENSIVE",
  };
}

function checkoutShippingOptionsProbe(actions = []) {
  const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const shippingSelector = "span,div,label,p,q-radio,button";
  const allElements = [];
  const visitOpenTree = (root) => {
    for (const element of root.querySelectorAll("*")) {
      allElements.push(element);
      if (element.shadowRoot) visitOpenTree(element.shadowRoot);
    }
  };
  visitOpenTree(document);
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const ownText = (element) => clean(Array.from(element?.childNodes || [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" "));
  const exact = (root, label) => Array.from(root.querySelectorAll(shippingSelector))
    .filter((element) => visible(element) && (ownText(element) === label || clean(element.textContent) === label))
    .sort((left, right) => left.childElementCount - right.childElementCount)[0] || null;
  const center = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const clickExact = (element) => {
    if (!element) return false;
    const root = element.getRootNode?.();
    const shadowHost = root instanceof ShadowRoot ? root.host : null;
    const control = element.closest?.("q-radio,label,[role='radio'],button")
      || (shadowHost?.matches?.("q-radio,label,[role='radio'],button") ? shadowHost : null)
      || element;
    control.click();
    return true;
  };
  const selected = (element) => {
    for (let node = element, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const aria = node.getAttribute?.("aria-checked") || node.getAttribute?.("aria-selected");
      const className = String(node.className || "");
      const localRadio = node.matches?.("input,q-radio,[role='radio']") ? node : node.querySelector?.("input,q-radio,[role='radio']");
      if (localRadio) {
        return localRadio.matches?.("input:checked,q-radio[checked='true'],[checked='true'],[aria-checked='true']") === true;
      }
      if (aria === "true" || node.matches?.("[checked='true']")
        || node.querySelector?.("[checked='true'],[aria-checked='true'],[aria-selected='true']")) return true;
      if (/(^|[-_\s])(selected|active|checked|current)([-_\s]|$)/i.test(className)) return true;
      if (clean(node.textContent).length > 220) break;
    }
    return false;
  };
  const priceFor = (scope, label) => {
    const text = clean(scope?.textContent);
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*(?:¥|￥)\\s*(\\d+(?:\\.\\d{1,2})?)`));
    return match ? Number(match[1]) : null;
  };
  const shippingElements = allElements.filter((element) => element.matches(shippingSelector));
  const allOfficial = shippingElements
    .filter((element) => visible(element) && (ownText(element) === "官方配送" || clean(element.textContent) === "官方配送"))
    .sort((left, right) => left.getBoundingClientRect().y - right.getBoundingClientRect().y);
  const methodLabelsPresent = allOfficial.length > 0
    || shippingElements
      .some((element) => visible(element) && (ownText(element) === "商家配送" || clean(element.textContent) === "商家配送"));
  const seen = new Set();
  const groups = [];
  for (const officialLabel of allOfficial) {
    const root = officialLabel.getRootNode?.();
    let scope = root instanceof ShadowRoot ? root : officialLabel.parentElement;
    if (!(scope instanceof ShadowRoot)) {
      for (let depth = 0; scope && depth < 7; depth += 1, scope = scope.parentElement) {
        const text = clean(scope.textContent);
        if (text.includes("商家配送") && text.includes("官方配送") && text.length <= 900) break;
      }
    }
    if (!scope) continue;
    const rect = scope instanceof ShadowRoot ? scope.host.getBoundingClientRect() : scope.getBoundingClientRect();
    const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const merchantLabel = exact(scope, "商家配送");
    const qualityLabel = exact(scope, "品质大件");
    const standardLabel = exact(scope, "标准大件");
    const premiumLabel = exact(scope, "尊享大件");
    const action = actions[groups.length] || {};
    let actionClicked = false;
    if (action.method === "OFFICIAL") actionClicked = clickExact(officialLabel);
    else if (action.method === "MERCHANT") actionClicked = clickExact(merchantLabel);
    else if (action.tier === "STANDARD") actionClicked = clickExact(standardLabel);
    groups.push({
      key,
      actionClicked,
      merchant: { available: Boolean(merchantLabel), priceCny: priceFor(scope, "商家配送"), selected: selected(merchantLabel), center: center(merchantLabel) },
      official: { available: true, priceCny: priceFor(scope, "官方配送"), selected: selected(officialLabel), center: center(officialLabel) },
      tiers: [
        { code: "QUALITY", label: "品质大件", available: Boolean(qualityLabel), selected: selected(qualityLabel), center: center(qualityLabel) },
        { code: "STANDARD", label: "标准大件", available: Boolean(standardLabel), selected: selected(standardLabel), center: center(standardLabel) },
        { code: "PREMIUM", label: "尊享大件", available: Boolean(premiumLabel), selected: selected(premiumLabel), center: center(premiumLabel) },
      ],
    });
  }
  return { href: location.href, methodLabelsPresent, groups };
}

function checkoutSnapshotProbe(items, shippingSelections = []) {
  const forbiddenOrderText = /提交订单|确认下单|立即下单|立即付款|确认付款|支付|pay\s*now/i;
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ").replace(/\s*([,;/|+，、；：:])\s*/g, "$1");
  const money = (value) => {
    const match = String(value || "").replace(/,/g, "").match(/(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)/);
    return match ? Number(match[1]) : null;
  };
  const amountFrom = (root) => {
    if (!root) return null;
    const amount = root.querySelector(".amount")?.textContent;
    if (amount && Number.isFinite(money(amount))) return money(amount);
    const dollar = String(root.querySelector(".dollar")?.textContent || "").replace(/[^\d]/g, "");
    const cent = String(root.querySelector(".cent")?.textContent || "").replace(/[^\d]/g, "");
    if (dollar) return Number(`${dollar}.${cent || "00"}`);
    return money(root.textContent);
  };
  const modernGroups = Array.from(document.querySelectorAll(".order-group-container"));
  if (modernGroups.length > 0) {
    const lines = [];
    const sellerGroups = [];
    for (const [groupIndex, group] of modernGroups.entries()) {
      const seller = group.querySelector("a.shop-link");
      const groupId = seller?.href || normalize(seller?.textContent || "");
      if (!groupId) continue;
      const detailRows = Array.from(group.querySelectorAll(".list-item"));
      const freightRow = detailRows.find((row) => {
        const title = row.querySelector(".list-item-title");
        return String(title?.childNodes?.[0]?.textContent || title?.textContent || "").trim() === "运费";
      });
      const freightRoot = freightRow?.querySelector(".list-item-extra .amount-container")
        || group.querySelector(".amount-container.freight-total");
      const subsidyRow = detailRows.find((row) => {
        const title = row.querySelector(".list-item-title");
        return /官方物流补贴/.test(String(title?.childNodes?.[0]?.textContent || title?.textContent || "").trim());
      });
      const subsidyRoot = subsidyRow?.querySelector(".list-item-extra .amount-container") || subsidyRow;
      const listedFreightCny = amountFrom(freightRoot);
      const officialSubsidyCny = amountFrom(subsidyRoot) || 0;
      const selectedShippingMethod = shippingSelections[groupIndex]?.method || "";
      sellerGroups.push({
        groupId,
        listedFreightCny,
        officialSubsidyCny,
        selectedShippingMethod,
        domesticFreightCny: Number.isFinite(listedFreightCny)
          ? Math.max(0, Math.round((listedFreightCny - (selectedShippingMethod === "OFFICIAL" ? officialSubsidyCny : 0)) * 100) / 100)
          : null,
      });

      for (const item of items) {
        const anchor = group.querySelector(`a.offer-link[href*="/offer/${item.offerId}.html"]`);
        if (!anchor) continue;
        const offer = anchor.closest(".offer-container");
        const cargos = Array.from(offer?.querySelectorAll(".cargo-container") || []);
        const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
          .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
        const matching = cargos.filter((cargo) => {
          const cargoText = cargo.querySelector(".cargo-spec")?.textContent || cargo.textContent || "";
          return optionNames.every((optionName) => (
            normalize(optionName) === normalize("단품") ? cargos.length === 1 : normalize(cargoText).includes(normalize(optionName))
          ));
        });
        if (matching.length !== 1) continue;
        const cargo = matching[0];
        const quantityNode = cargo.querySelector("q-inputnumber");
        const quantity = Number(quantityNode?.getAttribute("value") || quantityNode?.value || cargo.querySelector("input")?.value || 0);
        const priceRoot = cargo.querySelector(".cargo-unit-price .final-unit-price")
          || cargo.querySelector(".cargo-unit-price");
        const lineTotalCny = amountFrom(cargo.querySelector(".cargo-amount"));
        const displayedUnitPriceCny = amountFrom(priceRoot);
        lines.push({
          offerId: item.offerId,
          optionName: item.optionName,
          quantity,
          unitPriceCny: Number.isFinite(lineTotalCny) && quantity > 0
            ? lineTotalCny / quantity
            : displayedUnitPriceCny,
          displayedUnitPriceCny,
          lineTotalCny,
          groupId,
        });
      }
    }
    const bodyText = document.body?.innerText || "";
    return {
      href: location.href,
      forbiddenOrderControlPresent: Array.from(document.querySelectorAll("button,a,[role='button'],q-button,.button-wrapper"))
        .some((element) => forbiddenOrderText.test(String(element.textContent || ""))),
      loginRequired: /passport\.1688\.com|login\.1688\.com/i.test(location.href),
      securityChallenge: /滑块|安全验证|验证码|异常流量|슬라이더|보안 인증|인증을 완료|밀어서 확인|정상 접속/.test(bodyText.slice(0, 2500)),
      lines,
      sellerGroups,
    };
  }
  const lines = [];
  const groupElements = new Map();
  for (const item of items) {
    const optionNames = (Array.isArray(item.optionNames) ? item.optionNames : String(item.optionName || "").split(/[,，]/u))
      .map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
    const anchors = Array.from(document.querySelectorAll(`a[href*="/offer/${item.offerId}.html"]`));
    const matches = [];
    const matchedRows = new Set();
    for (const anchor of anchors) {
      let row = anchor;
      for (let depth = 0; row && depth < 10; depth += 1, row = row.parentElement) {
        const rowText = String(row.innerText || "").replace(/\s+/g, " ").trim();
        if (!rowText) continue;
        if (!optionNames.every((optionName) => normalize(optionName) === normalize("단품") || normalize(rowText).includes(normalize(optionName)))) continue;
        const quantityMatch = rowText.match(/(?:数量|x|×)\s*[:：]?\s*(\d+)/i);
        const priceNodes = Array.from(row.querySelectorAll("[class*='price'],[data-price],em,strong"));
        const prices = priceNodes.map((node) => money(node.getAttribute("data-price") || node.textContent)).filter((value) => Number.isFinite(value) && value > 0);
        if (!quantityMatch || prices.length === 0) continue;
        if (matchedRows.has(row)) break;
        matchedRows.add(row);
        let group = row;
        for (let groupDepth = 0; group && groupDepth < 10; groupDepth += 1, group = group.parentElement) {
          const text = String(group.innerText || "").replace(/\s+/g, " ");
          if (/运费|配送费|物流费|包邮|免运费/.test(text) && group.querySelector("a[href*='/offer/']")) break;
        }
        if (!group) continue;
        const sellerAnchor = group.querySelector("a[href*='winport.1688.com'],a[href*='company.1688.com'],a[href*='1688.com'][class*='shop']");
        const groupId = group.getAttribute("data-seller-id") || group.getAttribute("data-shop-id") || sellerAnchor?.href || "";
        matches.push({ group, groupId, quantity: Number(quantityMatch[1]), unitPriceCny: prices[0] });
        break;
      }
    }
    if (matches.length === 1) {
      lines.push({ offerId: item.offerId, optionName: item.optionName, quantity: matches[0].quantity, unitPriceCny: matches[0].unitPriceCny, groupId: matches[0].groupId });
      groupElements.set(matches[0].groupId, matches[0].group);
    }
  }
  const sellerGroups = [];
  for (const [groupId, group] of groupElements) {
    const groupText = String(group.innerText || "").replace(/\s+/g, " ");
    const free = /包邮|免运费/.test(groupText);
    const match = groupText.match(/(?:运费|配送费|物流费)\s*[:：]?\s*(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)/);
    sellerGroups.push({ groupId, domesticFreightCny: free ? 0 : match ? Number(match[1]) : null });
  }
  const bodyText = document.body?.innerText || "";
  return {
    href: location.href,
    forbiddenOrderControlPresent: Array.from(document.querySelectorAll("button,a,[role='button'],q-button,.button-wrapper")).some((element) => forbiddenOrderText.test(String(element.textContent || ""))),
    loginRequired: /passport\.1688\.com|login\.1688\.com/i.test(location.href),
    securityChallenge: /滑块|安全验证|验证码|异常流量|슬라이더|보안 인증|인증을 완료|밀어서 확인|정상 접속/.test(bodyText.slice(0, 2500)),
    lines,
    sellerGroups,
  };
}

export const ALIBABA1688_OFFER_PROBE_EXPRESSION = `(${offerProbe.toString()})()`;

export function buildAlibaba1688CheckoutProbeExpression(items, shippingSelections = []) {
  return `(${checkoutSnapshotProbe.toString()})(${JSON.stringify(items)},${JSON.stringify(shippingSelections)})`;
}

export const ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION = `(${checkoutShippingOptionsProbe.toString()})()`;
export const ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION = `(${checkoutSubmitOrderProbe.toString()})()`;
export const ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION = `(${paymentSelectionProbe.toString()})()`;

export function createAlibaba1688CartBrowserAdapter(config, dependencies = {}) {
  const connect = dependencies.withBrowserCdpTarget || withBrowserCdpTarget;
  let lastTarget = null;

  async function withSession(firstUrl, handler) {
    const target = lastTarget || await ensure1688Target(config, firstUrl, dependencies);
    lastTarget = target;
    return connect(config, target, handler, { timeoutMs: DEFAULT_TIMEOUT_MS });
  }

  async function inspectOffers(items) {
    const unique = [...new Map(items.map((item) => [item.offerId, item])).values()];
    // Start each task-5 run in its own window. Reusing an arbitrary old 1688 tab
    // can inherit a renderer that is stuck even though the offer opens normally
    // in a fresh window.
    let target = await create1688WindowTarget(config, unique[0]?.offerUrl || CART_URL, dependencies);
    lastTarget = target;
    const inspections = [];
    for (const item of unique) {
      let value = null;
      for (let freshTargetAttempt = 0; freshTargetAttempt <= SECURITY_CHALLENGE_FRESH_TARGET_RETRIES; freshTargetAttempt += 1) {
        value = await connect(config, target, async (session) => {
          let value = await inspectLoadedOffer(session, item);
          if (value?.blockedReason === "SECURITY_CHALLENGE") {
            await (dependencies.activateChromeTarget || activateChromeTarget)(config, target, {
              timeoutMs: 5_000,
            }).catch(() => null);
            value = await waitForOfferSecurityChallenge(session, item, value);
          }
          return value;
        }, { timeoutMs: OFFER_NAVIGATION_TIMEOUT_MS + SECURITY_CHALLENGE_WAIT_MS });

        if (!value?.freshTargetRequired) break;
        if (freshTargetAttempt >= SECURITY_CHALLENGE_FRESH_TARGET_RETRIES) break;

        const failedTarget = target;
        target = await create1688WindowTarget(config, item.offerUrl, dependencies);
        lastTarget = target;
        await (dependencies.activateChromeTarget || activateChromeTarget)(config, target, {
          timeoutMs: 5_000,
        }).catch(() => null);
        await close1688Target(config, failedTarget, dependencies);
      }

      if (value?.freshTargetRequired) {
        value = { ...value, freshTargetRequired: false };
      }
      inspections.push({ offerId: item.offerId, ...value });
      if (value?.loginRequired || value?.blockedReason === "SECURITY_CHALLENGE") break;
    }
    if (inspections.some((inspection) => (
      inspection.loginRequired || inspection.blockedReason === "SECURITY_CHALLENGE"
    ))) {
      await (dependencies.activateChromeTarget || activateChromeTarget)(config, target, {
        timeoutMs: 5_000,
      }).catch(() => null);
    }
    return inspections;
  }

  async function readCart(items) {
    return withSession(CART_URL, async (session) => {
      await navigate(session, CART_URL);
      let value = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        value = await evaluate(session, `(${cartSnapshotProbe.toString()})(${JSON.stringify(items)})`);
        if (value?.loginRequired || value?.securityChallenge || value?.lines?.length > 0) break;
        await sleep(500);
      }
      if (value?.loginRequired) fail("ALIBABA1688_LOGIN_REQUIRED", "1688 로그인이 필요합니다.");
      if (value?.securityChallenge) fail("ALIBABA1688_SECURITY_CHALLENGE", "1688 보안 확인을 사용자가 완료해야 합니다.");
      return value.lines || [];
    });
  }

  async function applyActions(actions) {
    if (!actions.length) return;
    return withSession(actions[0]?.item?.offerUrl || CART_URL, async (session) => {
      for (const action of actions) {
        if (action.type === "KEEP") continue;
        if (action.type === "ADD") {
          const inspection = await inspectLoadedOffer(session, action.item);
          if (inspection?.loginRequired) fail("ALIBABA1688_LOGIN_REQUIRED", "1688 로그인이 필요합니다.");
          if (inspection?.blockedReason === "SECURITY_CHALLENGE") fail("ALIBABA1688_SECURITY_CHALLENGE", "1688 보안 확인을 사용자가 완료해야 합니다.");
          if (inspection?.blockedReason === "OFFER_OFFLINE") fail("ALIBABA1688_OFFER_OFFLINE", "1688 상품이 404 또는 판매중단 상태입니다.", { offerId: action.item.offerId });
          const prepared = await evaluate(session, `(${preparePerSkuQuantityProbe.toString()})(${JSON.stringify(action.item)})`, DEFAULT_TIMEOUT_MS, true);
          let result;
          if (prepared?.handled) {
            if (!prepared.ok) fail(`ALIBABA1688_${prepared?.code || "ADD_FAILED"}`, "1688 상품 옵션을 정확히 선택하지 못했습니다.", prepared || {});
            await session.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              modifiers: 2,
              key: "a",
              code: "KeyA",
              windowsVirtualKeyCode: 65,
            }, DEFAULT_TIMEOUT_MS);
            await session.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              modifiers: 2,
              key: "a",
              code: "KeyA",
              windowsVirtualKeyCode: 65,
            }, DEFAULT_TIMEOUT_MS);
            await session.send("Input.insertText", { text: String(action.item.quantity) }, DEFAULT_TIMEOUT_MS);
            await session.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            }, DEFAULT_TIMEOUT_MS);
            await session.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            }, DEFAULT_TIMEOUT_MS);
            await sleep(350);
            result = await evaluate(session, `(${clickPreparedPerSkuAddProbe.toString()})(${JSON.stringify(action.item)})`, DEFAULT_TIMEOUT_MS, true);
            if (result?.ok && result?.buttonCenter) {
              await session.send("Input.dispatchMouseEvent", {
                type: "mousePressed",
                x: result.buttonCenter.x,
                y: result.buttonCenter.y,
                button: "left",
                clickCount: 1,
              }, DEFAULT_TIMEOUT_MS);
              await session.send("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x: result.buttonCenter.x,
                y: result.buttonCenter.y,
                button: "left",
                clickCount: 1,
              }, DEFAULT_TIMEOUT_MS);
              result = { ...result, clicked: true };
            }
          } else {
            result = await evaluate(session, `(${addVariantProbe.toString()})(${JSON.stringify(action.item)})`, DEFAULT_TIMEOUT_MS, true);
          }
          if (!result?.ok) fail(`ALIBABA1688_${result?.code || "ADD_FAILED"}`, "1688 상품을 장바구니에 정확히 담지 못했습니다.", result || {});
          await sleep(900);
          continue;
        }
        await navigate(session, CART_URL);
        const result = await evaluate(session, `(${setCartQuantityProbe.toString()})(${JSON.stringify(action)})`, DEFAULT_TIMEOUT_MS, true);
        if (!result?.ok) fail(`ALIBABA1688_${result?.code || "QUANTITY_SET_FAILED"}`, "1688 장바구니 수량을 정확히 맞추지 못했습니다.", result || {});
        await sleep(900);
      }
    });
  }

  async function readCheckoutPreview(items) {
    return withSession(CART_URL, async (session) => {
      await navigate(session, CART_URL);
      let selected = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        selected = await evaluate(session, `(${selectTargetsAndPreviewProbe.toString()})(${JSON.stringify(items)},false)`, DEFAULT_TIMEOUT_MS, true);
        if (selected?.ok) break;
        if (selected?.code !== "TARGET_ROW_MATCH_COUNT_INVALID" || Number(selected?.count) !== 0) break;
        await sleep(500);
      }
      if (!selected?.ok) fail(`ALIBABA1688_${selected?.code || "PREVIEW_START_FAILED"}`, "대상 품목만 선택한 주문 미리보기를 열지 못했습니다.", selected || {});
      const selectionAttemptLimit = Math.max(10, Number(selected.cartRowCount || 0) * 2 + 5);
      for (let attempt = 0; attempt < selectionAttemptLimit && selected.checkboxClicks?.length > 0; attempt += 1) {
        const toggled = await evaluate(session, `(${selectTargetsAndPreviewProbe.toString()})(${JSON.stringify(items)},true)`, DEFAULT_TIMEOUT_MS, true);
        if (!toggled?.ok) fail(`ALIBABA1688_${toggled?.code || "PREVIEW_START_FAILED"}`, "대상 품목 체크박스를 변경하지 못했습니다.", toggled || {});
        await sleep(250);
        selected = await evaluate(session, `(${selectTargetsAndPreviewProbe.toString()})(${JSON.stringify(items)},false)`, DEFAULT_TIMEOUT_MS, true);
        if (!selected?.ok) fail(`ALIBABA1688_${selected?.code || "PREVIEW_START_FAILED"}`, "대상 품목만 선택한 주문 미리보기를 열지 못했습니다.", selected || {});
      }
      if (selected.checkboxClicks?.length > 0) {
        fail("ALIBABA1688_TARGET_SELECTION_FAILED", "1688 장바구니에서 대상 품목만 선택하지 못했습니다.", selected);
      }
      // Checkbox changes re-render the sticky cart footer. Read its coordinates only
      // after that render settles; otherwise the trusted mouse click can hit stale pixels.
      await sleep(900);
      let preview = null;
      let lastState = null;
      for (let clickAttempt = 0; clickAttempt < 2 && !preview?.forbiddenOrderControlPresent; clickAttempt += 1) {
        const settlement = await evaluate(session, `(${settlementButtonProbe.toString()})(false)`, 3_000);
        if (!settlement?.ok || !settlement?.buttonCenter) {
          fail(`ALIBABA1688_${settlement?.code || "SETTLEMENT_CONTROL_MISSING"}`, "1688 장바구니 결제 전 확인 버튼을 찾지 못했습니다.", settlement || {});
        }
        if (settlement.disabled) {
          fail("ALIBABA1688_SETTLEMENT_CONTROL_DISABLED", "1688 장바구니 결제 전 확인 버튼이 비활성 상태입니다.", settlement);
        }
        const clickedSettlement = await evaluate(session, `(${settlementButtonProbe.toString()})(true)`, 3_000, true);
        if (!clickedSettlement?.clicked) {
          fail("ALIBABA1688_SETTLEMENT_CLICK_FAILED", "1688 장바구니 결제 전 확인 버튼을 누르지 못했습니다.", clickedSettlement || {});
        }

        for (let attempt = 0; attempt < 40; attempt += 1) {
          await sleep(500);
          lastState = await evaluate(session, `({ href: location.href, readyState: document.readyState })`, 1_500).catch(() => null) || lastState;
          const onCheckout = /\/order\/smart_make_order\.htm/i.test(String(lastState?.href || ""));
          if (onCheckout) {
            preview = await evaluate(session, buildAlibaba1688CheckoutProbeExpression(items), 3_000).catch(() => null);
            if (preview?.loginRequired || preview?.securityChallenge || preview?.forbiddenOrderControlPresent) break;
            continue;
          }
          // A cart click that did not navigate is safe to retry once. Never retry
          // after reaching the order-confirmation page.
          if (attempt >= 7 && /cart\.1688\.com\/cart\.htm/i.test(String(lastState?.href || ""))) break;
        }
        if (/\/order\/smart_make_order\.htm/i.test(String(lastState?.href || ""))) break;
        await sleep(600);
      }
      if (preview?.loginRequired) fail("ALIBABA1688_LOGIN_REQUIRED", "1688 로그인이 필요합니다.");
      if (preview?.securityChallenge) fail("ALIBABA1688_SECURITY_CHALLENGE", "1688 보안 확인을 사용자가 완료해야 합니다.");
      if (!preview?.forbiddenOrderControlPresent) {
        fail("ALIBABA1688_ORDER_PREVIEW_NOT_CONFIRMED", "1688 주문 확인 화면인지 검증하지 못했습니다.", { lastState });
      }
      let shipping;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        shipping = await evaluate(session, ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, 3_000);
        if (shipping?.methodLabelsPresent || shipping?.groups?.length) break;
        await sleep(400);
      }
      if (shipping?.methodLabelsPresent && !shipping?.groups?.length) {
        fail("ALIBABA1688_SHIPPING_CONTROL_AMBIGUOUS", "1688 배송방식이 보이지만 안전하게 구분하지 못했습니다.", { shipping });
      }
      const decisions = shipping.groups.map((group) => chooseAlibaba1688ShippingPreference(group));
      if (decisions.some((decision) => !decision.ok)) {
        fail("ALIBABA1688_SHIPPING_PRICE_UNAVAILABLE", "1688 배송방식별 운임을 비교하지 못했습니다.", { shipping });
      }
      const methodActions = shipping.groups.map((group, index) => {
        const decision = decisions[index];
        const alreadySelected = decision.method === "OFFICIAL" ? group.official.selected : group.merchant.selected;
        return alreadySelected ? {} : { method: decision.method };
      });
      if (methodActions.some((action) => action.method)) {
        const selectedMethods = await evaluate(session, `(${checkoutShippingOptionsProbe.toString()})(${JSON.stringify(methodActions)})`, 3_000, true);
        if (selectedMethods.groups.some((group, index) => methodActions[index]?.method && !group.actionClicked)) {
          fail("ALIBABA1688_SHIPPING_CONTROL_MISSING", "1688 배송방식 선택 컨트롤을 누르지 못했습니다.", { selectedMethods });
        }
      }
      await sleep(900);
      shipping = await evaluate(session, ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, 3_000);
      if (shipping.groups.length !== decisions.length) {
        fail("ALIBABA1688_SHIPPING_GROUP_COUNT_CHANGED", "1688 배송그룹 수가 선택 중 변경되었습니다.", {
          expected: decisions.length,
          actual: shipping.groups.length,
        });
      }
      const tierActions = shipping.groups.map((group, index) => {
        const standard = group.tiers?.find((tier) => tier.code === "STANDARD" && tier.available);
        return decisions[index]?.tier === "STANDARD" && !standard?.selected ? { tier: "STANDARD" } : {};
      });
      if (tierActions.some((action) => action.tier)) {
        const selectedTiers = await evaluate(session, `(${checkoutShippingOptionsProbe.toString()})(${JSON.stringify(tierActions)})`, 3_000, true);
        if (selectedTiers.groups.some((group, index) => tierActions[index]?.tier && !group.actionClicked)) {
          fail("ALIBABA1688_SHIPPING_CONTROL_MISSING", "1688 표준 배송등급을 누르지 못했습니다.", { selectedTiers });
        }
      }
      await sleep(900);
      const verifiedShipping = await evaluate(session, ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, 3_000);
      if (verifiedShipping.groups.length !== decisions.length) {
        fail("ALIBABA1688_SHIPPING_GROUP_COUNT_CHANGED", "1688 배송그룹 수가 선택 후 변경되었습니다.", {
          expected: decisions.length,
          actual: verifiedShipping.groups.length,
        });
      }
      for (let index = 0; index < verifiedShipping.groups.length; index += 1) {
        const group = verifiedShipping.groups[index];
        const decision = decisions[index];
        const methodSelected = decision.method === "OFFICIAL" ? group.official.selected : group.merchant.selected;
        const tierSelected = decision.tier !== "STANDARD"
          || group.tiers.some((tier) => tier.code === "STANDARD" && tier.selected);
        if (!methodSelected || !tierSelected) {
          fail("ALIBABA1688_SHIPPING_SELECTION_NOT_CONFIRMED", "1688 배송방식과 표준 등급 선택을 확인하지 못했습니다.", {
            expected: decision,
            actual: group,
          });
        }
      }
      preview = await evaluate(session, buildAlibaba1688CheckoutProbeExpression(items, decisions), 3_000);
      return { ...preview, shippingSelections: decisions };
    });
  }

  async function submitCheckoutOrder(expected = {}) {
    const target = lastTarget || await ensure1688Target(config, CART_URL, dependencies);
    lastTarget = target;
    return connect(config, target, async (session) => {
      const prepared = await evaluate(session, ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION, 3_000);
      if (!prepared?.ok || !prepared?.buttonCenter) {
        fail(`ALIBABA1688_${prepared?.code || "ORDER_SUBMIT_CONTROL_MISSING"}`, "1688 주문 제출 버튼을 정확히 찾지 못했습니다.", {
          ...(prepared || {}),
          submissionAttempted: false,
        });
      }
      if (!/\/order\/smart_make_order\.htm/i.test(String(prepared.href || ""))) {
        fail("ALIBABA1688_ORDER_CONFIRMATION_PAGE_REQUIRED", "1688 주문 확인 화면이 아니어서 주문 제출을 중단했습니다.", {
          ...prepared,
          submissionAttempted: false,
        });
      }
      if (prepared.disabled) {
        fail("ALIBABA1688_ORDER_SUBMIT_CONTROL_DISABLED", "1688 주문 제출 버튼이 비활성 상태입니다.", {
          ...prepared,
          submissionAttempted: false,
        });
      }
      const expectedTotalCny = Number(expected.totalCny);
      const finalSnapshot = await evaluate(session, buildAlibaba1688CheckoutProbeExpression(
        Array.isArray(expected.items) ? expected.items : [],
        Array.isArray(expected.shippingSelections) ? expected.shippingSelections : [],
      ), 3_000);
      const actualProductTotalCny = (finalSnapshot?.lines || [])
        .reduce((sum, line) => sum + Number(line?.unitPriceCny || 0) * Number(line?.quantity || 0), 0);
      const actualDomesticFreightCny = (finalSnapshot?.sellerGroups || [])
        .reduce((sum, group) => sum + Number(group?.domesticFreightCny || 0), 0);
      const actualSnapshotTotalCny = actualProductTotalCny + actualDomesticFreightCny;
      const buttonTotalMismatch = Number.isFinite(prepared.totalCny)
        && Math.abs(prepared.totalCny - expectedTotalCny) > 0.011;
      if (!Number.isFinite(expectedTotalCny)
        || !finalSnapshot?.forbiddenOrderControlPresent
        || Math.abs(actualSnapshotTotalCny - expectedTotalCny) > 0.011
        || buttonTotalMismatch) {
        fail("ALIBABA1688_ORDER_TOTAL_MISMATCH", "1688 주문 제출 버튼의 최종금액이 검증한 상품금액과 운임 합계와 다릅니다.", {
          expectedTotalCny,
          actualButtonTotalCny: prepared.totalCny,
          actualProductTotalCny,
          actualDomesticFreightCny,
          actualSnapshotTotalCny,
          label: prepared.label,
          submissionAttempted: false,
        });
      }
      const submitted = await evaluate(
        session,
        `(${checkoutSubmitOrderProbe.toString()})(true)`,
        3_000,
        true,
      );
      if (!submitted?.ok || !submitted?.clicked) {
        fail("ALIBABA1688_ORDER_SUBMIT_CLICK_FAILED", "1688 주문 제출 버튼을 누르지 못했습니다.", {
          submissionAttempted: false,
          submitted,
        });
      }

      let lastState = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(500);
        lastState = await evaluate(session, ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION, 2_000).catch(() => null) || lastState;
        if (lastState?.loginRequired) {
          fail("ALIBABA1688_LOGIN_REQUIRED", "1688 주문 제출 후 로그인이 다시 필요합니다.", {
            submissionAttempted: true,
            lastState,
          });
        }
        if (lastState?.securityChallenge) {
          fail("ALIBABA1688_SECURITY_CHALLENGE", "1688 주문 제출 후 보안 확인을 사용자가 완료해야 합니다.", {
            submissionAttempted: true,
            lastState,
          });
        }
        if (lastState?.paymentSelectionConfirmed) {
          return {
            ...lastState,
            submissionAttempted: true,
            productTotalCny: Number(expected.productTotalCny || 0),
            domesticFreightCny: Number(expected.domesticFreightCny || 0),
            totalCny: Number(expected.totalCny || 0),
            paymentExecuted: false,
          };
        }
      }
      fail("ALIBABA1688_ORDER_SUBMIT_OUTCOME_UNKNOWN", "1688 주문 제출 후 결제수단 선택 화면을 확인하지 못했습니다. 자동으로 다시 누르지 말고 미결제 주문을 확인하세요.", {
        submissionAttempted: true,
        lastState,
      });
    }, { timeoutMs: 75_000 });
  }

  return { inspectOffers, readCart, applyActions, readCheckoutPreview, submitCheckoutOrder };
}

export const ALIBABA1688_FORBIDDEN_ORDER_TEXT = FORBIDDEN_ORDER_TEXT;
