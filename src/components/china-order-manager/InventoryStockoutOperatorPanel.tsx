"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseInventoryStockoutBulkText,
  parseInventoryStocktakeBulkText,
} from "@/lib/inventoryStockBulkInput";
import { planShoplingStockLaunch } from "@/lib/shoplingStockLaunchPlan";

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
  directOperatorCommand?: true;
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

type ActiveBatch = {
  mode: "PARALLEL" | "SINGLE";
  batchId: string;
  jobs: DirectInventoryJob[];
  terminalJobIds: Set<string>;
};

const PARALLEL_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START";
const PARALLEL_STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_STATUS";
const SINGLE_START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
const REFRESH_EVENT = "commerce-os:inventory-refresh";

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

export function InventoryStockoutOperatorPanel() {
  const [stockoutInput, setStockoutInput] = useState("");
  const [onSaleInput, setOnSaleInput] = useState("");
  const [stocktakeInput, setStocktakeInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState("");
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
  const totalCount =
    stockoutParsed.barcodes.length +
    onSaleParsed.barcodes.length +
    stocktakeParsed.items.length;
  const inputErrors = [
    ...stockoutParsed.errors,
    ...onSaleParsed.errors,
    ...stocktakeParsed.errors,
  ];
  const conflictingBarcodes = useMemo(() => {
    const all = [
      ...stockoutParsed.barcodes,
      ...onSaleParsed.barcodes,
      ...stocktakeParsed.items.map((item) => item.barcode),
    ];
    return [...new Set(all.filter((barcode, index) => all.indexOf(barcode) !== index))];
  }, [onSaleParsed.barcodes, stockoutParsed.barcodes, stocktakeParsed.items]);

  const extensionReadyRef = useRef(false);
  const extensionVersionRef = useRef("");
  const directQueue = useRef<DirectInventoryJob[]>([]);
  const activeBatch = useRef<ActiveBatch | null>(null);
  const handledResults = useRef(new Set<string>());
  const launchNextRef = useRef<() => Promise<void>>(async () => undefined);

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
              ? stableEventId("shopling-stock-started", job, outcome)
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
          evidence: {
            unifiedInventoryBatch: true,
            twoLaneMax: 2,
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
    if (activeBatch.current || !extensionReadyRef.current) return;

    const plan = planShoplingStockLaunch(
      directQueue.current,
      extensionVersionRef.current,
    );
    if (!plan.jobs.length) {
      setSyncing(false);
      setSyncNotice("통합 입력과 Shopling 재고상태 전송을 모두 마쳤습니다.");
      window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }

    const batchId = randomId("stockout-direct-batch");
    const prepared = plan.jobs.map((job, index) => ({
      ...job,
      operationalQueue: true as const,
      parallelBatchId: batchId,
      parallelLane: index + 1,
      ignoreWindowClose: true as const,
    }));

    activeBatch.current = {
      mode: plan.mode,
      batchId,
      jobs: prepared,
      terminalJobIds: new Set<string>(),
    };
    setSyncNotice(
      plan.mode === "PARALLEL"
        ? `${prepared[0].barcode} + ${prepared[1].barcode} · Shopling 재고상태 2-Lane 전송 시작`
        : plan.compatibilitySerial
          ? `${prepared[0].barcode} · 현재 확장 버전에서는 옵션 B코드를 안전하게 1건씩 전송합니다.`
          : `${prepared[0].barcode} · Shopling 재고상태 전송 시작`,
    );

    try {
      await Promise.all(
        prepared.map((job) =>
          recordSync(
            job,
            "STARTED",
            `통합 재고 입력 후 Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 전송 시작 · Lane ${job.parallelLane || 1}`,
            {
              directOperatorCommand: true,
              unifiedInventoryBatch: true,
              operationalBatchId: batchId,
              operationalLane: job.parallelLane || 1,
              desiredSince: job.desiredSince,
            },
          ),
        ),
      );

      if (plan.mode === "PARALLEL") {
        window.postMessage(
          { type: PARALLEL_START, batchId, jobs: prepared },
          window.location.origin,
        );
      } else {
        window.postMessage(
          { type: SINGLE_START, job: prepared[0] },
          window.location.origin,
        );
      }
    } catch (error) {
      activeBatch.current = null;
      directQueue.current = [];
      setSyncing(false);
      setSyncNotice(
        `${error instanceof Error ? error.message : "Shopling 즉시 전송 시작 실패"} · 입력 내용은 저장되어 있으므로 일반 운영 큐에서 다시 처리할 수 있습니다.`,
      );
      window.dispatchEvent(new Event(REFRESH_EVENT));
    }
  }, [recordSync]);

  useEffect(() => {
    launchNextRef.current = launchNext;
  }, [launchNext]);

  useEffect(() => {
    const finishBatch = (batch: ActiveBatch) => {
      const completedIds = new Set(batch.jobs.map((job) => job.jobId));
      directQueue.current = directQueue.current.filter(
        (job) => !completedIds.has(job.jobId),
      );
      activeBatch.current = null;

      if (directQueue.current.length) {
        window.setTimeout(() => {
          void launchNextRef.current();
        }, 250);
      } else {
        setSyncing(false);
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
        extensionReadyRef.current = true;
        extensionVersionRef.current = version;
        setExtensionReady(true);
        setExtensionVersion(version);
        if (directQueue.current.length && !activeBatch.current) {
          window.setTimeout(() => {
            void launchNextRef.current();
          }, 0);
        }
        return;
      }

      if (type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS") {
        const batch = activeBatch.current;
        if (!batch) return;
        const jobId = String(data.jobId || "");
        if (!batch.jobs.some((job) => job.jobId === jobId)) return;
        if (data.message) setSyncNotice(String(data.message));
        return;
      }

      if (type === PARALLEL_STATUS) {
        const batch = activeBatch.current;
        if (!batch || batch.mode !== "PARALLEL") return;
        const batchId = String(data.batchId || "");
        if (batchId && batchId !== batch.batchId) return;
        if (data.ok !== false) return;

        void (async () => {
          const message = String(
            data.message || "Shopling 즉시 2-Lane 시작에 실패했습니다.",
          );
          for (const job of batch.jobs) {
            if (batch.terminalJobIds.has(job.jobId)) continue;
            await recordSync(job, "FAILED", message, {
              code: String(data.code || "DIRECT_PARALLEL_START_FAILED"),
              unifiedInventoryBatch: true,
              operationalBatchId: batch.batchId,
            }).catch(() => undefined);
          }
          setSyncNotice(
            `${message} · 저장된 재고 기준은 유지되며 실패 건은 일반 운영 큐에서 다시 처리할 수 있습니다.`,
          );
          finishBatch(batch);
        })();
        return;
      }

      if (type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;

      const result = data as unknown as ResultMessage;
      const batch = activeBatch.current;
      if (
        !batch ||
        !result.jobId ||
        !batch.jobs.some((job) => job.jobId === result.jobId)
      ) {
        return;
      }

      const resultKey = `${result.jobId}:${result.outcome}:${Number(
        result.finishedAt || 0,
      )}`;
      if (handledResults.current.has(resultKey)) return;

      const job =
        result.job ||
        batch.jobs.find((row) => row.jobId === result.jobId) ||
        null;
      if (!job) return;

      handledResults.current.add(resultKey);
      void (async () => {
        try {
          await recordSync(
            job,
            result.outcome,
            result.message || "",
            result.evidence,
            result.finishedAt,
          );
          batch.terminalJobIds.add(job.jobId);

          const marketFailures =
            result.outcome === "SUCCEEDED"
              ? advisoryMarketFailureCount(result.evidence)
              : 0;
          if (marketFailures > 0) {
            setSyncNotice(
              `${job.barcode} Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 반영 완료 · 연결 마켓 전송 실패 ${marketFailures}건은 Shopling 자체 상태 반영 실패와 구분됩니다.`,
            );
          } else if (result.outcome === "SUCCEEDED") {
            setSyncNotice(
              `${job.barcode} Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 반영 완료`,
            );
          } else {
            setSyncNotice(
              `${job.barcode} 즉시 전송 ${result.outcome}: ${result.message || "일반 운영 큐에서 재확인 필요"}`,
            );
          }

          if (batch.terminalJobIds.size >= batch.jobs.length) {
            finishBatch(batch);
          }
        } catch (error) {
          handledResults.current.delete(resultKey);
          activeBatch.current = null;
          directQueue.current = [];
          setSyncing(false);
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
    return () => window.removeEventListener("message", onMessage);
  }, [recordSync]);

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
      setNotice("세 입력을 합쳐 한 번에 최대 50개까지 처리할 수 있습니다.");
      return;
    }
    if (
      stockoutParsed.barcodes.length + onSaleParsed.barcodes.length > 0 &&
      !extensionReadyRef.current
    ) {
      setNotice(
        "품절·판매중 전송 전에 Shopling 자동화 확장 v0.5.8을 연결해 주세요.",
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
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        savedCount?: number;
        counts?: { stockout?: number; onSale?: number; stocktake?: number };
        jobs?: DirectInventoryJob[];
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "통합 재고 작업을 저장하지 못했습니다.");
      }

      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const existingIds = new Set(directQueue.current.map((job) => job.jobId));
      directQueue.current = [
        ...directQueue.current,
        ...jobs.filter((job) => !existingIds.has(job.jobId)),
      ];
      handledResults.current.clear();

      setNotice(
        payload.message ||
          `통합 재고 작업 ${payload.savedCount ?? totalCount}건을 저장했습니다.`,
      );
      setStockoutInput("");
      setOnSaleInput("");
      setStocktakeInput("");

      if (!jobs.length) {
        setSyncNotice(
          `재고수량 ${payload.counts?.stocktake ?? stocktakeParsed.items.length}건을 확정했습니다. Shopling 즉시 전송 대상은 없습니다.`,
        );
        window.dispatchEvent(new Event(REFRESH_EVENT));
      } else if (extensionReadyRef.current) {
        setSyncing(true);
        setSyncNotice(
          `입력 저장 완료 · Shopling 품절·판매중 ${jobs.length}건을 순서대로 자동 전송합니다. 이 화면에서 기다리면 됩니다.`,
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
          세 칸을 모두 작성한 뒤 아래 버튼을 한 번만 누르세요. 전체 B코드를 먼저
          검증하고 한 묶음으로 저장한 다음, 품절·판매중 전송을 자동으로 끝까지
          이어갑니다. 모델번호와 단품·옵션 형태는 Product Master에서 자동
          판별합니다. 같은 B코드가 두 칸 이상에 있으면 충돌을 막기 위해 전부
          저장하기 전에 중단합니다.
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
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
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>전체 인식 {totalCount}건</span>
        <span>·</span>
        <span>세 입력 합계 최대 50건</span>
        <span>·</span>
        <span className={extensionReady ? "text-emerald-700" : "text-amber-700"}>
          {extensionReady
            ? `Shopling 자동화 연결됨${extensionVersion ? ` · v${extensionVersion}` : ""}`
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

      {syncNotice ? (
        <p role="status" aria-live="polite" className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {syncNotice}
        </p>
      ) : null}
    </section>
  );
}
