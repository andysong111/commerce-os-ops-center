import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDomeggookPeriodExtensionController,
  createDomeggookPeriodExtensionControlServer,
  normalizeDomeggookControlSettings,
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
  await assert.rejects(() => controller.runAll(), (error) => error.code === "DOMEGGOOK_CONTROL_ALREADY_RUNNING");
  releaseFirst();
  await first;
});

test("server blocks cross-site and tokenless run requests", async () => {
  const controller = { readState: async () => ({ settings: { accounts }, receipts: [], running: false }), runAll: async () => ({ total: 4 }) };
  const control = await createDomeggookPeriodExtensionControlServer({}, { port: 0, token: "fixture-token", controller });
  const { origin } = await control.listen();
  try {
    const blocked = await fetch(`${origin}/api/run-all`, { method: "POST", headers: { origin: "https://evil.example", "x-commerce-os-token": "fixture-token" } });
    assert.equal(blocked.status, 403);
    const allowed = await fetch(`${origin}/api/run-all`, { method: "POST", headers: { origin, "x-commerce-os-token": "fixture-token" } });
    assert.equal(allowed.status, 200);
  } finally {
    await control.close();
  }
});

test("Windows startup task launches the Node control server directly", async () => {
  const source = await readFile("local-agent/scripts/install-domeggook-period-extension-control-task.ps1", "utf8");
  assert.match(source, /Get-Command "node\.exe"/);
  assert.match(source, /New-ScheduledTaskAction -Execute \$Node/);
  assert.match(source, /-WorkingDirectory \$RepoDir/);
  assert.doesNotMatch(source, /New-ScheduledTaskAction -Execute "powershell\.exe"/);
});
