"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseInventoryStockoutBulkText } from "@/lib/inventoryStockBulkInput";

type ProductKind = "OPTION" | "SINGLE";
type DesiredStatus = "SOLD_OUT" | "ON_SALE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type DirectStockoutJob = {
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
  directOperatorCommand?: true;
  operationalQueue?: true;
  parallelBatchId?: string;
  parallelLane?: number;
  ignoreWindowClose?: true;
};

type ResultMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  jobId: string;
  job?: DirectStockoutJob | null;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

type ActiveBatch = {
  batchId: string;
  jobs: DirectStockoutJob[];
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
  job: DirectStockoutJob,
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
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const parsed = useMemo(() => parseInventoryStockoutBulkText(input), [input]);

  const extensionReadyRef = useRef(false);
  const directQueue = useRef<DirectStockoutJob[]>([]);
  const activeBatch = useRef<ActiveBatch | null>(null);
  const handledResults = useRef(new Set<string>());
  const launchNextRef = useRef<() => Promise<void>>(async () => undefined);

  const recordSync = useCallback(
    async (
      job: DirectStockoutJob,
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
            directStockout: true,
            twoLaneMax: 2,
            windowCloseIgnored: true,
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
            "Shopling 품절 즉시 전송 결과를 원장에 저장하지 못했습니다.",
        );
      }
    },
    [],
  );

  const launchNext = useCallback(async () => {
    if (activeBatch.current || !extensionReadyRef.current) return;

    const selected = directQueue.current.slice(0, 2);
    if (!selected.length) {
      setSyncNotice("Shopling 품절 즉시 전송 작업을 모두 마쳤습니다.");
      window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }

    const batchId = randomId("stockout-direct-batch");
    const prepared = selected.map((job, index) => ({
      ...job,
      operationalQueue: true as const,
      parallelBatchId: batchId,
      parallelLane: index + 1,
      ignoreWindowClose: true as const,
    }));

    activeBatch.current = {
      batchId,
      jobs: prepared,
      terminalJobIds: new Set<string>(),
    };
    setSyncNotice(
      prepared.length === 2
        ? `${prepared[0].barcode} + ${prepared[1].barcode} · Shopling 품절 즉시 2-Lane 전송 시작`
        : `${prepared[0].barcode} · Shopling 품절 즉시 전송 시작`,
    );

    try {
      await Promise.all(
        prepared.map((job) =>
          recordSync(
            job,
            "STARTED",
            `창고 실물 품절 확정 직후 조회 없이 Shopling 품절 전송 시작 · Lane ${job.parallelLane || 1}`,
            {
              directOperatorCommand: true,
              operationalBatchId: batchId,
              operationalLane: job.parallelLane || 1,
              desiredSince: job.desiredSince,
            },
          ),
        ),
      );

      if (prepared.length === 2) {
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
      setSyncNotice(
        `${error instanceof Error ? error.message : "Shopling 즉시 전송 시작 실패"} · 품절 기준점은 저장되어 있으므로 일반 운영 큐에서 다시 처리할 수 있습니다.`,
      );
      window.dispatchEvent(new Event(REFRESH_EVENT));
    }
  }, [recordSync]);

  launchNextRef.current = launchNext;

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
        extensionReadyRef.current = true;
        setExtensionReady(true);
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
        if (!batch) return;
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
              directStockout: true,
              operationalBatchId: batch.batchId,
            }).catch(() => undefined);
          }
          setSyncNotice(
            `${message} · 품절 기준점은 유지되며 실패 건은 일반 운영 큐에서 다시 처리할 수 있습니다.`,
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
              `${job.barcode} Shopling 품절 상태 반영 완료 · 연결 마켓 전송 실패 ${marketFailures}건은 Shopling 자체 품절 반영 실패가 아니라 마켓별 후속 전송 실패입니다.`,
            );
          } else if (result.outcome === "SUCCEEDED") {
            setSyncNotice(`${job.barcode} Shopling 품절 반영 완료`);
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
    if (!parsed.barcodes.length) {
      setNotice("품절로 확정할 B코드를 1개 이상 입력해 주세요.");
      return;
    }
    if (parsed.errors.length) {
      setNotice(parsed.errors.join(" · "));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          batchId: randomId("stockout-batch"),
          barcodes: parsed.barcodes,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        savedCount?: number;
        jobs?: DirectStockoutJob[];
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "품절 처리를 저장하지 못했습니다.");
      }

      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const existingIds = new Set(directQueue.current.map((job) => job.jobId));
      directQueue.current = [
        ...directQueue.current,
        ...jobs.filter((job) => !existingIds.has(job.jobId)),
      ];
      handledResults.current.clear();

      setNotice(
        `품절 ${payload.savedCount ?? parsed.barcodes.length}건 확정 완료. Product Master 식별까지 끝났으며 Shopling 현재 판매상태를 선조회하지 않고 품절 상태를 바로 전송합니다.`,
      );
      setInput("");

      if (!jobs.length) {
        setSyncNotice(
          "즉시 전송 작업을 만들지 못해 저장된 품절 기준점을 일반 운영 큐에서 처리합니다.",
        );
        window.dispatchEvent(new Event(REFRESH_EVENT));
      } else if (extensionReadyRef.current) {
        setSyncNotice(
          `Shopling 자동화 연결 확인 · 품절 ${jobs.length}건 즉시 전송을 시작합니다.`,
        );
        void launchNextRef.current();
      } else {
        setSyncNotice(
          `품절 기준점은 저장되었습니다. Shopling 자동화 확장 연결을 기다리는 중이며, 연결되면 ${jobs.length}건을 즉시 전송합니다.`,
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "품절 처리 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
      <div>
        <span className="text-xs font-black tracking-[0.12em] text-rose-700">
          창고에서 수량 0 확인
        </span>
        <h2 className="mt-1 text-xl font-black text-slate-950">품절 처리</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          B코드만 입력합니다. Product Master에서 모델번호와 단품·옵션 여부를
          정확히 식별한 뒤 재고 0 기준점을 저장하고, Shopling의 기존 판매중/품절
          상태를 먼저 조회하지 않고 품절 상태를 바로 전송합니다. 식별되지 않는
          B코드가 하나라도 있으면 저장 전에 전체 작업을 중단합니다.
        </p>
      </div>

      <label className="mt-4 block text-sm font-bold text-slate-700">
        품절 B코드 · 1개 또는 여러 개
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"예:\nBCB2-1\nBBB8-1\nBAB3-1\n\n줄바꿈·쉼표·공백으로 여러 개 입력 가능"}
          rows={6}
          className="mt-1 block w-full resize-y rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-rose-500"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>인식 {parsed.barcodes.length}건</span>
        <span>·</span>
        <span>최대 50건</span>
        <span>·</span>
        <span className={extensionReady ? "text-emerald-700" : "text-amber-700"}>
          {extensionReady ? "Shopling 자동화 연결됨" : "Shopling 자동화 연결 대기"}
        </span>
        {parsed.errors.length ? (
          <span className="text-rose-700">
            · 확인 필요 {parsed.errors.length}건
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading || !parsed.barcodes.length}
        className="mt-4 rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white hover:bg-rose-800 disabled:bg-slate-400"
      >
        {loading
          ? "처리 중..."
          : parsed.barcodes.length > 1
            ? `품절 ${parsed.barcodes.length}건 확정 · 즉시 반영`
            : "품절 확정 · 즉시 반영"}
      </button>

      {notice ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}

      {syncNotice ? (
        <p className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {syncNotice}
        </p>
      ) : null}
    </section>
  );
}
