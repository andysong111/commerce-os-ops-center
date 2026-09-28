import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

export const AGENT_VERSION = "0.1.0";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(agentRoot, "..");

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parseList(value, fallback) {
  const items = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

export function loadDotEnvFile(path, env = process.env) {
  try {
    const source = readFileSync(path, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (env[key] !== undefined) continue;
      env[key] = raw.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // The local agent can run without repository env files.
  }
}

export function loadConfig(env = process.env) {
  loadDotEnvFile(resolve(repoRoot, ".env.local"), env);

  const dataDir = resolve(env.COMMERCE_OS_LOCAL_AGENT_DATA_DIR || resolve(agentRoot, "data"));
  const chromeDebugBaseUrl = (env.COMMERCE_OS_CHROME_DEBUG_URL || "http://127.0.0.1:9222").replace(/\/$/, "");

  return {
    agentId: env.COMMERCE_OS_LOCAL_AGENT_ID || os.hostname(),
    agentVersion: AGENT_VERSION,
    agentRoot,
    repoRoot,
    dataDir,
    diagnosticsDir: resolve(dataDir, "diagnostics"),
    heartbeatIntervalMs: parseInteger(env.COMMERCE_OS_LOCAL_AGENT_INTERVAL_MS, 30_000),
    chromeDebugBaseUrl,
    shoplingOrigins: parseList(env.COMMERCE_OS_SHOPLING_ORIGINS, ["https://a.shopling.co.kr/"]),
    opsOrigin: env.COMMERCE_OS_OPS_ORIGIN || "https://commerce-os-ops-center.vercel.app",
    probeShoplingPage: parseBoolean(env.COMMERCE_OS_LOCAL_AGENT_PROBE_PAGE, true),
    screenshotsEnabled: parseBoolean(env.COMMERCE_OS_LOCAL_AGENT_SCREENSHOTS, true),
    supabaseUploadEnabled: parseBoolean(env.COMMERCE_OS_LOCAL_AGENT_UPLOAD, false),
    supabaseUrl: (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, ""),
    supabaseSecretKey: (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    heartbeatTable: env.COMMERCE_OS_LOCAL_AGENT_HEARTBEAT_TABLE || "commerce_os_local_agent_heartbeats",
    diagnosticTable: env.COMMERCE_OS_LOCAL_AGENT_DIAGNOSTIC_TABLE || "commerce_os_local_agent_diagnostics",
  };
}
