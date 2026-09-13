import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { unzipSync } from "fflate";
import * as separation from "../src/lib/shoplingTitleWorkflowSeparation.ts";

const require = createRequire(import.meta.url);
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let baseEntries;
const routeSource = await readFile(new URL("../src/app/api/shopling-account-title-bridge/download/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const routeModule = { exports: {} };
const localRequire = (id) => {
  if (id === "@/lib/shoplingTitleWorkflowSeparation") return {
    ...separation,
    separateShoplingTitleWorkflow(entries) {
      baseEntries = entries;
      return separation.separateShoplingTitleWorkflow(entries);
    },
  };
  return require(id);
};
new Function("require", "module", "exports", compiled)(localRequire, routeModule, routeModule.exports);
// Calls only the download builder: local files -> ZIP. No Shopling/DB requests.
const response = await routeModule.exports.GET();
const zip = new Uint8Array(await response.arrayBuffer());
const entries = unzipSync(zip);
const source = (file) => decoder.decode(entries[file]);
const manifest = JSON.parse(source("manifest.json"));

if (process.env.SHOPLING_SEPARATED_ARTIFACT_DIR) {
  await mkdir(process.env.SHOPLING_SEPARATED_ARTIFACT_DIR, { recursive: true });
  await writeFile(`${process.env.SHOPLING_SEPARATED_ARTIFACT_DIR}/${separation.SEPARATED_TITLE_FILENAME}`, zip);
}

test("the actual download endpoint emits optional-title v0.6.4", () => {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /v0\.6\.4\.zip/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(manifest.version, "0.6.4");
  assert.match(manifest.name, /선택형 상품명 정리/);
  assert.match(source("VERSION.txt"), /Marketplace pipeline: excluded/);
});

test("combined pipeline is absent from archive, manifest, and background imports", () => {
  for (const name of [
    "content-shopling-pipeline.js", "content-shopling-pipeline-frame-bridge.js",
    "content-shopling-onebutton-stability-v054.js", "background-shopling-pipeline.js",
    "content-shopling-product-list-registry-bridge.js", "background-shopling-title-registry.js",
  ]) {
    assert.equal(entries[name], undefined, name);
    assert.ok(!JSON.stringify(manifest).includes(name), name);
    assert.ok(!source("background-shopling-root.js").includes(name), name);
  }
  const executable = Object.entries(entries).filter(([name]) => name.endsWith(".js")).map(([, bytes]) => decoder.decode(bytes)).join("\n");
  assert.doesNotMatch(executable, /commerce-os-shopling-pipeline-market-start|ensureTitleToMarketHandoff|commerce-os-shopling-pipeline-claim/);
});

test("every packaged JavaScript is syntax valid and every manifest dependency exists", () => {
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith(".js")) assert.doesNotThrow(() => new Function(decoder.decode(bytes)), name);
  }
  assert.ok(entries[manifest.background.service_worker]);
  for (const script of manifest.content_scripts) for (const name of script.js) assert.ok(entries[name], name);
});

test("lifecycle, its keeper alarm, permissions and read-only price verification are preserved", () => {
  const baseManifest = JSON.parse(decoder.decode(baseEntries["manifest.json"]));
  assert.deepEqual(manifest.permissions, baseManifest.permissions);
  assert.deepEqual(manifest.host_permissions, baseManifest.host_permissions);
  for (const name of Object.keys(baseEntries).filter((name) => /lifecycle|price-readback/.test(name))) {
    assert.deepEqual(entries[name], baseEntries[name], name);
  }
  assert.match(source("background-shopling-root.js"), /SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM/);
  assert.match(source("content-shopling-lifecycle-executor.js"), /commerce-os-shopling-lifecycle-main-execute/);
});

test("manual cleanup is current-query scoped, requires consent and has no marketplace transition", () => {
  const list = source("content-shopling-product-list-batch.js");
  assert.match(list, /async function runBatch\(\) \{\s+if \(!window\.confirm/);
  assert.match(list, /collected\.expected > collected\.goodsKeys\.length/);
  assert.match(list, /collectBatchGoodsKeys/);
  assert.match(list, /마켓전송 없음/);
  assert.match(source("content-shopling-account-titles.js"), /async function runManualSingle\(\) \{\s+if \(!window\.confirm/);
});

test("manual messages, run identifiers and storage cannot reuse old pipeline snapshots", () => {
  const background = source("background-shopling-title-batch.js");
  assert.match(background, /commerceOsShoplingTitleBatchRunV064/);
  assert.match(background, /commerceOsShoplingTitleBatchLastRunV064/);
  assert.match(background, /return `shopling-title-v064-/);
  for (const file of ["background-shopling-title-batch.js", "content-shopling-account-titles.js", "content-shopling-product-list-batch.js"]) {
    assert.doesNotMatch(source(file), /"commerce-os-shopling-title-batch-(?:start|page|progress)"/);
    assert.doesNotMatch(source(file), /"commerceOsShoplingTitleBatch(?:Last)?Run"/);
  }
});

function backgroundAuthorizationHarness(run) {
  const listeners = [];
  const noop = () => {};
  const context = {
    importScripts: noop,
    chrome: {
      runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, onInstalled: { addListener: noop }, onStartup: { addListener: noop } },
      alarms: { get: async () => ({ periodInMinutes: 1 }), create: async () => {}, onAlarm: { addListener: noop } },
      storage: { session: { get: async () => ({ commerceOsShoplingTitleBatchRunV064: run }) } },
    },
  };
  vm.runInNewContext(source("background-shopling-root.js"), context);
  assert.equal(listeners.length, 1);
  return (message, sender) => new Promise((resolve) => {
    const accepted = listeners[0](message, sender, (result) => resolve(Boolean(result.ok)));
    if (!accepted) resolve(false);
  });
}

test("worker authorization requires the exact active manual run, product and tab", async () => {
  const run = { status: "running", runId: "shopling-title-v064-123", currentGoodsKey: "123456", currentTabId: 17, phase: "batch" };
  const authorize = backgroundAuthorizationHarness(run);
  const message = { type: "commerce-os-shopling-manual-title-v064-authorize", runId: run.runId, goodsKey: run.currentGoodsKey };
  assert.equal(await authorize(message, { tab: { id: 17 } }), true);
  assert.equal(await authorize(message, { tab: { id: 18 } }), false);
  assert.equal(await authorize({ ...message, goodsKey: "999999" }, { tab: { id: 17 } }), false);
  assert.equal(await authorize({ ...message, runId: "shopling-title-old" }, { tab: { id: 17 } }), false);
  run.status = "completed";
  assert.equal(await authorize(message, { tab: { id: 17 } }), false);
  assert.equal(await backgroundAuthorizationHarness(null)(message, { tab: { id: 17 } }), false);
});

async function runUntrustedWorker(runId) {
  const deferred = [];
  const messages = [];
  vm.runInNewContext(source("content-shopling-account-titles.js"), {
    URLSearchParams, TextEncoder,
    location: { hostname: "a.shopling.co.kr", search: `?mode=nm_chg&prod_id=123456&commerce_os_batch=1&commerce_os_run=${runId}` },
    document: new Proxy({}, { get() { throw new Error("unauthorized page touched DOM"); } }),
    setTimeout: (fn) => deferred.push(fn),
    chrome: { runtime: { sendMessage: (message, cb) => { messages.push(message); cb({ ok: false }); } } },
  });
  for (const fn of deferred) await fn();
  return messages;
}

test("an old combined-pipeline tab cannot mutate titles after upgrade", async () => {
  assert.equal((await runUntrustedWorker("shopling-title-legacy" )).length, 0);
  const rejected = await runUntrustedWorker("shopling-title-v064-not-active");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].type, "commerce-os-shopling-manual-title-v064-authorize");
});

test("missing files, unreviewed base versions and changed anchors fail closed", () => {
  const badVersion = { ...baseEntries, "manifest.json": encoder.encode(JSON.stringify({ ...JSON.parse(decoder.decode(baseEntries["manifest.json"])), version: "9.9.9" })) };
  assert.throws(() => separation.separateShoplingTitleWorkflow(badVersion), /unreviewed_base_version/);
  const missing = { ...baseEntries };
  delete missing["background-shopling-title-batch.js"];
  assert.throws(() => separation.separateShoplingTitleWorkflow(missing), /missing_file/);
  const badAnchor = { ...baseEntries, "background-shopling-root.js": encoder.encode('"use strict";') };
  assert.throws(() => separation.separateShoplingTitleWorkflow(badAnchor), /anchor_invalid/);
});
