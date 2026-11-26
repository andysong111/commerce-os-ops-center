"use client";

import { useState } from "react";
import { DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE } from "@/lib/detailPageCompilerWorkerPool";
import { readChinaDetailPageLink } from "../../../public/product-launch-tracker-app/lib/china-product-links.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const OPTIMIZED_TRACKER_API = "/api/product-launch-tracker/optimized";
const REGISTER_CONCURRENCY = 4;

type LaunchItem = {
  id?: unknown;
  productName?: unknown;
  modelNumber?: unknown;
  orderOptions?: unknown;
  detailPageAutomation?: unknown;
  [key: string]: unknown;
};
type LaunchState = {
  items?: LaunchItem[];
  partialPage?: boolean;
  savedAt?: string;
};
type DetailJob = {
  jobId?: string;
  itemId?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

type Tone = "neutral" | "progress" | "success" | "error";

type PreparedItem = {
  itemId: string;
  localItem: LaunchItem;
  item: LaunchItem;
  sourceUrl: string;
  salesOptions: string;
  productName: string;
};

export function ProductLaunchEvidenceCompilerCanary() {
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState<Tone>("neutral");
  const [message, setMessage] = useState(
    `체크한 여러 상품을 Evidence Compiler v1로 새로 제작합니다. 1688 수집은 최대 ${DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}건까지 동시에 진행됩니다.`,
  );

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setTone("progress");
    setMessage("선택 상품과 기존 진행 작업을 확인하고 있습니다.");
    try {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[title="신규 상품 출시 진행관리"]',
      );
      const frameDocument = iframe?.contentDocument;
      if (!frameDocument) {
        throw new Error(
          "상품출시진행관리 화면에 연결하지 못했습니다. Ctrl+F5 후 다시 시도하세요.",
        );
      }
      const selectedIds = [
        ...frameDocument.querySelectorAll<HTMLInputElement>(
          "#launch-table-body tr[data-id] input.row-check:checked",
        ),
      ]
        .map(
          (input) =>
            input.closest<HTMLTableRowElement>("tr[data-id]")?.dataset.id || "",
        )
        .filter(Boolean);
      if (!selectedIds.length) {
        throw new Error("Evidence Compiler로 생성할 상품을 1건 이상 체크하세요.");
      }

      const state = readState();
      if (!Array.isArray(state?.items)) {
        throw new Error("상품출시진행관리 저장 상태를 읽지 못했습니다.");
      }
      const localItems = selectedIds.map((itemId) => {
        const localItem = state.items!.find(
          (item) => String(item?.id ?? "") === itemId,
        );
        if (!localItem) {
          throw new Error(`선택 상품 ${itemId}를 현재 출시관리 데이터에서 찾지 못했습니다.`);
        }
        return { itemId, localItem };
      });
      const authoritative = await authoritativeItems(state, selectedIds, localItems);
      const prepared: PreparedItem[] = localItems.map(({ itemId, localItem }) => {
        const item = authoritative.get(itemId) ?? localItem;
        const sourceUrl = readChinaDetailPageLink(item);
        const salesOptions = saleOptions(item);
        const productName = String(
          item.productName || item.modelNumber || itemId || "상품",
        ).trim();
        return { itemId, localItem, item, sourceUrl, salesOptions, productName };
      });

      const missingLinks = prepared.filter((entry) => !entry.sourceUrl);
      const missingOptions = prepared.filter((entry) => !entry.salesOptions);
      if (missingLinks.length || missingOptions.length) {
        const reasons = [
          missingLinks.length
            ? `상세페이지 제작용 1688 링크 없음: ${missingLinks.map((entry) => entry.productName).join(", ")}`
            : "",
          missingOptions.length
            ? `옵션 없음: ${missingOptions.map((entry) => entry.productName).join(", ")}`
            : "",
        ].filter(Boolean);
        throw new Error(`${reasons.join(" · ")} · 입력 후 다시 실행하세요.`);
      }

      const recent = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const recentBody = (await recent.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailJob[];
        message?: string;
      };
      if (!recent.ok || recentBody.ok !== true || !Array.isArray(recentBody.jobs)) {
        throw new Error(
          recentBody.message || "현재 상세페이지 작업 상태를 확인하지 못했습니다.",
        );
      }
      const activeItemIds = new Set(
        recentBody.jobs
          .filter(
            (job) =>
              !["success", "failed", "cancelled"].includes(
                String(job.status ?? ""),
              ),
          )
          .map((job) => String(job.itemId ?? ""))
          .filter(Boolean),
      );
      const runnable = prepared.filter((entry) => !activeItemIds.has(entry.itemId));
      const skipped = prepared.filter((entry) => activeItemIds.has(entry.itemId));
      if (!runnable.length) {
        throw new Error(
          `선택한 ${skipped.length}건은 모두 이미 상세페이지 작업이 진행 중입니다.`,
        );
      }

      if (
        !window.confirm(
          `선택한 ${prepared.length}건 중 ${runnable.length}건을 Evidence Compiler v1로 새로 제작할까요?\n\n1688 원본 수집은 최대 ${DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}건 병렬로 진행되고, 이후 각 상품의 Compiler·최종 픽셀검수도 독립 작업으로 이어집니다.${skipped.length ? `\n이미 진행 중인 ${skipped.length}건은 중복 등록하지 않습니다.` : ""}\n기존 상품상세 이미지/HTML은 각 새 결과가 최종 PASS할 때만 교체됩니다.`,
        )
      ) {
        setTone("neutral");
        setMessage("Compiler 다중 생성을 취소했습니다.");
        return;
      }

      setMessage(
        `Evidence Compiler 신규 작업 ${runnable.length}건을 병렬 등록하고 있습니다.`,
      );
      const results = await mapWithConcurrency(
        runnable,
        REGISTER_CONCURRENCY,
        async (entry, batchIndex) => {
          const jobId = crypto.randomUUID();
          const attempt = Math.max(1, automationAttempt(entry.localItem) + 1);
          const compilerWorkerSlot = batchIndex % DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE;
          const response = await fetch(JOBS_API, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jobId,
              itemId: entry.itemId,
              sourceUrl: entry.sourceUrl,
              salesOptions: entry.salesOptions,
              productName: entry.productName,
              attempt,
              compilerCanary: true,
              compilerWorkerSlot,
            }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            job?: DetailJob;
            message?: string;
          };
          if (!response.ok || body.ok !== true || !body.job) {
            throw new Error(
              `${entry.productName}: ${body.message || "Compiler 신규 작업 등록 실패"}`,
            );
          }
          if (body.job.payload?.compiler_canary !== true) {
            throw new Error(
              `${entry.productName}: 서버가 Compiler 플래그를 저장하지 못했습니다.`,
            );
          }
          if (Number(body.job.payload?.compiler_worker_slot) !== compilerWorkerSlot) {
            throw new Error(
              `${entry.productName}: 서버가 Compiler 병렬 슬롯을 저장하지 못했습니다.`,
            );
          }

          const now = new Date().toISOString();
          writeAutomationState(state, entry.itemId, {
            jobId,
            status: "queued",
            stage: "source_collection",
            message: `Evidence Compiler · 1688 원본 수집 대기 중 · 병렬 슬롯 ${compilerWorkerSlot + 1}`,
            progress: 1,
            qaStatus: "pending",
            sourceUrl: entry.sourceUrl,
            sourceRunId: "",
            attempt,
            queuedAt: now,
            startedAt: null,
            completedAt: null,
            error: "",
            executionMode: "server-v1",
            compilerCanary: true,
            compilerWorkerSlot,
          });
          return entry.productName;
        },
      );

      const succeeded = results.filter(
        (result): result is PromiseFulfilledResult<string> =>
          result.status === "fulfilled",
      );
      const failed = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      if (!succeeded.length) {
        throw new Error(
          failed
            .map((result) =>
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            )
            .join(" · ") || "Compiler 작업을 등록하지 못했습니다.",
        );
      }

      setTone(failed.length ? "error" : "success");
      setMessage(
        `Compiler ${succeeded.length}건 등록 완료 · 최대 ${DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}건 동시 수집 후 각 작업이 독립적으로 계속됩니다.${skipped.length ? ` 이미 진행 중 ${skipped.length}건 제외.` : ""}${failed.length ? ` 등록 실패 ${failed.length}건: ${failed.map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason))).join(" · ")}` : ""}`,
      );
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Evidence Compiler 다중 생성을 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toneClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-800"
      : tone === "error"
        ? "bg-rose-50 text-rose-800"
        : tone === "progress"
          ? "bg-blue-50 text-blue-800"
          : "bg-slate-50 text-slate-600";

  return (
    <div className="rounded-xl border border-violet-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-slate-950">
              Evidence Compiler v1 · 다중 신규 생성
            </strong>
            <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">
              OPS v260807 전용 · 동시 {DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}건
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            체크한 여러 상품을 한 번에 등록합니다. 앞의 {DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}건은 서로 다른 병렬 슬롯에 고정 배정되고, 이후 작업은 슬롯별 대기열로 자동 진입합니다. 일반 ‘선택 상세페이지 생성’은 v3 롤백 경로로 유지합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Compiler 다중 등록 중…" : "체크 상품 Compiler 생성"}
        </button>
      </div>
      <div
        className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold leading-5 ${toneClass}`}
      >
        {message}
      </div>
    </div>
  );
}

function readState(): LaunchState | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    );
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function authoritativeItems(
  state: LaunchState,
  itemIds: string[],
  localItems: Array<{ itemId: string; localItem: LaunchItem }>,
) {
  if (state.partialPage !== true) {
    return new Map(localItems.map(({ itemId, localItem }) => [itemId, localItem]));
  }
  const params = new URLSearchParams({ mode: "items" });
  itemIds.forEach((itemId) => params.append("id", itemId));
  const response = await fetch(`${OPTIMIZED_TRACKER_API}?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: LaunchItem[];
    message?: string;
  };
  if (!response.ok || body.ok !== true || !Array.isArray(body.items)) {
    throw new Error(
      body.message || "선택 상품의 최신 상세정보를 불러오지 못했습니다.",
    );
  }
  return new Map(
    body.items
      .map((item) => [String(item?.id ?? ""), item] as const)
      .filter(([itemId]) => itemIds.includes(itemId)),
  );
}

function saleOptions(item: LaunchItem) {
  const options = Array.isArray(item.orderOptions) ? item.orderOptions : [];
  return options
    .map((option) => String(record(option).saleOption || "").trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 2_000);
}

function automationAttempt(item: LaunchItem) {
  const automation = record(item.detailPageAutomation);
  return Math.max(0, Number(automation.attempt) || 0);
}

function writeAutomationState(
  state: LaunchState,
  itemId: string,
  automation: Record<string, unknown>,
) {
  if (!Array.isArray(state.items)) return;
  const now = new Date().toISOString();
  state.items = state.items.map((item) =>
    String(item?.id ?? "") === itemId
      ? {
          ...item,
          detailPageAutomation: automation,
          updatedAt: now,
        }
      : item,
  );
  state.savedAt = now;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(
    new CustomEvent("product-launch-tracker:external-state"),
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = {
            status: "fulfilled",
            value: await task(values[index], index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
