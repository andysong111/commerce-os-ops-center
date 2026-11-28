"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

type Challenge = {
  status: "WAITING" | "ANSWER_SUBMITTED" | "CONSUMED" | "EXPIRED" | "CANCELLED";
  imageVersion: number;
  imageUpdatedAt: string;
  answerSubmittedAt: string | null;
  confirmationDelayed: boolean;
  refreshRequestedAt: string | null;
  expiresAt: string;
  expired: boolean;
  imageAvailable: boolean;
};

const messages: Record<string, string> = {
  SHOPLING_CAPTCHA_ANSWER_INVALID: "이미지에 보이는 숫자 4자리를 입력해 주세요.",
  SHOPLING_CAPTCHA_STALE: "캡차 이미지가 바뀌었습니다. 최신 이미지를 다시 확인해 주세요.",
  SHOPLING_CAPTCHA_EXPIRED: "입력 시간이 만료되었습니다. PC 업무센터에서 업무를 다시 시작해 주세요.",
};

export default function ShoplingCaptchaClient({ token }: { token: string }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"submit" | "refresh" | "">("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/shopling-captcha/${encodeURIComponent(token)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(messages[body.code] || "캡차 요청을 열 수 없습니다.");
    setChallenge(body.challenge);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        await load();
        if (!cancelled) setError("");
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "캡차 요청을 열 수 없습니다.");
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [load]);

  const expiry = challenge?.expiresAt
    ? new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(challenge.expiresAt))
    : "";

  async function action(kind: "submit" | "refresh") {
    if (!challenge || busy) return;
    if (kind === "submit" && !/^\d{4}$/.test(answer)) {
      setError("이미지에 보이는 숫자 4자리를 입력해 주세요.");
      return;
    }
    setBusy(kind);
    setError("");
    try {
      const response = await fetch(`/api/shopling-captcha/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind, answer: kind === "submit" ? answer : undefined, imageVersion: challenge.imageVersion }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(messages[body.code] || "요청을 처리하지 못했습니다.");
      setAnswer("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다.");
      await load().catch(() => {});
    } finally {
      setBusy("");
    }
  }

  if (error && !challenge) {
    return <main className="grid min-h-screen place-items-center bg-slate-100 p-5 text-slate-900"><section className="w-full max-w-md rounded-xl bg-white p-6 shadow"><h1 className="text-xl font-black">샵플링 캡차 확인</h1><p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p></section></main>;
  }
  if (!challenge) return <main className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-600">캡차 이미지를 불러오는 중입니다.</main>;

  const finished = challenge.expired || ["CONSUMED", "EXPIRED", "CANCELLED"].includes(challenge.status);
  const submitted = challenge.status === "ANSWER_SUBMITTED";
  const refreshing = Boolean(challenge.refreshRequestedAt) && !submitted;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-4 text-slate-900">
      <section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="border-b-4 border-orange-500 bg-emerald-950 px-5 py-5 text-white">
          <h1 className="text-xl font-black">샵플링 캡차 확인</h1>
          <p className="mt-1 text-xs text-emerald-100">사람이 확인한 숫자만 로그인에 사용합니다.</p>
        </header>
        <div className="p-5">
          {finished ? (
            <p role="status" className="rounded-xl bg-slate-100 p-5 text-center text-sm font-bold">{challenge.status === "CONSUMED"
              ? "샵플링 로그인이 완료되었습니다. 이 창을 닫아도 됩니다."
              : challenge.status === "CANCELLED"
                ? "이 인증 요청이 종료되었습니다. 업무용 PC에서 샵플링 로그인 화면의 안내를 확인해 주세요."
                : "입력 시간이 끝났습니다. PC 업무센터에서 업무를 다시 시작해 주세요."}</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">아래 이미지의 숫자 4자리를 입력하세요. 유효시간: <strong>{expiry}</strong></p>
              <div className="mt-4 grid min-h-24 place-items-center rounded-xl border-2 border-slate-300 bg-white p-3">
                {challenge.imageAvailable
                  ? <Image key={challenge.imageVersion} src={`/api/shopling-captcha/${encodeURIComponent(token)}/image?v=${challenge.imageVersion}`} alt="샵플링 캡차 숫자 이미지" width={420} height={104} unoptimized className="h-auto max-h-32 w-full object-contain [image-rendering:auto]" />
                  : <span className="text-sm text-slate-500">이미지 준비 중</span>}
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">현재 이미지 #{challenge.imageVersion}</p>
              {submitted ? (
                <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-center text-sm font-bold text-amber-900">
                  {challenge.confirmationDelayed
                    ? "숫자는 접수됐습니다. 1분 넘게 업무용 PC에서 로그인 결과가 오지 않았습니다. PC의 샵플링 로그인 화면을 확인해 주세요."
                    : "숫자를 접수했습니다. 업무용 PC에서 샵플링 로그인 결과를 기다리고 있습니다."}
                </p>
              ) : refreshing ? (
                <p className="mt-4 rounded-xl bg-amber-50 p-4 text-center text-sm font-bold text-amber-900">PC에서 새 캡차를 준비 중입니다. 새 이미지가 자동으로 표시되고 카카오톡에도 다시 옵니다.</p>
              ) : (
                <div className="mt-4">
                  <label htmlFor="captcha-answer" className="text-sm font-bold">숫자 4자리</label>
                  <input id="captcha-answer" value={answer} onChange={(event) => setAnswer(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" autoComplete="one-time-code" maxLength={4} className="mt-2 w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-center text-3xl font-black tracking-[0.5em] outline-none focus:border-emerald-700" aria-label="캡차 숫자 4자리" />
                  <button type="button" onClick={() => void action("submit")} disabled={busy !== "" || answer.length !== 4} className="mt-3 w-full rounded-xl bg-emerald-800 px-4 py-4 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy === "submit" ? "전송 중…" : "숫자 전송 후 로그인 계속"}</button>
                </div>
              )}
              {!submitted && <button type="button" onClick={() => void action("refresh")} disabled={busy !== "" || refreshing} className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:text-slate-400">{busy === "refresh" || refreshing ? "새 캡차 요청 중…" : "이미지가 오래됐거나 안 맞음 · 새 캡차 요청"}</button>}
              {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
