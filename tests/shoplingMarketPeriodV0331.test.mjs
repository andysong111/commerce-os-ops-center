import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0331/download/route.ts", import.meta.url);
const listRoute = new URL("../src/app/api/shopling-market-group-canary/selection/list/route.ts", import.meta.url);
const v0330Route = new URL("../src/app/api/shopling-market-group-canary/v0330/download/route.ts", import.meta.url);

const read = (url) => readFile(url, "utf8");

test("v0.3.31 is a market-only package built on the proven v0.3.30 sender", async () => {
  const source = await read(packageRoute);
  assert.match(source, /const VERSION = "0\.3\.31"/);
  assert.match(source, /getV0330Package/);
  assert.match(source, /Market Sender · 기간 미전송 전용/);
  assert.match(source, /상품명 변경 없이 Shopling 업로드 완료일 기간으로 상품을 조회/);
  assert.match(source, /Market only: title diversification excluded/);
  assert.doesNotMatch(source, /content-shopling-account-titles\.js|background-shopling-title-batch\.js/);
});

test("period UI uses KST inclusive start/end dates and strict pending lookup", async () => {
  const source = await read(packageRoute);
  assert.match(source, /fromDate/);
  assert.match(source, /toDate/);
  assert.match(source, /T00:00:00\+09:00/);
  assert.match(source, /strict_pending: "1"/);
  assert.match(source, /기간조회/);
  assert.match(source, /확인필요\/처리중은 자동 제외/);
});

test("strict list mode excludes ambiguous or active channels from automatic selection", async () => {
  const source = await read(listRoute);
  assert.match(source, /const strictPending = text\(url\.searchParams\.get\("strict_pending"\)\) === "1"/);
  assert.match(source, /staleBusyCount === 0/);
  assert.match(source, /confirmNeededCount === 0/);
  assert.match(source, /registrationUnknownCount === 0/);
  assert.match(source, /pendingCount > 0/);
  assert.match(source, /marketDoneCount < 6/);
  assert.match(source, /basis: "shopling_upload_completed_at"/);
});

test("existing v0.3.30 durable auto handoff remains the base market engine", async () => {
  const source = await read(v0330Route);
  assert.match(source, /commerce-os-market-auto-bridge\.mjs/);
  assert.match(source, /shopling-market-auto-agent\.mjs/);
  assert.match(source, /최대 3상품\/18채널/);
});
