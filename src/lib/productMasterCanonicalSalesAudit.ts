import { loadProductMasterShoplingSalesEventSyncStatus } from "@/lib/productMasterShoplingSalesEventSync";

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";

export type CanonicalRollingSalesRow = {
  skuId: string;
  barcode: string;
  monthlyUnits: number[];
  monthlyRevenue: number[];
  validEventCount: number;
  tombstoneCount: number;
  lastSaleAt: string | null;
};

export type CanonicalInactiveSalesSample = {
  skuId: string;
  barcode: string;
  externalId: string;
  occurredAt: string;
  validSale: boolean;
};

export type ProductMasterCanonicalSalesSnapshot = {
  ok: true;
  generatedAt: string;
  analysisAsOf: string;
  source: string;
  bucketDays: number;
  bucketCount: number;
  managedActiveSkuCount: number;
  sourceEventCount: number;
  validEventCount: number;
  tombstoneCount: number;
  inactiveManagedHistoricalEventCount: number;
  inactiveManagedValidEventCount: number;
  inactiveManagedTombstoneCount: number;
  inactiveManagedHistoricalSamples: CanonicalInactiveSalesSample[];
  orphanEventCount: number;
  classifiedEventCount: number;
  classificationComplete: boolean;
  contentFingerprint: string;
  rows: CanonicalRollingSalesRow[];
  writesEnabled: false;
};

export type ProductMasterCanonicalSalesAudit = {
  ready: boolean;
  state: string;
  message: string;
  analysisAsOf: string | null;
  snapshot: ProductMasterCanonicalSalesSnapshot | null;
  blockerCount: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  return { baseUrl, secret };
}

function normalizeSnapshot(value: Record<string, unknown>): ProductMasterCanonicalSalesSnapshot {
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const samples = Array.isArray(value.inactiveManagedHistoricalSamples)
    ? value.inactiveManagedHistoricalSamples
    : [];
  return {
    ok: true,
    generatedAt: text(value.generatedAt),
    analysisAsOf: text(value.analysisAsOf),
    source: text(value.source),
    bucketDays: number(value.bucketDays),
    bucketCount: number(value.bucketCount),
    managedActiveSkuCount: number(value.managedActiveSkuCount),
    sourceEventCount: number(value.sourceEventCount),
    validEventCount: number(value.validEventCount),
    tombstoneCount: number(value.tombstoneCount),
    inactiveManagedHistoricalEventCount: number(value.inactiveManagedHistoricalEventCount),
    inactiveManagedValidEventCount: number(value.inactiveManagedValidEventCount),
    inactiveManagedTombstoneCount: number(value.inactiveManagedTombstoneCount),
    inactiveManagedHistoricalSamples: samples as CanonicalInactiveSalesSample[],
    orphanEventCount: number(value.orphanEventCount),
    classifiedEventCount: number(value.classifiedEventCount),
    classificationComplete: value.classificationComplete === true,
    contentFingerprint: text(value.contentFingerprint),
    rows: rows as CanonicalRollingSalesRow[],
    writesEnabled: false,
  };
}

async function loadProductMasterCanonicalSnapshot(
  analysisAsOf: string,
  requestTimeoutMs: number,
) {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(
    `${baseUrl}/api/integrations/sales-events?analysisAsOf=${encodeURIComponent(analysisAsOf)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(text(payload.message) || `CANONICAL_SALES_AUDIT_FAILED:${response.status}`);
  }
  return normalizeSnapshot(payload);
}

export async function loadProductMasterCanonicalSalesAudit(
  options: { requestTimeoutMs?: number } = {},
): Promise<ProductMasterCanonicalSalesAudit> {
  const requestTimeoutMs = Math.max(
    1_000,
    Math.min(60_000, Math.trunc(options.requestTimeoutMs ?? 60_000)),
  );
  const status = await loadProductMasterShoplingSalesEventSyncStatus();
  if (status.state !== "COMPLETED" || !status.analysisAsOf) {
    return {
      ready: false,
      state: status.state,
      message: status.message,
      analysisAsOf: status.analysisAsOf,
      snapshot: null,
      blockerCount: status.blockerCount,
    };
  }

  const snapshot = await loadProductMasterCanonicalSnapshot(
    status.analysisAsOf,
    requestTimeoutMs,
  );
  const structuralBlockers = [
    snapshot.bucketDays !== 30,
    snapshot.bucketCount !== 12,
    snapshot.analysisAsOf !== status.analysisAsOf,
    !snapshot.classificationComplete,
    snapshot.orphanEventCount > 0,
    snapshot.rows.length !== snapshot.managedActiveSkuCount,
  ].filter(Boolean).length;

  return {
    ready: structuralBlockers === 0,
    state: structuralBlockers === 0 ? "READY" : "BLOCKED",
    message:
      structuralBlockers === 0
        ? `활성 SKU ${snapshot.managedActiveSkuCount}개와 판매 이벤트 ${snapshot.sourceEventCount}건의 12×30일 원장을 정확히 재조회했습니다.`
        : `Canonical 판매원장 구조 검증에서 ${structuralBlockers}개 차단 조건이 발견됐습니다.`,
    analysisAsOf: status.analysisAsOf,
    snapshot,
    blockerCount: structuralBlockers,
  };
}
