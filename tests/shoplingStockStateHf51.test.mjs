import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF51 packages a durable wake-only parallel resume alarm and shared terminal observer as v0.6.16", async () => {
  const [route, background, resultObserver] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf51/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v075.js", "utf8"),
    readFile("public/shopling-stock-state-sync/content-stock-result-v051.js", "utf8"),
  ]);
  assert.match(route, /getHf50Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.15"/);
  assert.match(route, /const VERSION = "0\.6\.16"/);
  assert.match(route, /alarmDispatchesShoplingWrite: false/);
  assert.match(route, /content-stock-result-v051\.js/);
  assert.match(resultObserver, /상품\\s\*상태\\s\*변경\\s\*전송이\\s\*완료되었습니다/);
  assert.match(background, /importScripts\("background-v074\.js"\)/);
  assert.match(background, /state\.secondStarted !== true/);
  assert.match(background, /chrome\.storage\.onChanged\.addListener/);
  assert.match(background, /chrome\.alarms\.onAlarm\.addListener/);
  assert.doesNotMatch(background, /chrome\.tabs\.update/);
  assert.doesNotMatch(background, /chrome\.windows\.create/);
  assert.doesNotMatch(background, /STOCK_SYNC_EXECUTE/);
});

test("HF51 classifies the real BBD8-1 shared footer for the exact active OPTION owner", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/content-stock-result-v051.js",
    "utf8",
  );
  const sent = [];
  const document = {
    body: {
      innerText:
        "상품상태 변경 전송이 완료되었습니다. 총건수 108 성공건수 83 실패건수 25",
    },
    documentElement: {},
    readyState: "complete",
    title: "샵플링 상품상태 변경 전송 결과",
  };
  const window = { addEventListener() {}, setInterval() { return 1; } };
  window.top = window;
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.16" }),
      sendMessage: async (message) => sent.push(message),
    },
  };
  const location = {
    href: "https://a.shopling.co.kr/prod_a/prod_status_trsmt.phtml",
  };
  new Function(
    "chrome",
    "document",
    "window",
    "location",
    source,
  )(chrome, document, window, location);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].evidence.sharedStateComplete, true);
  assert.equal(sent[0].evidence.optionComplete, true);
  assert.equal(sent[0].evidence.productComplete, true);
  assert.equal(sent[0].evidence.successCount, 83);
  assert.equal(sent[0].evidence.failureCount, 25);
});

test("HF51 keeps wakeup armed across a worker restart and clears it after Lane 2 starts", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v075.js",
    "utf8",
  );
  const key = "commerceOsShoplingStockParallelV028";
  const alarmName = "commerce-os-shopling-stock-parallel-resume-hf51";
  let state = {
    batchId: "incident-bzz341-bbd8",
    status: "RUNNING",
    firstJobId: "BZZ341-1",
    secondJobId: "BBD8-1",
    secondStarted: false,
    results: { "BZZ341-1": { outcome: "SUCCEEDED" } },
  };
  const created = [];
  const cleared = [];
  const storageListeners = [];
  const alarmListeners = [];
  const chrome = {
    storage: {
      local: { get: async () => ({ [key]: state }) },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
    alarms: {
      create: async (name, options) => created.push({ name, options }),
      clear: async (name) => cleared.push(name),
      onAlarm: { addListener: (listener) => alarmListeners.push(listener) },
    },
  };
  const runWorker = () => new Function("chrome", "importScripts", source)(chrome, () => {});
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  runWorker();
  await flush();
  assert.equal(created.at(-1)?.name, alarmName);

  // A fresh MV3 worker load must re-arm the same persisted checkpoint without
  // dispatching Lane 2 itself. HF28's existing secondStarted guard remains the
  // only owner of the actual start.
  runWorker();
  await flush();
  assert.equal(created.filter((entry) => entry.name === alarmName).length, 2);

  state = { ...state, secondStarted: true };
  storageListeners.at(-1)?.({ [key]: { newValue: state } }, "local");
  await flush();
  assert.equal(cleared.at(-1), alarmName);

  alarmListeners.at(-1)?.({ name: alarmName });
  await flush();
  assert.equal(cleared.at(-1), alarmName);
});
