import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import * as v2 from "../src/lib/keywordEngineElonLabV2.ts";
import * as chain from "../src/lib/seoBulkSourceFallback.ts";
import { loadPurchaseCycleModule as loadModule } from "./helpers/purchaseCycleHarness.mjs";

const input = { launchItemId: "launch-aaa284", modelNumber: "AAA284", productName: "회전 연필꽂이", sourceUrl: "https://detail.1688.com/offer/867720344924.html", optionText: "일반형 / 투명형", supportingText: "문구 > 정리 · 회전 연필꽂이 · AAA284", mallTitleCategory: "문구 > 정리", shoplingGoodsKeys: ["121455"] };
const seed = (title = "회전 연필꽂이", extra = {}) => ({ url: input.sourceUrl, offerId: "867720344924", autoStatus: "partial", chineseTitle: title, optionText: "일반형", supportingText: "씨드", warnings: [], collectedAt: "2026-09-16T00:00:00.000Z", ...extra });
const tracker = seed(input.productName, { optionText: input.optionText, supportingText: input.supportingText, warnings: ["BULK_TRACKER_SOURCE_FALLBACK"] });
const empty = seed("", { optionText: "", supportingText: "" });
const normalRow = { goods_key: "121455", model_no: "AAA284", prod_nm: "회전식 투명 연필꽂이", site_srch: "연필꽂이,책상정리", cate_all_nm: "문구>정리", optionName: "투명형", optStatus: "N" };
const fail = async () => { throw new Error("blocked"); };
const noCall = () => { throw new Error("UNEXPECTED_CALL"); };

function collect(overrides = {}, product = input) {
  return chain.collectSeoBulkSourceChain(product, { collect1688: fail, collectShopling: async () => null, trackerFallback: () => tracker, ...overrides });
}

test("normal 1688 success is preferred and never reads Shopling or tracker", async () => {
  const original = seed("旋转笔筒");
  const result = await collect({ collect1688: async () => original, collectShopling: noCall, trackerFallback: noCall });
  assert.equal(result.mode, "1688_server");
  assert.equal(result.source, original);
});

test("1688 failure or empty payload uses Shopling before tracker", async () => {
  for (const collect1688 of [fail, async () => empty]) {
    const result = await collect({ collect1688, collectShopling: async () => seed("샵플링 연필꽂이"), trackerFallback: noCall });
    assert.equal(result.mode, "shopling_fallback");
    assert.equal(result.source.chineseTitle, "샵플링 연필꽂이");
    assert.ok(result.source.warnings.includes("BULK_SHOPLING_SOURCE_FALLBACK"));
  }
});

test("a nonempty HTTP/login/deleted-page title must not masquerade as a successful 1688 seed", async () => {
  for (const warning of ["1688 HTTP 404", "1688 페이지가 품절·로그인·접근제한 상태일 수 있습니다.", "1688 밖으로 리디렉션됨: login.example"] ) {
    const result = await collect({ collect1688: async () => seed("登录", { warnings: [warning] }), collectShopling: async () => seed("샵플링 연필꽂이") });
    assert.equal(result.mode, "shopling_fallback");
  }
});

test("missing, malformed and off-domain links skip 1688 but still use Shopling", async () => {
  for (const sourceUrl of ["", "not a link", "https://1688.com.evil.invalid/offer/1.html", "javascript:alert(1)"]) {
    let attempted1688 = false;
    const result = await collect({ collect1688: async () => { attempted1688 = true; return seed(); }, collectShopling: async () => seed("샵플링 연필꽂이"), trackerFallback: noCall }, { ...input, sourceUrl });
    assert.equal(attempted1688, false);
    assert.equal(result.mode, "shopling_fallback");
  }
});

test("Shopling no rows, empty payload, API errors and timeout all preserve the existing tracker seed", async () => {
  for (const collectShopling of [async () => null, async () => empty, fail, async () => { throw new Error("BULK_SHOPLING_LOOKUP_BUDGET_EXHAUSTED"); }]) {
    const result = await collect({ collectShopling });
    assert.equal(result.mode, "tracker_fallback");
    assert.equal(result.source.chineseTitle, tracker.chineseTitle);
    assert.equal(result.source.optionText, tracker.optionText);
    assert.equal(result.source.supportingText, tracker.supportingText);
    assert.ok(result.source.warnings.includes("BULK_TRACKER_SOURCE_FALLBACK"));
  }
});

test("secrets in external errors never reach persisted warnings", async () => {
  const result = await collect({ collectShopling: async () => { throw new Error("authKey=do-not-persist"); } });
  assert.ok(result.source.warnings.includes("BULK_SHOPLING_SOURCE_UNAVAILABLE"));
  assert.doesNotMatch(JSON.stringify(result), /do-not-persist/);
});

test("no sources fails explicitly; missing product ID never makes network calls", async () => {
  await assert.rejects(collect({ trackerFallback: () => empty }), /SEO 씨드가 부족/);
  await assert.rejects(collect({ collect1688: noCall }, { ...input, launchItemId: "" }), /출시 상품 ID/);
});

test("legacy callers without a Shopling loader keep the two-level source contract", async () => {
  const result = await chain.collectSeoBulkSourceChain(input, { collect1688: fail, trackerFallback: () => tracker });
  assert.equal(result.mode, "tracker_fallback");
  assert.ok(!result.source.warnings.some((value) => value.startsWith("BULK_SHOPLING")));
});

test("collection mode and user-readable source label survive resume", () => {
  for (const [mode, label] of [["1688_server", "1688 원본"], ["shopling_fallback", "샵플링 등록 데이터"], ["tracker_fallback", "상품출시관리 데이터"]]) {
    assert.equal(chain.normalizeSeoBulkCollectionMode(mode), mode);
    assert.equal(chain.seoBulkSourceLabel(mode), label);
  }
  assert.equal(chain.normalizeSeoBulkCollectionMode(undefined), "tracker_fallback");
  assert.equal(chain.seoBulkSourceLabel(undefined), "");
});

function adapter({ read = async () => [normalRow], planning = async () => ({ products: [] }), now } = {}) {
  const requests = [];
  const api = loadModule("src/lib/seoBulkShoplingSource.ts", {
    "./keywordEngineElonLabV2.ts": v2,
    "@/lib/productDecisionLiveRefresh": { loadProductPlanningSnapshot: planning },
    "@/lib/legacySeoShoplingEvidence": {
      buildLegacyShoplingProductLookupXml: (_config, goodsKeys) => ({ kind: "exact", goodsKeys }),
      buildLegacyShoplingModelDiscoveryXml: (_config, start, end) => ({ kind: "discovery", start, end }),
    },
    "@/lib/shopling/shoplingReadClient": {
      shoplingReadConfigFromEnv: () => ({ companyId: "fixture", loginId: "fixture", authKey: "secret", productsUrl: "https://api.shopling.co.kr/fixture" }),
      parseShoplingReadResponse: (_resource, body) => JSON.parse(body),
    },
    "@/lib/shopling/shoplingTlsTransport": {
      postShoplingXml: async (_url, xml, options) => {
        requests.push({ xml, timeoutMs: options.timeoutMs });
        return { ok: true, text: async () => JSON.stringify(await read(xml)) };
      },
    },
  }, now ? { Date: class extends Date { static now() { return now(); } } } : {});
  return { ...api, requests };
}

test("Shopling exact-model seed includes title, search terms, category and active options", () => {
  const api = adapter();
  const source = api.buildSeoBulkShoplingSource({ ...input, sourceUrl: "" }, [normalRow, { ...normalRow, optionName: "삭제옵션", optStatus: "X" }]);
  assert.equal(source.url, "");
  assert.equal(source.offerId, "");
  assert.equal(source.chineseTitle, normalRow.prod_nm);
  assert.match(source.supportingText, /책상정리/);
  assert.match(source.supportingText, /문구>정리/);
  assert.equal(source.optionText, "투명형");
  assert.doesNotMatch(JSON.stringify(source), /삭제옵션/);
});

test("stale goods keys resolving to different or missing model_no never become a seed", () => {
  const api = adapter();
  for (const model_no of ["AAA285", "", null]) assert.equal(api.buildSeoBulkShoplingSource(input, [{ ...normalRow, model_no }]), null);
  assert.equal(api.buildSeoBulkShoplingSource(input, [{ ...normalRow, prod_nm: "AAA284" }]), null);
});

test("server-side goods-key hints discard malformed values and cap lookup count", () => {
  const api = adapter();
  const hints = api.seoBulkShoplingGoodsKeys({ shoplingProducts: { wholesale1: { goodsKey: "121455" }, retail1: { goodsKey: "<inject>" } }, shoplingRegistrationHistory: [{ registeredGoodsKeys: ["121455", "121456", "invalid"] }] });
  assert.deepEqual(Array.from(hints), ["121455", "121456"]);
});

test("current registered keys are read first without loading planning or date scans", async () => {
  const api = adapter({ planning: noCall });
  const result = await api.loadSeoBulkShoplingSource(input);
  assert.equal(result.chineseTitle, normalRow.prod_nm);
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].xml.kind, "exact");
});

test("planning mapping is only an index; source comes from live verified Shopling", async () => {
  const api = adapter({ planning: async () => ({ products: [{ modelNo: "AAA284", listings: [{ goodsKey: "121455", active: true }] }] }) });
  const result = await api.loadSeoBulkShoplingSource({ ...input, shoplingGoodsKeys: [] });
  assert.equal(result.chineseTitle, normalRow.prod_nm);
  assert.equal(api.requests[0].xml.kind, "exact");
});

test("a missing/stale index discovers a model then performs exact-key readback", async () => {
  const api = adapter({ planning: fail, read: async (request) => request.kind === "discovery" ? [{ goods_key: "999999", model_no: "AAA284" }] : [{ ...normalRow, goods_key: "999999" }] });
  const result = await api.loadSeoBulkShoplingSource({ ...input, shoplingGoodsKeys: [] });
  assert.equal(result.chineseTitle, normalRow.prod_nm);
  assert.deepEqual(api.requests.map((request) => request.xml.kind), ["discovery", "exact"]);
});

test("Shopling missing product terminates finite scans and lets the chain fall through to tracker", async () => {
  const api = adapter({ read: async () => [] });
  const result = await collect({ collectShopling: api.loadSeoBulkShoplingSource });
  assert.equal(result.mode, "tracker_fallback");
  assert.ok(api.requests.length <= 29);
  assert.ok(api.requests.every((request) => request.timeoutMs <= 10_000));
});

test("time budget exhaustion is distinguished from no product and falls through safely", async () => {
  let clock = 0;
  const api = adapter({ now: () => clock, planning: async () => { clock = 76_000; return { products: [] }; } });
  const result = await collect({ collectShopling: api.loadSeoBulkShoplingSource }, { ...input, shoplingGoodsKeys: [] });
  assert.equal(result.mode, "tracker_fallback");
  assert.ok(result.source.warnings.includes("BULK_SHOPLING_LOOKUP_BUDGET_EXHAUSTED"));
  assert.equal(api.requests.length, 0);
});

test("concurrent models reuse discovery windows but still verify their own goods key", async () => {
  const api = adapter({ read: async (request) => request.kind === "discovery" ? [normalRow, { ...normalRow, model_no: "AAA285", goods_key: "121456" }] : [{ ...normalRow, model_no: request.goodsKeys[0] === "121455" ? "AAA284" : "AAA285", goods_key: request.goodsKeys[0] }] });
  const results = await Promise.all([api.loadSeoBulkShoplingSource({ ...input, shoplingGoodsKeys: [] }), api.loadSeoBulkShoplingSource({ ...input, modelNumber: "AAA285", shoplingGoodsKeys: [] })]);
  assert.equal(results.length, 2);
  assert.ok(results.every(Boolean));
  assert.equal(api.requests.filter((request) => request.xml.kind === "discovery").length, 1);
});

function engine() {
  const original = readFileSync("src/lib/keywordEngineElonBulkFinal.ts", "utf8");
  const imports = Object.fromEntries([...original.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => [match[1], {}]));
  return loadModule("src/lib/keywordEngineElonBulkFinal.ts", {
    ...imports,
    "./seoBulkSourceFallback.ts": chain,
    "@/lib/keywordEngineElonLabV2": v2,
    "@/lib/keywordEngineElonLabV2Server": { collectKeywordElon1688Source: fail },
  });
}

test("the production collector retains the real tracker fallback contents for linkless RUNs", async () => {
  const result = await engine().collectKeywordElonBulkSource({ ...input, sourceUrl: "" }, async () => null);
  assert.equal(result.mode, "tracker_fallback");
  assert.equal(result.source.chineseTitle, input.productName);
  assert.equal(result.source.optionText, input.optionText);
  assert.match(result.source.supportingText, /모델번호 AAA284/);
  assert.equal(result.source.url, "");
  assert.doesNotMatch(result.source.supportingText, /문구 > 정리/);
});

function routeFixture(authorized = true) {
  const rows = [];
  let reads = 0;
  const route = loadModule("src/app/api/seo-run-jobs/route.ts", {
    "next/server": { after: () => {} },
    "@/lib/seoBulkShoplingSource": { seoBulkShoplingGoodsKeys: adapter().seoBulkShoplingGoodsKeys },
    "@/lib/keywordEngineElonLabV2": v2,
    "@/lib/opsAdaptiveDispatcher": {},
    "@/lib/productLaunchTrackerNormalizedStore": { readProductLaunchNormalizedItems: async () => { reads++; return [{ id: input.launchItemId, modelNumber: input.modelNumber, productName: input.productName, orderOptions: [{ saleOption: "투명형" }], shoplingProducts: { wholesale1: { goodsKey: "121455" } } }]; } },
    "@/lib/seoTitleLedgerServer": { requireSeoTitleLedgerContext: async () => authorized ? { ok: true, value: { config: {}, identity: { userId: "owner-fixture" } } } : { ok: false, response: Response.json({ ok: false }, { status: 401 }) } },
    "@/lib/seoRunJobServer": { listSeoRunJobs: async () => rows, insertSeoRunJobs: async (_context, inserted) => { rows.push(...inserted); return inserted; } },
    "@/lib/seoRunShoplingWorkerPulse": { runCoalescedSeoRunShoplingWorkerPulse: noCall },
    "@/lib/seoRunWorkerPulse": {},
  }, { crypto: globalThis.crypto });
  return { route, rows, get reads() { return reads; } };
}
const enqueueRequest = () => new Request("https://ops.invalid/api/seo-run-jobs", { method: "POST", body: JSON.stringify({ runs: [{ id: input.launchItemId, runId: "seo-run-source-chain-fixture", modelNumber: "ATTACK", shoplingGoodsKeys: ["999999"] }], customBlockedTerms: ["차단키워드"] }) });

test("actual enqueue API accepts linkless owned items without trusting client seed/keys or registering", async () => {
  const fixture = routeFixture();
  const response = await fixture.route.POST(enqueueRequest());
  assert.equal(response.status, 200);
  assert.equal(fixture.rows.length, 1);
  const row = fixture.rows[0];
  assert.equal(row.source_url, "");
  assert.equal(row.input_payload.modelNumber, "AAA284");
  assert.deepEqual(Array.from(row.input_payload.shoplingGoodsKeys), ["121455"]);
  assert.deepEqual(Array.from(row.input_payload.customBlockedTerms), ["차단키워드"]);
  assert.equal(row.input_payload.variationSeed, "seo-run-source-chain-fixture");
});

test("unauthenticated enqueue remains blocked before source reads or writes", async () => {
  const fixture = routeFixture(false);
  assert.equal((await fixture.route.POST(enqueueRequest())).status, 401);
  assert.equal(fixture.reads, 0);
  assert.equal(fixture.rows.length, 0);
});

test("actual tracker handoff creates a new run for linkless products without issuing registration", async () => {
  const raw = readFileSync("public/product-launch-tracker-app/seo-title-ledger-handoff.js", "utf8");
  const data = new Map();
  const messages = [];
  const button = { disabled: false, textContent: "열기", dataset: {} };
  const sandbox = {
    console, crypto: globalThis.crypto, URL, URLSearchParams,
    document: {}, window: { localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }, location: { origin: "https://ops.invalid" } },
  };
  // Evaluate the real handoff function with browser boundary functions stubbed, not its control flow.
  const cut = raw.indexOf("function installStyle");
  assert.ok(cut > 0);
  const context = { ...sandbox, messages, button, targets: [] };
  runInNewContext(raw.slice(0, cut) + `\nreadSelectedItemIds = () => ["launch-aaa284"]; readSelectedItem = async () => (${JSON.stringify({ id: input.launchItemId, productName: input.productName, modelNumber: input.modelNumber, sourceUrl: "" })}); openOrFocusBulkWindow = (target) => targets.push(target); showMessage = (message) => messages.push(message); globalThis.run = () => openBulkCloud(button);`, context);
  await context.run();
  assert.deepEqual(messages, []);
  const batch = JSON.parse(data.get("commerceOs.seoBulkCloud.batch.v1"));
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].sourceUrl, "");
  assert.equal(batch.items[0].shoplingStatus, "idle");
  assert.match(batch.items[0].runId, /^seo-run-/);
  assert.match(context.targets[0], /^\/seo-bulk-cloud\?/);
  assert.equal(button.disabled, false);
});

test("normal worker wiring, checkpoint resume, FINAL guards and independent registration remain intact", () => {
  const worker = readFileSync("src/lib/seoRunWorker.ts", "utf8");
  const bulk = readFileSync("src/lib/keywordEngineElonBulkFinal.ts", "utf8");
  const handoff = readFileSync("public/product-launch-tracker-app/seo-title-ledger-handoff.js", "utf8");
  assert.match(worker, /collectKeywordElonBulkSource\(input, loadSeoBulkShoplingSource\)/);
  assert.match(worker, /normalizeSeoBulkCollectionMode\(state.collectionMode\)/);
  assert.match(worker, /collectionMode: collected.mode/);
  assert.doesNotMatch(worker, /!result.sourceUrl/);
  assert.doesNotMatch(bulk, /if \(!text\(input.sourceUrl\)\) throw/);
  assert.doesNotMatch(handoff, /const missingLinks/);
  assert.match(bulk, /searchKeywords.length !== 10/);
  assert.match(bulk, /mallTitles.length !== 29/);
  assert.match(worker, /filterKeywordElonProhibitedKeywords/);
  assert.doesNotMatch(worker, /queue_registration/);
  assert.match(readFileSync("src/app/seo-bulk-cloud/SeoBulkDurableRunCloudClient.tsx", "utf8"), /씨드 출처:/);
  assert.match(readFileSync(".github/workflows/seo-title-inventory-ledger-ci.yml", "utf8"), /tests\/seoBulkSourceFallback.test.mjs/);
});

test("actual durable worker carries Shopling/tracker fallback through checkpoints to ready without registering", async () => {
  for (const shoplingSource of [seed("샵플링 연필꽂이"), null]) {
    let job = { run_id: "seo-run-end-to-end-fixture", launch_item_id: input.launchItemId, model_number: input.modelNumber, product_name: input.productName, source_url: "", status: "running", stage: "collect_source", input_payload: { ...input, sourceUrl: "" }, checkpoint_payload: {}, attempt_count: 0, max_attempts: 2, registration_status: "idle" };
    let claimed = false;
    let filterCalls = 0;
    const patches = [];
    const expectedMode = shoplingSource ? "shopling_fallback" : "tracker_fallback";
    const candidates = [{ keyword: "연필꽂이", safetyPass: true, qualityScore: 90 }];
    const original = readFileSync("src/lib/seoRunWorker.ts", "utf8");
    const imports = Object.fromEntries([...original.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => [match[1], {}]));
    const worker = loadModule("src/lib/seoRunWorker.ts", {
      ...imports,
      "@/lib/seoBulkShoplingSource": { loadSeoBulkShoplingSource: async () => shoplingSource },
      "@/lib/seoBulkSourceFallback": chain,
      "@/lib/keywordEngineElonLabV2": v2,
      "@/lib/keywordEngineElonBulkFinal": {
        collectKeywordElonBulkSource: engine().collectKeywordElonBulkSource,
        composeKeywordElonBulkFinal: (data) => {
          assert.equal(data.collectionMode, expectedMode);
          assert.equal(data.sourceUrl, "");
          assert.equal(data.source.chineseTitle, shoplingSource?.chineseTitle ?? input.productName);
          return { collectionMode: data.collectionMode, seoFinal: { generatedAt: "fixture" } };
        },
      },
      "@/lib/keywordEngineElonLabV2Server": { analyzeKeywordElonIdentity: async () => ({ coreProduct: "연필꽂이" }), generateKeywordElonTitle: async () => ({ title: "연필꽂이" }) },
      "@/lib/keywordEngineElonLabV2Discovery": { discoverKeywordElonCandidatesResilient: async () => ({ candidates: ["연필꽂이"] }) },
      "@/lib/keywordEngineElonLabV2Scoring": { scoreKeywordElonCandidatesBatched: async () => ({ candidates }) },
      "@/lib/keywordEngineElonLabV2Step3": { expandKeywordElonFromPassing: async () => ({ newCandidateCount: 0, discovery: { candidates: [] } }) },
      "@/lib/keywordEngineElonLabV2Selection": { normalizeKeywordElonSelectionThresholds: () => ({}), selectKeywordElonStep4Union: (rows) => rows },
      "@/lib/keywordEngineElonLabV2Step4": { filterKeywordElonProhibitedKeywords: async () => { filterCalls++; return { allowedKeys: ["연필꽂이"], allowedCount: 1, decisions: [] }; } },
      "@/lib/productLaunchTrackerServer": { getProductLaunchAdminConfig: () => ({ ok: true, value: {} }) },
      "@/lib/seoRunJobServer": {
        claimNextSeoRunJob: async () => { if (claimed) return null; claimed = true; return job; },
        patchClaimedSeoRunJob: async (_config, _id, _owner, patch) => { patches.push(patch); job = { ...job, ...patch }; return job; },
        isSeoRunLeaseLostError: () => false,
      },
    }, { console });
    const result = await worker.processSeoRunQueue({ workerId: "fixture", maxJobs: 1 });
    assert.equal(result.completedCount, 1, JSON.stringify(result));
    assert.equal(job.status, "ready");
    assert.equal(job.result_payload.collectionMode, expectedMode);
    assert.equal(job.checkpoint_payload.collectionMode, expectedMode);
    assert.equal(job.registration_status, "idle");
    assert.equal(filterCalls, 1);
    assert.ok(patches.some((patch) => patch.stage === "analyze_identity"));
    assert.ok(!patches.some((patch) => Object.hasOwn(patch, "registration_status")));
  }
});

test("cached fallback selection no longer requires a 1688 link but preserves age/identity/read-only gates", () => {
  const source = readFileSync("public/product-launch-tracker-app/seo-fallback-cache-selection.js", "utf8");
  assert.doesNotMatch(source, /!sourceUrlFromItem\(raw\)/);
  assert.match(source, /if \(!id \|\| !model\) continue/);
  assert.match(source, /MAX_CACHE_AGE_MS/);
  assert.match(source, /method === "GET"/);
  assert.match(source, /url.origin === window.location.origin/);
});
