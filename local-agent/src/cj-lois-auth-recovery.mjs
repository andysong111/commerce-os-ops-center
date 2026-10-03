import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  withBrowserCdpTarget,
  withCdpTarget,
} from "./chrome-cdp.mjs";
import { isCjLoisTarget } from "./cj-lois-return-pickup-browser-adapter.mjs";
import {
  hasCjLoisDpapiCredential,
  readCjLoisDpapiCredential,
} from "./windows-dpapi-credential.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;
const AUTH_WAIT_MS = 45_000;
const CJ_MAIL_MARKER = /CJ\s*대한통운|CJ대한통운|LOIS\s*Parcel|기업고객시스템/i;
const OTP_MARKER = /인증\s*번호|인증코드|일회용\s*번호|OTP/i;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cjAuthProbe() {
  const text = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const loginApps = instances.filter((instance) => instance.app?.id === "app/com/inc/CMCMLI0001M");
  const otpApps = instances.filter((instance) => instance.app?.id === "app/com/inc/CMCMLI0005M");
  const mainApps = instances.filter((instance) => instance.app?.id === "app/com/main/CMCMLI0002M");
  const cprLoginReady = loginApps.length === 1
    && Boolean(loginApps[0].lookup("input1"))
    && Boolean(loginApps[0].lookup("input2"))
    && Boolean(loginApps[0].lookup("btnLogin"));
  const cprLoginAutofillReady = cprLoginReady
    && String(loginApps[0].lookup("input1")?.value || "").length > 0
    && String(loginApps[0].lookup("input2")?.value || "").length > 0;
  const cprOtpReady = otpApps.length === 1 && Boolean(otpApps[0].lookup("ipbOtpNo"));
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
  const idInputs = Array.from(document.querySelectorAll(
    'input[type="text"], input[type="email"], input[autocomplete="username"]',
  )).filter(visible);
  const otpInputs = Array.from(document.querySelectorAll(
    'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="auth" i], input[id*="auth" i], input[placeholder*="인증"]',
  )).filter((element) => visible(element) && element.type !== "password");
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
    .filter(visible);
  const buttonLabels = buttons.map((element) => String(element.textContent || element.value || "")
    .replace(/\s+/g, " ").trim());
  const captchaPresent = Boolean(document.querySelector(
    'iframe[src*="captcha" i], img[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]',
  )) || /자동입력\s*방지|보안문자|captcha/i.test(text);
  const authenticated = !captchaPresent && (mainApps.length === 1
    || (passwordInputs.length === 0
      && (buttonLabels.some((label) => label === "로그아웃")
        || /기업고객건별접수|운송장출력|상품추적|전일접수현황/.test(text))));
  return {
    state: authenticated ? "AUTHENTICATED"
      : captchaPresent ? "CAPTCHA_REQUIRED"
        : cprOtpReady || otpInputs.length === 1 ? "OTP_REQUIRED"
          : cprLoginReady || passwordInputs.length === 1 ? "LOGIN_REQUIRED"
            : "UNKNOWN",
    readyState: document.readyState,
    loginAutofillReady: cprLoginAutofillReady || (passwordInputs.length === 1
      && passwordInputs[0].value.length > 0
      && idInputs.some((element) => element.value.length > 0)),
    loginButtonCount: cprLoginReady ? 1 : buttonLabels.filter((label) => label === "로그인").length,
    otpInputCount: cprOtpReady ? 1 : otpInputs.length,
  };
}

function naverMailProbe() {
  const text = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const captchaPresent = Boolean(document.querySelector(
    'iframe[src*="captcha" i], img[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]',
  )) || /자동입력\s*방지|보안문자|captcha/i.test(text);
  return {
    state: captchaPresent ? "CAPTCHA_REQUIRED"
      : location.hostname === "mail.naver.com" && /메일|받은메일함|전체메일/.test(text)
        ? "MAILBOX_READY"
        : location.hostname === "nid.naver.com" || Boolean(document.querySelector('input[type="password"]'))
          ? "LOGIN_REQUIRED"
          : "UNKNOWN",
    readyState: document.readyState,
  };
}

function clickAutofilledCjLogin() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const loginInstances = instances.filter((instance) => instance.app?.id === "app/com/inc/CMCMLI0001M");
  if (loginInstances.length !== 1) {
    return { error: "CJ_LOGIN_APP_INSTANCE_COUNT_INVALID", count: loginInstances.length };
  }
  const parameters = loginInstances[0].lookup("dmParam");
  const button = loginInstances[0].lookup("btnLogin");
  if (!parameters || !button
    || String(parameters.getValue("cjLoginId") || "").length === 0
    || String(parameters.getValue("cjLoginPw") || "").length === 0) {
    return { error: "CJ_LOGIN_AUTOFILL_NOT_READY" };
  }
  button.click();
  return { clicked: true };
}

function locateAutofilledCjLogin() {
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
  const idInputs = Array.from(document.querySelectorAll(
    'input[type="text"], input[type="email"], input[autocomplete="username"]',
  )).filter(visible);
  if (passwordInputs.length !== 1 || passwordInputs[0].value.length === 0
    || !idInputs.some((element) => element.value.length > 0)) {
    return { error: "CJ_LOGIN_AUTOFILL_NOT_READY" };
  }
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
    .filter((element) => visible(element)
      && String(element.textContent || element.value || "").replace(/\s+/g, " ").trim() === "로그인");
  if (buttons.length !== 1) return { error: "CJ_LOGIN_BUTTON_COUNT_INVALID", count: buttons.length };
  const rect = buttons[0].getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { error: "CJ_LOGIN_BUTTON_RECT_INVALID" };
  return {
    ready: true,
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
  };
}

function fillCjLoginCredentials(username, password) {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const loginInstances = instances.filter((instance) => instance.app?.id === "app/com/inc/CMCMLI0001M");
  if (loginInstances.length !== 1) {
    return { error: "CJ_LOGIN_APP_INSTANCE_COUNT_INVALID", count: loginInstances.length };
  }
  const idControl = loginInstances[0].lookup("input1");
  const passwordControl = loginInstances[0].lookup("input2");
  const parameters = loginInstances[0].lookup("dmParam");
  if (!idControl || !passwordControl || !parameters) return { error: "CJ_LOGIN_CONTROL_MISSING" };
  parameters.setValue("cjLoginId", username);
  parameters.setValue("cjLoginPw", password);
  idControl.value = username;
  passwordControl.value = password;
  idControl.redraw?.();
  passwordControl.redraw?.();
  return {
    filled: idControl.value.length > 0 && passwordControl.value.length > 0,
    idLength: idControl.value.length,
    passwordLength: passwordControl.value.length,
    dataIdLength: String(parameters.getValue("cjLoginId") || "").length,
    dataPasswordLength: String(parameters.getValue("cjLoginPw") || "").length,
  };
}

function locateCjLoginInputs() {
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
  const idInputs = Array.from(document.querySelectorAll(
    'input[type="text"], input[type="email"], input[autocomplete="username"]',
  )).filter(visible);
  if (passwordInputs.length !== 1 || idInputs.length !== 1) {
    return { error: "CJ_LOGIN_INPUT_COUNT_INVALID", idCount: idInputs.length, passwordCount: passwordInputs.length };
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const input of [idInputs[0], passwordInputs[0]]) {
    if (setter) setter.call(input, "");
    else input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const center = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
  };
  return { ready: true, id: center(idInputs[0]), password: center(passwordInputs[0]) };
}

function readCjLoginInputLengths() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const loginInstances = instances.filter((instance) => instance.app?.id === "app/com/inc/CMCMLI0001M");
  if (loginInstances.length === 1) {
    const idControl = loginInstances[0].lookup("input1");
    const passwordControl = loginInstances[0].lookup("input2");
    const parameters = loginInstances[0].lookup("dmParam");
    if (idControl && passwordControl && parameters) {
      return {
        idLength: String(parameters.getValue("cjLoginId") || "").length,
        passwordLength: String(parameters.getValue("cjLoginPw") || "").length,
        source: "CPR_DATAMAP",
      };
    }
  }
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
  const idInputs = Array.from(document.querySelectorAll(
    'input[type="text"], input[type="email"], input[autocomplete="username"]',
  )).filter(visible);
  if (passwordInputs.length !== 1 || idInputs.length !== 1) {
    return { error: "CJ_LOGIN_INPUT_COUNT_INVALID", idCount: idInputs.length, passwordCount: passwordInputs.length };
  }
  return { idLength: idInputs[0].value.length, passwordLength: passwordInputs[0].value.length };
}

function locateCjLoginValidationAlert() {
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const text = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
  if (!/(?:ID|PW|아이디|비밀번호).{0,20}필수\s*입력\s*항목/.test(text)) {
    return { present: false };
  }
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
    .filter((element) => visible(element)
      && String(element.textContent || element.value || "").replace(/\s+/g, " ").trim() === "확인");
  if (buttons.length !== 1) return { error: "CJ_LOGIN_ALERT_BUTTON_COUNT_INVALID", count: buttons.length };
  const rect = buttons[0].getBoundingClientRect();
  return {
    present: true,
    ready: true,
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
  };
}

function dismissCjLoginValidationAlert() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const modals = instances.filter((instance) => instance.app?.id === "app/cmn/Modal");
  const validationModals = modals.filter((instance) => {
    const message = instance.lookup("optMsg");
    return /(?:ID|PW|아이디|비밀번호).{0,20}필수\s*입력\s*항목/.test(String(message?.value || ""));
  });
  if (validationModals.length === 0) return { dismissed: false };
  if (validationModals.length !== 1) {
    return { error: "CJ_LOGIN_VALIDATION_MODAL_COUNT_INVALID", count: validationModals.length };
  }
  const confirm = validationModals[0].lookup("btnConfirm");
  if (!confirm) return { error: "CJ_LOGIN_VALIDATION_CONFIRM_MISSING" };
  confirm.click();
  return { dismissed: true };
}

function openLatestCjOtpMail() {
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const candidates = Array.from(document.querySelectorAll('a.mail_title_link, a, button, [role="link"], [role="row"], li'))
    .filter(visible)
    .map((element) => ({
      element,
      text: String(element.textContent || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((item) => /CJ\s*대한통운|CJ대한통운|LOIS\s*Parcel|기업고객시스템/i.test(item.text));
  if (!candidates.length) return { error: "CJ_OTP_MAIL_NOT_FOUND" };
  const latest = candidates.find((item) => item.element.matches?.("a.mail_title_link")) || candidates[0];
  latest.element.click();
  return { clicked: true };
}

function extractCjOtpFromVisibleMail() {
  const text = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
  if (!/CJ\s*대한통운|CJ대한통운|LOIS\s*Parcel|기업고객시스템/i.test(text)
    || !/인증\s*번호|인증코드|일회용\s*번호|OTP/i.test(text)) return { found: false };
  const matches = [...text.matchAll(/(?<![0-9])([0-9]{6})(?![0-9])/g)]
    .map((match) => match[1]);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? { found: true, otp: unique[0] } : { found: false };
}

function submitCjOtp(otp) {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const otpApps = instances.filter((instance) => instance.app?.id === "app/com/inc/CMCMLI0005M");
  if (otpApps.length === 1) {
    const app = otpApps[0];
    const input = app.lookup("ipbOtpNo");
    const parameters = app.lookup("dmParam");
    const buttons = app.getContainer().getAllRecursiveChildren()
      .filter((control) => typeof control.click === "function"
        && String(control.value || "").replace(/\s+/g, " ").trim() === "로그인");
    if (!input || !parameters) return { error: "CJ_OTP_CONTROL_MISSING" };
    if (buttons.length !== 1) {
      return { error: "CJ_OTP_SUBMIT_BUTTON_COUNT_INVALID", count: buttons.length };
    }
    input.value = otp;
    parameters.setValue("otpNo", otp);
    input.redraw?.();
    if (String(input.value || "").length !== otp.length
      || String(parameters.getValue("otpNo") || "").length !== otp.length) {
      return { error: "CJ_OTP_FILL_FAILED" };
    }
    buttons[0].click();
    return { submitted: true, source: "CPR_DATAMAP" };
  }
  if (otpApps.length > 1) return { error: "CJ_OTP_APP_INSTANCE_COUNT_INVALID", count: otpApps.length };
  const visible = (element) => Boolean(element?.getClientRects?.().length)
    && getComputedStyle(element).visibility !== "hidden";
  const inputs = Array.from(document.querySelectorAll(
    'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="auth" i], input[id*="auth" i], input[placeholder*="인증"]',
  )).filter((element) => visible(element) && element.type !== "password");
  if (inputs.length !== 1) return { error: "CJ_OTP_INPUT_COUNT_INVALID", count: inputs.length };
  const input = inputs[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, otp);
  else input.value = otp;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
    .filter((element) => visible(element)
      && /^(확인|인증|로그인)$/.test(String(element.textContent || element.value || "").replace(/\s+/g, " ").trim()));
  if (buttons.length !== 1) return { error: "CJ_OTP_SUBMIT_BUTTON_COUNT_INVALID", count: buttons.length };
  buttons[0].click();
  return { submitted: true };
}

export const CJ_AUTH_PROBE_EXPRESSION = `(${cjAuthProbe.toString()})()`;
export const NAVER_MAIL_PROBE_EXPRESSION = `(${naverMailProbe.toString()})()`;
export const CJ_AUTH_CLICK_LOGIN_EXPRESSION = `(${clickAutofilledCjLogin.toString()})()`;
export const CJ_AUTH_LOGIN_BUTTON_POINT_EXPRESSION = `(${locateAutofilledCjLogin.toString()})()`;
export const CJ_AUTH_FILL_CREDENTIALS_SOURCE = fillCjLoginCredentials.toString();
export const CJ_AUTH_LOGIN_INPUT_POINTS_EXPRESSION = `(${locateCjLoginInputs.toString()})()`;
export const CJ_AUTH_LOGIN_INPUT_LENGTHS_EXPRESSION = `(${readCjLoginInputLengths.toString()})()`;
export const CJ_AUTH_LOGIN_ALERT_POINT_EXPRESSION = `(${locateCjLoginValidationAlert.toString()})()`;
export const CJ_AUTH_DISMISS_LOGIN_ALERT_EXPRESSION = `(${dismissCjLoginValidationAlert.toString()})()`;
export const NAVER_OPEN_CJ_OTP_MAIL_EXPRESSION = `(${openLatestCjOtpMail.toString()})()`;
export const NAVER_EXTRACT_CJ_OTP_EXPRESSION = `(${extractCjOtpFromVisibleMail.toString()})()`;
export const CJ_AUTH_SUBMIT_OTP_SOURCE = submitCjOtp.toString();

export function extractCjOtp(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!CJ_MAIL_MARKER.test(normalized) || !OTP_MARKER.test(normalized)) return "";
  const values = [...normalized.matchAll(/(?<![0-9])([0-9]{6})(?![0-9])/g)]
    .map((match) => match[1]);
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : "";
}

export function selectAuthFrame(results = [], allowedStates = []) {
  const matches = results.filter((entry) => allowedStates.includes(entry?.value?.state));
  if (matches.length !== 1) {
    fail("AUTH_FRAME_COUNT_INVALID", "Exactly one authentication frame is required.", {
      matchCount: matches.length,
    });
  }
  return matches[0];
}

async function evaluateInFrame(session, frame, expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!frame?.id) {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) fail("AUTH_FRAME_EVALUATION_FAILED", "Authentication page evaluation failed.");
    return result.result?.value;
  }
  const world = await session.send("Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: "commerce-os-cj-auth-recovery",
    grantUniveralAccess: false,
  }, timeoutMs);
  const result = await session.send("Runtime.evaluate", {
    expression,
    contextId: world.executionContextId,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) fail("AUTH_FRAME_EVALUATION_FAILED", "Authentication page evaluation failed.");
  return result.result?.value;
}

async function inspectTarget(target, expression, options = {}, dependencies = {}, config = null) {
  const connect = dependencies.withCdpTarget
    || (config
      ? ((selected, callback, connectOptions) => withBrowserCdpTarget(
        config,
        selected,
        callback,
        connectOptions,
      ))
      : withCdpTarget);
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCdpExpressionAcrossFrames;
  return connect(target, async (session) => {
    const timeoutMs = options.timeoutMs || 5_000;
    const top = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs).then((result) => result.result?.value || null).catch(() => null);
    if (top?.state) {
      return [{ frame: { id: "", name: "", depth: 0 }, value: top }];
    }
    const results = await evaluateAcross(session, expression, {
      timeoutMs,
    });
    return results;
  }, { timeoutMs: options.timeoutMs || 5_000 });
}

function pickTarget(targets, predicate) {
  const matches = targets.filter((target) => target.type === "page" && predicate(target));
  return matches.length === 1 ? matches[0] : null;
}

export async function runCjLoisAuthPreflight(config, options = {}, dependencies = {}) {
  const listed = await (dependencies.listChromeTargets || listChromeTargets)(config);
  if (!listed.available) {
    return {
      chromeDebugAvailable: false,
      cjState: "UNAVAILABLE",
      naverState: "UNAVAILABLE",
      recoveryReady: false,
      requiredUserActions: ["START_DEDICATED_CHROME"],
      externalWritesAllowed: false,
    };
  }
  const targets = listed.targets || [];
  const cjTarget = pickTarget(targets, (target) => isCjLoisTarget(target, config.cjLoisOrigins));
  const naverTarget = pickTarget(targets, (target) => (config.naverMailOrigins || [])
    .some((origin) => String(target.url || "").startsWith(origin)));
  const cjResults = cjTarget
    ? await (dependencies.inspectTarget || inspectTarget)(
      cjTarget, CJ_AUTH_PROBE_EXPRESSION, options, dependencies, config,
    ).catch(() => [])
    : [];
  const cjFrame = cjResults.find((entry) => entry?.value?.state === "AUTHENTICATED")
    || cjResults.find((entry) => ["CAPTCHA_REQUIRED", "OTP_REQUIRED", "LOGIN_REQUIRED"].includes(entry?.value?.state));
  const cjState = cjFrame?.value?.state || (cjTarget ? "UNKNOWN" : "TAB_MISSING");
  const naverLoginUrlVisible = String(naverTarget?.url || "").startsWith("https://nid.naver.com/");
  const naverResults = naverTarget && !naverLoginUrlVisible
    ? await (dependencies.inspectTarget || inspectTarget)(
      naverTarget, NAVER_MAIL_PROBE_EXPRESSION, options, dependencies, config,
    ).catch(() => [])
    : [];
  const naverFrame = naverResults.find((entry) => entry?.value?.state === "MAILBOX_READY")
    || naverResults.find((entry) => ["CAPTCHA_REQUIRED", "LOGIN_REQUIRED"].includes(entry?.value?.state));
  const naverState = naverFrame?.value?.state
    || (naverLoginUrlVisible
      ? "LOGIN_REQUIRED"
      : naverTarget ? "UNKNOWN" : "TAB_MISSING");
  const localCredentialAvailable = cjState === "LOGIN_REQUIRED"
    && !cjFrame?.value?.loginAutofillReady
    && await (dependencies.hasLocalCredential || hasCjLoisDpapiCredential)(config, dependencies);
  const requiredUserActions = [];
  if (!cjTarget) requiredUserActions.push("OPEN_CJ_LOIS_IN_DEDICATED_CHROME");
  else if (cjState === "CAPTCHA_REQUIRED") requiredUserActions.push("SOLVE_CJ_CAPTCHA_MANUALLY");
  else if (cjState === "LOGIN_REQUIRED"
    && !cjFrame?.value?.loginAutofillReady
    && !localCredentialAvailable) {
    requiredUserActions.push("SELECT_SAVED_CJ_CREDENTIALS");
  } else if (cjState === "UNKNOWN") requiredUserActions.push("LOGIN_CJ_LOIS_IN_DEDICATED_CHROME");
  if (cjState !== "AUTHENTICATED") {
    if (naverState === "CAPTCHA_REQUIRED") requiredUserActions.push("SOLVE_NAVER_CAPTCHA_MANUALLY");
    else if (naverState !== "MAILBOX_READY") requiredUserActions.push("LOGIN_NAVER_MAIL_IN_DEDICATED_CHROME");
  }
  const recoveryReady = cjState === "AUTHENTICATED"
    || (cjState === "LOGIN_REQUIRED"
      && (cjFrame?.value?.loginAutofillReady === true || localCredentialAvailable)
      && naverState === "MAILBOX_READY")
    || (cjState === "OTP_REQUIRED" && naverState === "MAILBOX_READY");
  return {
    chromeDebugAvailable: true,
    cjState,
    naverState,
    cjLoginAutofillReady: cjFrame?.value?.loginAutofillReady === true,
    cjLocalCredentialAvailable: localCredentialAvailable,
    recoveryReady,
    requiredUserActions,
    externalWritesAllowed: false,
  };
}

async function waitForCjState(session, states, options, dependencies) {
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.authWaitMs || AUTH_WAIT_MS);
  while (Date.now() < deadline) {
    const value = await session.send("Runtime.evaluate", {
      expression: CJ_AUTH_PROBE_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS).then((result) => result.result?.value).catch(() => null);
    const frame = value && states.includes(value.state)
      ? { frame: { id: "", name: "", depth: 0 }, value }
      : null;
    if (frame) return frame;
    await wait(options.pollMs || 500);
  }
  fail("CJ_AUTH_STATE_TIMEOUT", "CJ authentication did not reach an expected state.");
}

async function dispatchTrustedClick(session, point, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!point?.ready || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    fail(point?.error || "CJ_LOGIN_BUTTON_POINT_INVALID", "CJ login button could not be located.");
  }
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  }, timeoutMs);
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  }, timeoutMs);
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  }, timeoutMs);
  return { clicked: true };
}

async function replaceTextAtPoint(session, point, value, timeoutMs = DEFAULT_TIMEOUT_MS) {
  await dispatchTrustedClick(session, { ready: true, ...point }, timeoutMs);
  for (const character of value) {
    const upper = character.toUpperCase();
    const isLetter = /^[A-Z]$/.test(upper);
    const isDigit = /^[0-9]$/.test(character);
    const code = isLetter ? `Key${upper}` : isDigit ? `Digit${character}` : "";
    const virtualKeyCode = isLetter || isDigit ? upper.charCodeAt(0) : 0;
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: character,
      code,
      text: character,
      unmodifiedText: character,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    }, timeoutMs);
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: character,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    }, timeoutMs);
  }
}

async function fillCjLoginCredentialsWithCdp(session, points, credential, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!points?.ready || !points.id || !points.password) {
    fail(points?.error || "CJ_LOGIN_INPUT_POINTS_INVALID", "CJ login fields could not be located.");
  }
  await replaceTextAtPoint(session, points.id, credential.username, timeoutMs);
  await replaceTextAtPoint(session, points.password, credential.password, timeoutMs);
  return { filled: true };
}

async function readOtpFromNaver(config, options, dependencies) {
  const listed = await (dependencies.listChromeTargets || listChromeTargets)(config);
  const target = pickTarget(listed.targets || [], (item) => (config.naverMailOrigins || [])
    .some((origin) => String(item.url || "").startsWith(origin)));
  if (!target) fail("NAVER_MAIL_TARGET_MISSING", "A Naver Mail tab is required.");
  const connect = dependencies.withCdpTarget
    || ((selected, callback, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      callback,
      connectOptions,
    ));
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCdpExpressionAcrossFrames;
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const wait = dependencies.sleep || sleep;
  return connect(target, async (session) => {
    const inboxUrl = new URL("/v2/folders/-1", target.url).href;
    await session.send("Page.navigate", { url: inboxUrl }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const mailboxDeadline = Date.now() + (options.mailWaitMs || 30_000);
    let results = [];
    let frame = null;
    while (Date.now() < mailboxDeadline && !frame) {
      results = await evaluateAcross(session, NAVER_MAIL_PROBE_EXPRESSION, {
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      }).catch(() => []);
      const matches = results.filter((entry) => entry?.value?.state === "MAILBOX_READY");
      if (matches.length === 1) frame = matches[0];
      else await wait(options.pollMs || 500);
    }
    if (!frame) fail("NAVER_MAILBOX_LOAD_TIMEOUT", "Naver Mail did not return to the inbox.");
    const opened = await evaluateFrame(
      session, frame.frame, NAVER_OPEN_CJ_OTP_MAIL_EXPRESSION, options.timeoutMs || DEFAULT_TIMEOUT_MS,
    );
    if (opened?.error) fail(opened.error, "The latest CJ authentication email was not found.");
    const deadline = Date.now() + (options.mailWaitMs || 30_000);
    while (Date.now() < deadline) {
      results = await evaluateAcross(session, NAVER_EXTRACT_CJ_OTP_EXPRESSION, {
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      }).catch(() => []);
      const found = results.find((entry) => entry?.value?.found === true);
      if (found?.value?.otp) return String(found.value.otp);
      await wait(options.pollMs || 500);
    }
    fail("CJ_OTP_MAIL_READ_TIMEOUT", "A unique CJ authentication code was not found in the opened email.");
  }, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
}

export async function recoverCjLoisSession(config, options = {}, dependencies = {}) {
  const listed = await (dependencies.listChromeTargets || listChromeTargets)(config);
  if (!listed.available) fail("CHROME_CDP_UNAVAILABLE", "Dedicated Chrome DevTools is unavailable.");
  const target = pickTarget(listed.targets || [], (item) => isCjLoisTarget(item, config.cjLoisOrigins));
  if (!target) fail("CJ_LOIS_TARGET_COUNT_INVALID", "Exactly one CJ LOIS tab is required.");
  const connect = dependencies.withCdpTarget
    || ((selected, callback, connectOptions) => withBrowserCdpTarget(
      config,
      selected,
      callback,
      connectOptions,
    ));
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  return connect(target, async (session) => {
    const initial = await session.send("Runtime.evaluate", {
      expression: CJ_AUTH_PROBE_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const value = initial.result?.value;
    let frame = value?.state === "AUTHENTICATED"
      ? { frame: { id: "", name: "", depth: 0 }, value }
      : selectAuthFrame(
        value ? [{ frame: { id: "", name: "", depth: 0 }, value }] : [],
        ["LOGIN_REQUIRED", "OTP_REQUIRED", "CAPTCHA_REQUIRED"],
      );
    if (frame.value.state === "AUTHENTICATED") {
      return { authenticated: true, recovered: false, otpUsed: false };
    }
    if (frame.value.state === "CAPTCHA_REQUIRED") {
      fail("CJ_CAPTCHA_REQUIRED", "CJ requires manual CAPTCHA completion.");
    }
    if (frame.value.state === "LOGIN_REQUIRED") {
      const alertPoint = await evaluateFrame(
        session, frame.frame, CJ_AUTH_LOGIN_ALERT_POINT_EXPRESSION, options.timeoutMs || DEFAULT_TIMEOUT_MS,
      );
      if (alertPoint?.error) fail(alertPoint.error, "CJ login validation alert could not be closed.");
      if (alertPoint?.present) {
        const dismissed = await evaluateFrame(
          session, frame.frame, CJ_AUTH_DISMISS_LOGIN_ALERT_EXPRESSION, options.timeoutMs || DEFAULT_TIMEOUT_MS,
        );
        if (dismissed?.error || !dismissed?.dismissed) {
          fail(dismissed?.error || "CJ_LOGIN_ALERT_DISMISS_FAILED", "CJ login validation alert could not be closed.");
        }
        await (dependencies.sleep || sleep)(200);
        const remainingAlert = await evaluateFrame(
          session, frame.frame, CJ_AUTH_LOGIN_ALERT_POINT_EXPRESSION, options.timeoutMs || DEFAULT_TIMEOUT_MS,
        );
        if (remainingAlert?.present) {
          fail("CJ_LOGIN_ALERT_DISMISS_FAILED", "CJ login validation alert remained open.");
        }
      }
      if (!frame.value.loginAutofillReady) {
        const credential = await (dependencies.loadCredential || readCjLoisDpapiCredential)(config, dependencies);
        const filled = dependencies.fillCredential
          ? await dependencies.fillCredential(session, credential, options.timeoutMs || DEFAULT_TIMEOUT_MS)
          : await evaluateFrame(
            session,
            frame.frame,
            `(${fillCjLoginCredentials.toString()})(${JSON.stringify(credential.username)},${JSON.stringify(credential.password)})`,
            options.timeoutMs || DEFAULT_TIMEOUT_MS,
          );
        const lengths = await evaluateFrame(
          session, frame.frame, CJ_AUTH_LOGIN_INPUT_LENGTHS_EXPRESSION, options.timeoutMs || DEFAULT_TIMEOUT_MS,
        );
        if (lengths?.idLength !== credential.username.length
          || lengths?.passwordLength !== credential.password.length) {
          credential.password = "";
          fail("CJ_LOGIN_CREDENTIAL_LENGTH_MISMATCH", "CJ login fields did not receive the complete credential.");
        }
        credential.password = "";
        if (filled?.error || !filled?.filled) {
          fail(filled?.error || "CJ_LOGIN_CREDENTIAL_FILL_FAILED", "CJ local credential could not fill the login form.");
        }
      }
      const clicked = await evaluateFrame(
        session, frame.frame, CJ_AUTH_CLICK_LOGIN_EXPRESSION, options.timeoutMs || DEFAULT_TIMEOUT_MS,
      );
      if (clicked?.error) fail(clicked.error, "CJ saved credentials are not ready for login.");
      frame = await waitForCjState(
        session, ["AUTHENTICATED", "OTP_REQUIRED", "CAPTCHA_REQUIRED"], options, dependencies,
      );
      if (frame.value.state === "AUTHENTICATED") {
        return { authenticated: true, recovered: true, otpUsed: false };
      }
      if (frame.value.state === "CAPTCHA_REQUIRED") {
        fail("CJ_CAPTCHA_REQUIRED", "CJ requires manual CAPTCHA completion.");
      }
    }
    const otp = await (dependencies.readOtpFromNaver || readOtpFromNaver)(config, options, dependencies);
    if (!/^[0-9]{4,8}$/.test(otp)) fail("CJ_OTP_INVALID", "The CJ authentication code is invalid.");
    const submitted = await evaluateFrame(
      session,
      frame.frame,
      `(${submitCjOtp.toString()})(${JSON.stringify(otp)})`,
      options.timeoutMs || DEFAULT_TIMEOUT_MS,
    );
    if (submitted?.error) fail(submitted.error, "The CJ authentication code could not be submitted.");
    frame = await waitForCjState(session, ["AUTHENTICATED", "CAPTCHA_REQUIRED"], options, dependencies);
    if (frame.value.state !== "AUTHENTICATED") fail("CJ_AUTH_RECOVERY_FAILED", "CJ login recovery failed.");
    return { authenticated: true, recovered: true, otpUsed: true };
  }, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
}

export const CJ_LOIS_AUTH_RECOVERY_RULES = Object.freeze({
  credentialSource: "WINDOWS_DPAPI_OR_CHROME_SAVED_CREDENTIALS",
  otpSource: "NAVER_MAIL_ACTIVE_SESSION_ONLY",
  captchaPolicy: "MANUAL_ONLY",
  plaintextPersistence: false,
  encryptedPersistence: "WINDOWS_LOCAL_MACHINE_DPAPI_V1",
});
