import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.4.0 manifest keeps all-frame Shopling worker and uses API+A21 cutover background", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, "0.4.0");
  assert.equal(m.background.service_worker, "background-v040.js");
  const shopling = m.content_scripts.find((s) =>
    s.js.includes("content-shopling-v030.js"),
  );
  assert.ok(shopling?.all_frames);
});

test("generated Shopling worker remains syntactically valid and preserves proven A21 machinery", async () => {
  for (const name of [
    "background-v020.js",
    "background-v030.js",
    "background-v040.js",
    "content-ops-v021.js",
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
  assert.match(built, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.match(built, /A21_SALE_STATUS_MODE_NOT_FOUND/);
  assert.match(built, /샵플링상품코드/);
  assert.match(built, /A21_EXACT_ROW_SELECTION_FAILED/);
});

test("v0.4.0 option jobs bypass A6 and require API evidence before A21", async () => {
  const b = await readFile(`${root}/background-v040.js`, "utf8");
  assert.match(b, /productKind === "OPTION"\s*\? \["A21_LIST"\]/);
  assert.match(b, /optionApiApplied !== true/);
  assert.match(b, /SHOPLING_OPTION_API_NOT_APPLIED/);
  assert.match(b, /goodsKeys\.length !== 1/);
  assert.match(b, /const firstStage = "A21_LIST"/);
  assert.doesNotMatch(b, /const firstStage = "A6"/);
});

test("OPS bridge calls guarded option API, narrows to one exact goods key, then starts browser worker", async () => {
  const b = await readFile(`${root}/content-ops-v021.js`, "utf8");
  assert.match(b, /\/api\/inventory-stock-control\/shopling-option-status/);
  assert.match(b, /credentials: "include"/);
  assert.match(b, /goodsKeys: \[String\(apiResult\.matchedGoodsKey\)\]/);
  assert.match(b, /optionApiApplied: true/);
  assert.match(b, /SHOPLING_OPTION_API_VERIFIED/);
  assert.match(b, /chrome\.runtime\.sendMessage\(\{ type: "STOCK_SYNC_START", job \}\)/);
});

test("search continuation still waits for Shopling legacy result repaint", async () => {
  const p = await readFile(`${root}/search-policy-v023.js`, "utf8");
  assert.match(p, /awaitRows\(token, api, 20_000\)/);
  assert.match(p, /awaitRows\(token, api, 30_000\)/);
  assert.match(p, /EXACT_RESULT_ROW_NOT_BOUND/);
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

test("OPS bridge still reports installed manifest version and terminal recovery", async () => {
  const b = await readFile(`${root}/content-ops-v021.js`, "utf8");
  assert.match(b, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(b, /staleTerminalRunning/);
  assert.match(b, /lastFinishedAt >= activeStartedAt/);
});
