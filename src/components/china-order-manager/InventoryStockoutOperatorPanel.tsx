"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseInventoryStockEstimateBulkText,
  parseInventoryStockoutBulkText,
  parseInventoryStocktakeBulkText,
  type InventoryStockBand,
} from "@/lib/inventoryStockBulkInput";
import {
  planShoplingStockLaunch,
  supportsAllDateStockSync,
} from "@/lib/shoplingStockLaunchPlan";
import { requireShoplingAuthenticatedSession } from "@/lib/shoplingStockSessionPreflight";
import { waitForShoplingStockIdle } from "@/lib/shoplingStockReadyBarrier";
import { isSafeShoplingStockRetry, MAX_SHOPLING_STOCK_ATTEMPTS } from "@/lib/shoplingStockRetryPolicy.mjs";
import {
  finalizeShoplingDirectRun,
  recordShoplingDirectRunOutcome,
  retryableShoplingDirectRunJobIds,
  shoplingDirectRunCounts,
  shoplingDirectRunSummaryText,
  startShoplingDirectRun,
  type ShoplingDirectRunProgress,
} from "@/lib/shoplingDirectRunProgress";
import { recoverLatestPendingDirectJobs } from "@/lib/shoplingDirectRunRecovery";
import { shoplingStockResultDetail } from "@/lib/shoplingStockResponsibility";
import {
  buildShoplingManualFallbackGroups,
  shoplingManualFallbackCopyText,
} from "@/lib/shoplingManualFallback";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type DirectInventoryJob = {
  jobId: string;
  barcode: string;
  productName: string;
  productKind: ProductKind;
  modelNo: string | null;
  goodsKeys: string[];
  desiredStatus: DesiredStatus;
  desiredSince: string;
  exactInventoryQuantity: number;
  inventoryQuantityKnown?: boolean;
  manualStatusOnly?: boolean;
  resetAt: string;
  route: string[];
  stockStateApiEvidence?: unknown;
  directOperatorCommand?: true;
  retransmissionRequestId?: string;
  operationalQueue?: true;
  parallelBatchId?: string;
  parallelLane?: number;
  ignoreWindowClose?: true;
};

type ResultMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  jobId: string;
  job?: DirectInventoryJob | null;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

type DirectRunResultDetail = {
  jobId: string;
  barcode: string;
  desiredStatus: DesiredStatus;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message: string;
  code: string;
  stage: string;
  marketFailureCount: number;
  marketSuccessCount: number;
  marketTotalCount: number;
  responsibilityReceiptAccepted: boolean;
  attemptCount: number;
  failurePhaseLabel?: string;
  failureReason?: string;
  failureImpact?: string;
  failureNextAction?: string;
  failureCurrentStatus?: string;
};

type ActiveBatch = {
  mode: "PARALLEL" | "SINGLE";
  batchId: string;
  jobs: DirectInventoryJob[];
  dispatchedAt: number;
  dispatchIds: Map<string, string>;
  startedJobIds: Set<string>;
  startRecordPromises: Map<string, Promise<void>>;
  retainedJobIds: Set<string>;
  terminalJobIds: Set<string>;
};

const PARALLEL_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START";
const PARALLEL_STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_STATUS";
const SINGLE_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
const RECEIPT_MARK = "__commerceOsStockSyncBridgeHF27";
const REFRESH_EVENT = "commerce-os:inventory-refresh";

async function loadLatestPendingDirectJobs() {
  const response = await fetch("/api/inventory-stock-control/sync?mode=execute", {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = object(payload).message;
    throw new Error(
      typeof message === "string" && message.trim()
        ? message
        : "저장된 Shopling 미전송 작업을 불러오지 못했습니다.",
    );
  }
  const recovered = recoverLatestPendingDirectJobs(payload);
  if (!recovered) return null;
  return {
    requestId: recovered.requestId,
    jobs: recovered.jobs.map((job) => job as unknown as DirectInventoryJob),
  };
}

function randomId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function stableEventId(
  prefix: string,
  job: DirectInventoryJob,
  outcome: SyncOutcome,
  finishedAt?: number,
) {
  return [prefix, job.jobId, outcome, Number(finishedAt || 0)]
    .filter(Boolean)
    .join(":")
    .slice(0, 480);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function advisoryMarketFailureCount(evidence: unknown) {
  const root = object(evidence);
  const nested = object(root.result);
  const advisory =
    root.marketFailuresAdvisory === true ||
    nested.marketFailuresAdvisory === true;
  if (!advisory) return 0;
  return Math.max(
    0,
    Number(root.marketFailureCount) || 0,
    Number(nested.marketFailureCount) || 0,
  );
}

export function friendlyShoplingStockSyncFailure(
  message: string | null | undefined,
  evidence?: unknown,
) {
  const raw = `${String(message || "")} ${JSON.stringify(evidence ?? {})}`;
  if (
    raw.includes("enableAllDateSearch is not defined") ||
    raw.includes("A21_CONTENT_EXCEPTION")
  ) {
    return "Shopling A21 작업 프레임·성공표 영수증을 확인하지 못했습니다. Shopling에는 이미 접수됐을 수 있으므로 같은 B코드를 다시 실행하지 말고 A21 결과를 먼저 확인해 주세요. 이후 재고상태 자동화 확장을 v0.6.61로 업데이트해 주세요.";
  }
  if (
    raw.includes("A21_ALL_DATE_FILTER_NOT_FOUND") ||
    raw.includes("A6_DATE_SCOPE_CONTROLS_NOT_FOUND") ||
    raw.includes("A6_DATE_SCOPE_CLEAR_FAILED") ||
    raw.includes("A6_DATE_SCOPE_SET_FAILED") ||
    raw.includes("SEARCH_DATE_FIELDS_AMBIGUOUS")
  ) {
    return "Shopling 상품등록 전체기간 조건을 확인하지 못해 안전하게 중단했습니다. 재고 기준은 저장됐고 Shopling에는 반영되지 않았습니다.";
  }
  if (raw.includes("UNCERTAIN")) {
    return "Shopling 전송 결과를 확정하지 못했습니다. 중복 처리를 막기 위해 자동 재시도하지 않았으므로 처리 내역에서 확인해 주세요.";
  }
  return message
    ? `Shopling 반영에 실패했습니다: ${message}`
    : "Shopling 반영에 실패했습니다. 재고 기준은 저장됐으며 처리 내역에서 실패 사유를 확인해 주세요.";
}

type InventoryStockoutOperatorPanelProps = {
  focusedBarcodes?: string[];
  returnTo?: string | null;
};

const ROUGH_STOCK_OPTIONS = [
  { label: "많음", stockBand: "HIGH" },
  { label: "보통", stockBand: "NORMAL" },
  { label: "적음", stockBand: "LOW" },
  { label: "품절", stockBand: "OUT" },
] as const satisfies ReadonlyArray<{
  label: string;
  stockBand: InventoryStockBand;
}>;

function RoughStockCorrectionPanel({
  focusedBarcodes,
  returnTo,
}: Required<Pick<InventoryStockoutOperatorPanelProps, "focusedBarcodes">> &
  Pick<InventoryStockoutOperatorPanelProps, "returnTo">) {
  const [selected, setSelected] = useState<Record<string, InventoryStockBand>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const complete = focusedBarcodes.every((barcode) => Boolean(selected[barcode]));

  const saveAndReturn = async () => {
    if (!complete) {
      setNotice("표시된 상품의 재고상태를 모두 선택해 주세요.");
      return;
    }

    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/inventory-stock-control/unified-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          batchId: randomId("purchase-rough-stock-correction"),
          stockoutBarcodes: [],
          onSaleBarcodes: [],
          stocktakeItems: [],
          stockEstimateItems: focusedBarcodes.map((barcode) => ({
            barcode,
            stockBand: selected[barcode],
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DirectInventoryJob[];
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "발주용 재고상태를 저장하지 못했습니다.");
      }
      if (Array.isArray(payload.jobs) && payload.jobs.length > 0) {
        throw new Error("안전 확인에 실패했습니다. Shopling 전송은 실행하지 않았습니다.");
      }

      window.dispatchEvent(new Event(REFRESH_EVENT));
      let referrer: URL | null = null;
      try {
        referrer = document.referrer ? new URL(document.referrer) : null;
      } catch {
        referrer = null;
      }
      const target =
        referrer?.origin === window.location.origin &&
        referrer.pathname === "/purchase-cycle-preflight"
          ? referrer.href
          : returnTo || "/purchase-cycle-preflight";
      window.location.assign(target);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "발주용 재고상태 저장 실패",
      );
      setLoading(false);
    }
  };

  return (
    <section
      id="rough-stock-status"
      className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"
    >
      <span className="text-xs font-black tracking-[0.12em] text-amber-700">
        PURCHASE PLANNING · 대략 재고 수정
      </span>
      <h2 className="mt-1 text-xl font-black text-slate-950">
        충돌 상품 {focusedBarcodes.length}종만 확인하세요
      </h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
        여기서는 발주계산용 대략 재고만 저장합니다. Shopling의 품절·판매중
        상태와 실제 재고수량은 바꾸지 않습니다. 저장하면 발주 계산 화면으로
        돌아갑니다.
      </p>

      <div className="mt-5 space-y-3">
        {focusedBarcodes.map((barcode) => (
          <fieldset
            key={barcode}
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <legend className="px-1 text-sm font-black text-slate-950">
              {barcode}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ROUGH_STOCK_OPTIONS.map((option) => {
                const active = selected[barcode] === option.stockBand;
                return (
                  <button
                    key={option.stockBand}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setSelected((current) => ({
                        ...current,
                        [barcode]: option.stockBand,
                      }))
                    }
                    className={`rounded-lg border px-4 py-2 text-sm font-black ${
                      active
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-amber-300"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void saveAndReturn()}
        disabled={loading || !complete}
        aria-busy={loading}
        className="mt-5 rounded-xl bg-amber-600 px-6 py-3 text-sm font-black text-white hover:bg-amber-700 disabled:bg-slate-400"
      >
        {loading ? "재고상태 저장 중..." : "재고상태 저장하고 발주 계산으로 돌아가기"}
      </button>
      {notice ? (
        <p
          role="status"
          className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800"
        >
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export function InventoryStockoutOperatorPanel({
  focusedBarcodes = [],
  returnTo = null,
}: InventoryStockoutOperatorPanelProps = {}) {
  if (focusedBarcodes.length > 0) {
    return (
      <RoughStockCorrectionPanel
        focusedBarcodes={focusedBarcodes}
        returnTo={returnTo}
      />
    );
  }
  return <InventoryStockoutGenericPanel />;
}

function InventoryStockoutGenericPanel() {
  const [stockoutInput, setStockoutInput] = useState("");
  const [onSaleInput, setOnSaleInput] = useState("");
  const [stocktakeInput, setStocktakeInput] = useState("");
  const [stockEstimateInput, setStockEstimateInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState("");
  const [manualCopyNotice, setManualCopyNotice] = useState("");
  const [directRunProgress, setDirectRunProgress] =
    useState<ShoplingDirectRunProgress | null>(null);
  const [directRunJobSnapshot, setDirectRunJobSnapshot] = useState<
    DirectInventoryJob[]
  >([]);
  const [directRunResultDetails, setDirectRunResultDetails] = useState<
    DirectRunResultDetail[]
  >([]);
  const stockoutParsed = useMemo(
    () => parseInventoryStockoutBulkText(stockoutInput),
    [stockoutInput],
  );
  const onSaleParsed = useMemo(
    () => parseInventoryStockoutBulkText(onSaleInput),
    [onSaleInput],
  );
  const stocktakeParsed = useMemo(
    () => parseInventoryStocktakeBulkText(stocktakeInput),
    [stocktakeInput],
  );
  const stockEstimateParsed = useMemo(
    () => parseInventoryStockEstimateBulkText(stockEstimateInput),
    [stockEstimateInput],
  );
  const totalCount =
    stockoutParsed.barcodes.length +
    onSaleParsed.barcodes.length +
    stocktakeParsed.items.length +
    stockEstimateParsed.items.length;
  const inputErrors = [
    ...stockoutParsed.errors,
    ...onSaleParsed.errors,
    ...stocktakeParsed.errors,
    ...stockEstimateParsed.errors,
  ];
  const conflictingBarcodes = useMemo(() => {
    const all = [
      ...stockoutParsed.barcodes,
      ...onSaleParsed.barcodes,
      ...stocktakeParsed.items.map((item) => item.barcode),
      ...stockEstimateParsed.items.map((item) => item.barcode),
    ];
    return [...new Set(all.filter((barcode, index) => all.indexOf(barcode) !== index))];
  }, [onSaleParsed.barcodes, stockEstimateParsed.items, stockoutParsed.barcodes, stocktakeParsed.items]);

  const extensionReadyRef = useRef(false);
  const extensionVersionRef = useRef("");
  const directQueue = useRef<DirectInventoryJob[]>([]);
  const directRunJobs = useRef(new Map<string, DirectInventoryJob>());
  const activeBatch = useRef<ActiveBatch | null>(null);
  const launchingNext = useRef(false);
  const mounted = useRef(false);
  const attemptsByJob = useRef(new Map<string, number>());
  const safeRetryWaiting = useRef(new Set<string>());
  const [hasResumableStoppedJobs, setHasResumableStoppedJobs] = useState(false);
  const launchTimer = useRef<number | null>(null);
  const handledResults = useRef(new Set<string>());
  const directRunProgressRef = useRef<ShoplingDirectRunProgress | null>(null);
  const launchNextRef = useRef<() => Promise<void>>(async () => undefined);

  const publishDirectRunProgress = useCallback(
    (next: ShoplingDirectRunProgress | null) => {
      directRunProgressRef.current = next;
      setDirectRunProgress(next);
    },
    [],
  );

  const rememberDirectJobs = useCallback(
    (jobs: readonly DirectInventoryJob[], replace = false) => {
      if (replace) directRunJobs.current.clear();
      for (const job of jobs) {
        const previous = directRunJobs.current.get(job.jobId);
        directRunJobs.current.set(job.jobId, {
          ...previous,
          ...job,
          goodsKeys:
            Array.isArray(job.goodsKeys) && job.goodsKeys.length
              ? job.goodsKeys
              : previous?.goodsKeys ?? [],
          stockStateApiEvidence:
            job.stockStateApiEvidence ?? previous?.stockStateApiEvidence,
        });
      }
      setDirectRunJobSnapshot([...directRunJobs.current.values()]);
    },
    [],
  );

  const upsertDirectRunResultDetail = useCallback(
    (
      job: DirectInventoryJob,
      outcome: Exclude<SyncOutcome, "STARTED">,
      message: string,
      evidence?: unknown,
    ) => {
      const receipt = shoplingStockResultDetail({
        outcome,
        message,
        evidence,
      });
      const nextDetail: DirectRunResultDetail = {
        jobId: job.jobId,
        barcode: job.barcode,
        desiredStatus: job.desiredStatus,
        attemptCount: Number(object(evidence).attempt) || 1,
        outcome,
        message,
        ...receipt,
      };
      setDirectRunResultDetails((current) => {
        const index = current.findIndex((row) => row.jobId === job.jobId);
        if (index < 0) return [...current, nextDetail];
        const next = [...current];
        next[index] = nextDetail;
        return next;
      });
    },
    [],
  );

  const getResumableDirectJobIds = useCallback((current: ShoplingDirectRunProgress) =>
    [...directRunJobs.current.keys()].filter((jobId) =>
      !current.outcomesByJobId[jobId]
      && (!attemptsByJob.current.has(jobId) || safeRetryWaiting.current.has(jobId)),
    ), []);

  const stopDirectRunProgress = useCallback(() => {
    const current = directRunProgressRef.current;
    if (!current) return;
    setHasResumableStoppedJobs(getResumableDirectJobIds(current).length > 0);
    publishDirectRunProgress(finalizeShoplingDirectRun(current, true));
  }, [getResumableDirectJobIds, publishDirectRunProgress]);

  const recordSync = useCallback(
    async (
      job: DirectInventoryJob,
      outcome: SyncOutcome,
      message: string,
      evidence?: unknown,
      finishedAt?: number,
    ) => {
      const response = await fetch("/api/inventory-stock-control/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          eventId:
            outcome === "STARTED"
              ? stableEventId(`shopling-stock-started:${object(evidence).dispatchJobId || "initial"}`, job, outcome)
              : stableEventId(
                  "shopling-stock-result",
                  job,
                  outcome,
                  finishedAt || Date.now(),
                ),
          jobId: job.jobId,
          barcode: job.barcode,
          productKind: job.productKind,
          modelNo: job.modelNo,
          desiredStatus: job.desiredStatus,
          outcome,
          message,
          ...(job.retransmissionRequestId
            ? { retransmissionRequestId: job.retransmissionRequestId }
            : {}),
          evidence: {
            unifiedInventoryBatch: true,
            maxConcurrentLanes: 1,
            windowCloseIgnored: true,
            inventoryQuantityKnown: job.inventoryQuantityKnown !== false,
            manualStatusOnly: job.manualStatusOnly === true,
            ...(evidence &&
            typeof evidence === "object" &&
            !Array.isArray(evidence)
              ? (evidence as Record<string, unknown>)
              : { extensionEvidence: evidence ?? null }),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.message ||
            "Shopling 재고상태 전송 결과를 원장에 저장하지 못했습니다.",
        );
      }
    },
    [],
  );

  const launchNext = useCallback(async () => {
    if (!mounted.current || activeBatch.current || launchingNext.current || !extensionReadyRef.current) return;

    const plan = planShoplingStockLaunch(
      directQueue.current,
      extensionVersionRef.current,
    );
    if (!plan.jobs.length) {
      setSyncing(false);
      const current = directRunProgressRef.current;
      if (current) {
        const finalized = finalizeShoplingDirectRun(current);
        publishDirectRunProgress(finalized);
        setSyncNotice(shoplingDirectRunSummaryText(finalized));
      } else {
        setSyncNotice("통합 입력과 Shopling 재고상태 전송을 모두 마쳤습니다.");
      }
      window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }

    launchingNext.current = true;
    try {
      setSyncNotice(
        `${plan.jobs[0].barcode} · Shopling 다음 작업 가능 상태를 확인하고 있습니다.`,
      );
      await waitForShoplingStockIdle();
    } catch (error) {
      launchingNext.current = false;
      setSyncing(false);
      stopDirectRunProgress();
      setSyncNotice(
        `${
          error instanceof Error
            ? error.message
            : "Shopling 다음 작업 가능 상태를 확인하지 못했습니다."
        } · 남은 B코드는 전송하지 않고 운영 큐에 그대로 남겼습니다.`,
      );
      window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }

    try {
      if (!mounted.current) return;
      await requireShoplingAuthenticatedSession();
    } catch (error) {
      launchingNext.current = false;
      setSyncing(false);
      stopDirectRunProgress();
      setSyncNotice(
        error instanceof Error
          ? error.message
          : "Shopling 로그인 상태를 확인하지 못해 전송을 시작하지 않았습니다.",
      );
      window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }

    if (!mounted.current) return;
    const batchId = randomId("stockout-direct-batch");
    // A proven one-B-code run is the only safe transport boundary. Even when
    // several option B-codes share a model number, never merge them back into
    // one extension START. The next B-code is assigned only after this job has
    // a terminal receipt and the extension explicitly reports idle.
    const assignedJobs = plan.jobs.slice(0, 1);
    const prepared = assignedJobs.map((job, index) => ({
      ...job,
      operationalQueue: true as const,
      parallelBatchId: batchId,
      parallelLane: index + 1,
      ignoreWindowClose: true as const,
    }));
    const dispatchIds = new Map(prepared.map((job) => [job.jobId, randomId(job.jobId)]));

    const batch: ActiveBatch = {
      mode: plan.mode,
      batchId,
      jobs: prepared,
      dispatchIds,
      dispatchedAt: 0,
      startedJobIds: new Set<string>(),
      startRecordPromises: new Map<string, Promise<void>>(),
      retainedJobIds: new Set<string>(),
      terminalJobIds: new Set<string>(),
    };
    activeBatch.current = batch;
    launchingNext.current = false;
    setSyncNotice(
      plan.mode === "PARALLEL"
        ? `${prepared[0].barcode} + ${prepared[1].barcode} · Shopling 재고상태 2-Lane 전송 시작`
        : plan.compatibilitySerial
          ? `${prepared[0].barcode} · Shopling 동시작업 충돌을 막기 위해 B코드를 1건씩 순차 전송합니다.`
          : `${prepared[0].barcode} · Shopling 재고상태 전송 시작`,
    );

    try {
      for (const job of prepared) {
        const attempt = (attemptsByJob.current.get(job.jobId) || 0) + 1;
        if (attempt > MAX_SHOPLING_STOCK_ATTEMPTS) throw new Error("Shopling 자동 시도 한도에 도달했습니다.");
        attemptsByJob.current.set(job.jobId, attempt);
        safeRetryWaiting.current.delete(job.jobId);
        const startRecord = recordSync(
          job,
          "STARTED",
          `Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 전송 ${attempt}차 시도`,
          {
            directOperatorCommand: true,
            unifiedInventoryBatch: true,
            operationalBatchId: batchId,
            operationalLane: 1,
            maxConcurrentLanes: 1,
            strictSingleBcodeDispatch: true,
            desiredSince: job.desiredSince,
            attempt,
            dispatchJobId: dispatchIds.get(job.jobId),
          },
        );
        batch.startRecordPromises.set(job.jobId, startRecord);
        await startRecord;
        if (!mounted.current || activeBatch.current !== batch) return;
        batch.startedJobIds.add(job.jobId);
      }

      const dispatchedJobs = prepared.map((job) => ({ ...job, jobId: dispatchIds.get(job.jobId)! }));
      batch.dispatchedAt = Date.now();
      if (plan.mode === "PARALLEL") {
        window.postMessage(
          { type: PARALLEL_START, batchId, jobs: dispatchedJobs },
          window.location.origin,
        );
      } else {
        window.postMessage(
          {
            type: SINGLE_START,
            job: dispatchedJobs[0],
          },
          window.location.origin,
        );
      }
    } catch (error) {
      activeBatch.current = null;
      directQueue.current = [];
      setSyncing(false);
      stopDirectRunProgress();
      setSyncNotice(
        `${error instanceof Error ? error.message : "Shopling 즉시 전송 시작 실패"} · 입력 내용은 저장되어 있으므로 일반 운영 큐에서 다시 처리할 수 있습니다.`,
      );
      window.dispatchEvent(new Event(REFRESH_EVENT));
    }
  }, [publishDirectRunProgress, recordSync, stopDirectRunProgress]);

  useEffect(() => {
    launchNextRef.current = launchNext;
  }, [launchNext]);

  useEffect(() => {
    let cancelled = false;
    void loadLatestPendingDirectJobs()
      .then((recovered) => {
        if (cancelled || !recovered || directRunProgressRef.current) return;
        directQueue.current = recovered.jobs;
        rememberDirectJobs(recovered.jobs, true);
        setHasResumableStoppedJobs(true);
        publishDirectRunProgress(
          finalizeShoplingDirectRun(
            startShoplingDirectRun(recovered.jobs.length),
            true,
          ),
        );
        setSyncNotice(
          `최근 저장된 Shopling 미전송 ${recovered.jobs.length}건을 복구했습니다. 관리자 로그인 확인 후 아래 버튼으로 다시 시도하세요.`,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [publishDirectRunProgress, rememberDirectJobs]);

  useEffect(() => {
    mounted.current = true;
    const finishBatch = (batch: ActiveBatch, retainedJobIds = new Set<string>()) => {
      if (!mounted.current || activeBatch.current !== batch) return;
      const completedIds = new Set(
        batch.jobs
          .filter((job) => !retainedJobIds.has(job.jobId))
          .map((job) => job.jobId),
      );
      directQueue.current = directQueue.current.filter(
        (job) => !completedIds.has(job.jobId),
      );
      activeBatch.current = null;

      if (directQueue.current.length) {
        launchTimer.current = window.setTimeout(() => {
          launchTimer.current = null;
          void launchNextRef.current();
        }, 250);
      } else {
        setSyncing(false);
        const current = directRunProgressRef.current;
        if (current) {
          const finalized = finalizeShoplingDirectRun(current);
          publishDirectRunProgress(finalized);
          setSyncNotice(shoplingDirectRunSummaryText(finalized));
        }
        window.dispatchEvent(new Event(REFRESH_EVENT));
      }
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

      if (type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY") {
        const version = String(data.extensionVersion || "");
        const supported = supportsAllDateStockSync(version);
        extensionReadyRef.current = supported;
        extensionVersionRef.current = version;
        setExtensionReady(supported);
        setExtensionVersion(version);
        if (!supported) {
          setSyncNotice(
            `Shopling 자동화 v${version || "확인 불가"}는 실행 중 최초 팝업 소유권 보존을 지원하지 않아 사용할 수 없습니다. v0.6.61로 업데이트해 주세요.`,
          );
        } else {
          setSyncNotice((current) =>
            current.includes("Shopling 자동화 v") && current.includes("업데이트해 주세요") ? "" : current,
          );
        }
        return;
      }

      if (type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS") {
        const batch = activeBatch.current;
        if (!batch) return;
        const jobId = String(data.jobId || "");
        const assigned = batch.jobs.find((job) => batch.dispatchIds.get(job.jobId) === jobId);
        if (!assigned || data[RECEIPT_MARK] !== true || data.extensionVersion !== extensionVersionRef.current) return;
        const progressJob = data.job as DirectInventoryJob | undefined;
        if (progressJob?.barcode === assigned.barcode && progressJob.desiredStatus === assigned.desiredStatus) {
          rememberDirectJobs([{ ...progressJob, jobId: assigned.jobId }]);
        }
        if (data.message) setSyncNotice(String(data.message));
        return;
      }

      if (type === PARALLEL_STATUS) {
        const batch = activeBatch.current;
        if (!batch || batch.mode !== "PARALLEL") return;
        const batchId = String(data.batchId || "");
        if (batchId && batchId !== batch.batchId) return;
        const secondJob = batch.jobs[1];
        if (data.secondStarted === true && secondJob && !batch.startedJobIds.has(secondJob.jobId)) {
          batch.startedJobIds.add(secondJob.jobId);
          const startRecord = recordSync(
            secondJob,
            "STARTED",
            `통합 재고 입력 후 Shopling ${secondJob.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 전송 시작 · Lane ${secondJob.parallelLane || 2}`,
            {
              directOperatorCommand: true,
              unifiedInventoryBatch: true,
              operationalBatchId: batch.batchId,
              operationalLane: secondJob.parallelLane || 2,
              maxConcurrentLanes: batch.jobs.length,
              desiredSince: secondJob.desiredSince,
              extensionConfirmedLaneStart: true,
            },
          );
          batch.startRecordPromises.set(secondJob.jobId, startRecord);
          void startRecord.catch((error) => {
            batch.startedJobIds.delete(secondJob.jobId);
            setSyncing(false);
            setSyncNotice(error instanceof Error ? error.message : "Lane 2 시작 원장 기록에 실패했습니다.");
          });
        }
        const phase = String(data.phase || "");
        const secondNeverDispatched =
          secondJob &&
          data.secondStarted !== true &&
          String(data.status || "").toUpperCase() === "FAILED" &&
          ["DONE", "FIRST_START_FAILED", "COORDINATOR_TIMEOUT"].includes(phase);
        if (secondNeverDispatched) {
          batch.retainedJobIds.add(secondJob.jobId);
          batch.terminalJobIds.add(secondJob.jobId);
          setSyncNotice(`${secondJob.barcode} Lane 2는 아직 Shopling에 시작되지 않았습니다. 대기 목록에 유지하고 다음 배치의 첫 작업으로 다시 배정합니다.`);
          if (batch.terminalJobIds.size >= batch.jobs.length) {
            finishBatch(batch, batch.retainedJobIds);
          }
          return;
        }
        if (data.ok !== false) return;

        void (async () => {
          const rawMessage = String(
            data.message || "Shopling 즉시 2-Lane 시작에 실패했습니다.",
          );
          const message = friendlyShoplingStockSyncFailure(rawMessage, data);
          for (const job of batch.jobs) {
            if (batch.terminalJobIds.has(job.jobId)) continue;
            const failureEvidence = {
              code: String(data.code || "DIRECT_PARALLEL_START_FAILED"),
              unifiedInventoryBatch: true,
              operationalBatchId: batch.batchId,
            };
            await recordSync(job, "FAILED", message, {
              ...failureEvidence,
            }).catch(() => undefined);
            upsertDirectRunResultDetail(
              job,
              "FAILED",
              message,
              failureEvidence,
            );
            const currentProgress = directRunProgressRef.current;
            if (currentProgress) {
              publishDirectRunProgress(
                recordShoplingDirectRunOutcome(
                  currentProgress,
                  job.jobId,
                  "FAILED",
                ),
              );
            }
          }
          setSyncNotice(
            `${message} · 이 배치의 실패 건만 기록하고 나머지 B코드 전송을 계속합니다.`,
          );
          finishBatch(batch);
        })();
        return;
      }

      if (type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;

      const result = data as unknown as ResultMessage;
      const batch = activeBatch.current;
      if (!batch?.dispatchedAt || data[RECEIPT_MARK] !== true || data.extensionVersion !== extensionVersionRef.current
        || !(Number(result.finishedAt) >= batch.dispatchedAt) || !["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(result.outcome)) return;
      const job = batch.jobs.find((row) => batch.dispatchIds.get(row.jobId) === result.jobId);
      if (!job || batch.terminalJobIds.has(job.jobId)) return;
      if (result.job && (result.job.barcode !== job.barcode || result.job.desiredStatus !== job.desiredStatus)) return;

      const resultKey = `${result.jobId}:${result.outcome}:${Number(
        result.finishedAt || 0,
      )}`;
      if (handledResults.current.has(resultKey)) return;

      handledResults.current.add(resultKey);
      batch.terminalJobIds.add(job.jobId);
      if (result.job?.barcode === job.barcode && result.job.desiredStatus === job.desiredStatus) {
        rememberDirectJobs([{ ...result.job, jobId: job.jobId }]);
      }
      void (async () => {
        try {
          await batch.startRecordPromises.get(job.jobId);
          const attempt = attemptsByJob.current.get(job.jobId) || 1;
          const autoRetry = attempt < MAX_SHOPLING_STOCK_ATTEMPTS && isSafeShoplingStockRetry(result);
          const evidence = { ...object(result.evidence), attempt, dispatchJobId: result.jobId, autoRetry };
          await recordSync(
            job,
            result.outcome,
            result.message || "",
            evidence,
            result.finishedAt,
          );
          if (!mounted.current || activeBatch.current !== batch) return;
          upsertDirectRunResultDetail(
            job,
            result.outcome,
            result.message || "",
            evidence,
          );
          if (autoRetry) {
            safeRetryWaiting.current.add(job.jobId);
            batch.retainedJobIds.add(job.jobId);
            setSyncNotice(`${job.barcode} · 전송 전 실패 확인 · ${attempt + 1}차 자동 시도 준비 중`);
            if (batch.terminalJobIds.size >= batch.jobs.length) finishBatch(batch, batch.retainedJobIds);
            return;
          }
          const currentProgress = directRunProgressRef.current;
          if (currentProgress) {
            publishDirectRunProgress(
              recordShoplingDirectRunOutcome(
                currentProgress,
                job.jobId,
                result.outcome,
              ),
            );
          }
          const marketFailures =
            result.outcome === "SUCCEEDED"
              ? advisoryMarketFailureCount(result.evidence)
              : 0;
          if (marketFailures > 0) {
            setSyncNotice(
              `${job.barcode} Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 전송 접수 완료 · 마켓별 최종 결과는 Shopling에서 계속 처리됩니다.`,
            );
          } else if (result.outcome === "SUCCEEDED") {
            setSyncNotice(
              `${job.barcode} Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 전송 접수 완료`,
            );
          } else {
            setSyncNotice(`${job.barcode} · ${friendlyShoplingStockSyncFailure(result.message, result.evidence)}`);
          }

          if (batch.terminalJobIds.size >= batch.jobs.length) {
            finishBatch(batch, batch.retainedJobIds);
          }
        } catch (error) {
          handledResults.current.delete(resultKey);
          if (!mounted.current || activeBatch.current !== batch) return;
          activeBatch.current = null;
          directQueue.current = [];
          setSyncing(false);
          stopDirectRunProgress();
          setSyncNotice(
            `${error instanceof Error ? error.message : "Shopling 결과 저장 실패"} · 외부 전송을 임의 재시도하지 않고 일반 운영 큐에서 확인합니다.`,
          );
          window.dispatchEvent(new Event(REFRESH_EVENT));
        }
      })();
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
    return () => {
      mounted.current = false;
      window.removeEventListener("message", onMessage);
      if (launchTimer.current !== null) window.clearTimeout(launchTimer.current);
    };
  }, [
    publishDirectRunProgress,
    recordSync,
    rememberDirectJobs,
    stopDirectRunProgress,
    upsertDirectRunResultDetail,
  ]);

  const save = async () => {
    setNotice("");
    if (!totalCount) {
      setNotice("품절·판매중·재고수량 중 한 곳에 1건 이상 입력해 주세요.");
      return;
    }
    if (inputErrors.length) {
      setNotice(inputErrors.join(" · "));
      return;
    }
    if (conflictingBarcodes.length) {
      setNotice(
        `같은 B코드를 둘 이상의 작업에 입력할 수 없습니다: ${conflictingBarcodes.join(", ")}`,
      );
      return;
    }
    if (totalCount > 50) {
      setNotice("네 입력을 합쳐 한 번에 최대 50개까지 처리할 수 있습니다.");
      return;
    }
    if (
      stockoutParsed.barcodes.length + onSaleParsed.barcodes.length > 0 &&
      !extensionReadyRef.current
    ) {
      setNotice(
        "품절·판매중 전송 전에 Shopling 자동화 확장 v0.6.61을 연결해 주세요.",
      );
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control/unified-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          batchId: randomId("inventory-unified-batch"),
          stockoutBarcodes: stockoutParsed.barcodes,
          onSaleBarcodes: onSaleParsed.barcodes,
          stocktakeItems: stocktakeParsed.items,
          stockEstimateItems: stockEstimateParsed.items,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        savedCount?: number;
        counts?: { stockout?: number; onSale?: number; stocktake?: number; stockEstimate?: number };
        jobs?: DirectInventoryJob[];
        commandRequestId?: string | null;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "통합 재고 작업을 저장하지 못했습니다.");
      }

      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      directQueue.current = jobs;
      rememberDirectJobs(jobs, true);
      handledResults.current.clear();
      attemptsByJob.current.clear();
      safeRetryWaiting.current.clear();
      setHasResumableStoppedJobs(false);
      setDirectRunResultDetails([]);
      setManualCopyNotice("");
      publishDirectRunProgress(
        jobs.length ? startShoplingDirectRun(jobs.length) : null,
      );

      setNotice(
        payload.message ||
          `통합 재고 작업 ${payload.savedCount ?? totalCount}건을 저장했습니다.`,
      );
      setStockoutInput("");
      setOnSaleInput("");
      setStocktakeInput("");
      setStockEstimateInput("");

      if (!jobs.length) {
        setSyncNotice(
          `정확 재고 ${payload.counts?.stocktake ?? stocktakeParsed.items.length}건과 대략 재고상태 ${payload.counts?.stockEstimate ?? stockEstimateParsed.items.length}건을 저장했습니다. Shopling 즉시 전송 대상은 없습니다.`,
        );
        window.dispatchEvent(new Event(REFRESH_EVENT));
      } else if (extensionReadyRef.current) {
        setSyncing(true);
        setSyncNotice(
          `입력 저장 완료 · Shopling 품절·판매중 ${jobs.length}건을 확장 호출 1회당 B코드 1건씩 순차 전송합니다. 한 건의 접수와 작업 잠금 해제를 확인한 뒤 다음 건을 시작합니다.`,
        );
        void launchNextRef.current();
      } else {
        setSyncNotice(
          `입력은 저장되었습니다. Shopling 자동화 확장 연결을 기다리며, 연결되면 ${jobs.length}건을 전송합니다.`,
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "통합 재고 작업 실패");
    } finally {
      setLoading(false);
    }
  };

  const resumeStoppedDirectRun = () => {
    setNotice("");
    const current = directRunProgressRef.current;
    const allJobs = [...directRunJobs.current.values()];
    if (current?.status !== "STOPPED" || activeBatch.current || launchingNext.current) return;
    if (!extensionReadyRef.current) {
      setSyncNotice(
        "Shopling 자동화 확장 v0.6.61 연결을 확인한 뒤 다시 시도해 주세요.",
      );
      return;
    }

    const pendingIds = new Set(getResumableDirectJobIds(current));
    const pendingJobs = allJobs.filter((job) => pendingIds.has(job.jobId));
    if (!pendingJobs.length || allJobs.length !== current.total) {
      setSyncNotice(
        "미완료 작업의 저장 정보가 화면 상태와 일치하지 않아 자동 재시도를 중단했습니다. 아래 수동 전송 목록을 확인해 주세요.",
      );
      return;
    }

    directQueue.current = pendingJobs;
    publishDirectRunProgress({ ...current, status: "RUNNING" });
    setSyncing(true);
    setSyncNotice(`전송 시작을 확인할 수 있는 대기 ${pendingJobs.length}건을 이어서 처리합니다.`);
    void launchNextRef.current();
  };

  const directRunCounts = directRunProgress
    ? shoplingDirectRunCounts(directRunProgress)
    : null;
  const directRunJobIds = directRunJobSnapshot.map((job) => job.jobId);
  const canResumeStoppedRun =
    directRunProgress?.status === "STOPPED" && hasResumableStoppedJobs;
  const finalManualFallbackJobs =
    directRunProgress &&
    directRunProgress.status !== "RUNNING" &&
    !canResumeStoppedRun
      ? retryableShoplingDirectRunJobIds(
          directRunProgress,
          directRunJobIds,
        ).flatMap((jobId) => {
          const job = directRunJobSnapshot.find((row) => row.jobId === jobId);
          return job ? [job] : [];
        })
      : [];
  const manualFallbackGroups = buildShoplingManualFallbackGroups(
    finalManualFallbackJobs,
  );

  const copyManualFallback = async (label: string, values: string[]) => {
    const text = shoplingManualFallbackCopyText(values);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setManualCopyNotice(`${label} ${values.length}개를 복사했습니다.`);
    } catch {
      setManualCopyNotice(
        `${label} 자동 복사에 실패했습니다. 아래 목록을 직접 선택해 복사해 주세요.`,
      );
    }
  };

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div>
        <span className="text-xs font-black tracking-[0.12em] text-indigo-700">
          ONE CLICK · 재고 운영 통합 입력
        </span>
        <h2 className="mt-1 text-xl font-black text-slate-950">
          품절·판매중·재고수량 한꺼번에 적용
        </h2>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
          필요한 칸을 작성한 뒤 아래 버튼을 한 번만 누르세요. 전체 B코드를 먼저
          검증하고 한 묶음으로 저장한 다음, 품절·판매중 전송을 자동으로 끝까지
          이어갑니다. 모델번호와 단품·옵션 형태는 Product Master에서 자동
          판별합니다. 같은 B코드가 두 칸 이상에 있으면 충돌을 막기 위해 전부
          저장하기 전에 중단합니다.
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <label className="block rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-950">
          ① 품절 처리 B코드
          <textarea
            value={stockoutInput}
            onChange={(event) => setStockoutInput(event.target.value)}
            placeholder={"예:\nBBD3-1\nBCC6-2"}
            rows={7}
            className="mt-2 block w-full resize-y rounded-xl border border-rose-200 bg-white px-3 py-3 font-mono text-sm text-slate-950 outline-none focus:border-rose-500"
          />
          <span className="mt-2 block text-xs">인식 {stockoutParsed.barcodes.length}건 · 재고 0 + Shopling 품절</span>
        </label>

        <label className="block rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-950">
          ② 판매중 전환 B코드
          <textarea
            value={onSaleInput}
            onChange={(event) => setOnSaleInput(event.target.value)}
            placeholder={"예:\nBAA1-1\nBAA1-2"}
            rows={7}
            className="mt-2 block w-full resize-y rounded-xl border border-sky-200 bg-white px-3 py-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
          />
          <span className="mt-2 block text-xs">인식 {onSaleParsed.barcodes.length}건 · 수량 변경 없이 Shopling 판매중</span>
        </label>

        <label className="block rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-950">
          ③ 재고수량 확정 · B코드 수량
          <textarea
            value={stocktakeInput}
            onChange={(event) => setStocktakeInput(event.target.value)}
            placeholder={"예:\nBCB2-1 50\nBBB8-1 10"}
            rows={7}
            className="mt-2 block w-full resize-y rounded-xl border border-emerald-200 bg-white px-3 py-3 font-mono text-sm text-slate-950 outline-none focus:border-emerald-500"
          />
          <span className="mt-2 block text-xs">인식 {stocktakeParsed.items.length}건 · 새 실물수량 기준점 저장</span>
        </label>

        <label className="block rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">
          ④ 대략 재고상태 · B코드 상태
          <textarea
            value={stockEstimateInput}
            onChange={(event) => setStockEstimateInput(event.target.value)}
            placeholder={"예:\nBCB2-1 많음\nBBB8-1 보통\nBAB3-1 적음\nBCA5-1 품절"}
            rows={7}
            className="mt-2 block w-full resize-y rounded-xl border border-amber-200 bg-white px-3 py-3 font-mono text-sm text-slate-950 outline-none focus:border-amber-500"
          />
          <span className="mt-2 block text-xs leading-5">
            인식 {stockEstimateParsed.items.length}건 · 발주계산용 상태로 저장 · 많음 100% / 보통 50% / 적음 25% / 품절 0% · 정확 재고로 표시하지 않음
          </span>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>전체 인식 {totalCount}건</span>
        <span>·</span>
        <span>네 입력 합계 최대 50건</span>
        <span>·</span>
        <span className={extensionReady ? "text-emerald-700" : "text-amber-700"}>
          {extensionReady
            ? `Shopling 자동화 연결됨${extensionVersion ? ` · v${extensionVersion}` : ""}`
            : extensionVersion
              ? `Shopling 자동화 업데이트 필요 · v${extensionVersion} → v0.6.61`
            : "Shopling 자동화 연결 대기"}
        </span>
        {inputErrors.length ? (
          <span className="text-rose-700">
            · 형식 확인 필요 {inputErrors.length}건
          </span>
        ) : null}
        {conflictingBarcodes.length ? (
          <span className="text-rose-700">
            · 중복 충돌 {conflictingBarcodes.join(", ")}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void save()}
        aria-busy={loading || syncing}
        disabled={
          loading ||
          syncing ||
          !totalCount ||
          totalCount > 50 ||
          inputErrors.length > 0 ||
          conflictingBarcodes.length > 0 ||
          (stockoutParsed.barcodes.length + onSaleParsed.barcodes.length > 0 &&
            !extensionReady)
        }
        className="mt-4 rounded-xl bg-indigo-700 px-6 py-3 text-sm font-black text-white hover:bg-indigo-800 disabled:bg-slate-400"
      >
        {loading
          ? "전체 입력 검증·저장 중..."
          : syncing
            ? "Shopling 자동 처리 중 · 기다려 주세요"
            : `전체 ${totalCount}건 저장·적용 시작`}
      </button>

      {notice ? (
        <p role="status" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}

      {directRunProgress ? (
        <div
          data-testid="shopling-direct-run-summary"
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-xl border px-4 py-4 ${
            directRunProgress.status === "COMPLETED"
              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
              : directRunProgress.status === "COMPLETED_WITH_EXCEPTIONS"
                ? "border-amber-300 bg-amber-50 text-amber-950"
              : directRunProgress.status === "STOPPED"
                ? "border-rose-300 bg-rose-50 text-rose-950"
                : "border-sky-300 bg-sky-50 text-sky-950"
          }`}
        >
          <p className="text-base font-black">
            {shoplingDirectRunSummaryText(directRunProgress)}
          </p>
          <p className="mt-1 text-xs font-bold leading-5">
            {directRunProgress.status === "COMPLETED"
              ? "Commerce OS가 모든 B코드의 Shopling 처리화면 도달을 확인했습니다. 원본 전송 접수 영수증도 확인됐으며 마켓별 최종 결과는 Shopling에서 계속 처리됩니다."
              : directRunProgress.status === "COMPLETED_WITH_EXCEPTIONS"
                ? "모든 B코드의 전송 시도는 끝났습니다. 성공·마켓 경고·실패 원인은 바로 아래 이번 실행 상세에서 확인할 수 있습니다."
              : directRunProgress.status === "STOPPED"
                ? "전체 접수가 끝난 상태가 아닙니다. 아래 실패 사유를 확인하기 전에는 다음 일괄 작업을 시작하지 마세요."
                : "아직 모든 B코드의 Shopling 전송 접수가 끝나지 않았습니다."}
          </p>
          {directRunResultDetails.length ? (
            <div
              data-testid="shopling-direct-run-details"
              className="mt-3 space-y-2"
            >
              <h3 className="text-sm font-black">
                이번 실행 상세 · {directRunResultDetails.length}건
              </h3>
              {directRunResultDetails.map((detail) => {
                const marketWarning =
                  detail.responsibilityReceiptAccepted &&
                  detail.marketFailureCount > 0;
                const successful = detail.outcome === "SUCCEEDED";
                const statusLabel = marketWarning
                  ? `전송 접수 성공 · 마켓 경고 ${detail.marketFailureCount}/${detail.marketTotalCount}`
                  : successful
                    ? "전송 접수 성공"
                    : detail.outcome === "FAILED"
                      ? "실패"
                      : "확인 필요";
                const tone = marketWarning
                  ? "border-amber-300 bg-amber-100 text-amber-950"
                  : successful
                    ? "border-emerald-300 bg-emerald-100 text-emerald-950"
                    : "border-rose-300 bg-rose-100 text-rose-950";
                return (
                  <div
                    key={detail.jobId}
                    className={`rounded-lg border px-3 py-3 ${tone}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm font-black">
                      <span>{detail.barcode}</span>
                      <span>
                        {detail.desiredStatus === "SOLD_OUT"
                          ? "품절"
                          : "판매중"}
                      </span>
                      <span>· {statusLabel}</span>
                      {detail.attemptCount > 1 ? <span>· {detail.attemptCount}차 시도</span> : null}
                    </div>
                    {successful ? (
                      <p className="mt-1 text-xs font-bold leading-5">
                        {detail.message || "상세 메시지가 없습니다."}
                      </p>
                    ) : null}
                    {!successful && detail.failurePhaseLabel ? (
                      <dl className="mt-2 grid gap-1 rounded-md border border-rose-200/80 bg-white/70 px-3 py-2 text-xs font-bold leading-5">
                        <div className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr]">
                          <dt>중단 위치</dt>
                          <dd>{detail.failurePhaseLabel}</dd>
                        </div>
                        {detail.failureCurrentStatus ? (
                          <div className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr]">
                            <dt>확인된 상태</dt>
                            <dd>{detail.failureCurrentStatus}</dd>
                          </div>
                        ) : null}
                        <div className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr]">
                          <dt>실패 원인</dt>
                          <dd>{detail.failureReason}</dd>
                        </div>
                        <div className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr]">
                          <dt>전송 여부</dt>
                          <dd>{detail.failureImpact}</dd>
                        </div>
                        <div className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr]">
                          <dt>다음 조치</dt>
                          <dd>{detail.failureNextAction}</dd>
                        </div>
                      </dl>
                    ) : null}
                    <p className="mt-1 break-all font-mono text-[11px] font-bold opacity-80">
                      코드 {detail.code || "-"} · 단계 {detail.stage || "-"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}
          {canResumeStoppedRun && directRunCounts ? (
            <button
              type="button"
              data-testid="resume-stopped-shopling-run"
              onClick={resumeStoppedDirectRun}
              disabled={loading || syncing || !extensionReady}
              className="mt-3 rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-black text-white hover:bg-rose-800 disabled:bg-slate-400"
            >
              대기 건 계속 처리
            </button>
          ) : null}
        </div>
      ) : null}

      {finalManualFallbackJobs.length ? (
        <div
          data-testid="shopling-manual-fallback"
          className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-4 text-rose-950"
        >
          <h3 className="text-base font-black">
            확인이 필요한 {finalManualFallbackJobs.length}건 · 수동 확인 목록
          </h3>
          <p className="mt-1 text-xs font-bold leading-5">
            Shopling에서 기존 접수 결과를 먼저 확인하세요. 추가 전송이 필요한 상품은 아래 GOODS KEY를 사용할 수 있습니다.
            판매중 상품이 옵션 판매를 회복하는 경우에는 상품 판매중전송을 먼저
            끝낸 뒤 옵션전송을 진행하세요.
          </p>

          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            {[
              {
                label: "상품 품절전송",
                values: manualFallbackGroups.soldOutProductGoodsKeys,
              },
              {
                label: "상품 판매중전송",
                values: manualFallbackGroups.onSaleProductGoodsKeys,
              },
              {
                label: "옵션전송",
                values: manualFallbackGroups.optionGoodsKeys,
              },
            ].map((group) => (
              <div key={group.label} className="rounded-lg border border-rose-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm">{group.label} · {group.values.length}개</strong>
                  <button
                    type="button"
                    disabled={!group.values.length}
                    onClick={() => void copyManualFallback(group.label, group.values)}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-black text-white disabled:bg-slate-300"
                  >
                    복사
                  </button>
                </div>
                <textarea
                  readOnly
                  aria-label={`${group.label} GOODS KEY`}
                  value={shoplingManualFallbackCopyText(group.values)}
                  rows={4}
                  className="mt-2 block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-xs text-slate-950"
                />
              </div>
            ))}
          </div>

          {manualFallbackGroups.unresolvedBarcodes.length ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">
                  GOODS KEY 확인 필요 B코드 · {manualFallbackGroups.unresolvedBarcodes.length}개
                </strong>
                <button
                  type="button"
                  onClick={() =>
                    void copyManualFallback(
                      "GOODS KEY 확인 필요 B코드",
                      manualFallbackGroups.unresolvedBarcodes,
                    )
                  }
                  className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-black text-white"
                >
                  복사
                </button>
              </div>
              <textarea
                readOnly
                aria-label="GOODS KEY 확인 필요 B코드"
                value={manualFallbackGroups.unresolvedBarcodes.join(",")}
                rows={2}
                className="mt-2 block w-full resize-y rounded-lg border border-amber-200 bg-white px-2 py-2 font-mono text-xs text-slate-950"
              />
            </div>
          ) : null}

          {manualCopyNotice ? (
            <p role="status" className="mt-2 text-xs font-black">
              {manualCopyNotice}
            </p>
          ) : null}
        </div>
      ) : null}

      {syncNotice ? (
        <p role="status" aria-live="polite" className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {syncNotice}
        </p>
      ) : null}
    </section>
  );
}
