import type { EngineRunnerKind } from "./engineRunnerTypes";

export const ENGINE_RUNNER_HISTORY_STORAGE_KEY = "opsCenter.engineRunnerHistory.v1";
export const ENGINE_RUNNER_HISTORY_MAX_ITEMS = 100;

export type EngineRunnerHistoryType = "dispatch_requested" | "artifact_imported";
export type EngineRunnerHistoryStatus = "requested" | "imported" | "failed";

export type EngineRunnerHistoryItem = {
  id: string;
  kind: EngineRunnerKind;
  type: EngineRunnerHistoryType;
  createdAt: string;
  title: string;
  summary: string;
  input: {
    goodsKey?: string;
    seedKeyword?: string;
    sourceLink?: string;
    productCode?: string;
  };
  github?: {
    repo?: string;
    workflowFile?: string;
    actionsUrl?: string;
    runId?: number;
    artifactId?: number;
    artifactName?: string;
  };
  reviewRoute?: string;
  status?: EngineRunnerHistoryStatus;
  safety: {
    notAppliedToShopling: true;
    notPublished: true;
    requiresHumanReview: true;
  };
};

type EngineRunnerHistoryInput = Omit<EngineRunnerHistoryItem, "id" | "createdAt" | "safety"> & {
  id?: string;
  createdAt?: string;
  safety?: EngineRunnerHistoryItem["safety"];
};

const FORBIDDEN_KEYS = new Set([
  "token",
  "authorization",
  "auth",
  "headers",
  "files",
  "fileContents",
  "contents",
  "csv",
  "html",
  "payload",
]);

function hasStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `engine-history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sanitize<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitize(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        if (FORBIDDEN_KEYS.has(key) || /token|authorization|headers|contents|payload|csv|html/i.test(key)) return [];
        return [[key, sanitize(entry)]];
      }),
    ) as T;
  }
  return value;
}

function normalizeItem(item: EngineRunnerHistoryInput): EngineRunnerHistoryItem {
  const sanitized = sanitize(item);
  return {
    ...sanitized,
    id: sanitized.id ?? createId(),
    createdAt: sanitized.createdAt ?? new Date().toISOString(),
    input: sanitized.input ?? {},
    safety: {
      notAppliedToShopling: true,
      notPublished: true,
      requiresHumanReview: true,
    },
  };
}

export function readEngineRunnerHistory(): EngineRunnerHistoryItem[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(ENGINE_RUNNER_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeItem(item)).slice(0, ENGINE_RUNNER_HISTORY_MAX_ITEMS);
  } catch {
    return [];
  }
}

export function addEngineRunnerHistoryItem(item: EngineRunnerHistoryInput): EngineRunnerHistoryItem | null {
  if (!hasStorage()) return null;
  const normalized = normalizeItem(item);
  const nextItems = [normalized, ...readEngineRunnerHistory()].slice(0, ENGINE_RUNNER_HISTORY_MAX_ITEMS);
  window.localStorage.setItem(ENGINE_RUNNER_HISTORY_STORAGE_KEY, JSON.stringify(nextItems));
  window.dispatchEvent(new Event("engine-runner-history-updated"));
  return normalized;
}
