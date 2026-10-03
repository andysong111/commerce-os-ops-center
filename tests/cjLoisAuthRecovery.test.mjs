import assert from "node:assert/strict";
import test from "node:test";
import {
  CJ_AUTH_CLICK_LOGIN_EXPRESSION,
  CJ_AUTH_DISMISS_LOGIN_ALERT_EXPRESSION,
  CJ_AUTH_FILL_CREDENTIALS_SOURCE,
  CJ_AUTH_LOGIN_BUTTON_POINT_EXPRESSION,
  CJ_AUTH_LOGIN_ALERT_POINT_EXPRESSION,
  CJ_AUTH_LOGIN_INPUT_LENGTHS_EXPRESSION,
  CJ_AUTH_LOGIN_INPUT_POINTS_EXPRESSION,
  CJ_AUTH_PROBE_EXPRESSION,
  CJ_AUTH_SUBMIT_OTP_SOURCE,
  CJ_LOIS_AUTH_RECOVERY_RULES,
  NAVER_EXTRACT_CJ_OTP_EXPRESSION,
  NAVER_OPEN_CJ_OTP_MAIL_EXPRESSION,
  extractCjOtp,
  runCjLoisAuthPreflight,
  recoverCjLoisSession,
  selectAuthFrame,
} from "../local-agent/src/cj-lois-auth-recovery.mjs";

const config = {
  cjLoisOrigins: ["https://loisparcelp.cjlogistics.com/"],
  naverMailOrigins: ["https://mail.naver.com/", "https://nid.naver.com/"],
};

test("auth expressions never expose saved credential values", () => {
  assert.match(CJ_AUTH_PROBE_EXPRESSION, /loginAutofillReady/);
  assert.match(CJ_AUTH_PROBE_EXPRESSION, /CMCMLI0005M/);
  assert.match(CJ_AUTH_PROBE_EXPRESSION, /CMCMLI0002M/);
  assert.match(CJ_AUTH_CLICK_LOGIN_EXPRESSION, /CJ_LOGIN_AUTOFILL_NOT_READY/);
  assert.match(CJ_AUTH_DISMISS_LOGIN_ALERT_EXPRESSION, /app\/cmn\/Modal/);
  assert.match(CJ_AUTH_LOGIN_BUTTON_POINT_EXPRESSION, /getBoundingClientRect/);
  assert.match(CJ_AUTH_FILL_CREDENTIALS_SOURCE, /CJ_LOGIN_APP_INSTANCE_COUNT_INVALID/);
  assert.match(CJ_AUTH_LOGIN_INPUT_POINTS_EXPRESSION, /getBoundingClientRect/);
  assert.match(CJ_AUTH_LOGIN_INPUT_LENGTHS_EXPRESSION, /passwordLength/);
  assert.match(CJ_AUTH_LOGIN_ALERT_POINT_EXPRESSION, /필수\\s\*입력/);
  assert.match(CJ_AUTH_SUBMIT_OTP_SOURCE, /ipbOtpNo/);
  assert.match(CJ_AUTH_SUBMIT_OTP_SOURCE, /CPR_DATAMAP/);
  assert.match(NAVER_EXTRACT_CJ_OTP_EXPRESSION, /found/);
  assert.match(NAVER_OPEN_CJ_OTP_MAIL_EXPRESSION, /mail_title_link/);
  assert.doesNotMatch(CJ_AUTH_PROBE_EXPRESSION, /passwordValue|loginIdValue/);
  assert.equal(CJ_LOIS_AUTH_RECOVERY_RULES.plaintextPersistence, false);
  assert.equal(CJ_LOIS_AUTH_RECOVERY_RULES.encryptedPersistence, "WINDOWS_LOCAL_MACHINE_DPAPI_V1");
});

test("auth preflight accepts a current-user DPAPI credential when Chrome autofill is unavailable", async () => {
  const targets = [
    { id: "cj", type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" },
    { id: "naver", type: "page", url: "https://mail.naver.com/" },
  ];
  const result = await runCjLoisAuthPreflight(config, {}, {
    listChromeTargets: async () => ({ available: true, targets }),
    inspectTarget: async (target) => target.id === "cj"
      ? [{ frame: { id: "cj" }, value: { state: "LOGIN_REQUIRED", loginAutofillReady: false } }]
      : [{ frame: { id: "naver" }, value: { state: "MAILBOX_READY" } }],
    hasLocalCredential: async () => true,
  });
  assert.equal(result.recoveryReady, true);
  assert.equal(result.cjLocalCredentialAvailable, true);
  assert.deepEqual(result.requiredUserActions, []);
});

test("auth recovery fills a DPAPI credential without returning or persisting the password", async () => {
  const target = { id: "cj", type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" };
  let state = "LOGIN_REQUIRED";
  let receivedCredential = null;
  const session = {
    async send(method, params) {
      assert.equal(method, "Runtime.evaluate");
      if (params.expression === CJ_AUTH_PROBE_EXPRESSION) {
        return { result: { value: { state, loginAutofillReady: false } } };
      }
      throw new Error("unexpected direct expression");
    },
  };
  const result = await recoverCjLoisSession(config, { pollMs: 0 }, {
    listChromeTargets: async () => ({ available: true, targets: [target] }),
    withCdpTarget: async (_target, handler) => handler(session),
    loadCredential: async () => ({ username: "operator-id", password: "local-secret" }),
    evaluateInFrame: async (_session, _frame, expression) => {
      if (expression === CJ_AUTH_LOGIN_ALERT_POINT_EXPRESSION) return { present: false };
      if (expression === CJ_AUTH_LOGIN_INPUT_LENGTHS_EXPRESSION) {
        return { idLength: 9, passwordLength: 12 };
      }
      if (expression === CJ_AUTH_CLICK_LOGIN_EXPRESSION) {
        state = "AUTHENTICATED";
        return { clicked: true };
      }
      throw new Error("unexpected frame expression");
    },
    fillCredential: async (_session, credential) => {
      receivedCredential = { ...credential };
      return { filled: true };
    },
    sleep: async () => {},
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.otpUsed, false);
  assert.deepEqual(receivedCredential, { username: "operator-id", password: "local-secret" });
  assert.doesNotMatch(JSON.stringify(result), /local-secret/);
});

test("OTP extraction requires both a CJ sender marker and one unique code", () => {
  assert.equal(extractCjOtp("CJ대한통운 기업고객시스템 인증번호 123456"), "123456");
  assert.equal(extractCjOtp("CJ대한통운 인증번호 발송 아래 코드를 입력하세요. 123456 인증번호는 3분 내 입력"), "123456");
  assert.equal(extractCjOtp("다른 서비스 인증번호 123456"), "");
  assert.equal(extractCjOtp("CJ대한통운 인증번호 123456, 이전 인증번호 654321"), "");
});

test("auth frame selection fails closed unless unique", () => {
  const selected = selectAuthFrame([
    { frame: { id: "root" }, value: { state: "UNKNOWN" } },
    { frame: { id: "login" }, value: { state: "LOGIN_REQUIRED" } },
  ], ["LOGIN_REQUIRED"]);
  assert.equal(selected.frame.id, "login");
  assert.throws(() => selectAuthFrame([], ["LOGIN_REQUIRED"]), {
    code: "AUTH_FRAME_COUNT_INVALID",
  });
});

test("auth preflight permits recovery only with active Naver mail and saved CJ credentials", async () => {
  const targets = [
    { id: "cj", type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" },
    { id: "naver", type: "page", url: "https://mail.naver.com/" },
  ];
  const ready = await runCjLoisAuthPreflight(config, {}, {
    listChromeTargets: async () => ({ available: true, targets }),
    inspectTarget: async (target) => target.id === "cj"
      ? [{ frame: { id: "cj" }, value: { state: "LOGIN_REQUIRED", loginAutofillReady: true } }]
      : [{ frame: { id: "naver" }, value: { state: "MAILBOX_READY" } }],
  });
  assert.equal(ready.recoveryReady, true);
  assert.deepEqual(ready.requiredUserActions, []);

  const blocked = await runCjLoisAuthPreflight(config, {}, {
    listChromeTargets: async () => ({ available: true, targets }),
    inspectTarget: async (target) => target.id === "cj"
      ? [{ frame: { id: "cj" }, value: { state: "LOGIN_REQUIRED", loginAutofillReady: false } }]
      : [{ frame: { id: "naver" }, value: { state: "LOGIN_REQUIRED" } }],
  });
  assert.equal(blocked.recoveryReady, false);
  assert.deepEqual(blocked.requiredUserActions, [
    "SELECT_SAVED_CJ_CREDENTIALS",
    "LOGIN_NAVER_MAIL_IN_DEDICATED_CHROME",
  ]);
});

test("auth preflight reports an unrecognized CJ page instead of silently proceeding", async () => {
  const result = await runCjLoisAuthPreflight(config, {}, {
    listChromeTargets: async () => ({
      available: true,
      targets: [
        { id: "cj", type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" },
        { id: "naver", type: "page", url: "https://mail.naver.com/" },
      ],
    }),
    inspectTarget: async (target) => target.id === "cj"
      ? [{ frame: { id: "cj" }, value: { state: "UNKNOWN" } }]
      : [{ frame: { id: "naver" }, value: { state: "MAILBOX_READY" } }],
  });
  assert.equal(result.recoveryReady, false);
  assert.deepEqual(result.requiredUserActions, ["LOGIN_CJ_LOIS_IN_DEDICATED_CHROME"]);
});

test("auth preflight recognizes a visible Naver login URL even when page inspection is unavailable", async () => {
  const result = await runCjLoisAuthPreflight(config, {}, {
    listChromeTargets: async () => ({
      available: true,
      targets: [
        { id: "cj", type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" },
        { id: "naver", type: "page", url: "https://nid.naver.com/nidlogin.login" },
      ],
    }),
    inspectTarget: async (target) => target.id === "cj"
      ? [{ frame: { id: "cj" }, value: { state: "AUTHENTICATED" } }]
      : [],
  });
  assert.equal(result.cjState, "AUTHENTICATED");
  assert.equal(result.naverState, "LOGIN_REQUIRED");
  assert.equal(result.recoveryReady, true);
  assert.deepEqual(result.requiredUserActions, []);
});
