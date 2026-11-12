import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDomeggookCloudRows,
  domeggookCloudStateFromRows,
} from "../src/lib/domeggookPeriodExtensionCloud.ts";
import {
  persistDomeggookHistory,
  syncDomeggookCloudHistory,
} from "../local-agent/src/domeggook-period-extension-history.mjs";

const settings = {
  accounts: [
    { accountId: "everysale999", scheduleTime: "00:10", extensionDays: 90, liveExecution: true, enabled: true, debugPort: 9600, updatedAt: null },
    { accountId: "buzz1237", scheduleTime: "00:20", extensionDays: 90, liveExecution: true, enabled: true, debugPort: 9697, updatedAt: null },
  ],
  updatedAt: "2026-11-11T21:44:12.314Z",
};

const success = {
  accountId: "buzz1237",
  status: "succeeded",
  mode: "execute",
  startedAt: "2026-11-12T15:20:21.669Z",
  finishedAt: "2026-11-12T15:20:31.540Z",
  before: { totalCount: 7, itemNos: ["61963162"] },
  after: { totalCount: 0, itemNos: [] },
  verification: "SELECTED_ITEMS_ABSENT_FROM_PERIOD_EXPIRED_LIST",
};

const failure = {
  accountId: "everysale999",
  status: "failed",
  mode: "execute",
  startedAt: "2026-11-12T15:10:01.000Z",
  finishedAt: "2026-11-12T15:10:52.451Z",
  error: { code: "DOMEGGOOK_CHROME_UNAVAILABLE", message: "도매꾹 전용 Chrome에 연결하지 못했습니다." },
};

test("cloud rows preserve verified before/after counts and failures without secrets", () => {
  const built = buildDomeggookCloudRows({ settings, runs: [success, failure] }, new Date("2026-11-12T16:00:00Z"));
  assert.equal(built.runRows.length, 2);
  assert.equal(built.runRows[0].status, "SUCCEEDED");
  assert.equal(built.runRows[1].status, "FAILED");
  assert.equal(JSON.stringify(built).includes("password"), false);
  const state = domeggookCloudStateFromRows(
    { result_snapshot: built.settingsRow.result_snapshot },
    built.runRows.map((row) => ({ source_event_id: row.source_event_id, result_snapshot: row.result_snapshot })),
  );
  assert.equal(state.settings.accounts.length, 2);
  assert.deepEqual(state.runs.map((run) => [run.accountId, run.beforeCount, run.afterCount]), [
    ["buzz1237", 7, 0],
    ["everysale999", null, null],
  ]);
});

test("cloud payload fails closed for an account absent from settings", () => {
  assert.throws(
    () => buildDomeggookCloudRows({ settings, runs: [{ ...success, accountId: "unexpected1" }] }),
    /설정에 없는 계정/,
  );
});

test("local history persists and syncs through the authenticated endpoint without exposing the token", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "domeggook-history-"));
  const config = { dataDir, opsOrigin: "https://commerce-os-ops-center.vercel.app" };
  await mkdir(path.join(dataDir, "domeggook-period-extension"), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(
    path.join(dataDir, "domeggook-period-extension", "settings.json"),
    JSON.stringify(settings),
  ));
  const pathname = persistDomeggookHistory(config, "buzz1237", success);
  assert.match(await readFile(pathname, "utf8"), /"totalCount": 0/);
  let captured;
  const result = await syncDomeggookCloudHistory(config, "buzz1237", success, {
    token: "test-secret-token",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://commerce-os-ops-center.vercel.app/api/integrations/domeggook-period-extension");
  assert.equal(captured.init.headers["x-commerce-os-domeggook-secret"], "test-secret-token");
  assert.equal(captured.init.headers["x-vercel-protection-bypass"], "test-secret-token");
  assert.equal(captured.init.body.includes("test-secret-token"), false);
});

test("production card uses cloud history while keeping password control local", async () => {
  const [card, page, ingest, historyRoute, runner] = await Promise.all([
    readFile("src/components/domeggook-period-extension/DomeggookPeriodExtensionHistoryCard.tsx", "utf8"),
    readFile("src/app/domeggook-period-extension/page.tsx", "utf8"),
    readFile("src/app/api/integrations/domeggook-period-extension/route.ts", "utf8"),
    readFile("src/app/api/domeggook-period-extension/history/route.ts", "utf8"),
    readFile("local-agent/scripts/run-domeggook-period-extension.ps1", "utf8"),
  ]);
  assert.match(card, /날짜별 실행 성공·실패 이력/);
  assert.match(card, /실행 전 종료상품/);
  assert.match(card, /종료상품 0개 확인/);
  assert.match(card, /Windows 암호화 저장 · 서버 전송 안 함/);
  assert.match(page, /DomeggookPeriodExtensionHistoryCard/);
  assert.match(ingest, /DOMEGGOOK_RECEIPT_SYNC_SECRET/);
  assert.match(historyRoute, /isSameOriginOpsRequest/);
  assert.match(runner, /DOMEGGOOK_RECEIPT_SYNC_TOKEN/);
});
