import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF88 packages the isolated preview origins without widening to every Vercel app", async () => {
  const route = await readFile(
    "src/app/api/shopling-stock-state-sync/download-hf88/route.ts",
    "utf8",
  );
  assert.match(route, /const VERSION = "0\.6\.51"/);
  assert.match(route, /commerce-os-ops-center-8eexmqzlu-a2bsangsa\.vercel\.app/);
  assert.match(route, /commerce-os-ops-center-git-codex-shopling-stoc-d84729-a2bsangsa\.vercel\.app/);
  assert.doesNotMatch(route, /https:\/\/\*\.vercel\.app/);
  assert.match(route, /const OPS_MATCH =/);
  assert.match(route, /opsEntry\.matches\.push/);
});

test("HF88 remains traceable while stock control downloads HF90", async () => {
  const page = await readFile(
    "src/app/china-order-manager/stock-control/page.tsx",
    "utf8",
  );
  assert.match(page, /download-hf92/);
  assert.match(page, /v0\.6\.54/);
});
