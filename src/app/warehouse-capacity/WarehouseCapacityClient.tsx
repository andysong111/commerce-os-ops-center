"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WarehouseCapacityLocation,
  WarehouseCapacitySnapshot,
} from "@/lib/warehouseCapacityBridge";

type ApiPayload = {
  ok: boolean;
  configured?: boolean;
  snapshot?: WarehouseCapacitySnapshot;
  error?: string;
  message?: string;
};

type LocationFilter = "all" | "occupied" | "free" | "exit" | "attention";

const gateLabels: Record<WarehouseCapacitySnapshot["sourcingIntakeGate"], string> = {
  READY: "소싱 수용량 계산 가능",
  WAITING_PHYSICAL_REGISTRY_CONFIRMATION: "전체 물리 위치 목록 확인 필요",
  WAITING_LIFECYCLE_BASELINE: "단종·정리 기준선 확정 대기",
  CAPACITY_DATA_CONFLICT: "위치 데이터 충돌 확인 필요",
};

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined
    ? "미확정"
    : new Intl.NumberFormat("ko-KR").format(value);
}

function parseCodes(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,;\t]+/)
        .map((row) => row.trim())
        .filter(Boolean),
    ),
  ];
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{helper}</p>
    </div>
  );
}

function LocationRow({ location }: { location: WarehouseCapacityLocation }) {
  const occupant = location.occupants[0];
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-3 font-mono text-xs font-black text-slate-900">
        {location.locationCode}
      </td>
      <td className="px-3 py-3 text-xs text-slate-700">
        {location.occupied ? "사용 중" : "비어 있음"}
        {!location.registered ? (
          <span className="ml-1 rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700">
            미등록
          </span>
        ) : null}
        {location.registered && !location.allocatable ? (
          <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">
            신규배정 금지
          </span>
        ) : null}
      </td>
      <td className="px-3 py-3 text-xs text-slate-700">
        {occupant ? (
          <>
            <span className="font-black">{occupant.modelNo || "모델번호 없음"}</span>
            <span className="ml-1 text-slate-500">
              {occupant.productName || occupant.optionName}
            </span>
            {location.occupants.length > 1 ? (
              <span className="ml-1 font-bold text-rose-700">
                +{location.occupants.length - 1} 충돌
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-slate-400">-</span>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-slate-700">
        {location.exitCandidate ? (
          <span className="font-black text-amber-700">정리 후보</span>
        ) : occupant ? (
          occupant.lifecycleStatus || "상태 확인 중"
        ) : (
          <span className="text-slate-400">-</span>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-slate-500">
        {location.zone || location.note || location.source || "-"}
      </td>
    </tr>
  );
}

export function WarehouseCapacityClient() {
  const [snapshot, setSnapshot] = useState<WarehouseCapacitySnapshot | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LocationFilter>("all");
  const [slotCodes, setSlotCodes] = useState("");
  const [allocationCodes, setAllocationCodes] = useState("");
  const [reserveSlots, setReserveSlots] = useState("0");
  const [registryConfirmation, setRegistryConfirmation] = useState("");
  const [message, setMessage] = useState("");

  const parsedSlotCodes = useMemo(() => parseCodes(slotCodes), [slotCodes]);
  const parsedAllocationCodes = useMemo(
    () => parseCodes(allocationCodes),
    [allocationCodes],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/warehouse-capacity", { cache: "no-store" });
      const payload = (await response.json()) as ApiPayload;
      setConfigured(payload.configured ?? null);
      if (!response.ok || !payload.ok || !payload.snapshot) {
        throw new Error(payload.message || "창고 수용능력 정보를 불러오지 못했습니다.");
      }
      setSnapshot(payload.snapshot);
      setReserveSlots(String(payload.snapshot.reserveSlotCount ?? 0));
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (body: Record<string, unknown>, successMessage: string) => {
      setSaving(true);
      setError("");
      setMessage("");
      try {
        const response = await fetch("/api/warehouse-capacity", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as ApiPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "저장에 실패했습니다.");
        }
        setConfigured(true);
        if (payload.snapshot) setSnapshot(payload.snapshot);
        setMessage(successMessage);
        return true;
      } catch (mutationError) {
        setError(
          mutationError instanceof Error ? mutationError.message : "저장에 실패했습니다.",
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const filteredLocations = useMemo(() => {
    if (!snapshot) return [];
    const needle = search.trim().toLowerCase();
    return snapshot.locations.filter((location) => {
      const text = [
        location.locationCode,
        location.zone,
        location.note,
        ...location.occupants.flatMap((row) => [
          row.modelNo,
          row.productName,
          row.optionName,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      if (needle && !text.includes(needle)) return false;
      if (filter === "occupied" && !location.occupied) return false;
      if (filter === "free" && (location.occupied || !location.registered)) return false;
      if (filter === "exit" && !location.exitCandidate) return false;
      if (
        filter === "attention" &&
        location.registered &&
        location.allocatable &&
        location.occupants.length <= 1
      ) {
        return false;
      }
      return true;
    });
  }, [filter, search, snapshot]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-600 shadow-sm">
        창고 위치 원장을 불러오는 중입니다…
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <p className="font-black text-amber-950">
          {configured === false
            ? "상품마스터 연동 설정이 필요합니다."
            : "창고 위치 원장을 불러오지 못했습니다."}
        </p>
        <p className="mt-2 text-sm leading-6 text-amber-800">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white"
        >
          다시 확인
        </button>
      </div>
    );
  }

  const trustedExitText = snapshot.exitCandidateCountTrusted
    ? formatNumber(snapshot.exitCandidateLocationCount)
    : `참고 ${formatNumber(snapshot.exitCandidateLocationCount)}`;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-slate-500">현재 판단 게이트</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              {gateLabels[snapshot.sourcingIntakeGate]}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              전체 물리 위치 목록과 상품 생애주기 원장이 확정된 뒤에만 이번 달 신규 SKU 수용 상한을 숫자로 사용합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            새로고침
          </button>
        </div>
        {snapshot.warnings.length ? (
          <div className="mt-4 space-y-2">
            {snapshot.warnings.map((warning) => (
              <p
                key={warning}
                className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800"
              >
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="등록 위치코드"
          value={formatNumber(snapshot.registeredSlotCount)}
          helper={
            snapshot.registryComplete
              ? "전체 물리 위치 목록 확정"
              : "현재 등록된 범위 · 전체 목록 미확정"
          }
        />
        <MetricCard
          label="현재 사용 중 위치"
          value={formatNumber(snapshot.occupiedLocationCount)}
          helper={`레지스트리 커버리지 ${snapshot.registryCoverageRate}%`}
        />
        <MetricCard
          label="등록 범위 내 빈 위치"
          value={formatNumber(snapshot.freeRegisteredSlotCount)}
          helper="전체 목록 확정 전에는 실제 남은 수용량으로 간주하지 않음"
        />
        <MetricCard
          label="창고 수용률"
          value={
            snapshot.occupancyRate === null
              ? "미확정"
              : `${snapshot.occupancyRate}%`
          }
          helper="전체 물리 위치 목록 확정 후에만 계산"
        />
        <MetricCard
          label="단종·정리 후보 위치"
          value={trustedExitText}
          helper={
            snapshot.exitCandidateCountTrusted
              ? "확정된 생애주기 원장 기준"
              : "현재 lifecycle 기준선 미확정 · 의사결정 사용 금지"
          }
        />
        <MetricCard
          label="즉시 신규 SKU 수용"
          value={formatNumber(snapshot.safeImmediateNewSkuCapacity)}
          helper="빈 위치 - 예약 버퍼 · 확정 조건 충족 시만 숫자 제공"
        />
        <MetricCard
          label="예상 신규 SKU 수용"
          value={formatNumber(snapshot.forecastNewSkuCapacity)}
          helper="즉시 수용 + 신뢰 가능한 정리 예정 위치"
        />
        <MetricCard
          label="예약 버퍼"
          value={formatNumber(snapshot.reserveSlotCount)}
          helper="항상 남겨둘 빈 위치 수"
        />
      </section>

      {message ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <h2 className="font-black text-slate-950">전체 위치코드</h2>
            <p className="mt-1 text-xs text-slate-500">
              검색 결과 {filteredLocations.length}개 · 한 위치에 여러 활성 SKU가 있으면 충돌로 표시합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="위치코드·모델번호 검색"
              className="w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as LocationFilter)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
            >
              <option value="all">전체</option>
              <option value="occupied">사용 중</option>
              <option value="free">빈 위치</option>
              <option value="exit">정리 후보</option>
              <option value="attention">확인 필요</option>
            </select>
          </div>
        </div>
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="sticky top-0 bg-slate-50 text-xs font-black text-slate-600">
              <tr>
                <th className="px-3 py-3">위치코드</th>
                <th className="px-3 py-3">점유</th>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3">생애주기</th>
                <th className="px-3 py-3">구역·메모</th>
              </tr>
            </thead>
            <tbody>
              {filteredLocations.slice(0, 500).map((location) => (
                <LocationRow key={location.locationCode} location={location} />
              ))}
            </tbody>
          </table>
        </div>
        {filteredLocations.length > 500 ? (
          <p className="border-t border-slate-100 p-3 text-xs font-bold text-slate-500">
            화면 성능을 위해 첫 500개만 표시합니다. 검색으로 범위를 좁히세요.
          </p>
        ) : null}
      </section>

      <details className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
        <summary className="cursor-pointer select-none font-black text-slate-900">
          위치코드 레지스트리 관리 · 고급
        </summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          위치코드 형식은 임의로 제한하지 않습니다. 현재 사용 중 코드만으로 빈 위치를 추정하지 않고, 실제 창고에 존재하는 전체 위치 목록을 등록해야 수용률이 확정됩니다.
        </p>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-900">물리 위치코드 일괄 추가</h3>
            <textarea
              value={slotCodes}
              onChange={(event) => setSlotCodes(event.target.value)}
              placeholder={"BBA1-1\nBBA1-2\nA구역-선반#3"}
              className="mt-3 min-h-32 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs outline-none focus:border-slate-500"
            />
            <button
              type="button"
              disabled={saving || parsedSlotCodes.length === 0}
              onClick={() => {
                const codes = parsedSlotCodes;
                void (async () => {
                  const ok = await mutate(
                    { action: "register_slots", locationCodes: codes },
                    `${codes.length}개 위치코드 등록 요청을 반영했습니다.`,
                  );
                  if (ok) setSlotCodes("");
                })();
              }}
              className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              위치코드 추가
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-900">신규 배정 가능/금지</h3>
            <textarea
              value={allocationCodes}
              onChange={(event) => setAllocationCodes(event.target.value)}
              placeholder="변경할 위치코드를 줄바꿈으로 입력"
              className="mt-3 min-h-32 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs outline-none focus:border-slate-500"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={saving || parsedAllocationCodes.length === 0}
                onClick={() => {
                  const codes = parsedAllocationCodes;
                  void (async () => {
                    const ok = await mutate(
                      {
                        action: "set_slot_allocatable",
                        locationCodes: codes,
                        allocatable: false,
                      },
                      "선택 위치를 신규 배정 금지로 변경했습니다.",
                    );
                    if (ok) setAllocationCodes("");
                  })();
                }}
                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-40"
              >
                신규배정 금지
              </button>
              <button
                type="button"
                disabled={saving || parsedAllocationCodes.length === 0}
                onClick={() => {
                  const codes = parsedAllocationCodes;
                  void (async () => {
                    const ok = await mutate(
                      {
                        action: "set_slot_allocatable",
                        locationCodes: codes,
                        allocatable: true,
                      },
                      "선택 위치를 신규 배정 가능으로 변경했습니다.",
                    );
                    if (ok) setAllocationCodes("");
                  })();
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-40"
              >
                신규배정 가능
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h3 className="text-sm font-black text-rose-950">전체 물리 위치 목록 확정</h3>
          <p className="mt-1 text-xs leading-5 text-rose-800">
            실제 창고의 모든 사용 가능 위치코드가 등록된 뒤에만 확정하세요. 확정 전에는 수용률과 신규 소싱 상한이 잠깁니다.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold text-slate-700">
              예약 버퍼
              <input
                type="number"
                min={0}
                value={reserveSlots}
                onChange={(event) => setReserveSlots(event.target.value)}
                className="ml-2 w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
            {!snapshot.registryComplete ? (
              <>
                <input
                  value={registryConfirmation}
                  onChange={(event) => setRegistryConfirmation(event.target.value)}
                  placeholder="확정 입력"
                  className="w-32 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={saving || registryConfirmation !== "확정"}
                  onClick={() => {
                    void (async () => {
                      const ok = await mutate(
                        {
                          action: "set_registry_status",
                          registryComplete: true,
                          reserveSlots: Number(reserveSlots || 0),
                        },
                        "전체 물리 위치 목록을 확정했습니다.",
                      );
                      if (ok) setRegistryConfirmation("");
                    })();
                  }}
                  className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                >
                  전체 목록 확정
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void mutate(
                    {
                      action: "set_registry_status",
                      registryComplete: false,
                      reserveSlots: Number(reserveSlots || 0),
                    },
                    "전체 목록 확정을 해제했습니다. 수용량 계산은 다시 잠겼습니다.",
                  )
                }
                className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-800 disabled:opacity-40"
              >
                확정 해제
              </button>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
