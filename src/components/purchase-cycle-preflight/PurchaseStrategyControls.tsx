"use client";

import { useRouter } from "next/navigation";
import {
  MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
  MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
  MONTHLY_REVENUE_THRESHOLD_STEP_KRW,
} from "@/lib/productDecisionEngine/purchaseStrategyPolicy";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type PurchaseStrategyConfig = {
  version: number;
  monthlyRevenueThresholdKrw: number;
  newProductProtectionDays: number;
  baseCoverMonths: number;
  risingCoverMonths: {
    weak: number;
    medium: number;
    strong: number;
  };
  automaticMaxCoverMonths: number;
  manualHeroMaxCoverMonths: number;
};

type ProductState = {
  barcode: string;
  status: "ACTIVE" | "DISCONTINUED";
  discontinuedReason: string | null;
  discontinuedAt: string | null;
  discontinuedBy: string | null;
  restoredAt: string | null;
  restoredBy: string | null;
  restoreReason: string | null;
  updatedAt: string;
};

type ConfigHistoryEntry = {
  sourceEventId: string;
  actor: string;
  occurredAt: string;
  config: PurchaseStrategyConfig;
};

type ProductHistoryEntry = {
  sourceEventId: string;
  action: "DISCONTINUE" | "RESTORE";
  barcode: string;
  reason: string;
  actor: string;
  occurredAt: string;
};

type StrategyPayload = {
  ok?: boolean;
  message?: string;
  code?: string;
  config?: PurchaseStrategyConfig;
  states?: ProductState[];
  history?: {
    config?: ConfigHistoryEntry[];
    products?: ProductHistoryEntry[];
  };
  bounds?: {
    latestRowsPerOperationType?: number;
    configHistoryMayBeTruncated?: boolean;
    productHistoryMayBeTruncated?: boolean;
  };
  temporaryDraftExclusionsStoredHere?: boolean;
};

type Notice = {
  kind: "idle" | "success" | "error";
  text: string;
};

const ACTOR = "ops-center-operator";
const DEFAULT_THRESHOLD_KRW = 40_000;

function won(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function koreaDateTime(value: string | null | undefined) {
  if (!value) return "기록 없음";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return value;
  return parsed.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeBarcodeInput(value: string) {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function configForUpdate(config: PurchaseStrategyConfig) {
  return {
    monthlyRevenueThresholdKrw: config.monthlyRevenueThresholdKrw,
    newProductProtectionDays: config.newProductProtectionDays,
    baseCoverMonths: config.baseCoverMonths,
    risingCoverMonths: config.risingCoverMonths,
    automaticMaxCoverMonths: config.automaticMaxCoverMonths,
    manualHeroMaxCoverMonths: config.manualHeroMaxCoverMonths,
  };
}

export function PurchaseStrategyControls() {
  const router = useRouter();
  const [payload, setPayload] = useState<StrategyPayload | null>(null);
  const [thresholdInput, setThresholdInput] = useState(
    String(DEFAULT_THRESHOLD_KRW),
  );
  const [barcode, setBarcode] = useState("");
  const [discontinueReason, setDiscontinueReason] = useState("");
  const [restoreReasons, setRestoreReasons] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>({
    kind: "idle",
    text: "현재 발주 정책을 확인하고 있습니다.",
  });

  const applyPayload = useCallback((next: StrategyPayload) => {
    setPayload(next);
    if (next.config) {
      setThresholdInput(String(next.config.monthlyRevenueThresholdKrw));
    }
  }, []);

  const loadState = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/purchase-strategy", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as StrategyPayload;
      if (!response.ok || body.ok !== true || !body.config) {
        throw new Error(body.message || "발주 정책을 불러오지 못했습니다.");
      }
      applyPayload(body);
      if (!quiet) {
        setNotice({ kind: "idle", text: "최신 발주 정책을 불러왔습니다." });
      }
      return body;
    } catch (caught) {
      setNotice({
        kind: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "발주 정책을 불러오지 못했습니다.",
      });
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadState();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadState]);

  const discontinued = useMemo(
    () =>
      (payload?.states ?? [])
        .filter((row) => row.status === "DISCONTINUED")
        .sort((left, right) => left.barcode.localeCompare(right.barcode)),
    [payload?.states],
  );

  const recentHistory = useMemo(
    () => (payload?.history?.products ?? []).slice(0, 10),
    [payload?.history?.products],
  );

  async function postAction(body: Record<string, unknown>, actionKey: string) {
    setBusyAction(actionKey);
    setNotice({ kind: "idle", text: "변경 내용을 저장하고 있습니다." });
    try {
      const response = await fetch("/api/purchase-strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = (await response.json().catch(() => ({}))) as StrategyPayload;
      if (!response.ok || next.ok !== true || !next.config) {
        if (response.status === 409) {
          await loadState(true);
          throw new Error(
            `${next.message || "다른 화면에서 먼저 변경했습니다."} 최신값을 다시 불러왔습니다. 확인 후 다시 저장하세요.`,
          );
        }
        throw new Error(next.message || "발주 정책 변경을 저장하지 못했습니다.");
      }
      applyPayload(next);
      setNotice({
        kind: "success",
        text: next.message || "발주 정책 변경을 저장했습니다.",
      });
      router.refresh();
      return true;
    } catch (caught) {
      setNotice({
        kind: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "발주 정책 변경을 저장하지 못했습니다.",
      });
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function saveThreshold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const config = payload?.config;
    const threshold = Number(thresholdInput);
    if (!config) {
      setNotice({ kind: "error", text: "정책 조회가 끝난 뒤 저장하세요." });
      return;
    }
    if (
      !Number.isSafeInteger(threshold) ||
      threshold < MIN_MONTHLY_REVENUE_THRESHOLD_KRW ||
      threshold > MAX_MONTHLY_REVENUE_THRESHOLD_KRW ||
      threshold % MONTHLY_REVENUE_THRESHOLD_STEP_KRW !== 0
    ) {
      setNotice({
        kind: "error",
        text: "월매출 기준값은 1,000원~10,000,000원 사이에서 1,000원 단위로 입력하세요.",
      });
      return;
    }
    await postAction(
      {
        action: "UPDATE_CONFIG",
        actor: ACTOR,
        expectedVersion: config.version,
        config: {
          ...configForUpdate(config),
          monthlyRevenueThresholdKrw: threshold,
        },
      },
      "UPDATE_CONFIG",
    );
  }

  async function discontinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedBarcode = normalizeBarcodeInput(barcode);
    if (!normalizedBarcode || discontinueReason.trim().length < 2) {
      setNotice({
        kind: "error",
        text: "B코드와 2자 이상의 단종 사유를 입력하세요.",
      });
      return;
    }
    const saved = await postAction(
      {
        action: "DISCONTINUE",
        actor: ACTOR,
        barcode: normalizedBarcode,
        reason: discontinueReason.trim(),
      },
      `DISCONTINUE:${normalizedBarcode}`,
    );
    if (saved) {
      setBarcode("");
      setDiscontinueReason("");
    }
  }

  async function restore(row: ProductState) {
    const reason = restoreReasons[row.barcode]?.trim() ?? "";
    if (reason.length < 2) {
      setNotice({
        kind: "error",
        text: `${row.barcode}의 복구 사유를 2자 이상 입력하세요.`,
      });
      return;
    }
    const saved = await postAction(
      {
        action: "RESTORE",
        actor: ACTOR,
        barcode: row.barcode,
        reason,
      },
      `RESTORE:${row.barcode}`,
    );
    if (saved) {
      setRestoreReasons((current) => {
        const next = { ...current };
        delete next[row.barcode];
        return next;
      });
    }
  }

  const config = payload?.config;
  const historyTruncated =
    payload?.bounds?.configHistoryMayBeTruncated === true ||
    payload?.bounds?.productHistoryMayBeTruncated === true;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">
            PURCHASE STRATEGY
          </p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            발주 기준과 영구 발주 제외
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            월매출 기준은 최근 1년 상품 우선순위 계산에 사용합니다. 영구 발주
            제외는 단종 상품에만 사용하며, 이후의 모든 발주안에서 빠집니다.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || busyAction !== null}
          onClick={() => void loadState()}
          className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-50"
        >
          저장된 발주정책 다시 불러오기
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
        <strong>이번 Draft만 빼는 기능과 별개입니다.</strong> 재고가 많아서 이번
        이번 발주차시만 제외할 상품은 Draft의 임시 제외를 사용하세요. 이 화면의 영구
        제외는 단종처럼 앞으로도 사지 않을 상품에만 사용합니다.
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <form
          onSubmit={saveThreshold}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-slate-950">월매출 기준값</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                현재 정책 버전 {config?.version ?? "-"} · 기본값 40,000원
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
              현재 {won(config?.monthlyRevenueThresholdKrw ?? DEFAULT_THRESHOLD_KRW)}
            </span>
          </div>
          <label className="mt-4 block text-sm font-bold text-slate-800">
            한 달 매출 기준
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={MIN_MONTHLY_REVENUE_THRESHOLD_KRW}
                max={MAX_MONTHLY_REVENUE_THRESHOLD_KRW}
                step={MONTHLY_REVENUE_THRESHOLD_STEP_KRW}
                value={thresholdInput}
                disabled={loading || busyAction !== null || !config}
                onChange={(event) => setThresholdInput(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-bold text-slate-950 disabled:bg-slate-100"
              />
              <button
                type="submit"
                disabled={loading || busyAction !== null || !config}
                className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
              >
                {busyAction === "UPDATE_CONFIG" ? "저장 중..." : "기준 저장"}
              </button>
            </div>
          </label>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            저장하면 최신 정책 버전을 확인한 뒤 반영합니다. 다른 화면이 먼저
            바꾼 경우 덮어쓰지 않고 최신값을 다시 보여줍니다.
          </p>
        </form>

        <form
          onSubmit={discontinue}
          className="rounded-xl border border-rose-200 bg-white p-4"
        >
          <h3 className="font-black text-slate-950">단종 상품 영구 제외</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            언제든 복구할 수 있고, 사유와 변경 기록이 남습니다.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label className="text-sm font-bold text-slate-800">
              B코드
              <input
                value={barcode}
                placeholder="예: BCD8-1"
                autoCapitalize="characters"
                disabled={loading || busyAction !== null}
                onChange={(event) => setBarcode(event.target.value.toUpperCase())}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-bold uppercase text-slate-950 disabled:bg-slate-100"
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              단종 사유
              <input
                value={discontinueReason}
                placeholder="예: 공급 중단 확인"
                maxLength={300}
                disabled={loading || busyAction !== null}
                onChange={(event) => setDiscontinueReason(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 disabled:bg-slate-100"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={loading || busyAction !== null}
            className="mt-3 rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
          >
            {busyAction?.startsWith("DISCONTINUE:")
              ? "저장 중..."
              : "영구 발주 제외"}
          </button>
        </form>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-black text-slate-950">
            현재 영구 제외 {discontinued.length.toLocaleString("ko-KR")}개
          </h3>
          <p className="text-xs text-slate-500">복구에도 사유가 필요합니다.</p>
        </div>
        {discontinued.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
            영구 발주 제외로 지정한 상품이 없습니다.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {discontinued.map((row) => (
              <li
                key={row.barcode}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-slate-950">{row.barcode}</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {row.discontinuedReason || "사유 없음"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {koreaDateTime(row.discontinuedAt)} · {row.discontinuedBy || "작업자 미상"}
                    </p>
                  </div>
                  <div className="flex min-w-64 flex-1 gap-2 sm:max-w-lg">
                    <input
                      aria-label={`${row.barcode} 복구 사유`}
                      value={restoreReasons[row.barcode] ?? ""}
                      placeholder="복구 사유"
                      maxLength={300}
                      disabled={busyAction !== null}
                      onChange={(event) =>
                        setRestoreReasons((current) => ({
                          ...current,
                          [row.barcode]: event.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                    />
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void restore(row)}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800 disabled:opacity-50"
                    >
                      {busyAction === `RESTORE:${row.barcode}`
                        ? "복구 중..."
                        : "발주 복구"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-black text-slate-950">
          최근 변경 이력 보기 ({(payload?.history?.products ?? []).length}건)
        </summary>
        <div className="mt-3 grid gap-2">
          <p className="text-xs leading-5 text-slate-500">
            설정 변경 {(payload?.history?.config ?? []).length}건 · 최근 정책 버전 {config?.version ?? "-"}
          </p>
          {recentHistory.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
              상품 상태 변경 이력이 없습니다.
            </p>
          ) : (
            recentHistory.map((entry) => (
              <div
                key={entry.sourceEventId}
                className="grid gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm sm:grid-cols-[8rem_6rem_minmax(0,1fr)]"
              >
                <strong className="text-slate-950">{entry.barcode}</strong>
                <span
                  className={
                    entry.action === "DISCONTINUE"
                      ? "font-bold text-rose-700"
                      : "font-bold text-emerald-700"
                  }
                >
                  {entry.action === "DISCONTINUE" ? "영구 제외" : "복구"}
                </span>
                <span className="text-slate-700">
                  {entry.reason} · {entry.actor} · {koreaDateTime(entry.occurredAt)}
                </span>
              </div>
            ))
          )}
          {historyTruncated ? (
            <p className="text-xs font-bold text-amber-800">
              변경 이력이 많아 최근 {payload?.bounds?.latestRowsPerOperationType ?? 1_000}건만 표시합니다.
            </p>
          ) : null}
        </div>
      </details>

      <p
        role={notice.kind === "error" ? "alert" : "status"}
        className={`mt-4 rounded-lg px-3 py-2 text-sm font-bold ${
          notice.kind === "error"
            ? "bg-red-50 text-red-800"
            : notice.kind === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-white/70 text-slate-700"
        }`}
      >
        {loading ? "현재 발주 정책을 확인하고 있습니다." : notice.text}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        이 화면은 발주 후보 계산 기준만 바꿉니다. 1688 주문이나 결제는 실행하지 않습니다.
      </p>
    </section>
  );
}
