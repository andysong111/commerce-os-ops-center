const DEFAULT_PRODUCT_MASTER_BASE_URL =
  "https://commerce-os-product-master.vercel.app";
const WAREHOUSE_CAPACITY_PATH = "/api/integrations/warehouse-capacity";
const UPSTREAM_TIMEOUT_MS = 15_000;

export type WarehouseCapacityGate =
  | "READY"
  | "WAITING_PHYSICAL_REGISTRY_CONFIRMATION"
  | "WAITING_LIFECYCLE_BASELINE"
  | "CAPACITY_DATA_CONFLICT";

export type WarehouseCapacityLocation = {
  locationCode: string;
  registered: boolean;
  allocatable: boolean;
  occupied: boolean;
  zone: string;
  source: string;
  note: string;
  exitCandidate: boolean;
  trustedExitCandidate: boolean;
  occupants: Array<{
    skuId: string;
    modelNo: string;
    productName: string;
    optionName: string;
    lifecycleStatus: string;
    reorderingAllowed: boolean | null;
    discontinued: boolean | null;
    clearanceStage: number | null;
    historyMonths: number | null;
    lastAction: string;
    shadowMode: boolean | null;
    baselineReady: boolean;
  }>;
};

export type WarehouseCapacitySnapshot = {
  generatedAt: string;
  registryComplete: boolean;
  registryConfirmedAt: string | null;
  reserveSlotCount: number;
  registeredSlotCount: number;
  registeredAllocatableSlotCount: number;
  registeredBlockedSlotCount: number;
  occupiedLocationCount: number;
  registeredOccupiedLocationCount: number;
  freeRegisteredSlotCount: number;
  usableFreeSlotCount: number | null;
  occupancyRate: number | null;
  registryCoverageRate: number;
  unregisteredOccupiedLocationCount: number;
  occupiedBlockedLocationCount: number;
  occupancyCollisionCount: number;
  lifecycleReady: boolean;
  lifecycleCoveredSkuCount: number;
  lifecycleRequiredSkuCount: number;
  lifecycleAuthoritativeSkuCount: number;
  lifecycleMissingSkuCount: number;
  lifecycleShadowSkuCount: number;
  lifecycleWaitingBaselineSkuCount: number;
  lifecycleInsufficientHistorySkuCount: number;
  exitCandidateLocationCount: number;
  trustedExitCandidateLocationCount: number;
  untrustedExitCandidateLocationCount: number;
  exitCandidateCountTrusted: boolean;
  safeImmediateNewSkuCapacity: number | null;
  forecastNewSkuCapacity: number | null;
  forecastIsLowerBound: boolean;
  sourcingIntakeGate: WarehouseCapacityGate;
  settingsNote: string;
  warnings: string[];
  locations: WarehouseCapacityLocation[];
};

type UpstreamPayload = {
  ok?: boolean;
  snapshot?: WarehouseCapacitySnapshot;
  error?: string;
  message?: string;
  action?: string;
  result?: unknown;
};

export class WarehouseCapacityBridgeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "WarehouseCapacityBridgeError";
    this.code = code;
    this.status = status;
  }
}

function baseUrl() {
  const raw =
    process.env.PRODUCT_MASTER_BASE_URL?.trim() ||
    DEFAULT_PRODUCT_MASTER_BASE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") {
      throw new Error("PRODUCT_MASTER_BASE_URL_MUST_USE_HTTPS");
    }
    return parsed.origin;
  } catch {
    throw new WarehouseCapacityBridgeError(
      "PRODUCT_MASTER_BASE_URL_INVALID",
      "상품마스터 연결 주소가 올바르지 않습니다.",
      503,
    );
  }
}

function integrationSecret() {
  return process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim() || "";
}

export function warehouseCapacityBridgeConfigured() {
  return Boolean(integrationSecret());
}

export const WAREHOUSE_CAPACITY_ALLOWED_ACTIONS = [
  "register_slots",
  "set_slot_allocatable",
  "set_registry_status",
] as const;

export type WarehouseCapacityWriteAction =
  (typeof WAREHOUSE_CAPACITY_ALLOWED_ACTIONS)[number];

export function isWarehouseCapacityWriteAction(
  value: unknown,
): value is WarehouseCapacityWriteAction {
  return WAREHOUSE_CAPACITY_ALLOWED_ACTIONS.includes(
    String(value ?? "") as WarehouseCapacityWriteAction,
  );
}

async function upstreamRequest(
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) {
  const secret = integrationSecret();
  if (!secret) {
    throw new WarehouseCapacityBridgeError(
      "PRODUCT_MASTER_INTEGRATION_NOT_CONFIGURED",
      "OPS Center에 상품마스터 연동 비밀키가 설정되지 않았습니다.",
      503,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${WAREHOUSE_CAPACITY_PATH}`, {
      method,
      headers: {
        accept: "application/json",
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
        "x-commerce-os-integration-secret": secret,
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    let payload: UpstreamPayload = {};
    try {
      payload = (await response.json()) as UpstreamPayload;
    } catch {
      throw new WarehouseCapacityBridgeError(
        "PRODUCT_MASTER_INVALID_RESPONSE",
        "상품마스터 응답 형식이 올바르지 않습니다.",
        502,
      );
    }

    if (!response.ok || payload.ok === false) {
      const code =
        response.status === 401
          ? "PRODUCT_MASTER_INTEGRATION_SECRET_MISMATCH"
          : payload.error || "PRODUCT_MASTER_CAPACITY_UPSTREAM_FAILED";
      const message =
        response.status === 401
          ? "상품마스터 연동 비밀키가 일치하지 않습니다. 서버 환경변수를 확인해야 합니다."
          : payload.message || "상품마스터 창고 수용능력 조회에 실패했습니다.";
      throw new WarehouseCapacityBridgeError(code, message, response.status);
    }

    return payload;
  } catch (error) {
    if (error instanceof WarehouseCapacityBridgeError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new WarehouseCapacityBridgeError(
        "PRODUCT_MASTER_CAPACITY_TIMEOUT",
        "상품마스터 응답 시간이 초과되었습니다.",
        504,
      );
    }
    throw new WarehouseCapacityBridgeError(
      "PRODUCT_MASTER_CAPACITY_UNREACHABLE",
      "상품마스터 창고 수용능력 서비스에 연결하지 못했습니다.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWarehouseCapacitySnapshot() {
  const payload = await upstreamRequest("GET");
  if (!payload.snapshot) {
    throw new WarehouseCapacityBridgeError(
      "PRODUCT_MASTER_CAPACITY_SNAPSHOT_MISSING",
      "상품마스터 응답에 창고 수용능력 스냅샷이 없습니다.",
      502,
    );
  }
  return payload.snapshot;
}

export async function writeWarehouseCapacity(
  body: Record<string, unknown>,
) {
  if (!isWarehouseCapacityWriteAction(body.action)) {
    throw new WarehouseCapacityBridgeError(
      "WAREHOUSE_CAPACITY_ACTION_INVALID",
      "허용되지 않은 창고 수용능력 작업입니다.",
      400,
    );
  }
  return upstreamRequest("POST", body);
}
