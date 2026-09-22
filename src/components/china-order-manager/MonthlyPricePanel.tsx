"use client";

import { useEffect, useRef, useState } from "react";
import { MONTHLY_PRICE_BRIDGE, MONTHLY_PRICE_POLICY, MONTHLY_PRICE_EXTENSION_VERSION } from "@/lib/monthlyPriceContract";
import type { MonthlyPriceCandidate, MonthlyPricePlan } from "@/lib/monthlyPriceCore";

type Transmission = { token: string; fingerprint: string; claimedAt: string; result?: string };
type Item = { id: string; goodsKey: string; state: string; candidate: MonthlyPriceCandidate; plan: MonthlyPricePlan | null; writeIndex: number; errorCode: string | null; transmission: Transmission | null };
type Snapshot = { run: { id: string; month: string; policy: string; warnings: string[] } | null; items: Item[] };
type BridgeReply = { ok: boolean; error?: string; version?: string; observation?: unknown; report?: Record<string, unknown> };
const endpoint = "/api/china-order-manager/monthly-price";
const STATE: Record<string, string> = { QUEUED: "대기", PREPARED: "가격 반영 중", WRITING: "반영 결과 확인 필요", VERIFY_PENDING: "가격 재조회 중", VERIFIED: "샵플링 반영 확인", RESENDING: "쇼핑몰 수정전송 중", TRANSMITTED: "전송 종료 · 마켓 확인 대기", HELD: "현재가 유지 · 인하 보호", BLOCKED: "변경 제외 · 확인 필요", UNCERTAIN: "불확실 · 재전송 차단" };
function describe(code: string) {
  if (/EXTENSION|HISTORY_MISSING/.test(code)) return `A21 확장프로그램 ${MONTHLY_PRICE_EXTENSION_VERSION} 설치·새로고침이 필요하거나 이전 전송기록을 확인해야 합니다.`;
  if (/SOURCE_CHANGED|CLOSED_DRAFT_CHANGED/.test(code)) return "입고·원가 근거가 실행 시작 후 변경되었습니다. 이전 변경 결과를 확인한 뒤 새 기준으로 진행해야 합니다.";
  if (/RECEIPT|FINAL_COST|CONFIRMED_COST|CAPTURED_COST/.test(code)) return "입고확정 수량과 최종 원가 근거를 대조하지 못했습니다. 가격을 임의로 계산하지 않았습니다.";
  if (/GROUP|MAPPING|SCOPE|UNITS|OPTION/.test(code)) return "가격그룹·상품/옵션 연결·묶음 수량을 안전하게 확정하지 못해 변경을 제외했습니다.";
  if (/BUSY/.test(code)) return "다른 창 또는 다른 월에서 같은 상품을 처리 중입니다. 중복 실행하지 않았습니다.";
  if (/READBACK|UNCERTAIN|MARKET_RESULT/.test(code)) return "실제 반영 결과를 확정하지 못했습니다. 완료 처리하거나 무조건 다시 전송하지 않습니다.";
  if (/LOGIN|DOM|BROWSER|CURRENT_PRICE|MALL/.test(code)) return "샵플링 로그인 또는 현재 가격행을 확인하지 못했습니다. 가격 변경을 보호했습니다.";
  return "자동 처리를 멈췄습니다. 아래 확인 코드를 확인하세요.";
}
export function monthlyPriceBridge(command: string, payload: Record<string, unknown> = {}, timeoutMs = 40000): Promise<BridgeReply> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { window.removeEventListener("message", receive); window.clearTimeout(timer); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== MONTHLY_PRICE_BRIDGE || event.data.direction !== "response" || event.data.requestId !== requestId) return;
      cleanup();
      const response = event.data.response as BridgeReply;
      if (!response?.ok) reject(new Error(response?.error || "MONTHLY_PRICE_EXTENSION_FAILED")); else resolve(response);
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("MONTHLY_PRICE_EXTENSION_NOT_CONNECTED")); }, timeoutMs);
    window.addEventListener("message", receive);
    window.postMessage({ channel: MONTHLY_PRICE_BRIDGE, direction: "request", requestId, command, payload }, location.origin);
  });
}
async function api(payload: Record<string, unknown>) {
  const result = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, policy: MONTHLY_PRICE_POLICY }), signal: AbortSignal.timeout(65000), cache: "no-store" });
  const data = await result.json();
  if (!result.ok || !data.ok) throw new Error(data.code || "MONTHLY_PRICE_REQUEST_FAILED");
  return data;
}
export function MonthlyPricePanel({ month, ready }: { month: string; ready: boolean }) {
  return <MonthlyPricePanelForMonth key={month} month={month} ready={ready} />;
}
function MonthlyPricePanelForMonth({ month, ready }: { month: string; ready: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ run: null, items: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const generation = useRef(0), running = useRef(false);
  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    running.current = false;
    void fetch(`${endpoint}?month=${encodeURIComponent(month)}`, { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (generation.current === current && data.ok) setSnapshot(data);
    }).catch(() => {});
    return () => { generation.current += 1; running.current = false; };
  }, [month]);
  function update(item: Item) { setSnapshot((value) => ({ ...value, items: value.items.map((old) => old.id === item.id ? item : old) })); }
  async function execute() {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    const current = generation.current;
    const active = () => running.current && generation.current === current;
    try {
      setProgress("확장프로그램 연결 확인");
      const bridge = await monthlyPriceBridge("PING", {}, 3000);
      if (bridge.version !== MONTHLY_PRICE_EXTENSION_VERSION) throw new Error("MONTHLY_PRICE_EXTENSION_UPDATE_REQUIRED");
      if (!active()) return;
      setProgress("입고 원장·실제 원가·구재고 인하 보호 확인");
      const data = await api({ action: "start", month }) as Snapshot;
      if (!active()) return;
      setSnapshot(data);
      if (!data.run) throw new Error("MONTHLY_PRICE_RUN_REQUIRED");
      const runId = data.run.id;
      for (const initial of data.items) {
        if (!active()) break;
        let item = initial;
        const step = async (action: string, extra: Record<string, unknown> = {}, read = true) => {
          const observation = read ? (await monthlyPriceBridge("READ", { goodsKey: item.goodsKey })).observation : undefined;
          if (!active()) return { ...item, duplicate: undefined as boolean | undefined };
          const result = await api({ action, itemId: item.id, runId, observation, ...extra });
          item = { ...item, ...result.item };
          if (generation.current === current) update(item);
          return { ...item, duplicate: result.item.duplicate };
        };
        if (item.state === "BLOCKED" || item.state === "HELD" || item.state === "TRANSMITTED") continue;
        setProgress(`${item.candidate.productName} · ${item.goodsKey}`);
        try {
          if (item.state === "QUEUED") await step("prepare");
          while (active() && item.state === "PREPARED") await step("write");
          if (!active()) break;
          if (["VERIFY_PENDING", "UNCERTAIN", "WRITING"].includes(item.state)) await step("verify");
          if (!active()) break;
          if (item.state === "VERIFIED" || item.state === "RESENDING") {
            const claim = await step("resendClaim", {}, item.state === "VERIFIED");
            if (!active() || !item.transmission) break;
            const transmission = item.transmission;
            // An already-claimed transmission is resumed by token, never created
            // again merely because this page refreshed or a response was lost.
            let reply = await monthlyPriceBridge("START", { month, runId, itemId: item.id, token: transmission.token, fingerprint: transmission.fingerprint, newClaim: claim.duplicate === false });
            for (let polls = 0; active() && polls < 1000; polls += 1) {
              const report = reply.report;
              if (!report) throw new Error("MONTHLY_PRICE_EXTENSION_REPORT_REQUIRED");
              if (report.state !== "RUNNING" && report.state !== "STARTING") { await step("resendReport", { report }, false); break; }
              setProgress(`${item.candidate.productName} · 쇼핑몰 수정전송 결과 대기`);
              await new Promise((resolve) => setTimeout(resolve, 2000));
              if (!active()) break;
              reply = await monthlyPriceBridge("STATUS", { token: transmission.token, fingerprint: transmission.fingerprint, goodsKey: item.goodsKey });
            }
          }
        } catch (itemError) {
          const code = itemError instanceof Error ? itemError.message : "MONTHLY_PRICE_ITEM_FAILED";
          if (generation.current === current) { setError(code); setProgress(`${item.goodsKey} · ${describe(code)}`); }
          // Connection loss can invalidate later observations too; require an
          // explicit retry instead of continuing a possibly unobserved job.
          break;
        }
      }
      if (active()) setProgress("자동 처리 종료 · 보호·확인 필요 항목과 마켓 반영 대기를 확인하세요.");
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : "MONTHLY_PRICE_FAILED"); }
    finally { if (generation.current === current) { running.current = false; setBusy(false); } }
  }
  const count = (states: string[]) => snapshot.items.filter((item) => states.includes(item.state)).length;
  return <section id="monthly-price" className="rounded-xl border border-cyan-700 bg-slate-900 p-3" data-testid="monthly-price-panel">
    <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-xs font-black text-slate-950">6</span><h3 className="font-black text-white">입고 후 가격조정</h3></div>
    <p className="mt-2 text-xs leading-5 text-slate-300">{month} 입고상품만 처리합니다. 구재고·혼재 원가는 현재가를 보호하고, 검증된 원가 기준 인상만 실행합니다. 재고수량·과거 원가는 변경하지 않습니다. 옵션별 최종 판매가는 각 B코드의 보호원가로 재계산하며 현재 최종가격보다 낮추지 않습니다.</p>
    <button type="button" onClick={() => void execute()} disabled={!ready || busy} className="mt-3 w-full rounded-lg bg-cyan-300 px-3 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "가격조정 처리 중…" : snapshot.run ? "가격조정 실행 · 미완료 확인" : "가격조정 실행"}</button>
    {!ready && <p className="mt-2 text-xs text-amber-200">입고확정과 배송대행 실제비용 저장 후 실행할 수 있습니다. 실제 원가 근거는 실행 시 다시 검증합니다.</p>}
    {busy && <button type="button" onClick={() => { running.current = false; setProgress("다음 작업 중지 요청 · 이미 전송한 작업은 결과 확인이 필요합니다."); }} className="mt-2 text-xs underline text-slate-300">이후 작업 중지</button>}
    <div role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-cyan-100">{progress}</div>
    {snapshot.run && <p className="mt-2 text-xs leading-5 text-slate-300">대상 {snapshot.items.length} · 샵플링 반영 확인 {count(["VERIFIED", "RESENDING", "TRANSMITTED"])} · 현재가 보호 {count(["HELD"])} · 확인 필요 {count(["BLOCKED", "UNCERTAIN", "WRITING"])} · 전송 종료 {count(["TRANSMITTED"])}</p>}
    <p className="mt-2 text-[11px] leading-4 text-slate-400">전송창 종료와 각 쇼핑몰의 최종 반영 확인은 다릅니다. 전송 종료 항목은 ‘마켓 확인 대기’로 남습니다. 창을 닫으면 자동 진행이 멈추며, 다시 클릭하면 저장된 단계부터 확인합니다.</p>
    {error && <div role="alert" className="mt-3 rounded-lg border border-amber-700 bg-amber-950 p-2 text-xs text-amber-100">{describe(error)}<code className="mt-1 block break-all text-[10px]">{error}</code></div>}
    <a href="/api/shopling-a21-price-option-resend/download" className="mt-3 inline-block text-xs text-cyan-200 underline">A21 확장프로그램 {MONTHLY_PRICE_EXTENSION_VERSION} 받기</a>
    {snapshot.run?.warnings?.length ? <details className="mt-2 text-xs text-amber-200"><summary>원가 근거 확인 필요 ({snapshot.run.warnings.length})</summary>{snapshot.run.warnings.map((warning) => <p className="mt-1 break-all" key={warning}>{warning}</p>)}</details> : null}
    {snapshot.items.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer font-bold text-slate-200">상품별 결과·제외 사유</summary><div className="mt-2 max-h-80 space-y-2 overflow-auto">{snapshot.items.map((item) => <div key={item.id} className="rounded border border-slate-700 p-2"><b>{item.goodsKey} · {item.candidate.productName}</b><p>{STATE[item.state] || item.state}</p>{item.errorCode && <><p className="text-amber-200">{describe(item.errorCode)}</p><code className="break-all text-[10px] text-slate-400">{item.errorCode}</code></>}{item.plan && <p className="text-slate-400">가격 변경 {item.plan.writes.length}행 · 옵션 변경 {item.plan.optionChangeCount}개 · 인하 보호 {item.plan.protectedDecreaseCount}행</p>}</div>)}</div></details>}
  </section>;
}
