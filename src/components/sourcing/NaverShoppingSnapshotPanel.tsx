"use client";

import { useState } from "react";
import type { NaverShoppingSnapshot } from "@/lib/naverShoppingSnapshot";

type SnapshotResponse =
  | {
      ok: true;
      snapshot: NaverShoppingSnapshot;
      notice: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

const numberFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

export function NaverShoppingSnapshotPanel({ keyword }: { keyword: string }) {
  const [snapshot, setSnapshot] = useState<NaverShoppingSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [excludeOverseas, setExcludeOverseas] = useState(true);

  async function fetchSnapshot() {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      setErrorMessage("키워드를 먼저 입력하세요.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setNotice("");

    try {
      const params = new URLSearchParams({
        keyword: trimmedKeyword,
        display: "50",
        excludeOverseas: String(excludeOverseas),
      });
      const response = await fetch(`/api/sourcing/naver-shopping-snapshot?${params}`);
      const payload = (await response.json()) as SnapshotResponse;

      if (!payload.ok) {
        setSnapshot(null);
        setErrorMessage(toFriendlyError(payload));
        return;
      }

      setSnapshot(payload.snapshot);
      setNotice(payload.notice);
    } catch {
      setSnapshot(null);
      setErrorMessage("네이버 경쟁 스냅샷을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-950">네이버 경쟁 스냅샷</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            판매량 증명이 아니라 경쟁 가격대·몰/브랜드 쏠림을 보는 보조지표입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchSnapshot}
          disabled={loading}
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "조회 중" : "스냅샷 조회"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <input
          type="checkbox"
          checked={excludeOverseas}
          onChange={(event) => setExcludeOverseas(event.target.checked)}
        />
        해외직구/구매대행 결과 제외 시도
      </label>

      {errorMessage ? (
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          {errorMessage}
        </div>
      ) : null}

      {snapshot ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="총 검색결과" value={numberFormatter.format(snapshot.total)} />
            <Metric label="상위 수집" value={`${snapshot.displayCount}개`} />
            <Metric label="중위 가격" value={`${numberFormatter.format(snapshot.priceMedianKrw)}원`} />
            <Metric label="브랜드 수" value={`${snapshot.brandCount}개`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <TopList title="상위 몰" items={snapshot.topMalls} />
            <TopList title="상위 브랜드" items={snapshot.topBrands} />
            <TopList title="상위 카테고리" items={snapshot.topCategories} />
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-500">판단 메모</h3>
            <ul className="mt-2 space-y-1.5">
              {snapshot.notes.map((item) => (
                <li key={item} className="text-sm leading-6 text-slate-600">
                  • {item}
                </li>
              ))}
            </ul>
          </div>

          {notice ? (
            <p className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-700">
              {notice}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-500">
          네이버 API 키가 연결되어 있으면 현재 키워드의 경쟁 스냅샷을 바로 조회합니다.
          키가 없으면 화면은 유지되고 수동 1688 후보 판단은 계속 가능합니다.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-950">{value}</p>
    </div>
  );
}

function TopList({
  title,
  items,
}: {
  title: string;
  items: Array<{ name: string; count: number }>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <h3 className="text-xs font-bold text-slate-500">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-3 text-xs text-slate-600">
              <span className="truncate">{item.name}</span>
              <span className="font-semibold text-slate-900">{item.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-400">데이터 없음</p>
      )}
    </div>
  );
}

function toFriendlyError(payload: Extract<SnapshotResponse, { ok: false }>) {
  if (payload.code === "MISSING_NAVER_KEYS") {
    return "네이버 API 키가 아직 연결되지 않았습니다. NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 설정 후 사용할 수 있습니다.";
  }
  if (payload.code === "MISSING_KEYWORD") {
    return "키워드를 먼저 입력하세요.";
  }
  if (payload.code === "NAVER_API_ERROR") {
    return `네이버 API 요청 실패: ${payload.status ?? "unknown"}`;
  }
  return payload.message || "네이버 경쟁 스냅샷 조회 실패";
}
