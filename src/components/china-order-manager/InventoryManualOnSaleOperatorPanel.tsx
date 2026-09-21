"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseInventoryStockoutBulkText } from "@/lib/inventoryStockBulkInput";

type ProductKind = "OPTION" | "SINGLE";
type SyncOutcome = "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

type DirectOnSaleJob = {
  jobId: string;
  barcode: string;
  productName: string;
  productKind: ProductKind;
  modelNo: string | null;
  goodsKeys: string[];
  desiredStatus: "ON_SALE";
  desiredSince: string;
  exactInventoryQuantity: number;
  inventoryQuantityKnown?: false;
  manualStatusOnly?: true;
  resetAt: string;
  route: string[];
  directOperatorCommand?: true;
};

type ResultMessage = {
  type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  jobId: string;
  job?: DirectOnSaleJob | null;
  outcome: Exclude<SyncOutcome, "STARTED">;
  message?: string;
  evidence?: unknown;
  finishedAt?: number;
};

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
  job: DirectOnSaleJob,
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

export function InventoryManualOnSaleOperatorPanel() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const parsed = useMemo(() => parseInventoryStockoutBulkText(input), [input]);

  const extensionReadyRef = useRef(false);
  const directQueue = useRef<DirectOnSaleJob[]>([]);
  const activeJob = useRef<DirectOnSaleJob | null>(null);
  const handledResults = useRef(new Set<string>());
  const launchNextRef = useRef<() => Promise<void>>(async () => undefined);

  const recordSync = useCallback(
    async (
      job: DirectOnSaleJob,
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
          desiredStatus: "ON_SALE",
          outcome,
          message,
          evidence: {
            manualStatusOnly: true,
            inventoryQuantityKnown: false,
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
            "Shopling 판매중 전환 결과를 원장에 저장하지 못했습니다.",
        );
      }
    },
    [],
  );

  const launchNext = useCallback(async () => {
    if (activeJob.current || !extensionReadyRef.current) return;
    const job = directQueue.current[0];
    if (!job) {
      setSyncNotice("Shopling 판매중 전환 작업을 모두 마쳤습니다.");
      window.dispatchEvent(new Event(REFRESH_EVENT));
      return;
    }

    activeJob.current = job;
    setSyncNotice(
      `${job.barcode} · 재고수량은 변경하지 않고 Shopling 판매중 전환을 시작합니다.`,
    );
    try {
      await recordSync(
        job,
        "STARTED",
        "수량 미확정 수동 판매중 전환 · Shopling 판매중 즉시 전송 시작",
        {
          directOperatorCommand: true,
          manualStatusOnly: true,
          desiredSince: job.desiredSince,
        },
      );
      window.postMessage(
        { type: SINGLE_START, job },
        window.location.origin,
      );
    } catch (error) {
      activeJob.current = null;
      directQueue.current = [];
      setSyncNotice(
        `${error instanceof Error ? error.message : "Shopling 판매중 전환 시작 실패"} · 수동 판매중 기준은 저장되어 있으므로 아래 자동 처리 영역에서 다시 실행할 수 있습니다.`,
      );
      window.dispatchEvent(new Event(REFRESH_EVENT));
    }
  }, [recordSync]);

  launchNextRef.current = launchNext;

  useEffect(() => {
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
        if (directQueue.current.length && !activeJob.current) {
          window.setTimeout(() => {
            void launchNextRef.current();
          }, 0);
        }
        return;
      }

      if (type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS") {
        const current = activeJob.current;
        if (!current || String(data.jobId || "") !== current.jobId) return;
        if (data.message) setSyncNotice(String(data.message));
        return;
      }

      if (type !== "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT") return;
      const result = data as unknown as ResultMessage;
      const current = activeJob.current;
      if (!current || result.jobId !== current.jobId) return;

      const resultKey = `${result.jobId}:${result.outcome}:${Number(
        result.finishedAt || 0,
      )}`;
      if (handledResults.current.has(resultKey)) return;
      handledResults.current.add(resultKey);

      void (async () => {
        try {
          await recordSync(
            current,
            result.outcome,
            result.message || "",
            result.evidence,
            result.finishedAt,
          );

          directQueue.current = directQueue.current.filter(
            (job) => job.jobId !== current.jobId,
          );
          activeJob.current = null;

          const marketFailures =
            result.outcome === "SUCCEEDED"
              ? advisoryMarketFailureCount(result.evidence)
              : 0;
          if (marketFailures > 0) {
            setSyncNotice(
              `${current.barcode} Shopling 판매중 반영 완료 · 연결 마켓 후속 전송 실패 ${marketFailures}건은 Shopling 자체 판매중 전환 실패와 구분됩니다.`,
            );
          } else if (result.outcome === "SUCCEEDED") {
            setSyncNotice(
              `${current.barcode} Shopling 판매중 반영 완료 · 재고수량은 미확정 상태로 유지합니다.`,
            );
          } else {
            setSyncNotice(
              `${current.barcode} 판매중 전환 ${result.outcome}: ${result.message || "자동 처리 영역에서 확인이 필요합니다."}`,
            );
          }

          if (directQueue.current.length) {
            window.setTimeout(() => {
              void launchNextRef.current();
            }, 250);
          } else {
            window.dispatchEvent(new Event(REFRESH_EVENT));
          }
        } catch (error) {
          handledResults.current.delete(resultKey);
          activeJob.current = null;
          directQueue.current = [];
          setSyncNotice(
            `${error instanceof Error ? error.message : "Shopling 결과 저장 실패"} · 외부 전송을 임의 재시도하지 않고 자동 처리 영역에서 확인합니다.`,
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
    setSyncNotice("");
    if (!parsed.barcodes.length) {
      setNotice("판매중으로 전환할 B코드를 1개 이상 입력해 주세요.");
      return;
    }
    if (parsed.errors.length) {
      setNotice(parsed.errors.join(" · "));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        "/api/inventory-stock-control/on-sale/batch",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            batchId: randomId("manual-on-sale-batch"),
            barcodes: parsed.barcodes,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        savedCount?: number;
        jobs?: DirectOnSaleJob[];
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.message || "판매중 전환을 저장하지 못했습니다.",
        );
      }

      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const existingIds = new Set(directQueue.current.map((job) => job.jobId));
      directQueue.current = [
        ...directQueue.current,
        ...jobs.filter((job) => !existingIds.has(job.jobId)),
      ];
      handledResults.current.clear();
      setInput("");
      setNotice(
        `판매중 수동 전환 ${payload.savedCount ?? parsed.barcodes.length}건 확정. 재고수량은 입력·변경하지 않으며, 다음 품절 확정 또는 재고 수량 확정 전까지 판매상태만 수동 관리합니다.`,
      );

      if (!jobs.length) {
        setSyncNotice(
          "즉시 전송 작업을 만들지 못해 저장된 판매중 전환을 자동 처리 영역에서 처리합니다.",
        );
        window.dispatchEvent(new Event(REFRESH_EVENT));
      } else if (extensionReadyRef.current) {
        setSyncNotice(
          `Shopling 자동화 연결 확인 · 판매중 ${jobs.length}건 즉시 전송을 시작합니다.`,
        );
        void launchNextRef.current();
      } else {
        setSyncNotice(
          `판매중 수동 기준은 저장되었습니다. Shopling 자동화 연결을 기다리는 중이며 연결되면 ${jobs.length}건을 순차 전송합니다.`,
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "판매중 전환 실패",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div>
        <span className="text-xs font-black tracking-[0.12em] text-indigo-700">
          재고수량 미입력 · 판매상태만 변경
        </span>
        <h2 className="mt-1 text-xl font-black text-slate-950">
          판매중 전환
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          B코드만 입력하면 재고수량을 새 기준점으로 만들지 않고 Shopling 판매상태만
          판매중으로 전환합니다. 이후 품절 확정 또는 재고 수량 확정을 입력하면
          수동 상태는 종료되고 정확재고 자동판단으로 복귀합니다.
        </p>
      </div>

      <label className="mt-4 block text-sm font-bold text-slate-700">
        판매중 전환 B코드 · 1개 또는 여러 개
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"예:\nBCB2-1\nBBB8-1\nBAB3-1\n\n줄바꿈·쉼표·공백으로 여러 개 입력 가능"}
          rows={6}
          className="mt-1 block w-full resize-y rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-indigo-500"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>인식 {parsed.barcodes.length}건</span>
        <span>·</span>
        <span>최대 50건</span>
        <span>·</span>
        <span className={extensionReady ? "text-emerald-700" : "text-amber-700"}>
          {extensionReady
            ? "Shopling 자동화 연결됨"
            : "Shopling 자동화 연결 대기"}
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
        className="mt-4 rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white hover:bg-indigo-800 disabled:bg-slate-400"
      >
        {loading
          ? "처리 중..."
          : parsed.barcodes.length > 1
            ? `판매중 ${parsed.barcodes.length}건 즉시 전환`
            : "판매중 즉시 전환"}
      </button>

      {notice ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}

      {syncNotice ? (
        <p className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {syncNotice}
        </p>
      ) : null}
    </section>
  );
}
