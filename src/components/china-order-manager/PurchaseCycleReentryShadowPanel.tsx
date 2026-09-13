"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReentryShadowReport, ReentryShadowRow } from "@/lib/purchaseCycleReentryShadowCore";

const POLL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const MIN_FOCUS_REFRESH_MS = 60_000;
function stamp(value: string | null) { return value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "미확인"; }
function amount(value: number | null) { return value === null ? "미확인" : value.toLocaleString("ko-KR"); }
function stage(row: ReentryShadowRow) {
  return ({ PURCHASE_CANDIDATE: "발주 후보 · 미승인", STOCK_SUFFICIENT: "추가 발주 불필요", BASELINE_ACCUMULATING: "기준점 축적 대기", DATA_HOLD: "근거 확인 필요", REVIEW: "참고·검토" })[row.stage];
}

export function PurchaseCycleReentryShadowPanel({ targetMonth }: { targetMonth: string }) {
  const [report, setReport] = useState<ReentryShadowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState("");
  const [changeNotice, setChangeNotice] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const lastStartedAt = useRef(0);
  const lastFingerprint = useRef<string | null>(null);
  const failures = useRef(0);

  const read = useCallback(async () => {
    if (lock.current || !mounted.current || document.visibilityState === "hidden" || !navigator.onLine) return;
    const owner = generation.current;
    lock.current = true; lastStartedAt.current = Date.now();
    setLoading(true); setNotice("");
    const controller = new AbortController(); abort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 175_000);
    try {
      const response = await fetch(`/api/china-order-manager/reentry-shadow?targetMonth=${encodeURIComponent(targetMonth)}`, {
        method: "GET", headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal,
      });
      const payload = await response.json() as { report?: ReentryShadowReport };
      const next = payload.report;
      const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
      const nullableCount = (value: unknown) => value === null || count(value);
      if (![200, 503].includes(response.status) || !next || next.mode !== "SHADOW_READ_ONLY" || next.writesEnabled !== false ||
          next.actualPurchaseExecuted !== false || next.approvalGranted !== false || next.targetCycleMonth !== targetMonth ||
          !["READY_SHADOW", "REVIEW_SHADOW", "BLOCKED"].includes(next.state) || !Array.isArray(next.rows) ||
          !Array.isArray(next.blockers) || !Array.isArray(next.warnings) || !next.summary ||
          ![next.summary.exactCount, next.summary.candidateCount, next.summary.reviewCount].every(count) ||
          typeof next.sourceFingerprint !== "string" || !Number.isFinite(Date.parse(next.generatedAt)) ||
          next.rows.some((row) => row.allocatedQuantity !== 0 || !Array.isArray(row.issues) ||
            ![row.stockQuantity, row.inventoryLowQuantity, row.inventoryHighQuantity, row.openCommitmentQuantity, row.target44Quantity, row.candidateQuantity].every(nullableCount))) throw new Error("INVALID_SHADOW_RESPONSE");
      if (!mounted.current || owner !== generation.current) return;
      setChangeNotice(lastFingerprint.current === null ? "최초 사전 점검 완료" : lastFingerprint.current === next.sourceFingerprint ? "원본 변화 없음 · 최신성을 다시 확인했습니다." : "원본 변화 감지 · 재고·미입고를 반영해 다시 계산했습니다.");
      lastFingerprint.current = next.sourceFingerprint;
      setReport(next); setStale(false); failures.current = next.state === "BLOCKED" ? Math.min(3, failures.current + 1) : 0;
    } catch {
      if (!mounted.current || owner !== generation.current) return;
      failures.current = Math.min(3, failures.current + 1);
      setStale(true); setNotice("최신 조회에 실패했습니다. 아래 이전 기록을 현재 추천으로 사용하지 마세요. 주문·재고 변경은 실행되지 않았습니다.");
    } finally {
      window.clearTimeout(timeout);
      if (abort.current === controller) { abort.current = null; lock.current = false; }
      if (mounted.current && owner === generation.current) setLoading(false);
    }
  }, [targetMonth]);

  useEffect(() => {
    mounted.current = true; generation.current += 1;
    let timer: number | undefined;
    let disposed = false;
    const active = () => document.visibilityState !== "hidden" && navigator.onLine;
    const clear = () => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      clear();
      if (disposed || !mounted.current || !active()) return;
      timer = window.setTimeout(async () => {
        await read();
        schedule();
      }, Math.min(MAX_BACKOFF_MS, POLL_MS * (failures.current + 1)));
    };
    const wake = async () => {
      clear();
      if (disposed || !active()) return;
      if (Date.now() - lastStartedAt.current >= MIN_FOCUS_REFRESH_MS) await read();
      schedule();
    };
    timer = window.setTimeout(() => { void read().finally(schedule); }, 0);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake); window.addEventListener("offline", wake); window.addEventListener("focus", wake);
    return () => {
      disposed = true; mounted.current = false; generation.current += 1; clear(); abort.current?.abort(); abort.current = null; lock.current = false;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake); window.removeEventListener("offline", wake); window.removeEventListener("focus", wake);
    };
  }, [read]);

  const rows = (report?.rows ?? []).filter((row) => !onlyReview || ["DATA_HOLD", "REVIEW", "BASELINE_ACCUMULATING"].includes(row.stage));
  const usable = Boolean(report && !stale && report.state !== "BLOCKED");
  return (
    <section className="space-y-4" aria-label="다음 발주 사전 점검">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">{targetMonth} 발주 사전 점검 · Shadow</h2>
          <button type="button" onClick={() => void read()} disabled={loading} className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">{loading ? "원본 확인 중…" : "읽기 전용 다시 계산"}</button>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-700">현재 시점의 자료로 다음 발주를 연습합니다. 해당 날짜의 미래 재고를 예측한 확정안이 아닙니다. 예산 배분·승인·1688 주문·결제·입고·판매상태 변경은 실행하지 않습니다.</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">화면이 보이고 온라인일 때 5분마다 재계산합니다. 숨김·오프라인에서는 멈추고, 조회 실패 시 최대 15분으로 간격을 늘립니다. 화면을 닫은 뒤 별도 배경 작업은 돌리지 않습니다.</p>
      </div>
      {notice ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 font-bold text-amber-950">{notice}</p> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
        <span>{stale ? "이전 기록 · 현재 판단 보류" : report?.state === "BLOCKED" ? "원본 차단 · 판단 보류" : report ? "사전 점검 결과 · 미승인" : "조회 대기"}</span>
        <span>조회: {stamp(report?.generatedAt ?? null)}</span><span>판매 분석: {stamp(report?.demandAsOf ?? null)}</span>
        {report ? <span>서명: {report.sourceFingerprint.replace("sha256:", "").slice(0, 12)}</span> : null}
      </div>
      {changeNotice && !stale ? <p role="status" className="text-sm text-slate-700">{changeNotice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["정확재고 확인", report ? amount(report.summary.exactCount) : "—"],
          ["발주 후보 · 미승인", usable ? amount(report!.summary.candidateCount) : "—"],
          ["검토 필요", report ? amount(report.summary.reviewCount) : "—"],
          ["확정·배정 예산", "미확정"],
        ].map(([label, value]) => <article key={label} className="rounded-xl border bg-white p-4"><span className="text-xs text-slate-500">{label}</span><strong className="mt-2 block text-xl">{value}</strong></article>)}
      </div>
      {(report?.blockers.length ?? 0) > 0 ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm"><strong>원본 확인 전에는 발주 후보로 확정하지 않습니다.</strong>{report!.blockers.map((value, i) => <p className="mt-2" key={`${value.code}-${i}`}>{value.barcode ? `${value.barcode} · ` : ""}{value.message} <code>{value.code}</code></p>)}</div> : null}
      {report?.warnings.map((value) => <p key={value} className="text-xs text-amber-800">{value}</p>)}
      <div className="rounded-xl border bg-white p-4 text-sm leading-6 text-slate-700">
        <strong>발주일 확인사항</strong> · {report?.budgetMonth ?? "전월"} 매출 마감 후의 예산 상한, 실제 투입현금, 최신 재고·미입고를 정상 V2 화면에서 다시 계산하고 승인합니다. 이 사전 점검은 기존 확정안이나 Draft를 덮어쓰지 않습니다.
      </div>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={onlyReview} onChange={(event) => setOnlyReview(event.target.checked)} />검토·기준점 축적 대상만 보기</label>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[940px] text-left text-xs">
          <thead className="bg-slate-50"><tr>{["B코드 / 상품", "재고 근거", "현재 재고 / 참고 범위", "미입고", "44일 목표", "사전 후보 수량", "상태·확인사항"].map((text) => <th key={text} className="p-3">{text}</th>)}</tr></thead>
          <tbody className="divide-y">{rows.map((row) => <tr key={row.barcode} className={stale ? "opacity-50" : ""}>
            <td className="p-3"><strong>{row.barcode}</strong><div className="mt-1 text-slate-500">{row.productName}</div></td>
            <td className="p-3">{row.inventoryBasis === "EXACT" ? "확정 기준점" : row.inventoryBasis === "ESTIMATED_REFERENCE" ? "추정 · 참고만" : "미확정"}</td>
            <td className="p-3">{row.inventoryBasis === "ESTIMATED_REFERENCE" ? `${amount(row.inventoryLowQuantity)}~${amount(row.inventoryHighQuantity)}` : amount(row.stockQuantity)}</td>
            <td className="p-3">{amount(row.openCommitmentQuantity)}</td><td className="p-3">{amount(row.target44Quantity)}</td>
            <td className="p-3 font-bold">{usable ? amount(row.candidateQuantity) : "판단 보류"}</td>
            <td className="max-w-sm p-3"><strong>{stage(row)}</strong>{row.issues.map((value) => <p key={value.code} className="mt-1 leading-5 text-slate-500">{value.message}</p>)}{row.manualOpenDifferenceQuantity > 0 ? <p className="mt-1 text-amber-800">수동 추가 미입고 {row.manualOpenDifferenceQuantity}개도 중복 발주 방지에 포함</p> : null}</td>
          </tr>)}</tbody>
        </table>
        {!rows.length ? <p className="p-6 text-center text-sm text-slate-500">{loading ? "원본을 읽고 있습니다. 아직 수량을 확정하지 않았습니다." : report ? "현재 조건에 해당하는 표시 항목이 없습니다. 원본 차단 여부를 먼저 확인하세요." : "조회 전입니다. 미입고·필요 수량을 0으로 간주하지 않습니다."}</p> : null}
      </div>
    </section>
  );
}
