"use client";

import { useCallback, useEffect, useState } from "react";
import {
  localOpsBridgeBaseUrlStorageKey,
  normalizeLocalBridgeBaseUrl,
} from "@/lib/localOpsBridgeConfig";

type BridgeState = "checking" | "connected" | "disconnected";

const startProtocolUrl = "seungjun-ops-bridge://start";
const stopProtocolUrl = "seungjun-ops-bridge://stop";

export function LocalBridgeStatus({
  baseUrl,
  onBaseUrlChange,
}: {
  baseUrl?: string;
  onBaseUrlChange?: (baseUrl: string) => void;
}) {
  const [currentBaseUrl] = useState(() => normalizeLocalBridgeBaseUrl(baseUrl ?? (typeof window === "undefined" ? null : window.localStorage.getItem(localOpsBridgeBaseUrlStorageKey))));
  const [state, setState] = useState<BridgeState>("checking");
  const [message, setMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    onBaseUrlChange?.(currentBaseUrl);
  }, [currentBaseUrl, onBaseUrlChange]);

  const checkHealth = useCallback((signal?: AbortSignal, showChecking = true) => {
    if (showChecking) setState("checking");
    return fetch(`${currentBaseUrl}/health`, { signal })
      .then((response) => {
        const nextState = response.ok ? "connected" : "disconnected";
        setState(nextState);
        return nextState;
      })
      .catch(() => {
        setState("disconnected");
        return "disconnected" as const;
      });
  }, [currentBaseUrl]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void checkHealth(controller.signal, false));
    return () => controller.abort();
  }, [checkHealth]);

  const connected = state === "connected";

  const handleStart = () => {
    setMessage("브릿지 실행 요청을 보냈습니다. 브라우저 확인창이 뜨면 허용하세요.");
    window.location.href = startProtocolUrl;
    window.setTimeout(() => void checkHealth(), 3000);
    window.setTimeout(() => void checkHealth(), 6000);
  };

  const handleStop = () => {
    window.location.href = stopProtocolUrl;
  };

  const handleReconnect = () => {
    setMessage("");
    void checkHealth();
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="승준컴 로컬 브릿지 상태">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-950">승준컴 로컬 브릿지</p>
          <p className="mt-1 text-xs font-semibold text-blue-700">이 기능은 승준컴 로컬 브릿지가 켜져 있을 때만 작동합니다.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {state === "checking" ? "확인 중" : connected ? "연결됨" : "연결 안 됨"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={handleStart} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
          승준컴 브릿지 실행
        </button>
        <button type="button" onClick={handleReconnect} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          연결 다시 확인
        </button>
        <button type="button" onClick={handleStop} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50">
          브릿지 중지
        </button>
        <button type="button" onClick={() => setShowHelp((value) => !value)} className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-50" aria-expanded={showHelp}>
          설치 안내 보기
        </button>
      </div>
      {message ? <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-800">{message}</p> : null}
      {!connected ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">승준컴 로컬 브릿지 실행 필요</p>
          <p className="mt-2 font-semibold">브릿지가 꺼져 있습니다. ‘승준컴 브릿지 실행’을 누른 뒤 3~5초 후 연결 다시 확인을 눌러주세요.</p>
          <code className="mt-2 block overflow-x-auto rounded bg-white/80 p-3 text-xs text-slate-800">python tools/run_local_ops_bridge.py --host 127.0.0.1 --port 8765</code>
        </div>
      ) : null}
      {showHelp ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          <p className="font-bold text-slate-950">설치 안내</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>최초 1회 product-detail-page-auto에서 프로토콜 설치가 필요합니다.</li>
            <li>설치 후 브라우저에서 외부 앱 열기 확인창이 뜨면 허용하세요.</li>
            <li>
              수동 확인:
              <code className="mt-1 block overflow-x-auto rounded bg-white p-3 text-xs text-slate-800">Invoke-RestMethod http://127.0.0.1:8765/health</code>
            </li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}
