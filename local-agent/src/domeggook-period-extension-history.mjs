import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const MAX_HISTORY_RUNS_PER_SYNC = 60;

function jsonFile(pathname) {
  try {
    return JSON.parse(readFileSync(pathname, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function writeJsonAtomic(pathname, value) {
  mkdirSync(dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, pathname);
}

export function domeggookHistoryFileName(receipt) {
  const timestamp = String(receipt?.startedAt || receipt?.finishedAt || new Date().toISOString());
  const safeTimestamp = timestamp.replace(/[^0-9A-Za-z.-]/g, "-");
  return `${safeTimestamp}-${String(receipt?.mode || "unknown")}.json`;
}

export function persistDomeggookHistory(config, accountId, receipt) {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) throw new Error("Invalid Domeggook history account ID.");
  const pathname = join(
    config.dataDir,
    "domeggook-period-extension",
    accountId,
    "history",
    domeggookHistoryFileName(receipt),
  );
  writeJsonAtomic(pathname, { ...receipt, accountId });
  return pathname;
}

function readSettings(config) {
  const stored = jsonFile(join(config.dataDir, "domeggook-period-extension", "settings.json"));
  const accounts = Array.isArray(stored?.accounts)
    ? stored.accounts.filter((account) => ACCOUNT_ID_PATTERN.test(String(account?.accountId || "")))
    : [];
  return {
    accounts: accounts.map((account) => ({
      accountId: String(account.accountId),
      scheduleTime: String(account.scheduleTime || ""),
      extensionDays: Number(account.extensionDays || 90),
      liveExecution: account.liveExecution !== false,
      enabled: account.enabled !== false,
      updatedAt: typeof account.updatedAt === "string" ? account.updatedAt : null,
    })),
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
  };
}

function readAccountHistory(config, accountId) {
  const historyDir = join(config.dataDir, "domeggook-period-extension", accountId, "history");
  try {
    return readdirSync(historyDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(-MAX_HISTORY_RUNS_PER_SYNC)
      .map((name) => jsonFile(join(historyDir, name)))
      .filter((receipt) => receipt && typeof receipt === "object");
  } catch {
    return [];
  }
}

export function buildDomeggookCloudPayload(config, accountId, currentReceipt) {
  const history = readAccountHistory(config, accountId);
  if (currentReceipt && !history.some((receipt) =>
    receipt.startedAt === currentReceipt.startedAt && receipt.finishedAt === currentReceipt.finishedAt)) {
    history.push({ ...currentReceipt, accountId });
  }
  return {
    settings: readSettings(config),
    runs: history.slice(-MAX_HISTORY_RUNS_PER_SYNC),
  };
}

export async function syncDomeggookCloudHistory(config, accountId, currentReceipt, options = {}) {
  const token = String(options.token ?? process.env.DOMEGGOOK_RECEIPT_SYNC_TOKEN ?? "").trim();
  if (!token) return { ok: false, skipped: true, reason: "DOMEGGOOK_SYNC_TOKEN_MISSING" };
  const fetchImpl = options.fetchImpl || fetch;
  const payload = buildDomeggookCloudPayload(config, accountId, currentReceipt);
  const endpoint = `${String(config.opsOrigin || "").replace(/\/$/, "")}/api/integrations/domeggook-period-extension`;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-commerce-os-domeggook-secret": token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs || 12_000),
    });
    if (!response.ok) {
      return { ok: false, skipped: false, reason: `DOMEGGOOK_SYNC_HTTP_${response.status}` };
    }
    return { ok: true, skipped: false, syncedRuns: payload.runs.length };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "DOMEGGOOK_SYNC_REQUEST_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
