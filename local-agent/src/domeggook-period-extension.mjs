import { createHash } from "node:crypto";
import {
  listChromeTargets,
  withBrowserCdpTarget,
} from "./chrome-cdp.mjs";

export const DOMEGGOOK_LIST_URL = "https://www.domeggook.com/main/mySell/register/my_sellList.php?mode=OVER";
export const DOMEGGOOK_UPDATE_PATH = "/main/mySell/register/my_sellUpdateItems.php";
export const DOMEGGOOK_MAX_EXTENSION_DAYS = 90;

const DEFAULT_TIMEOUT_MS = 20_000;

export class DomeggookPeriodExtensionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomeggookPeriodExtensionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new DomeggookPeriodExtensionError(code, message, details);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeItemNo(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{6,12}$/.test(normalized) ? normalized : "";
}

function parseInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizeDomeggookExtensionDays(value) {
  return parseInteger(value, DOMEGGOOK_MAX_EXTENSION_DAYS, 1, DOMEGGOOK_MAX_EXTENSION_DAYS);
}

function seoulYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function targetRegistrationDate(now = new Date(), extensionDays = DOMEGGOOK_MAX_EXTENSION_DAYS) {
  const days = normalizeDomeggookExtensionDays(extensionDays);
  const [year, month, day] = seoulYmd(now).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // The Domeggook picker is an exclusive cutoff: choosing D+91 produces a
  // displayed extension through D+90, as observed on the live update screen.
  date.setUTCDate(date.getUTCDate() + days + 1);
  return date.toISOString().slice(0, 10);
}

function stableFingerprint(value) {
  const canonical = JSON.stringify(value, Object.keys(value).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildDomeggookExtensionPlan(snapshot, options = {}) {
  const extensionDays = normalizeDomeggookExtensionDays(options.extensionDays);
  const maxItems = parseInteger(options.maxItems, 50, 1, 50);
  const expectedAccountId = String(options.accountId || "").trim().toLowerCase();
  if (!snapshot?.authenticated) {
    fail(
      "DOMEGGOOK_LOGIN_REQUIRED",
      "도매꾹 전용 Chrome에서 로그인이 필요합니다.",
      { url: snapshot?.url || "" },
    );
  }
  if (snapshot.pageRole !== "PERIOD_EXPIRED_LIST") {
    fail(
      "DOMEGGOOK_PERIOD_LIST_NOT_CONFIRMED",
      "도매꾹 기간종료 목록 화면을 확인하지 못했습니다.",
      { url: snapshot?.url || "", pageRole: snapshot?.pageRole || "UNKNOWN" },
    );
  }
  if (expectedAccountId) {
    const accountContext = String(snapshot.accountContext || "").toLowerCase();
    if (!accountContext.includes(expectedAccountId)) {
      fail(
        "DOMEGGOOK_ACCOUNT_MISMATCH",
        "로그인된 도매꾹 계정이 설정한 아이디와 일치하지 않습니다.",
        { expectedAccountId },
      );
    }
  }
  const totalCount = Number.isFinite(Number(snapshot.totalCount))
    ? Number(snapshot.totalCount)
    : 0;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const normalized = items.map((item) => ({
    itemNo: normalizeItemNo(item?.itemNo),
    status: String(item?.status || "").trim().toUpperCase(),
  })).filter((item) => item.itemNo);
  const uniqueItems = [...new Map(normalized.map((item) => [item.itemNo, item])).values()];

  if (totalCount > 0 && uniqueItems.length === 0) {
    fail(
      "DOMEGGOOK_PERIOD_ITEMS_MISSING",
      "기간종료 상품 수는 있지만 상품번호를 읽지 못했습니다.",
      { totalCount },
    );
  }
  const unapproved = uniqueItems.filter((item) => item.status !== "DONE");
  if (unapproved.length) {
    fail(
      "DOMEGGOOK_UNAPPROVED_ITEM_BLOCKED",
      "승인완료 상태가 아닌 상품이 포함되어 기간연장을 중단했습니다.",
      { items: unapproved },
    );
  }
  const candidates = uniqueItems.slice(0, maxItems);
  const itemNos = candidates.map((item) => item.itemNo);
  const targetDate = targetRegistrationDate(options.now || new Date(), extensionDays);
  const plan = {
    mode: itemNos.length ? "READY" : "NOOP",
    totalCount,
    itemNos,
    extensionDays,
    targetDate,
  };
  return { ...plan, fingerprint: stableFingerprint(plan) };
}

export function validateDomeggookUpdatePreflight(snapshot, plan) {
  if (!snapshot?.authenticated) {
    fail("DOMEGGOOK_LOGIN_REQUIRED", "기간연장 화면에서 로그인이 풀렸습니다.");
  }
  if (snapshot.pageRole !== "PERIOD_EXTENSION") {
    fail(
      "DOMEGGOOK_UPDATE_PAGE_NOT_CONFIRMED",
      "도매꾹 기간연장 화면을 확인하지 못했습니다.",
      { url: snapshot?.url || "", pageRole: snapshot?.pageRole || "UNKNOWN" },
    );
  }
  const itemNos = new Set((snapshot.itemNos || []).map(normalizeItemNo).filter(Boolean));
  const missing = plan.itemNos.filter((itemNo) => !itemNos.has(itemNo));
  if (missing.length) {
    fail(
      "DOMEGGOOK_UPDATE_SCOPE_MISMATCH",
      "기간연장 화면의 상품 범위가 계획과 다릅니다.",
      { expected: plan.itemNos, actual: [...itemNos], missing },
    );
  }
  if (snapshot.paidOptionExtension !== false) {
    fail(
      "DOMEGGOOK_PAID_OPTION_EXTENSION_BLOCKED",
      "유료옵션 기간연장이 꺼져 있음을 확인하지 못했습니다.",
    );
  }
  if (!Number.isFinite(Number(snapshot.chargeWon)) || snapshot.chargeWon === null || Number(snapshot.chargeWon) !== 0) {
    fail(
      "DOMEGGOOK_NONZERO_CHARGE_BLOCKED",
      "기간연장 화면에서 0원이 아닌 비용이 감지되어 중단했습니다.",
      { chargeWon: snapshot.chargeWon },
    );
  }
  const dayValues = (snapshot.extensionDayValues || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (dayValues.length < plan.itemNos.length) {
    fail(
      "DOMEGGOOK_EXTENSION_DAYS_NOT_CONFIRMED",
      "모든 상품의 연장 일수를 확인하지 못했습니다.",
      { expectedItemCount: plan.itemNos.length, observedDayValues: dayValues },
    );
  }
  if (dayValues.some((value) => value > plan.extensionDays)) {
    fail(
      "DOMEGGOOK_EXTENSION_DAYS_EXCEED_POLICY",
      "요청한 최대 연장 일수를 넘는 값이 감지되었습니다.",
      { maximum: plan.extensionDays, observedDayValues: dayValues },
    );
  }
  if (!snapshot.executeControlPresent) {
    fail(
      "DOMEGGOOK_EXECUTE_CONTROL_MISSING",
      "기간연장 실행 버튼을 확인하지 못했습니다.",
    );
  }
  return {
    itemNos: plan.itemNos,
    extensionDayValues: dayValues.slice(0, plan.itemNos.length),
    chargeWon: 0,
    paidOptionExtension: false,
  };
}

function listingProbe() {
  const text = document.body?.innerText || "";
  const url = String(location.href || "");
  const itemInputs = [...document.querySelectorAll('input[id^="itemChk"]')]
    .filter((input) => /^itemChk\d+$/.test(input.id));
  const items = itemInputs.map((input) => {
    const itemNo = input.id.replace(/^itemChk/, "");
    const status = document.getElementById(`itemStatus${itemNo}`)?.value || "";
    return { itemNo, status };
  });
  const totalMatch = text.match(/총\s*([\d,]+)\s*개의\s*상품/);
  const updateForm = document.querySelector('form[name="multiExecForUpdate"]');
  const authenticated = Boolean(
    document.querySelector('a[href*="logout" i], a[onclick*="logout" i]')
    || /로그아웃/.test(text.slice(0, 3000)),
  );
  const loginPage = /\/ssl\/member\/mem_loginForm\.php/i.test(url)
    || Boolean(document.querySelector('form[action*="login" i] input[type="password"]'));
  const accountContext = text.slice(0, 800).replace(/\s+/g, " ");
  return {
    url,
    title: document.title || "",
    pageRole: /[?&]mode=OVER(?:&|$)/i.test(url) && updateForm
      ? "PERIOD_EXPIRED_LIST"
      : "UNKNOWN",
    authenticated,
    loginPage,
    accountContext,
    totalCount: totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null,
    items,
    updateFormPresent: Boolean(updateForm),
  };
}

function submitUpdateScope(itemNos) {
  const expected = Array.isArray(itemNos) ? itemNos.map(String) : [];
  if (!expected.length) return { ok: false, code: "EMPTY_SCOPE" };
  const form = document.querySelector('form[name="multiExecForUpdate"]');
  const nos = form?.querySelector('input[name="nos"]');
  if (!form || !nos) return { ok: false, code: "UPDATE_FORM_MISSING" };
  for (const itemNo of expected) {
    const checkbox = document.getElementById(`itemChk${itemNo}`);
    const status = document.getElementById(`itemStatus${itemNo}`)?.value || "";
    if (!checkbox) return { ok: false, code: "ITEM_MISSING", itemNo };
    if (String(status).toUpperCase() !== "DONE") {
      return { ok: false, code: "ITEM_NOT_DONE", itemNo, status };
    }
  }
  nos.value = expected.join(",");
  form.removeAttribute("target");
  form.target = "";
  form.submit();
  return { ok: true, itemNos: expected };
}

function updateProbe() {
  const text = document.body?.innerText || "";
  const compact = text.replace(/\s+/g, " ").trim();
  const url = String(location.href || "");
  const loginPage = /\/ssl\/member\/mem_loginForm\.php/i.test(url)
    || Boolean(document.querySelector('form[action*="login" i] input[type="password"]'));
  const itemNos = [...new Set([
    ...[...text.matchAll(/\[\s*(\d{6,12})\s*\]/g)].map((match) => match[1]),
    ...[...document.querySelectorAll('a[href*="itemNo"], a[href*="item_no"], a[href*="no="]')]
      .flatMap((anchor) => (anchor.textContent || "").match(/\d{6,12}/g) || []),
  ])];
  const controls = [...document.querySelectorAll(
    'button,input[type="button"],input[type="submit"],input[type="image"],a,img[alt],[role="button"]',
  )];
  const executeControlPresent = controls.some((element) => (
    /기간연장\s*실행하기/.test(
      `${element.value || ""} ${element.textContent || ""} ${element.alt || ""} ${element.title || ""}`,
    )
  ));
  const dateRegPresent = Boolean(document.querySelector('#dateReg, input[name="dateReg"]'));
  const scopedNosPresent = Boolean(document.querySelector('input[name="nos"]'));
  const authenticated = !loginPage && Boolean(
    document.querySelector('a[href*="logout" i], a[onclick*="logout" i]')
    || /로그아웃/.test(text.slice(0, 3000))
    || (dateRegPresent && executeControlPresent && scopedNosPresent && itemNos.length),
  );
  const positiveNumericInputs = [...document.querySelectorAll('input')]
    .filter((input) => !["hidden", "radio", "checkbox", "submit", "button"].includes(input.type))
    .filter((input) => !/^\d{4}-\d{2}-\d{2}$/.test(String(input.value || "")))
    .map((input) => Number(String(input.value || "").replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 365);
  const chargeValues = [...compact.matchAll(/(?:수수료|결제)\s*([\d,]+)\s*원/g)]
    .map((match) => Number(match[1].replace(/,/g, "")));
  const chargeWon = chargeValues.length ? Math.max(...chargeValues) : null;
  const radios = [...document.querySelectorAll('input[type="radio"]')];
  let paidOptionExtension = null;
  for (const radio of radios) {
    const context = radio.closest("label,td,tr,div")?.innerText || "";
    const isKnownPaidOptionControl = radio.id === "noUpdateAdvT" || radio.id === "noUpdateAdvF";
    if (!isKnownPaidOptionControl && !/유료옵션기간|유료옵션/.test(context)) continue;
    if (!radio.checked) continue;
    const adjacentText = [
      ...(radio.labels ? [...radio.labels].map((label) => label.innerText || "") : []),
      radio.nextSibling?.textContent || "",
      radio.previousSibling?.textContent || "",
    ].join(" ").trim();
    const normalizedValue = String(radio.value || "").trim().toLowerCase();
    if (radio.id === "noUpdateAdvT"
      || /아니오/.test(adjacentText)
      || /^(?:n|no|false|0)$/.test(normalizedValue)) paidOptionExtension = false;
    else if (radio.id === "noUpdateAdvF"
      || /예/.test(adjacentText)
      || /^(?:y|yes|true|1)$/.test(normalizedValue)) paidOptionExtension = true;
  }
  const success = /기간연장이\s*완료되었습니다/.test(compact);
  return {
    url,
    title: document.title || "",
    pageRole: /my_sellUpdateItems\.php/i.test(url) || /상품기간\s*일괄연장도구/.test(compact)
      ? "PERIOD_EXTENSION"
      : "UNKNOWN",
    authenticated,
    loginPage,
    itemNos,
    extensionDayValues: positiveNumericInputs,
    chargeWon,
    paidOptionExtension,
    executeControlPresent,
    dateRegPresent,
    success,
    textSample: compact.slice(0, 800),
  };
}

function configureUpdate(targetDate) {
  const dateInputs = [...document.querySelectorAll('input')]
    .filter((input) => /^\d{4}-\d{2}-\d{2}$/.test(String(input.value || "")) || input.type === "date");
  if (!dateInputs.length) return { ok: false, code: "DATE_INPUT_MISSING" };
  const ranked = dateInputs.sort((left, right) => {
    const score = (input) => /(?:등록|상품|연장|기간|end|date|dt)/i.test(
      `${input.name || ""} ${input.id || ""} ${input.closest("td,tr,div")?.innerText || ""}`,
    ) ? 1 : 0;
    return score(right) - score(left);
  });
  const dateInput = document.querySelector('#dateReg, input[name="dateReg"]') || ranked[0];
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(dateInput, targetDate);
  else dateInput.value = targetDate;
  for (const eventName of ["input", "change", "blur"]) {
    dateInput.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  if (dateInput.value !== targetDate) {
    return { ok: false, code: "DATE_INPUT_VALUE_MISMATCH", actual: dateInput.value };
  }

  const explicitNoPaidOption = document.querySelector('#noUpdateAdvT');
  if (explicitNoPaidOption) {
    if (!explicitNoPaidOption.checked) explicitNoPaidOption.click();
    else explicitNoPaidOption.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const radios = explicitNoPaidOption ? [] : [...document.querySelectorAll('input[type="radio"]')];
  for (const radio of radios) {
    const context = radio.closest("td,tr,div")?.innerText || "";
    const adjacentText = [
      ...(radio.labels ? [...radio.labels].map((label) => label.innerText || "") : []),
      radio.nextSibling?.textContent || "",
      radio.previousSibling?.textContent || "",
    ].join(" ").trim();
    const normalizedValue = String(radio.value || "").trim().toLowerCase();
    const isNo = /아니오/.test(adjacentText) || /^(?:n|no|false|0)$/.test(normalizedValue);
    if (/유료옵션기간|유료옵션/.test(context) && isNo) {
      if (!radio.checked) radio.click();
      else radio.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
  }
  if (typeof globalThis.mainCalc === "function") globalThis.mainCalc();
  return { ok: true, targetDate, inputName: dateInput.name || "", inputId: dateInput.id || "" };
}

export function submitLogin(credentials) {
  const accountId = String(credentials?.accountId || "").trim();
  const password = String(credentials?.password || "");
  if (!accountId || !password) return { ok: false, code: "LOGIN_CREDENTIAL_MISSING" };
  const captchaInput = document.querySelector('input[name*="captcha" i],input[id*="captcha" i],input[name*="security" i]');
  if (captchaInput) return { ok: false, code: "LOGIN_CAPTCHA_REQUIRED" };
  const passwordInput = document.querySelector('input[type="password"]');
  const form = passwordInput?.form || passwordInput?.closest("form");
  if (!passwordInput || !form) return { ok: false, code: "LOGIN_FORM_MISSING" };
  const textInputs = [...form.querySelectorAll('input:not([type]),input[type="text"],input[type="email"]')];
  const accountInput = textInputs.find((input) => /(?:^|_)(?:id|user|member|login)(?:$|_)/i.test(`${input.name || ""}_${input.id || ""}`))
    || textInputs[0];
  if (!accountInput) return { ok: false, code: "LOGIN_ACCOUNT_INPUT_MISSING" };
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const setValue = (input, value) => {
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  setValue(accountInput, accountId);
  setValue(passwordInput, password);
  const controls = [...form.querySelectorAll('button,input[type="submit"],input[type="button"],a')];
  const submit = controls.find((element) => /로그인/.test(`${element.textContent || ""} ${element.value || ""}`))
    || form.querySelector('button[type="submit"],input[type="submit"]');
  if (!submit) return { ok: false, code: "LOGIN_SUBMIT_MISSING" };
  setTimeout(() => submit.click(), 250);
  return { ok: true };
}

function clickExecuteControl() {
  const controls = [...document.querySelectorAll(
    'button,input[type="button"],input[type="submit"],input[type="image"],a,img[alt],[role="button"]',
  )];
  const control = controls.find((element) => (
    /기간연장\s*실행하기/.test(
      `${element.value || ""} ${element.textContent || ""} ${element.alt || ""} ${element.title || ""}`,
    )
  ));
  if (!control) return { ok: false, code: "EXECUTE_CONTROL_MISSING" };
  if (control.disabled) return { ok: false, code: "EXECUTE_CONTROL_DISABLED" };
  control.click();
  return { ok: true };
}

function expression(fn, argument) {
  const serialized = argument === undefined ? "" : JSON.stringify(argument);
  return `(${fn.toString()})(${serialized})`;
}

async function evaluate(session, fn, argument, timeoutMs = DEFAULT_TIMEOUT_MS, userGesture = false) {
  const response = await session.send("Runtime.evaluate", {
    expression: expression(fn, argument),
    returnByValue: true,
    awaitPromise: true,
    userGesture,
  }, timeoutMs);
  if (response.exceptionDetails) {
    fail("DOMEGGOOK_PAGE_EVALUATION_FAILED", "도매꾹 화면을 처리하는 중 오류가 발생했습니다.");
  }
  return response.result?.value;
}

async function waitForProbe(session, probe, predicate, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await evaluate(session, probe, undefined, Math.min(timeoutMs, 5_000)).catch(() => null);
    if (latest && predicate(latest)) return latest;
    await sleep(200);
  }
  fail(
    options.code || "DOMEGGOOK_PAGE_TIMEOUT",
    options.message || "도매꾹 화면 응답을 기다리는 시간이 초과되었습니다.",
    { latest },
  );
}

async function navigate(session, url, probe, predicate, timeoutMs = DEFAULT_TIMEOUT_MS) {
  await session.send("Page.enable", {}, timeoutMs);
  await session.send("Page.navigate", { url }, timeoutMs);
  return waitForProbe(session, probe, predicate, { timeoutMs });
}

export function isDomeggookSettledPage(value, expectedRole) {
  return value?.pageRole === expectedRole || value?.loginPage === true;
}

export function isDomeggookUpdateReady(value, expectedItemNos = []) {
  if (value?.loginPage === true) return true;
  if (value?.pageRole !== "PERIOD_EXTENSION"
    || value?.dateRegPresent !== true
    || value?.executeControlPresent !== true) return false;
  const observed = new Set((value.itemNos || []).map(String));
  return expectedItemNos.every((itemNo) => observed.has(String(itemNo)));
}

export function createDomeggookCdpBrowser(session, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  return {
    async openListing() {
      return navigate(
        session,
        DOMEGGOOK_LIST_URL,
        listingProbe,
        (value) => isDomeggookSettledPage(value, "PERIOD_EXPIRED_LIST"),
        timeoutMs,
      );
    },
    async readListing() {
      return evaluate(session, listingProbe, undefined, timeoutMs);
    },
    async login(accountId, password) {
      const submitted = await evaluate(session, submitLogin, { accountId, password }, timeoutMs, true);
      if (!submitted?.ok) {
        const reason = submitted?.code || "LOGIN_SUBMIT_NO_RESPONSE";
        const code = submitted?.code === "LOGIN_CAPTCHA_REQUIRED"
          ? "DOMEGGOOK_LOGIN_CAPTCHA_REQUIRED"
          : "DOMEGGOOK_LOGIN_SUBMIT_FAILED";
        fail(
          code,
          submitted?.code === "LOGIN_CAPTCHA_REQUIRED"
            ? "도매꾹 로그인 보안문자가 나타나 자동로그인을 중단했습니다."
            : `저장된 계정으로 도매꾹 로그인을 시작하지 못했습니다. (${reason})`,
          submitted || {},
        );
      }
      await waitForProbe(
        session,
        listingProbe,
        (value) => value.loginPage !== true,
        {
          timeoutMs,
          code: "DOMEGGOOK_LOGIN_NOT_CONFIRMED",
          message: "도매꾹 자동로그인 완료를 확인하지 못했습니다. 비밀번호 또는 추가 인증을 확인하세요.",
        },
      );
    },
    async openUpdate(itemNos) {
      const submitted = await evaluate(session, submitUpdateScope, itemNos, timeoutMs, true);
      if (!submitted?.ok) {
        fail(
          "DOMEGGOOK_UPDATE_SCOPE_SUBMIT_FAILED",
          "기간연장 대상 상품을 여는 데 실패했습니다.",
          submitted || {},
        );
      }
      return waitForProbe(
        session,
        updateProbe,
        (value) => isDomeggookUpdateReady(value, itemNos),
        {
          timeoutMs,
          code: "DOMEGGOOK_UPDATE_PAGE_TIMEOUT",
          message: "기간연장 화면이 열리지 않았습니다.",
        },
      );
    },
    async configureUpdate(targetDate) {
      const configured = await evaluate(session, configureUpdate, targetDate, timeoutMs, true);
      if (!configured?.ok) {
        fail(
          "DOMEGGOOK_UPDATE_CONFIGURATION_FAILED",
          "기간연장 날짜를 설정하지 못했습니다.",
          configured || {},
        );
      }
      await sleep(250);
      return configured;
    },
    async readUpdate() {
      return evaluate(session, updateProbe, undefined, timeoutMs);
    },
    async executeUpdate() {
      await session.send("Page.enable", {}, timeoutMs);
      const dialogs = [];
      let unexpectedDialog = null;
      let confirmationDialogSeen = false;
      let completionDialogSeen = false;
      const removeDialogListener = session.on("Page.javascriptDialogOpening", (event) => {
        const message = String(event?.message || "");
        dialogs.push(message.slice(0, 300));
        const isConfirmation = /기간연장을\s*실행하겠습니까/.test(message);
        const isCompletion = /기간연장이\s*완료되었습니다/.test(message);
        if (isConfirmation) confirmationDialogSeen = true;
        if (isCompletion) completionDialogSeen = true;
        const expected = isConfirmation || isCompletion;
        if (!expected) unexpectedDialog = message;
        void session.send("Page.handleJavaScriptDialog", { accept: expected }, timeoutMs).catch(() => null);
      });
      try {
        const clicked = await evaluate(session, clickExecuteControl, undefined, timeoutMs, true);
        if (!clicked?.ok) {
          fail("DOMEGGOOK_EXECUTE_CLICK_FAILED", "기간연장 실행 버튼을 누르지 못했습니다.", clicked || {});
        }
        const deadline = Date.now() + timeoutMs;
        let latest = null;
        while (Date.now() < deadline && !completionDialogSeen) {
          if (unexpectedDialog) {
            fail(
              "DOMEGGOOK_UNEXPECTED_DIALOG",
              "예상하지 못한 도매꾹 확인창이 나타나 실행을 중단했습니다.",
              { message: unexpectedDialog },
            );
          }
          latest = await evaluate(session, updateProbe, undefined, Math.min(timeoutMs, 5_000)).catch(() => null);
          if (latest?.success === true) break;
          await sleep(200);
        }
        if (!confirmationDialogSeen || (!completionDialogSeen && latest?.success !== true)) {
          fail(
            "DOMEGGOOK_COMPLETION_NOT_CONFIRMED",
            "도매꾹의 기간연장 완료 신호를 확인하지 못했습니다.",
            { confirmationDialogSeen, completionDialogSeen, dialogs },
          );
        }
        return { ...(latest || {}), success: true, dialogs };
      } finally {
        removeDialogListener?.();
      }
    },
  };
}

export async function runDomeggookPeriodExtensionWithBrowser(browser, options = {}) {
  const startedAt = new Date().toISOString();
  await browser.openListing();
  let before = await browser.readListing();
  if (!before?.authenticated && before?.loginPage && options.password && typeof browser.login === "function") {
    await browser.login(options.accountId, options.password);
    await browser.openListing();
    before = await browser.readListing();
  }
  const plan = buildDomeggookExtensionPlan(before, options);
  if (plan.mode === "NOOP" || options.execute !== true) {
    return {
      status: plan.mode === "NOOP" ? "succeeded" : "planned",
      mode: options.execute === true ? "execute" : "dry-run",
      startedAt,
      finishedAt: new Date().toISOString(),
      plan,
      before: { totalCount: before.totalCount, itemNos: plan.itemNos },
      verification: plan.mode === "NOOP" ? "NO_EXPIRED_ITEMS" : "NOT_EXECUTED",
    };
  }

  await browser.openUpdate(plan.itemNos);
  await browser.configureUpdate(plan.targetDate);
  const updatePreflight = validateDomeggookUpdatePreflight(await browser.readUpdate(), plan);
  const completion = await browser.executeUpdate();
  if (completion.success !== true) {
    fail("DOMEGGOOK_COMPLETION_NOT_CONFIRMED", "도매꾹의 기간연장 완료 결과를 확인하지 못했습니다.");
  }

  await browser.openListing();
  const after = await browser.readListing();
  if (!after.authenticated || after.pageRole !== "PERIOD_EXPIRED_LIST") {
    fail("DOMEGGOOK_READBACK_PAGE_NOT_CONFIRMED", "기간연장 후 기간종료 목록을 다시 확인하지 못했습니다.");
  }
  const remaining = new Set((after.items || []).map((item) => normalizeItemNo(item?.itemNo)).filter(Boolean));
  const stillExpired = plan.itemNos.filter((itemNo) => remaining.has(itemNo));
  if (stillExpired.length) {
    fail(
      "DOMEGGOOK_READBACK_MISMATCH",
      "기간연장 완료 후에도 같은 상품이 기간종료 목록에 남아 있습니다.",
      { stillExpired, beforeTotal: before.totalCount, afterTotal: after.totalCount },
    );
  }

  return {
    status: "succeeded",
    mode: "execute",
    startedAt,
    finishedAt: new Date().toISOString(),
    plan,
    before: { totalCount: before.totalCount, itemNos: plan.itemNos },
    updatePreflight,
    completion: { dialogs: completion.dialogs || [] },
    after: { totalCount: after.totalCount, itemNos: (after.items || []).map((item) => item.itemNo) },
    verification: "SELECTED_ITEMS_ABSENT_FROM_PERIOD_EXPIRED_LIST",
  };
}

async function createDomeggookTarget(config, options = {}) {
  const createTarget = options.createTarget || (async (url) => {
    const response = await fetch(`${config.chromeDebugBaseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return response.json();
  });
  const created = await createTarget(DOMEGGOOK_LIST_URL);
  if (!created?.id) {
    fail("DOMEGGOOK_TARGET_CREATE_FAILED", "도매꾹 전용 Chrome 탭을 열지 못했습니다.");
  }
  return created;
}

export async function runDomeggookPeriodExtension(config, options = {}, dependencies = {}) {
  const getTargets = dependencies.listChromeTargets || listChromeTargets;
  const wait = dependencies.sleep || sleep;
  const attempts = Math.max(1, Number(options.chromeReadyAttempts || 30));
  let listing = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    listing = await getTargets(config);
    if (listing.available && listing.targets.some((candidate) => candidate.type === "page")) break;
    if (attempt + 1 < attempts) await wait(500);
  }
  if (!listing.available) {
    fail(
      "DOMEGGOOK_CHROME_UNAVAILABLE",
      "도매꾹 전용 Chrome에 연결하지 못했습니다.",
      { endpoint: config.chromeDebugBaseUrl },
    );
  }
  let target = listing.targets.find((candidate) => (
    candidate.type === "page" && /^https:\/\/(?:www\.)?domeggook\.com\//i.test(candidate.url || "")
  ));
  if (!target) target = await createDomeggookTarget(config, dependencies);

  const connect = dependencies.withBrowserCdpTarget
    || ((selected, handler, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      handler,
      connectOptions,
    ));
  return connect(target, async (session) => {
    const browser = createDomeggookCdpBrowser(session, options);
    return runDomeggookPeriodExtensionWithBrowser(browser, options);
  }, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
}
