import { normalizeNewProductLaunchState } from "@/lib/productLaunchOptionNames";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  withProductLaunchListSnapshot,
} from "@/lib/productLaunchTrackerListSnapshot";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";

export type ProductLaunchIdentity = {
  userId: string;
  email: string;
};

export type ProductLaunchAdminConfig = {
  supabaseUrl: string;
  secretKey: string;
};

const PRODUCT_LAUNCH_READ_ATTEMPTS = 6;
const PRODUCT_LAUNCH_READ_TIMEOUT_MS = 12_000;
const PRODUCT_LAUNCH_READ_RETRY_DELAYS_MS = [750, 1_500, 3_000, 5_000, 8_000];
const TRANSIENT_STORAGE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function resolveProductLaunchIdentity(
  request: Request,
  options: { requireSameOrigin?: boolean } = {},
): Promise<
  | { ok: true; value: ProductLaunchIdentity }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    }
> {
  const requireSameOrigin = options.requireSameOrigin !== false;
  if (requireSameOrigin && !isSameOriginOpsRequest(request)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 이 작업을 실행할 수 있습니다.",
      },
    };
  }

  if (isOpsLoginTemporarilyDisabled()) {
    return { ok: true, value: temporaryOpsIdentity() };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase 서버 연결이 설정되지 않았습니다.",
      },
    };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "이 작업을 실행하려면 로그인해야 합니다.",
      },
    };
  }
  return {
    ok: true,
    value: {
      userId: data.user.id,
      email: data.user.email?.toLowerCase() ?? "",
    },
  };
}

export function getProductLaunchAdminConfig():
  | { ok: true; value: ProductLaunchAdminConfig }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "진행관리 서버 저장소에 필요한 Supabase 환경변수가 없습니다.",
      },
    };
  }
  return { ok: true, value: { supabaseUrl, secretKey } };
}

export async function readProductLaunchState(
  config: ProductLaunchAdminConfig,
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: "state_payload,updated_at,schema_version,owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return Array.isArray(body) ? body[0] ?? null : null;
}

export async function readProductLaunchListSnapshot(
  config: ProductLaunchAdminConfig,
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: `list_snapshot:state_payload->${PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD},updated_at,schema_version`,
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return Array.isArray(body) ? body[0] ?? null : null;
}

export async function readProductLaunchStorageJson(
  url: string,
  init: RequestInit,
  options: {
    attempts?: number;
    timeoutMs?: number;
    retryDelaysMs?: number[];
  } = {},
) {
  const attempts = Math.max(1, Math.floor(options.attempts ?? PRODUCT_LAUNCH_READ_ATTEMPTS));
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? PRODUCT_LAUNCH_READ_TIMEOUT_MS));
  const retryDelaysMs = options.retryDelaysMs ?? PRODUCT_LAUNCH_READ_RETRY_DELAYS_MS;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      const body = await readResponseJson(response);
      if (response.ok) return { response, body, attempt };

      const message = readProductLaunchError(body, response.status);
      const error = new Error(message);
      lastError = error;
      if (
        attempt >= attempts ||
        !isTransientProductLaunchStorageFailure(response.status, body, error)
      ) {
        throw error;
      }
    } catch (error) {
      const normalized = normalizeStorageError(error);
      lastError = normalized;
      if (attempt >= attempts || !isTransientProductLaunchStorageError(normalized)) {
        throw normalized;
      }
    } finally {
      clearTimeout(timer);
    }

    const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0;
    if (delayMs > 0) await sleep(delayMs);
  }

  throw lastError ?? new Error("진행관리 저장소를 읽지 못했습니다.");
}

export function isTransientProductLaunchStorageError(error: unknown) {
  const message = normalizeStorageError(error).message.toLowerCase();
  return [
    "pgrst002",
    "schema cache",
    "could not query the database",
    "retrying",
    "connection refused",
    "connection reset",
    "fetch failed",
    "network",
    "timed out",
    "timeout",
    "aborted",
    "econnreset",
    "econnrefused",
  ].some((token) => message.includes(token));
}

function isTransientProductLaunchStorageFailure(
  status: number,
  body: unknown,
  error: Error,
) {
  if (TRANSIENT_STORAGE_STATUSES.has(status)) return true;
  const code =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? String((body as { code?: unknown }).code).toLowerCase()
      : "";
  return code === "pgrst002" || isTransientProductLaunchStorageError(error);
}

export async function writeProductLaunchState(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  state: Record<string, unknown>,
) {
  const persistedState = withProductLaunchListSnapshot(
    normalizeNewProductLaunchState(state) as ProductLaunchTrackerState,
  );
  const schemaVersion = Math.max(
    1,
    Math.floor(Number(persistedState.schemaVersion) || 3),
  );
  const row = {
    owner_id: identity.userId,
    owner_email: identity.email,
    schema_version: schemaVersion,
    state_payload: persistedState,
    updated_at: new Date().toISOString(),
  };
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?on_conflict=owner_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    },
  );
  return Array.isArray(body) ? body[0] ?? row : row;
}

export async function readResponseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function readProductLaunchError(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const candidate = body as {
      code?: unknown;
      message?: unknown;
      error?: unknown;
      details?: unknown;
    };
    const code = typeof candidate.code === "string" ? candidate.code.trim() : "";
    for (const value of [candidate.message, candidate.error, candidate.details]) {
      if (typeof value === "string" && value.trim()) {
        return code ? `${code}: ${value.trim()}` : value.trim();
      }
    }
    if (code) return code;
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return `진행관리 저장소 요청에 실패했습니다. status=${status}`;
}

function normalizeStorageError(error: unknown) {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "진행관리 저장소 요청에 실패했습니다.");
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
