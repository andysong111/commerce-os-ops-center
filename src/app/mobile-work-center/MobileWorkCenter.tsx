"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { canChooseDryRun, isMobileRequestId, MOBILE_ACTIONS, normalizeWorkRequest, REQUEST_MAX_AGE_MS, UNPAID_ORDER_PHRASE, type MobileAction } from "../../../shared/mobile-work-center.mjs";
import type { PublicWorkQueue } from "../../../shared/mobile-work-queue.mjs";

type Draft = { draftId: string; cycleStartDate: string; lineCount: number };
const API = "/api/mobile-work-center";
const PENDING_KEY = "commerce-os-mobile-work-center:pending-request";
const ACTIONS = Object.values(MOBILE_ACTIONS).filter(({ kind }) => kind !== "diagnostic");
const GROUPS = [...new Set(ACTIONS.map(({ group }) => group))];
const STATUS: Record<string, string> = {
  queued: "PC에 전달 중", running: "PC에서 실행 중", completed: "완료", failed: "시작 실패",
  needs_pc: "PC 확인 필요", ambiguous: "결과 확인 필요", acknowledged: "결과 확인 처리됨", expired: "요청 만료",
};
const MESSAGES: Record<string, string> = {
  PC_READY: "휴대폰 → PC → 업무센터 연결을 확인했습니다.",
  LOGIN_REQUIRED: "PC에서 샵플링 전용 Chrome에 로그인한 뒤 다시 요청하세요.",
  CHECK_PC: "PC 업무센터의 실행 기록에서 상세 내용을 확인하세요.",
  RESULT_UNCERTAIN: "실제 반영 여부를 PC와 원래 서비스에서 확인하세요. 확인할 때까지 새 요청을 받지 않습니다.",
  MISSING_PROOF: "완료 기록을 확인할 수 없습니다. PC 업무센터나 원래 서비스의 결과를 확인하세요.",
  PARTIAL_RESULT: "일부 항목은 PC에서 확인해야 합니다.",
  EXTENSION_UNAVAILABLE: "PC의 전용 Chrome에 업무센터 탭 하나와 온돌패스 확장프로그램이 필요합니다.",
  REJECTED_BY_PC: "PC에서 실행 조건을 충족하지 못했습니다. 기존 업무센터에서 해당 버튼의 상태를 확인하세요.",
  AGENT_BUSY: "PC에서 다른 작업이 실행 중입니다.",
};
const ERRORS: Record<string, string> = {
  LOGIN_REQUIRED: "운영 계정으로 다시 로그인하세요.",
  FORBIDDEN: "이 계정에는 실행 권한이 없습니다.",
  NOT_CONFIGURED: "모바일 업무센터 설정을 확인해 주세요.",
  QUEUE_UNAVAILABLE: "요청 저장소에 연결하지 못했습니다.",
  QUEUE_CONFLICT: "요청이 겹쳤습니다. 갱신된 실행 상태를 확인하세요.",
  PC_OFFLINE: "PC 업무센터가 연결되지 않았습니다.",
  PC_BUSY: "PC에서 다른 작업을 처리 중입니다.",
  JOB_ACTIVE: "이미 처리 중이거나 결과 확인이 필요한 요청이 있습니다.",
  ACTION_UNAVAILABLE: "PC에서 이 작업의 실행 조건을 확인하세요.",
  REQUEST_EXPIRED: "요청 시간이 지나 실행하지 않았습니다.",
};
const inputStyle = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900";
const buttonStyle = "min-h-11 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const time = (value: number) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value));

async function send<T>(query = "", payload?: object): Promise<T> {
  const response = await fetch(`${API}${query}`, {
    cache: "no-store",
    ...(payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(ERRORS[body.code] || "업무센터 요청을 확인하지 못했습니다.");
  return body;
}

function WorkForm({ action, disabled, close, submit }: {
  action: MobileAction; disabled: boolean; close: () => void;
  submit: (action: MobileAction, values: Record<string, unknown>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [draftError, setDraftError] = useState("");
  const [runMode, setRunMode] = useState<"check" | "execute">(canChooseDryRun(action) || action.readOnly ? "check" : "execute");
  const [confirmed, setConfirmed] = useState(false);
  const [phrase, setPhrase] = useState("");
  const needsDraft = action.input === "draft" || action.input === "order";
  useEffect(() => {
    if (!needsDraft) return;
    let live = true;
    void send<{ drafts: Draft[] }>("?drafts=1").then(
      ({ drafts }) => { if (live) setDrafts(drafts); },
      () => { if (live) setDraftError("발주초안을 불러오지 못했습니다. PC에서 원장을 확인하세요."); },
    );
    return () => { live = false; };
  }, [needsDraft]);

  function forward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawList = (name: string) => String(form.get(name) || "").trim().split(/[\s,]+/).filter(Boolean);
    void submit(action, {
      execute: runMode === "execute",
      confirmed,
      ...(needsDraft ? { draftId: String(form.get("draftId") || "") } : {}),
      ...(action.input === "order" ? { confirmation: phrase } : {}),
      ...(action.input === "invoices" ? { invoiceNumbers: rawList("invoices"), inventoryShortageInvoiceNumbers: rawList("shortages") } : {}),
    });
  }

  return (
    <form onSubmit={forward} className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      {needsDraft && (
        <label className="block text-sm font-medium text-slate-800">
          발주초안
          <select className={inputStyle} name="draftId" required defaultValue="" disabled={!drafts?.length}>
            <option value="">{draftError || (drafts === null ? "불러오는 중…" : drafts.length ? "실행할 차시를 선택하세요" : "선택 가능한 초안 없음")}</option>
            {drafts?.map((draft) => <option key={draft.draftId} value={draft.draftId}>{draft.cycleStartDate} · {draft.lineCount}품목 · {draft.draftId.slice(-5)}</option>)}
          </select>
        </label>
      )}
      {action.input === "invoices" && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">품절 송장번호<textarea name="invoices" rows={2} inputMode="numeric" placeholder="12자리, 줄바꿈 또는 쉼표로 구분" className={inputStyle} /></label>
          <label className="block text-sm font-medium">재고부족 송장번호<textarea name="shortages" rows={2} inputMode="numeric" placeholder="12자리, 두 칸 합계 최대 50개" className={inputStyle} /></label>
        </div>
      )}
      {canChooseDryRun(action) && (
        <label className="block text-sm font-medium">실행 방식
          <select className={inputStyle} value={runMode} onChange={(event) => { setRunMode(event.target.value === "execute" ? "execute" : "check"); setConfirmed(false); }}>
            <option value="check">점검 실행</option>
            <option value="execute">실제 반영</option>
          </select>
        </label>
      )}
      {runMode === "execute" && (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800">
          <input className="h-5 w-5 accent-emerald-800" type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          {action.id === "domeggook-withdrawal-execute" ? "4개 계정의 출금 가능 잔액 전액을 실제 신청합니다." :
            action.id === "1688-unpaid-order" ? "선택한 초안의 1688 미결제 주문을 실제 생성합니다." :
            action.id === "ondolpass-application" ? "PC에 열려 있는 온돌패스 신청서에 선택 초안의 데이터를 채웁니다." :
            "위 업무를 PC에서 실제로 실행합니다."}
        </label>
      )}
      {action.input === "order" && <label className="block text-sm font-medium">확인 문구 ‘{UNPAID_ORDER_PHRASE}’
        <input className={inputStyle} value={phrase} onChange={(event) => setPhrase(event.target.value)} required autoComplete="off" />
      </label>}
      {action.id === "picking-list" && <p className="text-xs text-slate-600">PC 설정에 따라 모바일 목록과 내 카카오톡에 결과를 보냅니다.</p>}
      {action.id === "1688-cart-staging" && <p className="text-xs text-slate-600">첫 실제 실행은 기존 업무센터 기준에 따라 검증용 1종만 처리할 수 있습니다.</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={disabled || (needsDraft && !drafts?.length) || (runMode === "execute" && !confirmed) || (action.input === "order" && phrase !== UNPAID_ORDER_PHRASE)}
          className={`${buttonStyle} flex-1 bg-emerald-800 text-white`}>{disabled ? "요청 처리 중…" : "PC에 실행 요청"}</button>
        <button type="button" onClick={close} className={`${buttonStyle} border border-slate-300 bg-white text-slate-700`}>닫기</button>
      </div>
    </form>
  );
}

export function MobileWorkCenter() {
  const [snapshot, setSnapshot] = useState<PublicWorkQueue | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const requestBusy = useRef(false);
  const revision = useRef(0);
  const latest = snapshot?.jobs[0];
  const active = latest && ["queued", "running", "ambiguous"].includes(latest.status);
  const connected = snapshot?.agent.connected === true;
  const locked = sending || reconciling || !connected || active || snapshot?.agent.busy;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const snapshotRevision = revision.current;
      try {
        const value = await send<PublicWorkQueue>();
        if (live && !requestBusy.current && revision.current === snapshotRevision) {
          let pending: { id?: string; issuedAt?: number } = {};
          try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "{}"); } catch { /* Storage can be disabled. */ }
          const uncertain = isMobileRequestId(pending?.id) && typeof pending.issuedAt === "number"
            && Date.now() < pending.issuedAt + REQUEST_MAX_AGE_MS + 30_000 && !value.jobs.some(({ id }) => id === pending.id);
          if (!uncertain) {
            try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Storage can be disabled. */ }
          }
          setReconciling(Boolean(uncertain));
          setSnapshot(value);
        }
        if (live) timer = setTimeout(poll, document.hidden ? 45_000 : value.jobs[0]?.status === "running" || value.jobs[0]?.status === "queued" ? 4_000 : 12_000);
      } catch (problem) {
        if (!live) return;
        if (revision.current === snapshotRevision) {
          setSnapshot(null);
          setError(problem instanceof Error ? problem.message : "업무센터 연결을 확인하지 못했습니다.");
        }
        timer = setTimeout(poll, 15_000);
      }
    }
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  async function submit(action: MobileAction, values: Record<string, unknown>) {
    if (requestBusy.current || locked) return;
    const command = { id: crypto.randomUUID(), issuedAt: Date.now(), actionId: action.id, ...values };
    if (!normalizeWorkRequest(command)) {
      setError("선택한 초안과 확인 항목을 확인하세요. 송장번호는 두 칸에 중복 없이 최대 50개까지 입력할 수 있습니다.");
      return;
    }
    requestBusy.current = true;
    revision.current += 1;
    setSending(true);
    setError("");
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: command.id, issuedAt: command.issuedAt })); } catch { /* Storage can be disabled. */ }
    try {
      const body = await send<PublicWorkQueue>("", { type: "enqueue", command });
      setSnapshot(body);
      setSelected(null);
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Storage can be disabled. */ }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "실행 결과를 확인하지 못했습니다.");
      // The next status pull reconciles a dropped reply before any new request.
      setSnapshot(null);
    } finally {
      requestBusy.current = false;
      setSending(false);
    }
  }

  async function acknowledge() {
    if (!latest || latest.status !== "ambiguous" || requestBusy.current) return;
    if (!window.confirm("PC와 원래 서비스의 반영 결과를 확인했나요? 확인을 기록하면 새 요청을 보낼 수 있습니다.")) return;
    requestBusy.current = true;
    revision.current += 1;
    setSending(true);
    try {
      setSnapshot(await send<PublicWorkQueue>("", { type: "acknowledge", id: latest.id, confirmed: true }));
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "확인 상태를 저장하지 못했습니다.");
    } finally {
      requestBusy.current = false;
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="PC 연결 상태">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className={`text-sm font-bold ${connected ? "text-emerald-800" : "text-slate-700"}`}>
              {snapshot ? connected ? "Windows PC 연결됨" : "Windows PC 연결 대기" : "PC 연결 확인 중"}
            </p>
            {snapshot?.agent.lastSeenAt && <p className="mt-1 text-xs text-slate-500">마지막 응답 {time(snapshot.agent.lastSeenAt)}</p>}
          </div>
          <button className={`${buttonStyle} border border-slate-300 text-slate-800`} disabled={Boolean(locked)}
            onClick={() => void submit(MOBILE_ACTIONS["connection-check"], { execute: false })}>PC 연결 시험</button>
        </div>
        {latest && <div className="mt-3 border-t border-slate-200 pt-3 text-sm" aria-live="polite">
          <p className="font-semibold">{MOBILE_ACTIONS[latest.actionId]?.label} · {STATUS[latest.status] ?? latest.status}</p>
          {latest.code && MESSAGES[latest.code] && <p className="mt-1 leading-6 text-slate-600">{MESSAGES[latest.code]}</p>}
          {latest.connectionLost && <p className="mt-1 text-slate-700">PC의 응답이 끊겼습니다. PC가 다시 연결되면 결과를 확인합니다.</p>}
          {latest.status === "ambiguous" && <button className={`${buttonStyle} mt-2 border border-slate-300`} disabled={sending} onClick={() => void acknowledge()}>결과 확인 완료</button>}
        </div>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {reconciling && <p className="mt-3 text-sm text-slate-700">이전 요청이 전달됐는지 확인 중입니다. 이 동안 새 요청을 잠급니다.</p>}
      </section>

      <nav aria-label="업무 분류" className="flex flex-wrap gap-2">
        {GROUPS.map((group, index) => <a key={group} href={`#group-${index}`} className={`${buttonStyle} inline-flex items-center border border-slate-300 bg-white text-slate-800`}>{group}</a>)}
      </nav>
      {GROUPS.map((group, index) => (
        <section id={`group-${index}`} key={group} className="scroll-mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-950">{group}</h2>
            {group === "도매꾹" && <Link href="/domeggook-period-extension" prefetch={false} target="_blank" rel="noreferrer" className="text-sm font-semibold text-emerald-800 underline underline-offset-2">기간연장 전체 이력 ↗</Link>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.filter((action) => action.group === group).map((action) => {
              const available = snapshot?.agent.actions.includes(action.id) ?? false;
              return <div key={action.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <button type="button" className={`${buttonStyle} w-full text-left text-slate-950 enabled:hover:bg-emerald-50`}
                  aria-expanded={selected === action.id} disabled={Boolean(locked) || !available} onClick={() => setSelected(selected === action.id ? null : action.id)}>
                  {action.label}
                </button>
                {connected && !available && <p className="px-3 text-xs text-slate-600">{action.kind === "extension" ? "PC의 전용 Chrome 업무센터 탭 필요" : "PC의 해당 기능 연결 확인 필요"}</p>}
                {selected === action.id && <WorkForm action={action} disabled={Boolean(locked) || !available} close={() => setSelected(null)} submit={submit} />}
              </div>;
            })}
          </div>
        </section>
      ))}
      {Boolean(snapshot?.jobs.length) && <section aria-label="최근 휴대폰 실행 기록" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-bold">최근 휴대폰 실행 기록</h2>
        <ol className="mt-2 list-none divide-y divide-slate-100">
          {snapshot?.jobs.slice(0, 8).map((job) => <li className="flex flex-wrap justify-between gap-1 py-2 text-sm" key={job.id}>
            <span>{MOBILE_ACTIONS[job.actionId]?.label} · {STATUS[job.status] ?? job.status}</span><time dateTime={new Date(job.updatedAt).toISOString()} className="text-slate-500">{time(job.updatedAt)}</time>
          </li>)}
        </ol>
      </section>}
    </div>
  );
}
