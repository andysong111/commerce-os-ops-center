import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { runDomeggookPeriodExtension } from "../src/domeggook-period-extension.mjs";
import { sanitizeError } from "../src/safe-json.mjs";

function parseArgs(argv) {
  const flags = {
    execute: false,
    accountId: "",
    password: process.env.DOMEGGOOK_PASSWORD || "",
    extensionDays: 90,
    maxItems: 50,
    timeoutMs: 20_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") flags.execute = true;
    else if (value === "--dry-run") flags.execute = false;
    else if (value === "--account-id") flags.accountId = String(argv[++index] || "").trim();
    else if (value === "--days") flags.extensionDays = Number(argv[++index]);
    else if (value === "--max-items") flags.maxItems = Number(argv[++index]);
    else if (value === "--timeout-ms") flags.timeoutMs = Number(argv[++index]);
  }
  return flags;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    return openSync(path, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const ageMs = Date.now() - statSync(path).mtimeMs;
    if (ageMs <= 2 * 60 * 60 * 1_000) {
      const locked = new Error("도매꾹 기간연장 작업이 이미 실행 중입니다.");
      locked.code = "DOMEGGOOK_RUN_ALREADY_ACTIVE";
      throw locked;
    }
    rmSync(path, { force: true });
    return openSync(path, "wx");
  }
}

const config = loadConfig();
const flags = parseArgs(process.argv.slice(2));
const accountKey = /^[A-Za-z0-9._-]{3,50}$/.test(flags.accountId) ? flags.accountId : "default";
const stateDir = join(config.dataDir, "domeggook-period-extension", accountKey);
const receiptPath = join(stateDir, "latest.json");
const lockPath = join(stateDir, "run.lock");
let lockHandle;

try {
  lockHandle = acquireLock(lockPath);
  const result = await runDomeggookPeriodExtension(config, flags);
  writeJsonAtomic(receiptPath, result);
  console.log(JSON.stringify({ event: "domeggook_period_extension", ...result }, null, 2));
} catch (error) {
  const failure = {
    status: "failed",
    mode: flags.execute ? "execute" : "dry-run",
    finishedAt: new Date().toISOString(),
    error: sanitizeError(error, "DOMEGGOOK_PERIOD_EXTENSION_FAILED"),
  };
  writeJsonAtomic(receiptPath, failure);
  console.error(JSON.stringify({ event: "domeggook_period_extension_failed", ...failure }, null, 2));
  process.exitCode = 1;
} finally {
  if (lockHandle !== undefined) closeSync(lockHandle);
  rmSync(lockPath, { force: true });
}
