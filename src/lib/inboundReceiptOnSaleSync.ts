"use client";

import {
  INVENTORY_QUEUE_PATH,
  INVENTORY_REFRESH_PATH,
  inventoryStockReadClient,
} from "@/lib/inventoryStockConnection";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type SyncJob = {
  jobId: string;
  barcode: string;
  productName: string;
  productKind: ProductKind;
  modelNo: string | null;
  goodsKeys: string[];
  desiredStatus: DesiredStatus;
  desiredSince: string;
  exactInventoryQuantity: number;
  resetAt: string;
  route: string[];
};

type StockRow = {
  barcode: string;
  desiredStatus: DesiredStatus;
  exactInventoryQuantity: number;
  syncNeeded: boolean;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

type QueuePayload = {
  ok?: boolean;
  jobs?: SyncJob[];
  report: {
    state: "READY" | "BLOCKED";
    rows: StockRow[];
  };
};

type ResultMessage = {
  type: string;
  jobId: string;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

export type InboundOnSaleSyncSummary = {
  targetCount: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  alreadyOnSaleCount: number;
  blockedCount: number;
  extensionReady: boolean;
  message: string;
};

const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27";
const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27";
const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27";
const RESULT_HF27 = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27";
const RESULT_LEGACY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
const EXTENSION_READY_TIMEOUT_MS = 2_500;
const JOB_TIMEOUT_MS = 150_000;

function normalizeBarcode(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function eventId(prefix: string, job: SyncJob, outcome: SyncOutcome) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${job.jobId}:${outcome}:${random}`.slice(0, 480);
}

async function recordSync(
  job: SyncJob,
  outcome: SyncOutcome,
  message: string,
  evidence?: unknown,
) {
  const response = await fetch("/api/inventory-stock-control/sync", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({
      eventId: eventId("inbound-auto-onsale", job, outcome),
      jobId: job.jobId,
      barcode: job.barcode,
      productKind: job.productKind,
      modelNo: job.modelNo,
      desiredStatus: job.desiredStatus,
      outcome,
      message,
      evidence: {
        inboundAutoOnSale: true,
        source: "china-order-manager-receipt",
        ignoreWindowClose: true,
        ...(evidence && typeof evidence === "object" && !Array.isArray(evidence)
          ? (evidence as Record<string, unknown>)
          : { extensionEvidence: evidence ?? null }),
      },
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.message || `판매중 자동전환 결과 저장 실패 (${response.status})`,
    );
  }
}

function waitForExtensionReady() {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const done = (value: boolean) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      const type = String((event.data as Record<string, unknown>).type || "");
      if (
        type === READY ||
        type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY"
      ) {
        done(true);
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => done(false), EXTENSION_READY_TIMEOUT_MS);
    window.postMessage({ type: PING }, window.location.origin);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
  });
}

function waitForResult(jobId: string) {
  return new Promise<ResultMessage>((resolve) => {
    let finished = false;
    const done = (result: ResultMessage) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      const data = event.data as Record<string, unknown>;
      const type = String(data.type || "");
      if (type !== RESULT_HF27 && type !== RESULT_LEGACY) return;
      if (String(data.jobId || "") !== jobId) return;
      const outcome = String(data.outcome || "").toUpperCase();
      if (!(["SUCCEEDED", "FAILED", "UNCERTAIN"] as string[]).includes(outcome)) {
        return;
      }
      done({
        type,
        jobId,
        outcome: outcome as ResultMessage["outcome"],
        message: typeof data.message === "string" ? data.message : "",
        evidence: data.evidence,
        finishedAt: Number(data.finishedAt) || Date.now(),
      });
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(
      () =>
        done({
          type: RESULT_HF27,
          jobId,
          outcome: "UNCERTAIN",
          message:
            "Shopling 판매중 자동전환 결과가 제한시간 안에 확인되지 않아 자동 재시도하지 않습니다.",
          finishedAt: Date.now(),
          evidence: { code: "INBOUND_AUTO_ONSALE_RESULT_TIMEOUT" },
        }),
      JOB_TIMEOUT_MS,
    );
  });
}

async function executeOne(job: SyncJob) {
  await recordSync(
    job,
    "STARTED",
    `입고확정 후 자동 판매재개 시작 · 정확재고 ${job.exactInventoryQuantity}개`,
    { desiredSince: job.desiredSince },
  );
  const resultPromise = waitForResult(job.jobId);
  window.postMessage(
    {
      type: START,
      job: {
        ...job,
        operationalQueue: true,
        inboundAutoOnSale: true,
        ignoreWindowClose: true,
      },
    },
    window.location.origin,
  );
  const result = await resultPromise;
  await recordSync(
    job,
    result.outcome,
    result.message ||
      (result.outcome === "SUCCEEDED"
        ? "입고확정 후 Shopling 판매중 자동전환 완료"
        : "입고확정 후 Shopling 판매중 자동전환 확인 필요"),
    result.evidence,
  );
  return result.outcome;
}

export async function runInboundReceiptOnSaleSync(
  barcodes: string[],
  onProgress?: (message: string) => void,
): Promise<InboundOnSaleSyncSummary> {
  const targets = [
    ...new Set(barcodes.map(normalizeBarcode).filter(Boolean)),
  ];
  const targetSet = new Set(targets);
  if (!targets.length) {
    return {
      targetCount: 0,
      attemptedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      alreadyOnSaleCount: 0,
      blockedCount: 0,
      extensionReady: false,
      message: "판매중 자동전환 대상 B-code가 없습니다.",
    };
  }

  onProgress?.("입고확정 완료 · 최신 판매·재고를 확인해 판매중 자동전환 대상을 계산하고 있습니다.");
  await inventoryStockReadClient.read(INVENTORY_REFRESH_PATH, false);
  let queue = await inventoryStockReadClient.read<QueuePayload>(
    INVENTORY_QUEUE_PATH,
    true,
  );

  const relevantRows = queue.report.rows.filter((row) =>
    targetSet.has(normalizeBarcode(row.barcode)),
  );
  const initialJobs = (queue.jobs ?? []).filter(
    (job) =>
      targetSet.has(normalizeBarcode(job.barcode)) &&
      job.desiredStatus === "ON_SALE" &&
      job.exactInventoryQuantity > 0,
  );
  const alreadyOnSaleCount = relevantRows.filter(
    (row) => row.desiredStatus === "ON_SALE" && !row.syncNeeded,
  ).length;
  const initialBlocked = relevantRows.filter(
    (row) =>
      row.desiredStatus === "ON_SALE" && row.syncNeeded && row.syncBlocked,
  ).length;

  if (!initialJobs.length) {
    const blockedCount = Math.max(
      initialBlocked,
      targets.length - alreadyOnSaleCount,
    );
    const message = blockedCount
      ? `입고확정은 완료됐습니다. ${alreadyOnSaleCount}건은 이미 판매중이며 ${blockedCount}건은 정확재고·매핑 확인이 필요해 자동 판매재개를 보류했습니다.`
      : `입고확정은 완료됐습니다. 대상 ${targets.length}건은 이미 Shopling 판매중 상태입니다.`;
    return {
      targetCount: targets.length,
      attemptedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      alreadyOnSaleCount,
      blockedCount,
      extensionReady: false,
      message,
    };
  }

  const extensionReady = await waitForExtensionReady();
  if (!extensionReady) {
    return {
      targetCount: targets.length,
      attemptedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      alreadyOnSaleCount,
      blockedCount: initialJobs.length + initialBlocked,
      extensionReady: false,
      message: `입고확정은 완료됐지만 재고상태 확장프로그램 연결을 확인하지 못해 판매중 자동전환 ${initialJobs.length}건을 보류했습니다. 재고·품절·판매재개 화면의 대기 큐에는 그대로 남습니다.`,
    };
  }

  let attemptedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  const candidateBarcodes = [
    ...new Set(initialJobs.map((job) => normalizeBarcode(job.barcode))),
  ];

  for (let index = 0; index < candidateBarcodes.length; index += 1) {
    const code = candidateBarcodes[index];
    queue = await inventoryStockReadClient.read<QueuePayload>(
      INVENTORY_QUEUE_PATH,
      true,
    );
    const job = (queue.jobs ?? []).find(
      (candidate) =>
        normalizeBarcode(candidate.barcode) === code &&
        candidate.desiredStatus === "ON_SALE" &&
        candidate.exactInventoryQuantity > 0,
    );
    if (!job) continue;

    attemptedCount += 1;
    onProgress?.(
      `입고확정 완료 · 판매중 자동전환 ${attemptedCount}/${candidateBarcodes.length} 처리 중 · ${job.barcode}`,
    );
    try {
      const outcome = await executeOne(job);
      if (outcome === "SUCCEEDED") succeededCount += 1;
      else failedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  queue = await inventoryStockReadClient.read<QueuePayload>(
    INVENTORY_QUEUE_PATH,
    true,
  );
  const finalRows = queue.report.rows.filter((row) =>
    targetSet.has(normalizeBarcode(row.barcode)),
  );
  const finalAlreadyOnSaleCount = finalRows.filter(
    (row) => row.desiredStatus === "ON_SALE" && !row.syncNeeded,
  ).length;
  const pendingOrBlockedCount = finalRows.filter(
    (row) => row.desiredStatus === "ON_SALE" && row.syncNeeded,
  ).length;
  const nonOnSaleDecisionCount = finalRows.filter(
    (row) => row.desiredStatus !== "ON_SALE",
  ).length;
  const missingRowCount = Math.max(0, targets.length - finalRows.length);
  const blockedCount = Math.max(
    0,
    pendingOrBlockedCount + nonOnSaleDecisionCount + missingRowCount,
  );

  const message =
    blockedCount || failedCount
      ? `입고확정 완료 · Shopling 판매중 자동전환 ${succeededCount}건 완료, 이미 판매중 ${finalAlreadyOnSaleCount}건, 확인 필요 ${Math.max(blockedCount, failedCount)}건입니다. 확인 필요 건은 자동 재시도하지 않고 기존 재고상태 큐에 남깁니다.`
      : `입고확정 완료 · Shopling 판매중 자동전환 ${succeededCount}건 완료, 이미 판매중 ${finalAlreadyOnSaleCount}건입니다.`;

  return {
    targetCount: targets.length,
    attemptedCount,
    succeededCount,
    failedCount,
    alreadyOnSaleCount: finalAlreadyOnSaleCount,
    blockedCount,
    extensionReady: true,
    message,
  };
}
