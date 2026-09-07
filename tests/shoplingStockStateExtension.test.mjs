import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.5.1 manifest wires price-core popup, MAIN bridge, result observer and v050 background", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, "0.5.1");
  assert.equal(m.background.service_worker, "background-v050.js");
  const listWorker = m.content_scripts.find((s) => s.js.includes("content-shopling-v030.js"));
  const popupCore = m.content_scripts.find((s) => s.js.includes("content-a21-price-core-v050.js"));
  const popupMain = m.content_scripts.find((s) => s.js.includes("main-a21-price-core-v050.js"));
  const resultObserver = m.content_scripts.find((s) => s.js.includes("content-stock-result-v050.js"));
  assert.ok(listWorker?.exclude_matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml")));
  assert.ok(popupCore?.all_frames);
  assert.equal(popupMain?.world, "MAIN");
  assert.ok(resultObserver?.all_frames);
});

test("v0.5.1 static stock scripts compile and generated list worker preserves exact multirow machinery", async () => {
  for (const name of [
    "background-v020.js",
    "background-v030.js",
    "background-v040.js",
    "background-v050.js",
    "content-ops-v021.js",
    "content-stock-result-v050.js",
    "main-shopling.js",
    "popup.js",
  ]) {
    const src = await readFile(`${root}/${name}`, "utf8");
    assert.doesNotThrow(() => new Function(src));
  }
  const built = buildStockWorkerV030(
    await readFile(`${root}/content-shopling-v018.js`, "utf8"),
    await readFile(`${root}/search-policy-v023.js`, "utf8"),
  );
  assert.doesNotThrow(() => new Function(built));
  assert.match(built, /샵플링상품코드/);
  assert.match(built, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(built, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(built, /selected\.count !== totalResultCount/);
});

test("v0.5.1 price-core source stays byte-identical to the working price extension", async () => {
  const [copiedContent, copiedMain, canonicalContent, canonicalMain] = await Promise.all([
    readFile(`${root}/price-core-content-a21-v024.js`, "utf8"),
    readFile(`${root}/price-core-main-a21-v024.js`, "utf8"),
    readFile("public/shopling-a21-price-option-resend/content-a21-v024.js", "utf8"),
    readFile("public/shopling-a21-price-option-resend/main-a21-v024.js", "utf8"),
  ]);
  assert.equal(copiedContent, canonicalContent);
  assert.equal(copiedMain, canonicalMain);
  assert.match(canonicalContent, /function configureOption\(\)/);
  assert.match(canonicalContent, /chooseMode\("goods_stock"\)/);
  assert.match(canonicalContent, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.doesNotMatch(canonicalContent, /A21 수정전송 팝업을 기다립니다/);
  assert.match(canonicalMain, /goods_mallMdfy_submit_sp/);
});

test("v0.5.1 adapter self-claims only OPTION popup and suppresses legacy OPTION popup dispatch", async () => {
  const background = await readFile(`${root}/background-v050.js`, "utf8");
  assert.match(background, /STOCK_PRICE_CORE_POPUP_CLAIM_V050/);
  assert.match(background, /active\?\.job\?\.productKind === "OPTION" && active\.stage === "A21_POPUP"/);
  assert.match(background, /return true;/);
  assert.match(background, /assignment: \{ jobId: active\.job\.jobId, mode: "OPTION", goodsKey \}/);
});

test("v0.5.1 package adapter retries only the observed A21 popup stage race", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /let claimInFlight = false/);
  assert.match(route, /attempt < 16/);
  assert.match(route, /await sleep\(250\)/);
  assert.match(route, /error !== "stock_price_core_not_option_popup_stage"/);
  assert.match(route, /shopling_stock_price_core_claim_retry_adapter_missing/);
  assert.match(route, /PRICE_CORE_SELF_CLAIM_ADAPTER_WITH_STAGE_RACE_RETRY/);
});

test("OPTION jobs still bypass A6 and require server API evidence", async () => {
  const b = await readFile(`${root}/background-v040.js`, "utf8");
  assert.match(b, /productKind === "OPTION"\s*\? \["A21_LIST"\]/);
  assert.match(b, /optionApiApplied !== true/);
  assert.match(b, /SHOPLING_OPTION_API_NOT_APPLIED/);
  assert.match(b, /goodsKeys\.length !== 1/);
  assert.doesNotMatch(b, /const firstStage = "A6"/);
});

test("search continuation keeps one-click guard and no tab reload", async () => {
  const [policy, background] = await Promise.all([
    readFile(`${root}/search-policy-v023.js`, "utf8"),
    readFile(`${root}/background-v030.js`, "utf8"),
  ]);
  assert.match(policy, /SEARCH_BINDING_MISMATCH/);
  assert.match(policy, /oneClickGuard/);
  assert.doesNotMatch(policy, /ticket\.documentToken !== documentToken/);
  assert.match(background, /allFrames: true/);
  assert.match(background, /chrome\.windows\.create/);
  assert.doesNotMatch(background, /chrome\.tabs\.reload/);
});
