import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  shoplingTargets,
  withCdpTarget,
} from "./chrome-cdp.mjs";

const BASE_URL = "https://a.shopling.co.kr";
const ROUTES = {
  collection: "/order/ord_gather.phtml",
  mapping: "/order/mapping2/order_mapping_1n_Lst.phtml",
  mappingAction: "/order/mapping2/order_map_act.phtml",
  orders: "/order/order_list.phtml",
  courier: "/order/dlvy_list.phtml",
  labelSettings: "/order/dlvy_print_setting.phtml",
};

const COLLECTION_JOBS = [
  {
    key: "orders",
    functionName: "order_gather_submit_sp",
    confirmation: "주문수집 하시겠습니까?",
    popupPath: "/order/order_gather_act_sp.phtml",
  },
  {
    key: "claims",
    functionName: "claim_gather_submit_sp",
    confirmation: "클레임수집 하시겠습니까?",
    popupPath: "/claim/claim_gather_act_sp.phtml",
  },
  {
    key: "questions",
    functionName: "qna_gather_submit_sp",
    confirmation: "문의수집 하시겠습니까?",
    popupPath: "/qna/qna_gather_act_sp.phtml",
  },
];

const AUTO_PACKAGE_LABEL = "우편번호 + 주소 + 수취인 + 전화번호 + 쇼핑몰명";
const COURIER_LABEL_FRAGMENT = "도소매사우루스";
const DEFAULT_TIMEOUT_MS = 15_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function codedError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function pagePath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function normalizeOrderNumbers(values) {
  const normalized = [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (normalized.some((value) => !/^\d+$/.test(value))) {
    throw codedError("Shopling returned an invalid order number.", "SHOPLING_ORDER_NUMBER_INVALID");
  }
  return normalized;
}

async function evaluate(session, expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Shopling page evaluation failed.";
    throw codedError(exception, "SHOPLING_PAGE_EVALUATION_FAILED");
  }
  return result.result?.value;
}

async function waitForDocument(session, expectedPath, options = {}) {
  const timeoutMs = options.timeoutMs || 30_000;
  const deadline = Date.now() + timeoutMs;
  let stableReads = 0;
  let previousSignature = "";
  while (Date.now() < deadline) {
    const state = await evaluate(session, `(() => ({
      path: location.pathname,
      readyState: document.readyState,
      signature: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000),
    }))()`, 5_000).catch(() => null);
    if (state?.path === expectedPath && state.readyState === "complete") {
      if (state.signature === previousSignature) stableReads += 1;
      else stableReads = 1;
      previousSignature = state.signature;
      if (stableReads >= (options.stableReads || 2)) return state;
    } else {
      stableReads = 0;
      previousSignature = "";
    }
    await sleep(options.pollMs || 300);
  }
  throw codedError(`Shopling page did not settle at ${expectedPath}.`, "SHOPLING_PAGE_LOAD_TIMEOUT");
}

async function navigate(session, path, options = {}) {
  await session.send("Page.enable", {}, 5_000).catch(() => null);
  await session.send("Page.navigate", { url: `${BASE_URL}${path}` }, 10_000);
  return waitForDocument(session, path, options);
}

async function waitAfterSubmit(session, path, options = {}) {
  await sleep(options.initialDelayMs || 500);
  return waitForDocument(session, path, options);
}

function exactDialogInvocation(functionName, expectedMessage) {
  return `(() => {
    const operation = globalThis[${JSON.stringify(functionName)}];
    if (typeof operation !== 'function') throw new Error('SHOPLING_OPERATION_MISSING:${functionName}');
    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    let confirmed = false;
    window.confirm = (message) => {
      const actual = String(message || '').replace(/\\s+/g, ' ').trim();
      const expected = ${JSON.stringify(expectedMessage)}.replace(/\\s+/g, ' ').trim();
      if (actual !== expected) throw new Error('SHOPLING_CONFIRMATION_MISMATCH:' + actual);
      confirmed = true;
      return true;
    };
    window.alert = (message) => { throw new Error('SHOPLING_UNEXPECTED_ALERT:' + String(message || '')); };
    try {
      operation();
      if (!confirmed) throw new Error('SHOPLING_CONFIRMATION_NOT_SHOWN');
      return true;
    } finally {
      window.confirm = originalConfirm;
      window.alert = originalAlert;
    }
  })()`;
}

function prefixDialogInvocation(functionName, expectedPrefix) {
  return `(() => {
    const operation = globalThis[${JSON.stringify(functionName)}];
    if (typeof operation !== 'function') throw new Error('SHOPLING_OPERATION_MISSING:${functionName}');
    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    let confirmed = false;
    window.confirm = (message) => {
      const actual = String(message || '').replace(/\\s+/g, ' ').trim();
      const prefix = ${JSON.stringify(expectedPrefix)}.replace(/\\s+/g, ' ').trim();
      if (!actual.startsWith(prefix)) throw new Error('SHOPLING_CONFIRMATION_MISMATCH:' + actual);
      confirmed = true;
      return true;
    };
    window.alert = (message) => { throw new Error('SHOPLING_UNEXPECTED_ALERT:' + String(message || '')); };
    try {
      operation();
      if (!confirmed) throw new Error('SHOPLING_CONFIRMATION_NOT_SHOWN');
      return true;
    } finally {
      window.confirm = originalConfirm;
      window.alert = originalAlert;
    }
  })()`;
}

async function listTargets(config, dependencies) {
  const listing = await (dependencies.listChromeTargets || listChromeTargets)(config);
  if (!listing.available) throw codedError("Dedicated Chrome DevTools is unavailable.", "CHROME_CDP_UNAVAILABLE");
  return listing.targets || [];
}

async function selectControlTarget(config, dependencies) {
  const candidates = shoplingTargets(await listTargets(config, dependencies), config.shoplingOrigins)
    .filter((target) => ![ROUTES.mappingAction, ROUTES.labelSettings].includes(pagePath(target.url)));
  const priority = [ROUTES.courier, ROUTES.orders, ROUTES.mapping, ROUTES.collection];
  const target = [...candidates].sort((left, right) => {
    const leftRank = priority.indexOf(pagePath(left.url));
    const rightRank = priority.indexOf(pagePath(right.url));
    return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
  })[0];
  if (!target) throw codedError("A logged-in Shopling page was not found in dedicated Chrome.", "SHOPLING_CONTROL_TARGET_MISSING");
  return target;
}

export function matchesExpectedShoplingAccount(frameResults, expectedAccount) {
  const expectedMarker = `[${String(expectedAccount || "").trim()}]`;
  return expectedMarker !== "[]"
    && (frameResults || []).some((entry) => entry?.value?.path !== "/login.phtml"
      && String(entry?.value?.header || "").includes(expectedMarker));
}

async function assertAccount(session, expectedAccount) {
  const states = await evaluateCdpExpressionAcrossFrames(session, `(() => ({
    path: location.pathname,
    header: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1000),
  }))()`, { timeoutMs: 5_000 });
  if (!matchesExpectedShoplingAccount(states, expectedAccount)) {
    throw codedError(`Shopling is not logged in as ${expectedAccount}.`, "SHOPLING_ACCOUNT_MISMATCH");
  }
}

async function withControlSession(config, options, dependencies, handler) {
  const target = await selectControlTarget(config, dependencies);
  const runWithTarget = dependencies.withCdpTarget || withCdpTarget;
  return runWithTarget(target, async (session) => {
    await assertAccount(session, options.account);
    return handler(session);
  }, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
}

export function isShoplingCollectionPopupComplete(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return /수집 결과입니다/.test(normalized)
    && /총\s*\d+\s*건중/.test(normalized)
    && /수집 되었습니다/.test(normalized)
    && !/수집중입니다|처리중입니다/.test(normalized);
}

export function isShoplingQnaContinuationScreen(path, text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return path === "/qna/qna_gather_act_sp.phtml"
    && normalized.includes("문의수집중")
    && normalized.includes("지원 쇼핑몰 문의수집 계속하기");
}

export function isExpectedShoplingCollectionPopupPath(actualPath, popupPath) {
  const kind = String(popupPath || "").split("/").filter(Boolean)[0];
  if (!["order", "claim", "qna"].includes(kind)) return actualPath === popupPath;
  return actualPath === popupPath || actualPath === `/${kind}_a/${kind}_gather.phtml`;
}

export function canTreatCollectionPopupClosureAsComplete(progress) {
  return progress?.hasResult === true
    && progress?.hasTotal === true
    && progress?.hasCollected === true;
}

async function waitForPopup(config, dependencies, popupPath, options = {}) {
  const timeoutMs = options.timeoutMs || 180_000;
  const deadline = Date.now() + timeoutMs;
  const isCollectionPopup = /\/(?:order|claim|qna)\/\w+_gather_act_sp\.phtml$/.test(popupPath);
  let collectionState = null;
  let collectionProgress = null;
  let qnaContinuationClicked = false;
  const finish = async (state, closed = false) => {
    const statusCounts = (String(state?.signature || "").match(/완료|성공|실패/g) || []).reduce((counts, status) => {
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    return { path: popupPath, settled: true, closed, statusCounts };
  };
  while (Date.now() < deadline) {
    const matches = (await listTargets(config, dependencies)).filter((target) => {
      if (target.type !== "page") return false;
      const path = pagePath(target.url);
      return isCollectionPopup
        ? isExpectedShoplingCollectionPopupPath(path, popupPath)
        : path === popupPath;
    });
    if (matches.length > 1) throw codedError(`Multiple Shopling popups opened for ${popupPath}.`, "SHOPLING_POPUP_TARGET_COUNT_INVALID");
    if (!matches.length && isCollectionPopup && canTreatCollectionPopupClosureAsComplete(collectionProgress)) {
      return finish(collectionState, true);
    }
    if (matches.length === 1) {
      const runWithTarget = dependencies.withCdpTarget || withCdpTarget;
      if (isCollectionPopup) {
        const state = await runWithTarget(matches[0], async (session) => evaluate(session, `(() => ({
          path: location.pathname,
          readyState: document.readyState,
          signature: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50000),
          controlLabels: Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],a'))
            .map((element) => String(element.textContent || element.value || '').replace(/\\s+/g, ' ').trim())
            .filter(Boolean),
        }))()`, 5_000), { timeoutMs: 8_000 }).catch(() => null);
        if (state) {
          collectionState = state;
          const signature = String(state.signature || "");
          const qnaContinuationText = [signature, ...(state.controlLabels || [])].join(" ");
          if (!qnaContinuationClicked && isShoplingQnaContinuationScreen(state.path, qnaContinuationText)) {
            const continued = await runWithTarget(matches[0], async (session) => evaluate(session, `(() => {
              const label = '지원 쇼핑몰 문의수집 계속하기';
              const matches = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],a'))
                .filter((element) => String(element.textContent || element.value || '').replace(/\\s+/g, ' ').trim() === label);
              if (matches.length !== 1) return { error: 'SHOPLING_QNA_CONTINUE_BUTTON_COUNT_INVALID', matchCount: matches.length };
              matches[0].click();
              return { clicked: true };
            })()`, 5_000), { timeoutMs: 8_000 });
            if (continued?.error) {
              throw codedError("The QnA collection continuation button was not unique.", continued.error, continued);
            }
            qnaContinuationClicked = true;
            await sleep(700);
            continue;
          }
          collectionProgress = {
            path: state.path || "",
            readyState: state.readyState || "",
            textLength: signature.length,
            hasResult: /수집 결과입니다/.test(signature),
            hasTotal: /총\s*\d+\s*건중/.test(signature),
            hasCollected: /수집 되었습니다/.test(signature),
            hasQueuedRequests: /수집 요청중입니다/.test(signature),
            queuedRequestCount: (signature.match(/수집 요청중입니다/g) || []).length,
            hasActiveProcessing: /수집중입니다|처리중입니다/.test(signature),
            activeProcessingCount: (signature.match(/수집중입니다|처리중입니다/g) || []).length,
          };
          if (state.readyState === "complete" && isShoplingCollectionPopupComplete(signature)) {
            await runWithTarget(matches[0], async (session) => {
              await session.send("Page.close", {}, 5_000).catch(() => null);
            }, { timeoutMs: 8_000 }).catch(() => null);
            return finish(state);
          }
        }
        await sleep(700);
        continue;
      }
      return runWithTarget(matches[0], async (session) => {
        const remainingMs = Math.max(5_000, deadline - Date.now());
        const state = await waitForDocument(session, popupPath, { timeoutMs: remainingMs, stableReads: 3, pollMs: 700 });
        await evaluate(session, "window.close(); true", 5_000).catch(() => null);
        return finish(state);
      }, { timeoutMs: Math.max(5_000, deadline - Date.now()) });
    }
    await sleep(300);
  }
  if (isCollectionPopup) {
    throw codedError(
      `Shopling collection popup did not complete at ${popupPath}: ${JSON.stringify(collectionProgress)}`,
      "SHOPLING_COLLECTION_POPUP_TIMEOUT",
    );
  }
  throw codedError(`Shopling popup did not open for ${popupPath}.`, "SHOPLING_POPUP_OPEN_TIMEOUT");
}

function resultRowsExpression(status = "") {
  return `(() => {
    const rows = Array.from(document.querySelectorAll('input[name="chk[]"]'))
      .map((checkbox) => {
        const statusInput = checkbox.closest('tr')?.querySelector('input[name^="ord_status_"]');
        const statusOrderNumber = String(statusInput?.name || '').replace(/^ord_status_/, '');
        return {
          orderNumber: /^\\d+$/.test(statusOrderNumber) ? statusOrderNumber : String(checkbox.value || '').trim(),
          status: String(checkbox.getAttribute('stcd') || statusInput?.value || ''),
        };
      })
      .filter((row) => /^\\d+$/.test(row.orderNumber))
      .filter((row) => ${JSON.stringify(status)} === '' || row.status === ${JSON.stringify(status)});
    const match = String(document.body?.innerText || '').match(/총\\s*조회수\\s*:?\\s*([0-9,]+)\\s*건/);
    return { rows, resultCount: match ? Number(match[1].replace(/,/g, '')) : rows.length };
  })()`;
}

async function queryMapping(session, type) {
  await navigate(session, ROUTES.mapping);
  await evaluate(session, `(() => {
    if (typeof map_srch !== 'function') throw new Error('SHOPLING_MAPPING_SEARCH_MISSING');
    map_srch(${JSON.stringify(type)});
    return true;
  })()`);
  await waitAfterSubmit(session, ROUTES.mapping);
  const result = await evaluate(session, resultRowsExpression());
  return { count: result.rows.length, orderNumbers: normalizeOrderNumbers(result.rows.map((row) => row.orderNumber)) };
}

async function queryB7NewOrders(session, date) {
  await navigate(session, ROUTES.orders);
  await evaluate(session, `(() => {
    const set = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('SHOPLING_CONTROL_MISSING:' + selector);
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('select[name="srch_dt"]', 'scrap_date');
    set('#s_dt', ${JSON.stringify(date)});
    set('#e_dt', ${JSON.stringify(date)});
    set('#row_cnt', '1000');
    const statuses = Array.from(document.querySelectorAll('input[name="ord_status_multi[]"]'));
    statuses.forEach((input) => { input.checked = input.value === 'A01'; });
    const button = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]'))
      .find((element) => String(element.textContent || element.value || '').trim() === '검색');
    if (!button) throw new Error('SHOPLING_SEARCH_BUTTON_MISSING');
    button.click();
    return true;
  })()`);
  await waitAfterSubmit(session, ROUTES.orders);
  const result = await evaluate(session, resultRowsExpression("A01"));
  return { count: result.rows.length, orderNumbers: normalizeOrderNumbers(result.rows.map((row) => row.orderNumber)) };
}

async function queryB12(session, date, status, options = {}) {
  await navigate(session, ROUTES.courier);
  await evaluate(session, `(() => {
    const set = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('SHOPLING_CONTROL_MISSING:' + selector);
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('select[name="srch_dt"]', 'srch_dt_i_dt');
    set('#s_dt', ${JSON.stringify(date)});
    set('#e_dt', ${JSON.stringify(date)});
    set('#row_cnt', '1000');
    set('#dlvy_status_tp', ${JSON.stringify(status)});
    set('select[name="sort_tp"]', ${JSON.stringify(options.sort ? "sort_tp_ptn_opt_cd" : "sort_tp_i_dt")});
    set('#sort', 'asc');
    set('select[name="sort_tp_second"]', ${JSON.stringify(options.sort ? "A" : "")});
    set('select[name="sort_second"]', 'asc');
    if (typeof srch_submit !== 'function') throw new Error('SHOPLING_SEARCH_FUNCTION_MISSING');
    srch_submit();
    return true;
  })()`);
  await waitAfterSubmit(session, ROUTES.courier);
  const result = await evaluate(session, resultRowsExpression());
  return { count: result.rows.length, orderNumbers: normalizeOrderNumbers(result.rows.map((row) => row.orderNumber)) };
}

function exactSelectionExpression(orderNumbers) {
  return `(() => {
    const expected = new Set(${JSON.stringify(normalizeOrderNumbers(orderNumbers))});
    const checks = Array.from(document.querySelectorAll('input[name="chk[]"]'));
    checks.forEach((checkbox) => { checkbox.checked = false; });
    for (const checkbox of checks) {
      const statusOrderNumber = String(checkbox.closest('tr')?.querySelector('input[name^="ord_status_"]')?.name || '').replace(/^ord_status_/, '');
      const value = /^\\d+$/.test(statusOrderNumber) ? statusOrderNumber : String(checkbox.value || '').trim();
      if (expected.has(value)) checkbox.checked = true;
    }
    const selected = checks.filter((checkbox) => checkbox.checked).map((checkbox) => {
      const statusOrderNumber = String(checkbox.closest('tr')?.querySelector('input[name^="ord_status_"]')?.name || '').replace(/^ord_status_/, '');
      return /^\\d+$/.test(statusOrderNumber) ? statusOrderNumber : String(checkbox.value || '').trim();
    });
    if (selected.length !== expected.size || selected.some((value) => !expected.has(value))) {
      throw new Error('SHOPLING_EXACT_SELECTION_MISMATCH');
    }
    return selected;
  })()`;
}

async function configureLabelSettings(config, dependencies, expectedOrders) {
  const matches = (await listTargets(config, dependencies)).filter((target) => target.type === "page" && pagePath(target.url) === ROUTES.labelSettings);
  if (matches.length !== 1) throw codedError(`Expected one Shopling label settings page, found ${matches.length}.`, "SHOPLING_LABEL_SETTINGS_TARGET_COUNT_INVALID");
  const runWithTarget = dependencies.withCdpTarget || withCdpTarget;
  return runWithTarget(matches[0], async (session) => {
    await session.send("Page.handleJavaScriptDialog", { accept: true }, 5_000).catch(() => null);
    await waitForDocument(session, ROUTES.labelSettings, { timeoutMs: 30_000 });
    return evaluate(session, `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const form = document.forms.frm;
      if (!form) throw new Error('SHOPLING_LABEL_FORM_MISSING');
      const setValue = (element, value) => {
        if (!element) throw new Error('SHOPLING_LABEL_CONTROL_MISSING');
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(form.elements.namedItem('print_style'), '003');
      const expectedFields = ['모델번호', '샵플링모델명', '샵플링옵션명', '수량', '옵션자체코드', '선택'];
      const fields = Array.from(document.querySelectorAll('select[name^="prod_print_info_"]'));
      if (fields.length !== expectedFields.length) throw new Error('SHOPLING_LABEL_FIELD_COUNT_MISMATCH');
      fields.forEach((select, index) => {
        const option = Array.from(select.options).find((item) => clean(item.textContent) === expectedFields[index]);
        if (!option) throw new Error('SHOPLING_LABEL_FIELD_OPTION_MISSING:' + expectedFields[index]);
        setValue(select, option.value);
      });
      const setRadio = (name, value) => {
        const radio = Array.from(document.querySelectorAll('input[type="radio"]')).find((item) => item.name === name && item.value === value);
        if (!radio) throw new Error('SHOPLING_LABEL_RADIO_MISSING:' + name);
        radio.checked = true;
      };
      setRadio('rcv_nm_YN', 'N');
      setRadio('send_info', 'A');
      setRadio('small_nm_yn', 'N');
      const count = (String(form.elements.namedItem('ord_no_arr')?.value || '').match(/[0-9]+/g) || []).length;
      if (count !== ${Number(expectedOrders)}) throw new Error('SHOPLING_LABEL_ORDER_COUNT_MISMATCH:' + count);
      return { orderCount: count, style: String(form.elements.namedItem('print_style')?.value || ''), fields: expectedFields };
    })()`);
  }, { timeoutMs: 30_000 });
}

export function createShoplingDailyBrowserAdapter(config, options = {}, dependencies = {}) {
  const settings = {
    account: options.account || "andy801",
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
  };

  return {
    async collectAll({ execute }) {
      return withControlSession(config, settings, dependencies, async (session) => {
        await navigate(session, ROUTES.collection);
        const readiness = await evaluate(session, `(() => ({
          accountCount: Array.from(document.querySelectorAll('input[name="chk[]"]')).filter((input) => input.value && !input.disabled).length,
          functions: ${JSON.stringify(COLLECTION_JOBS.map((job) => job.functionName))}.filter((name) => typeof globalThis[name] === 'function'),
        }))()`);
        if (!readiness.accountCount || readiness.functions.length !== COLLECTION_JOBS.length) {
          throw codedError("Shopling collection controls are incomplete.", "SHOPLING_COLLECTION_CONTROLS_MISSING");
        }
        if (!execute) return { executed: false, accountCount: readiness.accountCount, jobs: COLLECTION_JOBS.map((job) => job.key) };
        const popupWaits = [];
        for (const job of COLLECTION_JOBS) {
          await evaluate(session, `(() => {
            const checks = Array.from(document.querySelectorAll('input[name="chk[]"]')).filter((input) => input.value && !input.disabled);
            checks.forEach((input) => { input.checked = true; });
            return checks.length;
          })()`);
          await evaluate(session, exactDialogInvocation(job.functionName, job.confirmation));
          popupWaits.push(waitForPopup(config, dependencies, job.popupPath, { timeoutMs: 600_000 })
            .then((result) => ({ key: job.key, ...result })));
        }
        const completed = await Promise.all(popupWaits);
        return { executed: true, accountCount: readiness.accountCount, jobs: completed };
      });
    },

    async processMapping({ execute }) {
      return withControlSession(config, settings, dependencies, async (session) => {
        const unmapped = await queryMapping(session, "X");
        if (unmapped.count) return { executed: false, needsReview: true, unmapped };
        const mapped = await queryMapping(session, "M");
        if (!execute || !mapped.count) return { executed: false, needsReview: false, mapped };
        await evaluate(session, exactSelectionExpression(mapped.orderNumbers));
        await evaluate(session, `(() => {
          if (typeof a02_confirm_act !== 'function') throw new Error('SHOPLING_MAPPING_CONFIRM_MISSING');
          a02_confirm_act('MapActionBoth');
          return true;
        })()`);
        await waitForPopup(config, dependencies, ROUTES.mappingAction, { timeoutMs: 90_000 });
        const verified = await queryMapping(session, "X");
        if (verified.count) throw codedError("Unmapped orders remain after bulk confirmation.", "SHOPLING_MAPPING_VERIFICATION_FAILED");
        return { executed: true, needsReview: false, mapped, verifiedUnmappedCount: 0 };
      });
    },

    async moveNewOrdersToReady({ date, execute }) {
      return withControlSession(config, settings, dependencies, async (session) => {
        const before = await queryB7NewOrders(session, date);
        if (!execute || !before.count) return { executed: false, before, afterCount: before.count };
        await evaluate(session, exactSelectionExpression(before.orderNumbers));
        await evaluate(session, `(() => {
          const status = document.querySelector('#status, select[name="status"]');
          if (!status || !Array.from(status.options).some((option) => option.value === 'A02')) throw new Error('SHOPLING_READY_STATUS_MISSING');
          status.value = 'A02';
          status.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        await evaluate(session, exactDialogInvocation("ord_stat", "선택하신 주문 상태를 변경하시겠습니까?"));
        await waitAfterSubmit(session, ROUTES.orders);
        const after = await queryB7NewOrders(session, date);
        if (after.count) throw codedError("New orders remain after changing them to ready-to-ship.", "SHOPLING_B7_VERIFICATION_FAILED");
        return { executed: true, before, afterCount: 0 };
      });
    },

    async transmitPending({ date, execute }) {
      return withControlSession(config, settings, dependencies, async (session) => {
        let pending = await queryB12(session, date, "001");
        if (!pending.count) {
          const completed = await queryB12(session, date, "002", { sort: true });
          return {
            executed: false,
            pending,
            completed,
            completedOrderNumbers: completed.orderNumbers,
            reusedCompleted: completed.count > 0,
          };
        }
        if (!execute) return { executed: false, pending, completedOrderNumbers: [] };
        await evaluate(session, `(() => {
          const condition = document.querySelector('#ef_group_tp');
          const option = condition && Array.from(condition.options).find((item) => item.value === 'd' && String(item.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(AUTO_PACKAGE_LABEL)});
          if (!option) throw new Error('SHOPLING_AUTO_PACKAGE_OPTION_MISSING');
          condition.value = option.value;
          condition.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        await evaluate(session, prefixDialogInvocation("auto_sum_dlvy_pack", `[${AUTO_PACKAGE_LABEL}] 조건으로`));
        await waitAfterSubmit(session, ROUTES.courier);
        pending = await queryB12(session, date, "001");
        if (!pending.count) throw codedError("No pending orders remained after automatic packaging.", "SHOPLING_PENDING_BATCH_DISAPPEARED");
        await evaluate(session, exactSelectionExpression(pending.orderNumbers));
        const courier = await evaluate(session, `(() => {
          const select = document.querySelector('#trsmt_dlvy_cd');
          if (!select) throw new Error('SHOPLING_COURIER_SELECT_MISSING');
          const matches = Array.from(select.options).filter((option) => String(option.textContent || '').includes(${JSON.stringify(COURIER_LABEL_FRAGMENT)}));
          if (matches.length !== 1) throw new Error('SHOPLING_COURIER_OPTION_COUNT_INVALID:' + matches.length);
          select.value = matches[0].value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { value: matches[0].value, text: String(matches[0].textContent || '').replace(/\\s+/g, ' ').trim() };
        })()`);
        await sleep(700);
        await evaluate(session, prefixDialogInvocation("dlvy_trsmt_act", `[${courier.text}] 으로 택배사전송을 진행하시겠습니까?`));
        await waitForPopup(config, dependencies, "/order/dlvy_linkage/dlvy_linkage_018.phtml", { timeoutMs: 180_000 });

        const expected = new Set(pending.orderNumbers);
        let completed = { count: 0, orderNumbers: [] };
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          completed = await queryB12(session, date, "002", { sort: true });
          const found = completed.orderNumbers.filter((orderNumber) => expected.has(orderNumber));
          if (found.length === expected.size) {
            return { executed: true, pending, courier, completedOrderNumbers: found };
          }
          await sleep(2_000);
        }
        throw codedError("The transmitted batch did not appear in courier-complete results.", "SHOPLING_COURIER_TRANSMISSION_VERIFICATION_FAILED", { expectedCount: expected.size, completedCount: completed.count });
      });
    },

    async prepareLabels({ date, execute, orderNumbers }) {
      const expected = normalizeOrderNumbers(orderNumbers);
      if (!execute || !expected.length) return { executed: false, orderCount: expected.length };
      await withControlSession(config, settings, dependencies, async (session) => {
        const completed = await queryB12(session, date, "002", { sort: true });
        const available = new Set(completed.orderNumbers);
        if (expected.some((orderNumber) => !available.has(orderNumber))) {
          throw codedError("The exact transmitted batch is not available for label output.", "SHOPLING_LABEL_BATCH_MISMATCH");
        }
        await evaluate(session, exactSelectionExpression(expected));
        await evaluate(session, `(() => {
          const form = document.forms.frm;
          if (!form || typeof dlvy_print !== 'function') throw new Error('SHOPLING_LABEL_OPEN_MISSING');
          let courier = form.elements.namedItem('dlvy_id');
          if (!courier) {
            courier = document.createElement('input');
            courier.type = 'hidden';
            courier.name = 'dlvy_id';
            form.appendChild(courier);
          }
          courier.value = '018';
          const scale = document.querySelector('#srch_scale');
          if (scale) scale.value = 'chk';
          dlvy_print();
          return true;
        })()`);
      });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const matches = (await listTargets(config, dependencies)).filter((target) => target.type === "page" && pagePath(target.url) === ROUTES.labelSettings);
        if (matches.length === 1) break;
        if (matches.length > 1) throw codedError("Multiple label settings windows are open.", "SHOPLING_LABEL_SETTINGS_TARGET_COUNT_INVALID");
        await sleep(300);
      }
      const configured = await configureLabelSettings(config, dependencies, expected.length);
      return { executed: true, orderCount: expected.length, configured };
    },
  };
}

export const SHOPLING_DAILY_AUTOMATION_RULES = Object.freeze({
  collectionJobs: COLLECTION_JOBS.map((job) => job.key),
  collectionExecutionMode: "parallel",
  mappingLookupPriority: ["VERIFIED_B_CODE", "MODEL_NUMBER", "SHOPPING_MALL_PRODUCT_CODE"],
  mappingLookupForbiddenSources: ["SITE_SELF_CODE"],
  autoPackageValue: "d",
  autoPackageLabel: AUTO_PACKAGE_LABEL,
  courierLabelFragment: COURIER_LABEL_FRAGMENT,
  completedSort: ["sort_tp_ptn_opt_cd", "asc", "A", "asc"],
});
