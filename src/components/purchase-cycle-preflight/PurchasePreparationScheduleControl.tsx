"use client";

import { useEffect, useMemo, useState } from "react";

type Schedule = {
  enabled: boolean;
  dayOfMonth: number;
  startHour: number;
  updatedAt: string;
};

type StatusPayload = {
  ok?: boolean;
  schedule?: Schedule | null;
  decision?: { nextScheduledAt?: string | null };
  message?: string;
};

function hourLabel(hour: number) {
  if (hour === 0) return "자정 12시";
  if (hour < 12) return `오전 ${hour}시`;
  if (hour === 12) return "낮 12시";
  return `오후 ${hour - 12}시`;
}

export function PurchasePreparationScheduleControl({ targetDate }: { targetDate: string }) {
  const defaultDay = Math.min(28, Math.max(1, Number(targetDate.slice(8, 10)) || 1));
  const [dayOfMonth, setDayOfMonth] = useState(defaultDay);
  const [startHour, setStartHour] = useState(6);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [nextScheduledAt, setNextScheduledAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("현재 자동 준비 일정을 확인하고 있습니다.");
  const [error, setError] = useState(false);

  const nextLabel = useMemo(() => {
    if (!nextScheduledAt) return "";
    const parsed = new Date(nextScheduledAt);
    return Number.isFinite(parsed.valueOf())
      ? parsed.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      : "";
  }, [nextScheduledAt]);

  useEffect(() => {
    let active = true;
    void fetch("/api/purchase-cycle/preparation-schedule", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as StatusPayload;
        if (!response.ok || body.ok !== true) throw new Error(body.message || "일정 조회 실패");
        if (!active) return;
        if (body.schedule) {
          setSchedule(body.schedule);
          setDayOfMonth(body.schedule.dayOfMonth);
          setStartHour(body.schedule.startHour);
          setNotice(
            body.schedule.enabled
              ? `매달 ${body.schedule.dayOfMonth}일 ${hourLabel(body.schedule.startHour)}에 자동 준비를 시작합니다.`
              : "자동 준비 일정이 꺼져 있습니다.",
          );
        } else {
          setNotice("아직 자동 준비 일정이 없습니다. 아래 날짜와 시각을 한 번 저장하세요.");
        }
        setNextScheduledAt(body.decision?.nextScheduledAt ?? null);
        setError(false);
      })
      .catch(() => {
        if (!active) return;
        setNotice("자동 준비 일정을 불러오지 못했습니다. 잠시 후 다시 확인하세요.");
        setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(enabled: boolean) {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/purchase-cycle/preparation-schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, dayOfMonth, startHour }),
      });
      const body = (await response.json().catch(() => ({}))) as StatusPayload;
      if (!response.ok || body.ok !== true || !body.schedule) {
        throw new Error(body.message || "일정 저장 실패");
      }
      setSchedule(body.schedule);
      setNotice(body.message || "자동 준비 일정을 저장했습니다.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "자동 준비 일정을 저장하지 못했습니다.");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">MONTHLY AUTO PREP</p>
      <h2 className="mt-1 text-lg font-black text-slate-950">매달 발주자료 미리 준비</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">
        정한 시각이 되면 검증된 360일 판매근거는 유지하고 최근 45일만 다시 읽어 두 번 대조합니다. 최초 기준자료가 없을 때만 360일 전체를 수집합니다. 실제 원장 반영은 별도 승인 단계에서 진행하고, 1688 주문·결제는 계속 직접 확인합니다.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold text-slate-800">
          매달 실행일
          <input
            className="mt-1 block w-24 rounded-lg border border-slate-300 bg-white px-3 py-2"
            type="number"
            min={1}
            max={28}
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(Number(event.target.value))}
          />
        </label>
        <label className="text-sm font-bold text-slate-800">
          준비 시작
          <select
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"
            value={startHour}
            onChange={(event) => setStartHour(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{hourLabel(hour)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || dayOfMonth < 1 || dayOfMonth > 28 || startHour < 0 || startHour > 23}
          onClick={() => void save(true)}
          className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? "저장 중..." : "자동 준비 켜기"}
        </button>
        {schedule?.enabled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(false)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            자동 준비 끄기
          </button>
        ) : null}
      </div>
      <p role={error ? "alert" : "status"} className={`mt-3 text-sm font-bold ${error ? "text-red-700" : "text-slate-700"}`}>
        {notice}{nextLabel && schedule?.enabled ? ` 다음 시작: ${nextLabel}` : ""}
      </p>
      <p className="mt-2 text-xs text-slate-500">매달 날짜가 달라도 빠지지 않도록 실행일은 1~28일에서 선택합니다.</p>
    </section>
  );
}
