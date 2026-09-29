"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Readiness = {
  state: "READY_FOR_COUNT" | "WRITE_GATE_OFF" | "BLOCKED";
  message: string;
  barcode: string | null;
  name: string | null;
  modelNo: string | null;
  planFingerprint: string | null;
  sourceFingerprint: string | null;
  inventoryGuard: string | null;
  currentInventoryQuantity: number | null;
  inventoryVerification: string | null;
  inventoryBaselineKind: string | null;
  productMasterWriteEnabled: boolean;
  maxWriteRows: 1;
};

type ApiBody = {
  ok?: boolean;
  readiness?: Readiness;
  result?: unknown;
  message?: string;
  error?: string;
};

export default function Stage8StocktakeCanaryPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("첫 실사 canary의 최신 guard를 확인하고 있습니다.");
  const [failed, setFailed] = useState(false);

  async function refresh() {
    try {
      const response = await fetch("/api/stage8/stocktake-canary", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ApiBody;
      if (!response.ok || body.ok !== true || !body.readiness) {
        throw new Error(body.message || body.error || "STOCKTAKE_CANARY_READINESS_FAILED");
      }
      setFailed(false);
      setReadiness(body.readiness);
      setMessage(body.readiness.message);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "실사 canary 상태를 읽지 못했습니다.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function apply() {
    if (!readiness?.barcode || !readiness.planFingerprint || !readiness.inventoryGuard) return;
    if (!/^\d+$/.test(quantity)) {
      setFailed(true);
      setMessage("창고에서 직접 센 실물 수량을 0 이상의 정수로 입력하세요.");
      return;
    }
    setBusy(true);
    setFailed(false);
    setMessage("정확히 1건 STOCKTAKE canary를 저장하고 persisted readback을 확인하고 있습니다.");
    try {
      const response = await fetch("/api/stage8/stocktake-canary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          physicalQuantity: Number(quantity),
          expectedPlanFingerprint: readiness.planFingerprint,
          expectedInventoryGuard: readiness.inventoryGuard,
          confirmation: "APPLY_ONE_STOCKTAKE_CANARY",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiBody;
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || body.error || "STOCKTAKE_CANARY_APPLY_FAILED");
      }
      setMessage("1건 STOCKTAKE canary 저장과 persisted readback이 완료됐습니다. 다음 후보는 자동으로 다시 계산됩니다.");
      setQuantity("");
      await refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "실사 canary 적용에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const canApply =
    readiness?.state === "READY_FOR_COUNT" &&
    readiness.productMasterWriteEnabled &&
    /^\d+$/.test(quantity) &&
    !busy;

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-emerald-700">
              COMMERCE OS · STAGE 8 · ONE ROW STOCKTAKE CANARY
            </p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">선택형 재고보정 1건 적용</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              일반 발주사이클은 실사 없이 추정재고로 진행합니다. 이 화면은 재고 불일치를 교정해야 할 때만 실제 수량 1개를 입력하며, 현재 plan fingerprint와 Product Master inventory guard가 그대로일 때만 정확히 1개 STOCKTAKE를 저장합니다. 발주·가격·입고원가 write는 열리지 않습니다.
            </p>
          </div>
          <Link
            href="/stage8-stocktake-intervention-plan"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            선택형 보정 후보
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={readiness?.state ?? "LOADING"} />
        <Metric label="첫 canary" value={readiness?.barcode ?? "-"} />
        <Metric label="현재 재고표시" value={String(readiness?.currentInventoryQuantity ?? 0)} />
        <Metric label="재고 검증" value={readiness?.inventoryVerification ?? "-"} />
        <Metric label="최대 write" value="1 SKU" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">사람이 해야 하는 입력 1개</h2>
        <p className="mt-2 text-sm text-slate-600">
          {readiness?.barcode ?? "-"} · {readiness?.name ?? "후보 확인 중"}
          {readiness?.modelNo ? ` · ${readiness.modelNo}` : ""}
        </p>
        <label className="mt-4 block text-sm font-bold text-slate-700" htmlFor="physicalQuantity">
          창고에서 직접 센 실물 수량
        </label>
        <input
          id="physicalQuantity"
          inputMode="numeric"
          pattern="[0-9]*"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ""))}
          placeholder="예: 37"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-lg font-black text-slate-950 outline-none focus:border-emerald-600"
        />
        <button
          type="button"
          disabled={!canApply}
          onClick={() => void apply()}
          className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "1건 저장·재검증 중…" : "이 수량으로 STOCKTAKE canary 1건 적용"}
        </button>
        <p className={`mt-4 rounded-xl border p-4 text-sm font-semibold ${failed ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          {message}
        </p>
        {readiness?.state === "WRITE_GATE_OFF" ? (
          <p className="mt-3 text-xs font-semibold text-amber-700">
            Product Master write 환경 게이트가 아직 OFF라 버튼은 잠겨 있습니다. 수량을 받기 전에 시스템 쪽 게이트를 먼저 준비해야 합니다.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500 shadow-sm">
        <p>Plan fingerprint · {readiness?.planFingerprint ?? "-"}</p>
        <p className="mt-1">Inventory guard · {readiness?.inventoryGuard ?? "-"}</p>
        <p className="mt-1">STOCKTAKE 1건 외 write · 발주 false · 가격 false · 입고원가 false</p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-words text-lg text-slate-950">{value}</strong>
    </article>
  );
}
