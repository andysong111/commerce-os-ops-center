"use client";

import { useEffect, useState } from "react";

type AccountSettings = {
  accountId: string;
  scheduleTime: string;
  extensionDays: number;
  liveExecution: boolean;
  enabled: boolean;
  debugPort: number;
  updatedAt: string | null;
};

type Settings = { accounts: AccountSettings[]; updatedAt: string | null };
type TaskState = { accountId: string; installed: boolean; state: string | null; nextRunTime: string | null };
type ReceiptState = { accountId: string; receipt: Record<string, unknown> | null };
type State = { settings: Settings; tasks: TaskState[]; receipts: ReceiptState[]; credentials: { accountId: string; saved: boolean }[]; localWindows: boolean };

const initialSettings: Settings = {
  accounts: [{
    accountId: "everysale999",
    scheduleTime: "00:10",
    extensionDays: 90,
    liveExecution: true,
    enabled: true,
    debugPort: 0,
    updatedAt: null,
  }],
  updatedAt: null,
};

function nextTime(index: number) {
  const totalMinutes = 10 + index * 5;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

export function DomeggookPeriodExtensionCard() {
  const [state, setState] = useState<State | null>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("로컬 실행 상태를 확인하는 중입니다.");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/local/domeggook-period-extension", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!response.ok || body.ok !== true) throw new Error(body.message || "상태를 불러오지 못했습니다.");
        if (cancelled) return;
        setState(body);
        setSettings(body.settings);
        setMessage("계정별 예약과 최근 실행 상태를 불러왔습니다.");
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "상태 확인 실패");
      });
    return () => { cancelled = true; };
  }, []);

  function updateAccount(index: number, patch: Partial<AccountSettings>) {
    setSettings((current) => ({
      ...current,
      accounts: current.accounts.map((account, accountIndex) => accountIndex === index ? { ...account, ...patch } : account),
    }));
  }

  function addAccount() {
    setSettings((current) => ({
      ...current,
      accounts: [...current.accounts, {
        accountId: "",
        scheduleTime: nextTime(current.accounts.length),
        extensionDays: 90,
        liveExecution: true,
        enabled: true,
        debugPort: 0,
        updatedAt: null,
      }],
    }));
  }

  function removeAccount(index: number) {
    if (settings.accounts.length === 1) {
      setMessage("최소 1개의 계정이 필요합니다.");
      return;
    }
    const accountId = settings.accounts[index]?.accountId || "새 계정";
    if (!window.confirm(`${accountId} 설정을 목록에서 제거할까요? 저장 및 예약 적용 전에는 Windows 예약이 바뀌지 않습니다.`)) return;
    setSettings((current) => ({ ...current, accounts: current.accounts.filter((_, accountIndex) => accountIndex !== index) }));
  }

  async function run(action: string, accountId?: string) {
    const selected = settings.accounts.find((account) => account.accountId === accountId);
    if (action === "execute-now" && selected && !window.confirm(`${selected.accountId}의 기간종료 상품을 실제로 ${selected.extensionDays}일 연장합니다. 계속할까요?`)) return;
    const busyKey = `${action}:${accountId || "all"}`;
    setBusy(busyKey);
    setMessage("처리 중입니다.");
    try {
      const response = await fetch("/api/local/domeggook-period-extension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId, settings, passwords }),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(body.message || "작업에 실패했습니다.");
      setState(body);
      setSettings(body.settings);
      setPasswords({});
      setMessage(action === "install" ? "모든 활성 계정의 설정 저장과 예약 동기화를 완료했습니다." : "작업을 완료했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작업에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">다계정 로컬 자동화</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">도매꾹 상품 기간연장</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            계정마다 전용 Chrome 프로필·예약·실행기록을 분리합니다. 비용 발생, 로그인 계정 불일치, 완료 재조회 실패 시 해당 계정만 중단합니다.
          </p>
        </div>
        <button onClick={addAccount} disabled={Boolean(busy) || settings.accounts.length >= 12} className="w-fit rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800 disabled:opacity-50">+ 계정 추가</button>
      </div>

      <div className="mt-6 space-y-4">
        {settings.accounts.map((account, index) => {
          const task = state?.tasks.find((candidate) => candidate.accountId === account.accountId);
          const receipt = state?.receipts.find((candidate) => candidate.accountId === account.accountId)?.receipt;
          const credentialSaved = state?.credentials?.find((candidate) => candidate.accountId === account.accountId)?.saved === true;
          const receiptStatus = typeof receipt?.status === "string" ? receipt.status : "기록 없음";
          const finishedAt = typeof receipt?.finishedAt === "string" ? receipt.finishedAt : null;
          return (
            <article key={`${account.accountId}:${index}`} className="rounded-2xl border border-slate-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-black text-slate-900">계정 {index + 1}{account.accountId ? ` · ${account.accountId}` : ""}</h3>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${task?.installed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{task?.installed ? `예약 ${task.state || "설치됨"}` : "예약 미설치"}</span>
                  <button onClick={() => removeAccount(index)} className="text-xs font-bold text-rose-700">제거</button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <label className="text-sm font-bold text-slate-700">도매꾹 아이디<input className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" value={account.accountId} onChange={(event) => updateAccount(index, { accountId: event.target.value })} autoComplete="off" /><span className="mt-1 block text-xs font-normal text-slate-500">로그인 계정 검증에 사용</span></label>
                <label className="text-sm font-bold text-slate-700">도매꾹 비밀번호<input type="password" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" value={passwords[account.accountId] || ""} onChange={(event) => setPasswords((current) => ({ ...current, [account.accountId]: event.target.value }))} autoComplete="new-password" placeholder={credentialSaved ? "암호화 저장됨 · 변경 시에만 입력" : "Windows 암호화 저장"} /><span className="mt-1 block text-xs font-normal text-slate-500">{credentialSaved ? "이 Windows 사용자만 복호화 가능" : "일반 설정 파일에는 저장하지 않음"}</span></label>
                <label className="text-sm font-bold text-slate-700">매일 실행시간<input type="time" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" value={account.scheduleTime} onChange={(event) => updateAccount(index, { scheduleTime: event.target.value })} /><span className="mt-1 block text-xs font-normal text-slate-500">기본 5분 간격 권장</span></label>
                <label className="text-sm font-bold text-slate-700">연장기간<input type="number" min={1} max={90} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" value={account.extensionDays} onChange={(event) => updateAccount(index, { extensionDays: Number(event.target.value) })} /><span className="mt-1 block text-xs font-normal text-slate-500">최대 90일</span></label>
              </div>
              <div className="mt-4 flex flex-wrap gap-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                <label className="flex items-center gap-2"><input type="checkbox" checked={account.enabled} onChange={(event) => updateAccount(index, { enabled: event.target.checked })} />예약 사용</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={account.liveExecution} onChange={(event) => updateAccount(index, { liveExecution: event.target.checked })} />예약시간에 실제 연장</label>
                <span>다음 실행: <strong>{task?.nextRunTime ? new Date(task.nextRunTime).toLocaleString("ko-KR") : "-"}</strong></span>
                <span>최근 결과: <strong>{receiptStatus}</strong>{finishedAt ? ` · ${new Date(finishedAt).toLocaleString("ko-KR")}` : ""}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={Boolean(busy) || !account.accountId} onClick={() => run("open-browser", account.accountId)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50">전용 로그인 열기</button>
                <button disabled={Boolean(busy) || !account.accountId} onClick={() => run("dry-run", account.accountId)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50">시험 실행</button>
                <button disabled={Boolean(busy) || !account.accountId} onClick={() => run("execute-now", account.accountId)} className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-50">지금 실제 연장</button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button disabled={Boolean(busy)} onClick={() => run("install")} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">모든 계정 저장 및 예약 적용</button>
        <button disabled={Boolean(busy)} onClick={() => run("save")} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-800 disabled:opacity-50">설정만 저장</button>
      </div>
      <p role="status" className="mt-4 text-sm font-medium text-slate-700">{busy ? "처리 중 · " : ""}{message}</p>
    </section>
  );
}
