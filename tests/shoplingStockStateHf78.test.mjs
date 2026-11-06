import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchHf78AdminDomainCoverage,
  patchHf78SinglePopupSource,
} from "../src/lib/shoplingStockHf78Patch.ts";

test("HF78 reproduces the live kt A21 worker omitted by the legacy manifest", async () => {
  const manifest = JSON.parse(
    await readFile("public/shopling-stock-state-sync/manifest.json", "utf8"),
  );
  const liveWorker =
    "https://kt.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml";
  const main = manifest.content_scripts.find((script) =>
    script.js.includes("main-shopling.js"),
  );
  assert.ok(main);
  assert.equal(main.matches.some((pattern) => liveWorker.startsWith(pattern.slice(0, -1))), false);
});

test("HF78 injects MAIN and isolated workers on both Shopling admin hosts", () => {
  const manifest = {
    host_permissions: ["https://a.shopling.co.kr/*"],
    content_scripts: [
      {
        matches: ["https://a.shopling.co.kr/*"],
        exclude_matches: [
          "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
        ],
        js: ["main-shopling-v002.js"],
        world: "MAIN",
        all_frames: true,
        run_at: "document_start",
      },
    ],
  };
  patchHf78AdminDomainCoverage(manifest);
  assert.deepEqual(manifest.host_permissions, [
    "https://a.shopling.co.kr/*",
    "https://kt.shopling.co.kr/*",
  ]);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://a.shopling.co.kr/*",
    "https://kt.shopling.co.kr/*",
  ]);
  assert.deepEqual(manifest.content_scripts[0].exclude_matches, [
    "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
    "https://kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
  ]);
});

test("HF78 accepts the single-status result popup on kt and legacy hosts", async () => {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/content-stock-single-popup-v012.js",
    "utf8",
  );
  const patched = patchHf78SinglePopupSource(legacy);
  assert.match(patched, /\["https:\/\/a\.shopling\.co\.kr", "https:\/\/kt\.shopling\.co\.kr"\]\.includes\(parsed\.origin\)/);
  assert.doesNotThrow(() => new Function(patched));
});

test("HF78 download contract makes v0.6.41 the required package", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf78/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.40"/);
  assert.match(route, /const VERSION = "0\.6\.41"/);
  assert.match(route, /LIVE_A21_WORKER_MOVED_TO_KT_SHOPLING/);
  assert.match(page, /download-hf78/);
  assert.match(page, /v0\.6\.41 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 41\]/);
  assert.match(workflow, /shoplingStockStateHf78\.test\.mjs/);
});
