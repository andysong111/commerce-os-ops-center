import { createHash, timingSafeEqual } from "node:crypto";
import {
  normalizeDomeggookAccountsSettings,
  type DomeggookAccountsSettings,
} from "./domeggookPeriodExtensionSettings.ts";

export const DOMEGGOOK_RUN_OPERATION_TYPE = "DOMEGGOOK_PERIOD_EXTENSION";
export const DOMEGGOOK_SETTINGS_OPERATION_TYPE = "DOMEGGOOK_PERIOD_EXTENSION_SETTINGS";
export const DOMEGGOOK_SYNC_SECRET_HEADER = "x-commerce-os-domeggook-secret";
export const DOMEGGOOK_SETTINGS_SOURCE_EVENT_ID = "domeggook-period-extension:settings:v1";

type JsonObject = Record<string, unknown>;

export type DomeggookCloudRun = {
  sourceEventId: string;
  accountId: string;
  status: "succeeded" | "failed" | "planned";
  mode: "execute" | "dry-run";
  startedAt: string;
  finishedAt: string;
  beforeCount: number | null;
  afterCount: number | null;
  verification: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type DomeggookCloudState = {
  settings: DomeggookAccountsSettings;
  runs: DomeggookCloudRun[];
  cloud: true;
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown, maxLength = 500) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, maxLength);
}

function isoTime(value: unknown, label: string) {
  const normalized = text(value, 50);
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) throw new Error(`${label} 시각이 올바르지 않습니다.`);
  return new Date(timestamp).toISOString();
}

function nullableCount(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 && count <= 100_000 ? count : null;
}

function normalizedReceipt(value: unknown) {
  const receipt = object(value);
  const accountId = text(receipt.accountId, 50);
  const status = text(receipt.status, 20);
  const mode = text(receipt.mode, 20);
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(accountId)) throw new Error("실행기록 계정 아이디가 올바르지 않습니다.");
  if (!["succeeded", "failed", "planned"].includes(status)) throw new Error("실행기록 상태가 올바르지 않습니다.");
  if (!["execute", "dry-run"].includes(mode)) throw new Error("실행기록 모드가 올바르지 않습니다.");
  const startedAt = isoTime(receipt.startedAt || receipt.finishedAt, "시작");
  const finishedAt = isoTime(receipt.finishedAt || receipt.startedAt, "종료");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("실행기록 종료시각이 시작시각보다 빠릅니다.");
  const before = object(receipt.before);
  const after = object(receipt.after);
  const plan = object(receipt.plan);
  const error = object(receipt.error);
  const verification = text(receipt.verification, 120) || null;
  const beforeCount = nullableCount(before.totalCount ?? plan.totalCount);
  const afterCount = nullableCount(after.totalCount)
    ?? (status === "succeeded" && verification === "NO_EXPIRED_ITEMS" ? 0 : null);
  return {
    receipt: {
      ...receipt,
      accountId,
      status,
      mode,
      startedAt,
      finishedAt,
    },
    run: {
      accountId,
      status: status as DomeggookCloudRun["status"],
      mode: mode as DomeggookCloudRun["mode"],
      startedAt,
      finishedAt,
      beforeCount,
      afterCount,
      verification,
      errorCode: text(error.code, 120) || null,
      errorMessage: text(error.message, 500) || null,
    },
  };
}

export function authorizeDomeggookCloudSync(
  request: Request,
  expected = process.env.DOMEGGOOK_RECEIPT_SYNC_SECRET?.trim() || "",
  protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || "",
) {
  const supplied = request.headers.get(DOMEGGOOK_SYNC_SECRET_HEADER)?.trim() || "";
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const acceptedSecrets = [...new Set([expected, protectionBypass].map((value) => value.trim()).filter(Boolean))];
  return acceptedSecrets.some((accepted) => {
    const acceptedBuffer = Buffer.from(accepted, "utf8");
    return acceptedBuffer.length === suppliedBuffer.length && timingSafeEqual(acceptedBuffer, suppliedBuffer);
  });
}

export function normalizeDomeggookCloudPayload(value: unknown) {
  const payload = object(value);
  const settings = normalizeDomeggookAccountsSettings(object(payload.settings));
  if (!Array.isArray(payload.runs) || payload.runs.length > 100) {
    throw new Error("실행기록은 한 번에 100건 이하로 보내야 합니다.");
  }
  const allowedAccounts = new Set(settings.accounts.map((account) => account.accountId.toLowerCase()));
  const runs = payload.runs.map(normalizedReceipt);
  for (const { run } of runs) {
    if (!allowedAccounts.has(run.accountId.toLowerCase())) {
      throw new Error(`설정에 없는 계정의 실행기록입니다: ${run.accountId}`);
    }
  }
  return { settings, runs };
}

export function buildDomeggookCloudRows(value: unknown, now = new Date()) {
  const { settings, runs } = normalizeDomeggookCloudPayload(value);
  const observedAt = now.toISOString();
  const settingsRow = {
    operation_type: DOMEGGOOK_SETTINGS_OPERATION_TYPE,
    status: "SUCCEEDED",
    source: "DOMEGGOOK_WINDOWS_SCHEDULER",
    source_event_id: DOMEGGOOK_SETTINGS_SOURCE_EVENT_ID,
    correlation_id: "domeggook-period-extension-settings",
    actor_type: "SYSTEM",
    input_snapshot: {},
    result_snapshot: settings,
    error_message: null,
    started_at: settings.updatedAt || observedAt,
    finished_at: observedAt,
  };
  const runRows = runs.map(({ receipt, run }) => {
    const sourceEventId = `domeggook-period-extension:${run.accountId}:${createHash("sha256")
      .update(`${run.accountId}\n${run.startedAt}\n${run.finishedAt}\n${run.mode}`)
      .digest("hex")}`;
    return {
      operation_type: DOMEGGOOK_RUN_OPERATION_TYPE,
      status: run.status === "failed" ? "FAILED" : run.status === "succeeded" ? "SUCCEEDED" : "CANCELLED",
      source: "DOMEGGOOK_WINDOWS_SCHEDULER",
      source_event_id: sourceEventId,
      correlation_id: `domeggook-account:${run.accountId}`,
      actor_type: "SYSTEM",
      actor_id: run.accountId,
      input_snapshot: {
        accountId: run.accountId,
        mode: run.mode,
      },
      result_snapshot: receipt,
      error_message: run.errorMessage,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
    };
  });
  return { settings, settingsRow, runRows };
}

export function domeggookCloudStateFromRows(settingsValue: unknown, runValues: unknown): DomeggookCloudState {
  const settingsRow = object(settingsValue);
  const settings = normalizeDomeggookAccountsSettings(object(settingsRow.result_snapshot));
  const rows = Array.isArray(runValues) ? runValues : [];
  const runs = rows.flatMap((value) => {
    const row = object(value);
    try {
      const normalized = normalizedReceipt(object(row.result_snapshot));
      return [{ sourceEventId: text(row.source_event_id, 200), ...normalized.run }];
    } catch {
      return [];
    }
  });
  return { settings, runs, cloud: true };
}
