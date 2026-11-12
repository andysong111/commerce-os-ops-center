import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDomeggookExtensionPlan,
  createDomeggookCdpBrowser,
  isDomeggookSettledPage,
  isDomeggookUpdateReady,
  runDomeggookPeriodExtensionWithBrowser,
  runDomeggookPeriodExtension,
  submitLogin,
  targetRegistrationDate,
  validateDomeggookUpdatePreflight,
} from "../local-agent/src/domeggook-period-extension.mjs";

function listing({ totalCount = 3, items } = {}) {
  return {
    authenticated: true,
    pageRole: "PERIOD_EXPIRED_LIST",
    totalCount,
    items: items || [
      { itemNo: "61942623", status: "DONE" },
      { itemNo: "40449639", status: "DONE" },
      { itemNo: "61924681", status: "DONE" },
    ],
    accountContext: "송승준 everysale999 (사업자) 로그아웃",
  };
}

function update(overrides = {}) {
  return {
    authenticated: true,
    pageRole: "PERIOD_EXTENSION",
    itemNos: ["61942623", "40449639", "61924681"],
    paidOptionExtension: false,
    chargeWon: 0,
    extensionDayValues: [90, 90, 90],
    executeControlPresent: true,
    success: false,
    ...overrides,
  };
}

test("live 2026-11-12 evidence maps a 90-day policy to the observed exclusive picker date", () => {
  assert.equal(targetRegistrationDate(new Date("2026-11-11T19:00:00.000Z"), 90), "2027-02-11");
});

test("plan keeps only exact approved item numbers and is deterministic", () => {
  const input = listing();
  const first = buildDomeggookExtensionPlan(input, {
    extensionDays: 90,
    now: new Date("2026-11-11T19:00:00.000Z"),
  });
  const second = buildDomeggookExtensionPlan(input, {
    extensionDays: 90,
    now: new Date("2026-11-11T19:00:00.000Z"),
  });
  assert.deepEqual(first.itemNos, ["61942623", "40449639", "61924681"]);
  assert.equal(first.targetDate, "2027-02-11");
  assert.equal(first.fingerprint, second.fingerprint);
});

test("plan fails closed for login loss, unreadable rows, and non-DONE status", () => {
  assert.throws(
    () => buildDomeggookExtensionPlan({ ...listing(), authenticated: false }),
    { code: "DOMEGGOOK_LOGIN_REQUIRED" },
  );
  assert.throws(
    () => buildDomeggookExtensionPlan(listing({ totalCount: 1, items: [] })),
    { code: "DOMEGGOOK_PERIOD_ITEMS_MISSING" },
  );
  assert.throws(
    () => buildDomeggookExtensionPlan(listing({
      totalCount: 1,
      items: [{ itemNo: "61942623", status: "WAIT" }],
    })),
    { code: "DOMEGGOOK_UNAPPROVED_ITEM_BLOCKED" },
  );
});

test("navigation ignores transient unauthenticated DOM and settles only on a real list or login page", () => {
  assert.equal(isDomeggookSettledPage({ pageRole: "UNKNOWN", authenticated: false }, "PERIOD_EXPIRED_LIST"), false);
  assert.equal(isDomeggookSettledPage({ pageRole: "UNKNOWN", loginPage: true }, "PERIOD_EXPIRED_LIST"), true);
  assert.equal(isDomeggookSettledPage({ pageRole: "PERIOD_EXPIRED_LIST" }, "PERIOD_EXPIRED_LIST"), true);
});

test("update navigation waits for the real controls and every selected item", () => {
  const expected = ["61942623", "40449639", "61924681"];
  assert.equal(isDomeggookUpdateReady({ pageRole: "PERIOD_EXTENSION" }, expected), false);
  assert.equal(isDomeggookUpdateReady({
    pageRole: "PERIOD_EXTENSION",
    dateRegPresent: true,
    executeControlPresent: true,
    itemNos: expected.slice(0, 2),
  }, expected), false);
  assert.equal(isDomeggookUpdateReady({
    pageRole: "PERIOD_EXTENSION",
    dateRegPresent: true,
    executeControlPresent: true,
    itemNos: expected,
  }, expected), true);
  assert.equal(isDomeggookUpdateReady({ loginPage: true }, expected), true);
});

test("plan fails closed when the dedicated browser has a different account", () => {
  assert.throws(
    () => buildDomeggookExtensionPlan(listing(), { accountId: "anotherSeller" }),
    { code: "DOMEGGOOK_ACCOUNT_MISMATCH" },
  );
  assert.equal(
    buildDomeggookExtensionPlan(listing(), { accountId: "everysale999" }).mode,
    "READY",
  );
});

test("dry-run reads the exact scope but never opens or executes the update page", async () => {
  const calls = [];
  const browser = {
    async openListing() { calls.push("openListing"); },
    async readListing() { calls.push("readListing"); return listing(); },
    async openUpdate() { calls.push("openUpdate"); },
    async configureUpdate() { calls.push("configureUpdate"); },
    async readUpdate() { calls.push("readUpdate"); },
    async executeUpdate() { calls.push("executeUpdate"); },
  };
  const result = await runDomeggookPeriodExtensionWithBrowser(browser, {
    execute: false,
    now: new Date("2026-11-11T19:00:00.000Z"),
  });
  assert.equal(result.status, "planned");
  assert.equal(result.verification, "NOT_EXECUTED");
  assert.deepEqual(calls, ["openListing", "readListing"]);
});

test("stored credential logs in once before a dry-run and is never returned in the receipt", async () => {
  const calls = [];
  let reads = 0;
  const browser = {
    async openListing() { calls.push("openListing"); },
    async readListing() {
      reads += 1;
      return reads === 1
        ? { authenticated: false, loginPage: true, pageRole: "UNKNOWN" }
        : listing();
    },
    async login(accountId, password) { calls.push(["login", accountId, password]); },
  };
  const result = await runDomeggookPeriodExtensionWithBrowser(browser, {
    execute: false,
    accountId: "everysale999",
    password: "secret-value",
    now: new Date("2026-11-11T19:00:00.000Z"),
  });
  assert.equal(result.status, "planned");
  assert.deepEqual(calls, ["openListing", ["login", "everysale999", "secret-value"], "openListing"]);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("login submit reports success before the navigation-triggering click runs", async () => {
  const originalDocument = globalThis.document;
  const originalInput = globalThis.HTMLInputElement;
  class FakeInput {
    set value(next) { this.currentValue = next; }
    get value() { return this.currentValue || ""; }
    dispatchEvent() {}
  }
  const accountInput = new FakeInput();
  Object.assign(accountInput, { name: "id", id: "idInput" });
  const passwordInput = new FakeInput();
  let clicked = false;
  const submit = { textContent: "", value: "로그인하기", click: () => { clicked = true; } };
  const form = {
    querySelectorAll(selector) {
      return selector.includes('input:not') ? [accountInput] : [submit];
    },
    querySelector() { return submit; },
  };
  passwordInput.form = form;
  globalThis.HTMLInputElement = FakeInput;
  globalThis.document = {
    querySelector(selector) {
      if (selector.includes("captcha")) return null;
      if (selector === 'input[type="password"]') return passwordInput;
      return null;
    },
  };
  try {
    assert.deepEqual(submitLogin({ accountId: "everysale999", password: "fixture-secret" }), { ok: true });
    assert.equal(clicked, false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(clicked, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLInputElement = originalInput;
  }
});

test("Chrome readiness retries transient unavailable target listings", async () => {
  let attempts = 0;
  const result = await runDomeggookPeriodExtension(
    { chromeDebugBaseUrl: "http://127.0.0.1:9600" },
    { execute: false, chromeReadyAttempts: 3 },
    {
      listChromeTargets: async () => {
        attempts += 1;
        return attempts < 3
          ? { available: false, targets: [] }
          : { available: true, targets: [{ id: "fixture", type: "page", url: "https://www.domeggook.com/" }] };
      },
      sleep: async () => {},
      withBrowserCdpTarget: async (_target, handler) => handler({}),
    },
  ).catch((error) => error);
  assert.equal(attempts, 3);
  assert.notEqual(result.code, "DOMEGGOOK_CHROME_UNAVAILABLE");
});

test("execute requires zero charge and paid-option extension off", () => {
  const plan = buildDomeggookExtensionPlan(listing(), {
    now: new Date("2026-11-11T19:00:00.000Z"),
  });
  assert.throws(
    () => validateDomeggookUpdatePreflight(update({ chargeWon: null }), plan),
    { code: "DOMEGGOOK_NONZERO_CHARGE_BLOCKED" },
  );
  assert.throws(
    () => validateDomeggookUpdatePreflight(update({ paidOptionExtension: true }), plan),
    { code: "DOMEGGOOK_PAID_OPTION_EXTENSION_BLOCKED" },
  );
  assert.throws(
    () => validateDomeggookUpdatePreflight(update({ extensionDayValues: [91, 90, 90] }), plan),
    { code: "DOMEGGOOK_EXTENSION_DAYS_EXCEED_POLICY" },
  );
});

test("execute acknowledges success only after selected items disappear on readback", async () => {
  let listingReads = 0;
  const calls = [];
  const browser = {
    async openListing() { calls.push("openListing"); },
    async readListing() {
      calls.push("readListing");
      listingReads += 1;
      return listingReads === 1 ? listing() : listing({ totalCount: 0, items: [] });
    },
    async openUpdate(itemNos) { calls.push(["openUpdate", itemNos]); },
    async configureUpdate(targetDate) { calls.push(["configureUpdate", targetDate]); },
    async readUpdate() { calls.push("readUpdate"); return update(); },
    async executeUpdate() {
      calls.push("executeUpdate");
      return { success: true, dialogs: ["기간연장을 실행하겠습니까?", "기간연장이 완료되었습니다"] };
    },
  };
  const result = await runDomeggookPeriodExtensionWithBrowser(browser, {
    execute: true,
    now: new Date("2026-11-11T19:00:00.000Z"),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.verification, "SELECTED_ITEMS_ABSENT_FROM_PERIOD_EXPIRED_LIST");
  assert.deepEqual(calls.at(-2), "openListing");
  assert.deepEqual(calls.at(-1), "readListing");
});

test("execute does not report success when any selected item remains expired", async () => {
  let listingReads = 0;
  const browser = {
    async openListing() {},
    async readListing() {
      listingReads += 1;
      return listingReads === 1
        ? listing()
        : listing({ totalCount: 1, items: [{ itemNo: "61942623", status: "DONE" }] });
    },
    async openUpdate() {},
    async configureUpdate() {},
    async readUpdate() { return update(); },
    async executeUpdate() { return { success: true, dialogs: [] }; },
  };
  await assert.rejects(
    runDomeggookPeriodExtensionWithBrowser(browser, {
      execute: true,
      now: new Date("2026-11-11T19:00:00.000Z"),
    }),
    { code: "DOMEGGOOK_READBACK_MISMATCH" },
  );
});

test("CDP execution accepts only the exact confirmation and completion dialogs", async () => {
  let dialogListener = null;
  const session = {
    on(method, listener) {
      assert.equal(method, "Page.javascriptDialogOpening");
      dialogListener = listener;
      return () => { dialogListener = null; };
    },
    async send(method, params) {
      if (method === "Page.enable" || method === "Page.handleJavaScriptDialog") return {};
      if (method === "Runtime.evaluate") {
        assert.match(params.expression, /clickExecuteControl|기간연장 실행하기/);
        dialogListener({ message: "기간연장을 실행하겠습니까?" });
        dialogListener({ message: "기간연장이 완료되었습니다" });
        return { result: { value: { ok: true } } };
      }
      assert.fail(`unexpected CDP method: ${method}`);
    },
  };
  const browser = createDomeggookCdpBrowser(session, { timeoutMs: 1_000 });
  const result = await browser.executeUpdate();
  assert.equal(result.success, true);
  assert.deepEqual(result.dialogs, ["기간연장을 실행하겠습니까?", "기간연장이 완료되었습니다"]);
});

test("CDP execution rejects an unexpected dialog instead of clicking through it", async () => {
  let dialogListener = null;
  const session = {
    on(_method, listener) { dialogListener = listener; return () => {}; },
    async send(method) {
      if (method === "Page.enable" || method === "Page.handleJavaScriptDialog") return {};
      if (method === "Runtime.evaluate") {
        dialogListener({ message: "예상하지 못한 경고" });
        return { result: { value: { ok: true } } };
      }
      return {};
    },
  };
  const browser = createDomeggookCdpBrowser(session, { timeoutMs: 500 });
  await assert.rejects(browser.executeUpdate(), { code: "DOMEGGOOK_UNEXPECTED_DIALOG" });
});

test("live image-based execute control remains supported", async () => {
  const source = await readFile("local-agent/src/domeggook-period-extension.mjs", "utf8");
  assert.match(source, /img\[alt\]/);
  assert.match(source, /element\.alt/);
  assert.match(source, /noUpdateAdvT/);
});

test("scheduler is reversible and remains dry-run unless Execute is explicit", async () => {
  const [install, uninstall, runner] = await Promise.all([
    readFile("local-agent/scripts/install-domeggook-period-extension-task.ps1", "utf8"),
    readFile("local-agent/scripts/uninstall-domeggook-period-extension-task.ps1", "utf8"),
    readFile("local-agent/scripts/run-domeggook-period-extension.ps1", "utf8"),
  ]);
  assert.match(install, /\[switch\]\$Execute/);
  assert.match(install, /if \(\$Execute\).*\-Execute/);
  assert.match(install, /New-ScheduledTaskTrigger -Daily/);
  assert.match(install, /\[string\]\$At = "00:10"/);
  assert.match(install, /\-AccountId/);
  assert.match(uninstall, /Unregister-ScheduledTask/);
  assert.match(runner, /if \(\$Execute\).*--execute.*else.*--dry-run/s);
});
