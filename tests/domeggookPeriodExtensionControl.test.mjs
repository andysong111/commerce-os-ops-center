import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createDomeggookPeriodExtensionController,
  createDomeggookPeriodExtensionControlServer,
  normalizeDomeggookControlSettings,
  waitForDomeggookControlChild,
} from "../local-agent/src/domeggook-period-extension-control-server.mjs";

const accounts = [
  { accountId: "everysale999", scheduleTime: "00:10", extensionDays: 90, debugPort: 9600, enabled: true, liveExecution: true },
  { accountId: "andy8010", scheduleTime: "00:15", extensionDays: 90, debugPort: 9492, enabled: true, liveExecution: true },
  { accountId: "buzz1237", scheduleTime: "00:20", extensionDays: 90, debugPort: 9697, enabled: true, liveExecution: true },
  { accountId: "andy80101", scheduleTime: "00:25", extensionDays: 90, debugPort: 9743, enabled: true, liveExecution: true },
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "domeggook-control-"));
  const dataRoot = join(root, "data");
  await mkdir(dataRoot, { recursive: true });
  await writeFile(join(dataRoot, "settings.json"), JSON.stringify({ accounts }), "utf8");
  return { root, dataRoot };
}

test("control settings reject duplicate accounts and unsafe ports", () => {
  assert.throws(() => normalizeDomeggookControlSettings({ accounts: [accounts[0], { ...accounts[0], accountId: "EVERYSALE999", debugPort: 9601 }] }), /중복/);
  assert.throws(() => normalizeDomeggookControlSettings({ accounts: [{ ...accounts[0], debugPort: 80 }] }), /포트/);
});

test("all-account execution is sequential, fixed, and continues after one failure", async () => {
  const { root, dataRoot } = await fixture();
  const calls = [];
  const controller = createDomeggookPeriodExtensionController({ repoRoot: root, dataDir: root }, {
    repoRoot: root,
    dataRoot,
    runProcess: async (executable, args) => {
      calls.push({ executable, args });
      if (args.includes("andy8010")) throw new Error("fixture failure");
    },
  });
  const result = await controller.runAll();
  assert.deepEqual(result.succeeded, ["everysale999", "buzz1237", "andy80101"]);
  assert.deepEqual(result.failed, ["andy8010"]);
  assert.deepEqual(calls.map((call) => call.args[call.args.indexOf("-AccountId") + 1]), accounts.map((account) => account.accountId));
  assert.ok(calls.every((call) => call.executable === "powershell.exe" && call.args.includes("-Execute")));
});

test("a second all-account execution is rejected while the first is active", async () => {
  const { root, dataRoot } = await fixture();
  let releaseFirst;
  let announceStarted;
  const started = new Promise((resolve) => { announceStarted = resolve; });
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  let callCount = 0;
  const controller = createDomeggookPeriodExtensionController({ repoRoot: root, dataDir: root }, {
    repoRoot: root,
    dataRoot,
    runProcess: async () => {
      callCount += 1;
      if (callCount === 1) {
        announceStarted();
        await gate;
      }
    },
  });
  const first = controller.runAll();
  await started;
  const active = await controller.readState();
  assert.equal(active.running, true);
  assert.equal(active.progress.currentAccountId, "everysale999");
  assert.equal(active.progress.completed, 0);
  assert.equal(active.progress.total, 4);
  await assert.rejects(() => controller.runAll(), (error) => error.code === "DOMEGGOOK_CONTROL_ALREADY_RUNNING");
  releaseFirst();
  await first;
  const completed = await controller.readState();
  assert.equal(completed.running, false);
  assert.equal(completed.progress, null);
  assert.deepEqual(completed.lastRun.succeeded, accounts.map((account) => account.accountId));
});

test("2026-11-13 wrapper completion uses process exit even when Chrome keeps stdio pipes open", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => assert.fail("completed wrapper must not be killed");
  const completed = waitForDomeggookControlChild(child, { timeoutMs: 1_000 });
  child.stdout.write("receipt persisted");
  child.emit("exit", 0);
  const result = await completed;
  assert.match(result.stdout, /receipt persisted/);
  assert.equal(child.stdout.destroyed, false);
});

test("server blocks cross-site and tokenless run requests", async () => {
  const savedCredentials = [];
  const controller = {
    readState: async () => ({ settings: { accounts }, receipts: [], running: false }),
    runAll: async () => ({ total: 4 }),
    saveCredential: async (accountId, password) => {
      savedCredentials.push({ accountId, password });
      return { accountId, saved: true };
    },
  };
  const opsOrigin = "https://commerce-os-ops-center.vercel.app";
  const control = await createDomeggookPeriodExtensionControlServer({ opsOrigin }, { port: 0, token: "fixture-token", controller });
  const { origin } = await control.listen();
  try {
    const page = await fetch(origin).then((response) => response.text());
    assert.match(page, /setInterval\(\(\)=>load\(\)/);
    assert.match(page, /currentAccountId/);
    assert.match(page, /완료 · 성공/);
    const blocked = await fetch(`${origin}/api/run-all`, { method: "POST", headers: { origin: "https://evil.example", "x-commerce-os-token": "fixture-token" } });
    assert.equal(blocked.status, 403);
    const allowed = await fetch(`${origin}/api/run-all`, { method: "POST", headers: { origin, "x-commerce-os-token": "fixture-token" } });
    assert.equal(allowed.status, 200);
    const preflight = await fetch(`${origin}/api/credentials`, { method: "OPTIONS", headers: { origin: opsOrigin, "access-control-request-private-network": "true" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), opsOrigin);
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    const crossSiteCredential = await fetch(`${origin}/api/credentials`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ accountId: "everysale999", password: "not-saved" }) });
    assert.equal(crossSiteCredential.status, 403);
    const saved = await fetch(`${origin}/api/credentials`, { method: "POST", headers: { origin: opsOrigin, "content-type": "application/json" }, body: JSON.stringify({ accountId: "everysale999", password: "fixture-password" }) });
    assert.equal(saved.status, 200);
    assert.deepEqual(savedCredentials, [{ accountId: "everysale999", password: "fixture-password" }]);
  } finally {
    await control.close();
  }
});

test("credential saving accepts only configured accounts and passes the password through stdin", async () => {
  const { root, dataRoot } = await fixture();
  const calls = [];
  const controller = createDomeggookPeriodExtensionController({ repoRoot: root, dataDir: root }, {
    repoRoot: root,
    dataRoot,
    runProcess: async (executable, args, options) => { calls.push({ executable, args, options }); },
  });
  await controller.saveCredential("everysale999", "fixture-password");
  assert.equal(calls[0].executable, "powershell.exe");
  assert.equal(calls[0].args.includes("fixture-password"), false);
  assert.equal(calls[0].options.input, "fixture-password");
  await assert.rejects(() => controller.saveCredential("unknown999", "fixture-password"), /저장된 도매꾹 계정/);
});

test("Windows startup task launches the Node control server directly", async () => {
  const source = await readFile("local-agent/scripts/install-domeggook-period-extension-control-task.ps1", "utf8");
  assert.match(source, /Get-Command "node\.exe"/);
  assert.match(source, /New-ScheduledTaskAction -Execute \$Node/);
  assert.match(source, /-WorkingDirectory \$RepoDir/);
  assert.doesNotMatch(source, /New-ScheduledTaskAction -Execute "powershell\.exe"/);
});
