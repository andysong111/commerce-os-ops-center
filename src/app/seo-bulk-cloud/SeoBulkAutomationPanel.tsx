"use client";

import { useCallback, useEffect, useState } from "react";

const API = "/api/seo-listing-lifecycle";
const POLL_MS = 30_000;

type UnknownRecord = Record<string, unknown>;
type MarketRow = {
  marketAccountKey: string;
  marketName?: string;
  accountLabel?: string;
  maximumListingCount: number | null;
  activeListingCount: number | null;
  inFlightCount?: number | null;
  safetyBuffer?: number | null;
  availableListingCount: number;
  blocked: boolean;
  stale: boolean;
  reasonCode: string;
  observedAt?: string | null;
};

type Dashboard = {
  generatedAt: string;
  schemaReady: boolean;
  mode: string;
  autoExecutionEnabled: boolean;
  policy: {
    exposureDays: number;
    cooldownDays: number;
    maxAttempts: number;
    capacityMaxAgeHours: number;
  };
  summary: {
    seoReadyProductCount: number;
    shadowRegistrationCount: number;
    scheduledRegistrationCount: number;
    eligibleRegistrationCount: number;
    excludedByLifecycleCount: number;
    limitedByCapacityCount: number;
    soldOutDeleteDueCount: number;
    relistDueCount: number;
    protectedProductCount: number;
    cooldownProductCount: number;
    reviewProductCount: number;
    capacityFallbackActive: boolean;
    scheduledBatchLimit: number;
    registeredProductCount: number;
    registrationFailedProductCount: number;
    processingProductCount: number;
    verifiedSalesCount: number;
    safeBatchCount: number;
    marketCount: number;
    blockedMarketCount: number;
    lifecycle: Record<string, number>;
    requiresReviewCount: number;
  };
  scheduledRun: {
    executable: boolean;
    reasonCode: string;
    runIds: string[];
    cadenceLabel: string;
    capacityMode: string;
    externalDeleteEnabled: boolean;
  };
  operations: {
    dailyRefresh: {
      enabled: boolean;
      healthy: boolean;
      lastStatus: string;
      nextRunAt: string | null;
      lastStartedAt: string | null;
      lastFinishedAt: string | null;
      consecutiveFailures: number;
      externalMarketWrite: boolean;
    };
    exposureProgress: {
      trackedProductCount: number;
      maxVerifiedExposureDays: number;
      dueSoonProductCount: number;
      progressBands: {
        days0To29: number;
        days30To49: number;
        days50To59: number;
        days60Plus: number;
      };
    };
  };
  markets: MarketRow[];
  warnings: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function countLabel(value: number | null | undefined) {
  return value === null || value === undefined
    ? "미확인"
    : value.toLocaleString("ko-KR");
}

function nullableCount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function dateLabel(value: unknown) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) return "미확인";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

const REASON_LABELS: Record<string, string> = {
  CAPACITY_AVAILABLE: "자동등록 가능",
  CAPACITY_NOT_VERIFIED: "한도 확인 필요",
  CAPACITY_COUNT_INVALID: "수량 데이터 오류",
  CAPACITY_STALE: "24시간 초과 · 갱신 필요",
  ACTIVE_COUNT_EXCEEDS_MAXIMUM: "등록수가 한도 초과",
  MARKET_ACCOUNT_KEY_MISSING: "계정 식별자 누락",
};

const WARNING_LABELS: Record<string, string> = {
  LIFECYCLE_SCHEMA_NOT_APPLIED: "데이터베이스 준비 전",
  POLICY_ROW_NOT_CREATED: "정책 초기화 전",
  POLICY_VERSION_MISMATCH: "정책 버전 불일치",
  REQUIRED_MARKET_CAPACITY_MISSING: "필수 마켓 등록한도 미수집",
  CAPACITY_NOT_VERIFIED: "마켓 등록한도 확인 필요",
  CAPACITY_COUNT_INVALID: "마켓 등록수 데이터 오류",
  CAPACITY_STALE: "마켓 등록한도 24시간 초과",
  ACTIVE_COUNT_EXCEEDS_MAXIMUM: "마켓 등록수 한도 초과",
  REGISTRATION_ONLY_FALLBACK_ACTIVE: "신규 등록 3개 제한 안전모드",
  SHADOW_RECONCILIATION_FAILED: "판매·등록 근거 자동 대사 재시도 필요",
  DAILY_SHADOW_REFRESH_STATUS_UNAVAILABLE: "매일 자동 확인 상태 조회 실패",
  DAILY_SHADOW_REFRESH_TASK_MISSING: "매일 자동 확인 작업 누락",
  DAILY_SHADOW_REFRESH_TASK_DISABLED: "매일 자동 확인 중지됨",
  DAILY_SHADOW_REFRESH_LAST_RUN_FAILED: "매일 자동 확인 오류 점검 필요",
};

function normalizeDashboard(body: UnknownRecord): Dashboard {
  const policy = record(body.policy);
  const summary = record(body.summary);
  const lifecycle = record(summary.lifecycle);
  const operations = record(body.operations);
  const dailyRefresh = record(operations.dailyRefresh);
  const exposureProgress = record(operations.exposureProgress);
  const progressBands = record(exposureProgress.progressBands);
  return {
    generatedAt: text(body.generatedAt),
    schemaReady: body.schemaReady === true,
    mode: text(body.mode) || "shadow",
    autoExecutionEnabled: body.autoExecutionEnabled === true,
    policy: {
      exposureDays: count(policy.exposureDays),
      cooldownDays: count(policy.cooldownDays),
      maxAttempts: count(policy.maxAttempts),
      capacityMaxAgeHours: count(policy.capacityMaxAgeHours),
    },
    summary: {
      seoReadyProductCount: count(summary.seoReadyProductCount),
      shadowRegistrationCount: count(summary.shadowRegistrationCount),
      scheduledRegistrationCount: count(summary.scheduledRegistrationCount),
      eligibleRegistrationCount: count(summary.eligibleRegistrationCount),
      excludedByLifecycleCount: count(summary.excludedByLifecycleCount),
      limitedByCapacityCount: count(summary.limitedByCapacityCount),
      soldOutDeleteDueCount: count(summary.soldOutDeleteDueCount),
      relistDueCount: count(summary.relistDueCount),
      protectedProductCount: count(summary.protectedProductCount),
      cooldownProductCount: count(summary.cooldownProductCount),
      reviewProductCount: count(summary.reviewProductCount),
      capacityFallbackActive: summary.capacityFallbackActive === true,
      scheduledBatchLimit: count(summary.scheduledBatchLimit),
      registeredProductCount: count(summary.registeredProductCount),
      registrationFailedProductCount: count(
        summary.registrationFailedProductCount,
      ),
      processingProductCount: count(summary.processingProductCount),
      verifiedSalesCount: count(summary.verifiedSalesCount),
      safeBatchCount: count(summary.safeBatchCount),
      marketCount: count(summary.marketCount),
      blockedMarketCount: count(summary.blockedMarketCount),
      lifecycle: Object.fromEntries(
        Object.entries(lifecycle).map(([key, value]) => [key, count(value)]),
      ),
      requiresReviewCount: count(summary.requiresReviewCount),
    },
    scheduledRun: {
      executable: record(body.scheduledRun).executable === true,
      reasonCode: text(record(body.scheduledRun).reasonCode),
      runIds: Array.isArray(record(body.scheduledRun).runIds)
        ? (record(body.scheduledRun).runIds as unknown[]).map(text).filter(Boolean)
        : [],
      cadenceLabel:
        text(record(body.scheduledRun).cadenceLabel) ||
        "재고 동기화가 끝난 뒤 하루 1회",
      capacityMode: text(record(body.scheduledRun).capacityMode),
      externalDeleteEnabled:
        record(body.scheduledRun).externalDeleteEnabled === true,
    },
    operations: {
      dailyRefresh: {
        enabled: dailyRefresh.enabled === true,
        healthy: dailyRefresh.healthy === true,
        lastStatus: text(dailyRefresh.lastStatus) || "unknown",
        nextRunAt: text(dailyRefresh.nextRunAt) || null,
        lastStartedAt: text(dailyRefresh.lastStartedAt) || null,
        lastFinishedAt: text(dailyRefresh.lastFinishedAt) || null,
        consecutiveFailures: count(dailyRefresh.consecutiveFailures),
        externalMarketWrite: dailyRefresh.externalMarketWrite === true,
      },
      exposureProgress: {
        trackedProductCount: count(exposureProgress.trackedProductCount),
        maxVerifiedExposureDays: count(
          exposureProgress.maxVerifiedExposureDays,
        ),
        dueSoonProductCount: count(exposureProgress.dueSoonProductCount),
        progressBands: {
          days0To29: count(progressBands.days0To29),
          days30To49: count(progressBands.days30To49),
          days50To59: count(progressBands.days50To59),
          days60Plus: count(progressBands.days60Plus),
        },
      },
    },
    markets: Array.isArray(body.markets)
      ? body.markets.map((value): MarketRow => {
          const market = record(value);
          return {
            marketAccountKey: text(market.marketAccountKey),
            marketName: text(market.marketName),
            accountLabel: text(market.accountLabel),
            maximumListingCount: nullableCount(market.maximumListingCount),
            activeListingCount: nullableCount(market.activeListingCount),
            inFlightCount: nullableCount(market.inFlightCount),
            safetyBuffer: nullableCount(market.safetyBuffer),
            availableListingCount: count(market.availableListingCount),
            blocked: market.blocked !== false,
            stale: market.stale !== false,
            reasonCode: text(market.reasonCode) || "CAPACITY_NOT_VERIFIED",
            observedAt: text(market.observedAt) || null,
          };
        })
      : [],
    warnings: Array.isArray(body.warnings)
      ? body.warnings.map(text).filter(Boolean)
      : [],
  };
}

export default function SeoBulkAutomationPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(API, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = record(await response.json().catch(() => ({})));
      if (!response.ok || body.ok !== true) {
        throw new Error(text(body.message) || `HTTP ${response.status}`);
      }
      setDashboard(normalizeDashboard(body));
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "자동 물갈이 현황을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [load]);

  const lifecycle = dashboard?.summary.lifecycle ?? {};
  const dailyRefresh = dashboard?.operations.dailyRefresh;
  const exposureProgress = dashboard?.operations.exposureProgress;
  const exposureTargetDays = dashboard?.policy.exposureDays || 60;
  const exposurePercent = Math.min(
    100,
    Math.round(
      ((exposureProgress?.maxVerifiedExposureDays ?? 0) /
        exposureTargetDays) *
        100,
    ),
  );
  const actionableWarnings = (dashboard?.warnings ?? []).filter(
    (warning) => warning !== "SHADOW_ONLY_NO_MARKET_WRITE",
  );

  return (
    <section className="mx-auto mt-6 max-w-[1500px] rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-700">
              SEO Portfolio Autopilot
            </p>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
              신규등록 원클릭 · 물갈이 안전잠금
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
            자동등록 · 상품 물갈이
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            SEO 준비 상품을 확인된 마켓 슬롯 또는 3개 안전 상한 안에서 자동 배치합니다. 판매가 없으면 60일 노출 후
            90일 쉬었다가 새 SEO 버전으로 다시 기회를 주고, 3회 연속 무판매만 단종 후보로 보냅니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-800 shadow-sm hover:bg-indigo-50 disabled:opacity-50"
        >
          {loading ? "확인 중…" : "현황 새로고침"}
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-black text-slate-900">매일 자동 확인 상태</h3>
            <p className="mt-1 text-xs text-slate-600">
              Shopling 판매상태와 실제 판매 근거를 하루 한 번 확인하며, 외부 품절·삭제는 아직 실행하지 않습니다.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-black ${
              dailyRefresh?.enabled && dailyRefresh.healthy
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {dailyRefresh?.enabled && dailyRefresh.healthy
              ? "하루 1회 자동 확인 중"
              : "자동 확인 점검 필요"}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-cyan-100">
            <div className="text-xs font-bold text-slate-500">마지막 자동 확인</div>
            <div className="mt-1 font-black text-slate-950">
              {dailyRefresh?.lastFinishedAt
                ? dateLabel(dailyRefresh.lastFinishedAt)
                : "첫 실행 전"}
            </div>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-cyan-100">
            <div className="text-xs font-bold text-slate-500">다음 자동 확인</div>
            <div className="mt-1 font-black text-slate-950">
              {dailyRefresh?.nextRunAt
                ? dateLabel(dailyRefresh.nextRunAt)
                : "미확인"}
            </div>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-cyan-100">
            <div className="text-xs font-bold text-slate-500">가장 오래 노출된 상품</div>
            <div className="mt-1 font-black text-slate-950">
              {exposureProgress?.maxVerifiedExposureDays ?? 0}일 / {exposureTargetDays}일
            </div>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-cyan-100">
            <div className="text-xs font-bold text-slate-500">확인 오류</div>
            <div className="mt-1 font-black text-slate-950">
              {dailyRefresh?.consecutiveFailures ?? 0}건
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-cyan-100">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600">
            <span>
              노출 추적 {exposureProgress?.trackedProductCount ?? 0}개 · 50일 이상 무판매 {exposureProgress?.dueSoonProductCount ?? 0}개
            </span>
            <span>{exposurePercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-cyan-600 transition-[width]"
              style={{ width: `${exposurePercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-black text-slate-900">오늘 운영 흐름</h3>
          <span className="text-xs font-bold text-slate-500">
            {dashboard?.scheduledRun.cadenceLabel ?? "재고 동기화가 끝난 뒤 하루 1회"}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["1. SEO 준비", dashboard?.summary.seoReadyProductCount ?? 0],
            ["2. 오늘 실행", dashboard?.summary.scheduledRegistrationCount ?? 0],
            ["3. 처리 중", dashboard?.summary.processingProductCount ?? 0],
            ["4. 등록 완료", dashboard?.summary.registeredProductCount ?? 0],
            ["5. 판매 보호", dashboard?.summary.protectedProductCount ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
              <div className="text-xs font-bold text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-black text-slate-950">
                {Number(value).toLocaleString("ko-KR")}개
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
            검증된 판매 {dashboard?.summary.verifiedSalesCount ?? 0}건
          </span>
          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">
            등록 실패 확인 {dashboard?.summary.registrationFailedProductCount ?? 0}개
          </span>
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-800">
            재도전 준비 {dashboard?.summary.relistDueCount ?? 0}개
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ["오늘 등록 가능", dashboard?.summary.scheduledRegistrationCount ?? 0],
          ["SEO 준비 전체", dashboard?.summary.seoReadyProductCount ?? 0],
          ["노출 중", lifecycle.LIVE ?? 0],
          ["판매 발생 · 보호", dashboard?.summary.protectedProductCount ?? 0],
          ["90일 휴지", dashboard?.summary.cooldownProductCount ?? 0],
          ["단종 후보", lifecycle.RETIRE_CANDIDATE ?? 0],
          ["확인 필요", dashboard?.summary.reviewProductCount ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-black text-slate-950">
              {Number(value).toLocaleString("ko-KR")}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-emerald-800">
            오늘의 자동운영
          </div>
          <div className="mt-1 text-lg font-black text-slate-950">
            {dashboard?.scheduledRun.executable
              ? dashboard.summary.capacityFallbackActive
                ? `${dashboard.summary.scheduledRegistrationCount.toLocaleString("ko-KR")}개 상품을 안전 상한 ${dashboard.summary.scheduledBatchLimit}개 안에서 진행합니다.`
                : `${dashboard.summary.scheduledRegistrationCount.toLocaleString("ko-KR")}개 상품을 한 번에 진행할 수 있습니다.`
              : "지금 바로 등록할 상품은 없습니다."}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            실행 시점: {dashboard?.scheduledRun.cadenceLabel ?? "재고 동기화가 끝난 뒤 하루 1회"}
          </p>
          <a
            href="#seo-portfolio-one-click"
            className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm"
          >
            아래 원클릭 실행으로 이동
          </a>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-amber-800">
            안전 경계
          </div>
          <div className="mt-1 text-lg font-black text-slate-950">
            품절·삭제 예정 {dashboard?.summary.soldOutDeleteDueCount ?? 0}개
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            실제 품절·삭제는 아직 잠겨 있습니다. 검증된 소수 상품 Canary가 통과한 뒤에만 자동 실행합니다.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
          <div className="text-xs font-bold text-indigo-700">1회 노출</div>
          <div className="mt-1 text-lg font-black">{dashboard?.policy.exposureDays || 60}일</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">실제 판매중 readback이 확인된 날짜만 계산</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
          <div className="text-xs font-bold text-indigo-700">재도전 간격</div>
          <div className="mt-1 text-lg font-black">{dashboard?.policy.cooldownDays || 90}일</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">품절·삭제 확인 후 휴지기간 시작</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
          <div className="text-xs font-bold text-indigo-700">최대 기회</div>
          <div className="mt-1 text-lg font-black">{dashboard?.policy.maxAttempts || 3}회</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">기술 오류·미노출은 횟수에서 제외</p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          자동화 현황 조회 실패: {error}
        </div>
      ) : null}

      {!error && actionableWarnings.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-black">
            {dashboard?.summary.capacityFallbackActive
              ? "신규 등록만 제한 운영 중"
              : "자동 실행 차단 중"}
          </div>
          <div className="mt-1">
            {actionableWarnings
              .map((warning) => WARNING_LABELS[warning] ?? warning)
              .join(" · ")}
          </div>
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-black text-slate-900">마켓 계정별 등록 슬롯</h3>
            <p className="mt-1 text-xs text-slate-500">
              필수 마켓 중 남은 슬롯이 가장 적은 계정이 한 번에 등록할 상품 수를 결정합니다.
            </p>
          </div>
          <div className="text-xs font-bold text-slate-600">
            안전 등록 가능 {dashboard?.summary.safeBatchCount ?? 0}개 · 갱신 {dateLabel(dashboard?.generatedAt)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">마켓 / 계정</th>
                <th className="px-4 py-3">최대</th>
                <th className="px-4 py-3">현재 등록</th>
                <th className="px-4 py-3">진행 중</th>
                <th className="px-4 py-3">안전 여유</th>
                <th className="px-4 py-3">남은 슬롯</th>
                <th className="px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(dashboard?.markets ?? []).map((market) => (
                <tr key={market.marketAccountKey}>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900">{market.marketName || market.marketAccountKey}</div>
                    <div className="text-xs text-slate-500">{market.accountLabel || "계정명 미확인"}</div>
                  </td>
                  <td className="px-4 py-3">{countLabel(market.maximumListingCount)}</td>
                  <td className="px-4 py-3">{countLabel(market.activeListingCount)}</td>
                  <td className="px-4 py-3">{countLabel(market.inFlightCount)}</td>
                  <td className="px-4 py-3">{countLabel(market.safetyBuffer)}</td>
                  <td className="px-4 py-3 font-black">{market.availableListingCount.toLocaleString("ko-KR")}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${market.blocked ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
                      {REASON_LABELS[market.reasonCode] ?? market.reasonCode}
                    </span>
                  </td>
                </tr>
              ))}
              {!dashboard?.markets.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    아직 수집된 마켓 계정별 등록한도가 없습니다. 신규 등록은 한 번에 최대 3개만 진행하고, 품절·삭제는 계속 잠급니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        아래 원클릭 버튼은 오늘 등록 가능한 상품과 미완료 마켓전송을 한 번에 이어 처리합니다.
        실제 품절·삭제 자동 실행은 한도·노출·판매 readback 검증 후 Canary 단계에서만 켭니다.
      </p>
    </section>
  );
}
