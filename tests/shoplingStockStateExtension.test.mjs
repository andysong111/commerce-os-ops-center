import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.4.4 manifest isolates A21 popup and wires dedicated MAIN-world submit bridge", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, "0.4.4");
  assert.equal(m.background.service_worker, "background-v044.js");
  const listWorker = m.content_scripts.find((s) => s.js.includes("content-shopling-v030.js"));
  const popupWorker = m.content_scripts.find((s) => s.js.includes("content-a21-popup-v044.js"));
  const popupMain = m.content_scripts.find((s) => s.js.includes("main-a21-stock-v044.js"));
  assert.ok(listWorker?.all_frames);
  assert.ok(listWorker?.exclude_matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml")));
  assert.ok(popupWorker?.all_frames);
  assert.ok(popupWorker?.matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml")));
  assert.equal(popupMain?.world, "MAIN");
});

test("stock v0.4.4 scripts compile and list worker preserves exact multirow machinery", async () => {
  for (const name of [
    "background-v020.js",
    "background-v030.js",
    "background-v040.js",
    "background-v044.js",
    "content-ops-v021.js",
    "content-a21-popup-v044.js",
    "main-a21-stock-v044.js",
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
  assert.match(built, /function setA21PageSize200V042\(\)/);
  assert.match(built, /selected\.count !== totalResultCount/);
});

test("v0.4.4 popup mirrors current price engine exact form contract", async () => {
  const [popup, main, background] = await Promise.all([
    readFile(`${root}/content-a21-popup-v044.js`, "utf8"),
    readFile(`${root}/main-a21-stock-v044.js`, "utf8"),
    readFile(`${root}/background-v044.js`, "utf8"),
  ]);
  assert.match(popup, /selectRadio\("modify_tp", "goods_stock"\)/);
  assert.match(popup, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(popup, /verifyRadio\("modify_tp", "goods_stock"\)/);
  assert.match(popup, /verifyRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(popup, /STOCK_SYNC_A21_POPUP_CLAIM_V044/);
  assert.match(popup, /commerce-os-stock-a21-v044-main-submit-request/);
  assert.match(main, /goods_mallMdfy_submit_sp/);
  assert.match(main, /checkedValue\("modify_tp"\) !== "goods_stock"/);
  assert.match(main, /checkedValue\("trsmt_env_mody_opt"\) !== "1"/);
  assert.match(main, /수정전송\\s\*할\\s\*상품을\\s\*선택하셨습니까/);
  assert.match(background, /STOCK_SYNC_A21_POPUP_CLAIM_V044/);
  assert.match(background, /active\.stage !== "A21_POPUP"/);
  assert.match(background, /popupClaim: true/);
});

test("v0.4.4 option jobs bypass A6 and require API evidence before A21", async () => {
  const b = await readFile(`${root}/background-v040.js`, "utf8");
  assert.match(b, /productKind === "OPTION"\s*\? \["A21_LIST"\]/);
  assert.match(b, /optionApiApplied !== true/);
  assert.match(b, /SHOPLING_OPTION_API_NOT_APPLIED/);
  assert.match(b, /goodsKeys\.length !== 1/);
  assert.match(b, /const firstStage = "A21_LIST"/);
  assert.doesNotMatch(b, /const firstStage = "A6"/);
});

test("OPS bridge calls guarded option API then starts exact goods-key browser worker", async () => {
  const b = await readFile(`${root}/content-ops-v021.js`, "utf8");
  assert.match(b, /\/api\/inventory-stock-control\/shopling-option-status/);
  assert.match(b, /credentials: "include"/);
  assert.match(b, /goodsKeys: \[String\(apiResult\.matchedGoodsKey\)\]/);
  assert.match(b, /optionApiApplied: true/);
  assert.match(b, /SHOPLING_OPTION_API_VERIFIED/);
  assert.match(b, /chrome\.runtime\.sendMessage\(\{ type: "STOCK_SYNC_START", job \}\)/);
});

test("v0.4.4 keeps v0.4.1 one-click search guard", async () => {
  const p = await readFile(`${root}/search-policy-v023.js`, "utf8");
  assert.match(p, /awaitRows\(token, api, 20_000\)/);
  assert.match(p, /awaitRows\(token, api, 30_000\)/);
  assert.match(p, /commerce-stock-search-v041/);
  assert.match(p, /SEARCH_BINDING_MISMATCH/);
  assert.doesNotMatch(p, /ticket\.documentToken !== documentToken/);
  assert.match(p, /oneClickGuard/);
});

test("background still directly scans all frames and owns isolated work windows", async () => {
  const b = await readFile(`${root}/background-v030.js`, "utf8");
  assert.match(b, /allFrames: true/);
  assert.match(b, /chrome\.windows\.create/);
  assert.match(b, /frameId/);
  assert.match(b, /샵플링상품코드/);
  assert.match(b, /frame 진단/);
  assert.doesNotMatch(b, /chrome\.tabs\.reload/);
});
