import { sanitizeError } from "./safe-json.mjs";

const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function createSupabaseRestHeaders(secretKey) {
  const headers = {
    apikey: secretKey,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  if (!secretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

function enabledConfig(config, table) {
  if (!config.supabaseUploadEnabled) return { ok: false, reason: "SUPABASE_UPLOAD_DISABLED" };
  if (!config.supabaseUrl || !config.supabaseSecretKey) return { ok: false, reason: "SUPABASE_CONFIG_MISSING" };
  if (!TABLE_NAME.test(table)) return { ok: false, reason: "SUPABASE_TABLE_NAME_INVALID" };
  return { ok: true };
}

export async function uploadHeartbeat(config, status, options = {}) {
  return uploadRows(config, config.heartbeatTable, [{
    agent_id: config.agentId,
    observed_at: status.timestamp,
    status: status.agent?.status || "unknown",
    payload: status,
  }], options);
}

export async function uploadDiagnostic(config, diagnostic, options = {}) {
  return uploadRows(config, config.diagnosticTable, [{
    agent_id: config.agentId,
    diagnostic_id: diagnostic.diagnosticId,
    observed_at: diagnostic.timestamp,
    goods_key: diagnostic.goodsKey || null,
    url: diagnostic.url || null,
    payload: diagnostic,
  }], options);
}

export async function uploadRows(config, table, rows, options = {}) {
  const check = enabledConfig(config, table);
  if (!check.ok) return { enabled: config.supabaseUploadEnabled, ok: false, skipped: true, reason: check.reason };
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: createSupabaseRestHeaders(config.supabaseSecretKey),
      body: JSON.stringify(rows),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs || 12_000),
    });
    if (!response.ok) {
      return {
        enabled: true,
        ok: false,
        skipped: false,
        error: {
          code: "SUPABASE_UPLOAD_FAILED",
          message: `Supabase upload failed with HTTP ${response.status}`,
        },
      };
    }
    return { enabled: true, ok: true, skipped: false };
  } catch (error) {
    return { enabled: true, ok: false, skipped: false, error: sanitizeError(error, "SUPABASE_UPLOAD_FAILED") };
  }
}
