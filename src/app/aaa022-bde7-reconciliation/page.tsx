"use client";

import { useState } from "react";

const CONFIRM_TEXT = "AAA022BDE7실물적재확인";

export default function Aaa022Bde7ReconciliationPage() {
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState("사전점검 전");
  const [busy, setBusy] = useState(false);

  async function run(mode: "plan" | "apply") {
    setBusy(true);
    try {
      const response = await fetch("/api/internal/aaa022-bde7-reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, confirmText }),
      });
      const body = await response.json();
      setResult(JSON.stringify(body, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">AAA022 BDE7 안전 조정</h1>
      <p>AAA115 블랙·화이트의 낡은 위치를 해제하고 AAA022 회색·하늘 배정을 검증합니다.</p>
      <div className="flex gap-3">
        <button className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => run("plan")}>사전점검</button>
        <button className="rounded bg-red-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy || confirmText !== CONFIRM_TEXT} onClick={() => run("apply")}>실제 반영</button>
      </div>
      <label className="block space-y-2">
        <span>확인 문구: {CONFIRM_TEXT}</span>
        <input className="w-full rounded border p-2" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
      </label>
      <pre className="max-h-[60vh] overflow-auto rounded bg-slate-950 p-4 text-xs text-green-200">{result}</pre>
    </main>
  );
}
