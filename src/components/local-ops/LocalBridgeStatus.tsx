"use client";

import { useEffect, useState } from "react";
import {
  localOpsBridgeBaseUrlStorageKey,
  normalizeLocalBridgeBaseUrl,
} from "@/lib/localOpsBridgeConfig";

type BridgeState = "checking" | "connected" | "disconnected";

export function LocalBridgeStatus({
  baseUrl,
  onBaseUrlChange,
}: {
  baseUrl?: string;
  onBaseUrlChange?: (baseUrl: string) => void;
}) {
  const [currentBaseUrl] = useState(() => normalizeLocalBridgeBaseUrl(baseUrl ?? (typeof window === "undefined" ? null : window.localStorage.getItem(localOpsBridgeBaseUrlStorageKey))));
  const [state, setState] = useState<BridgeState>("checking");

  useEffect(() => {
    onBaseUrlChange?.(currentBaseUrl);
  }, [currentBaseUrl, onBaseUrlChange]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${currentBaseUrl}/health`, { signal: controller.signal })
      .then((response) => setState(response.ok ? "connected" : "disconnected"))
      .catch(() => setState("disconnected"));
    return () => controller.abort();
  }, [currentBaseUrl]);

  const connected = state === "connected";

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
      {!connected ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">승준컴 로컬 브릿지 실행 필요</p>
          <code className="mt-2 block overflow-x-auto rounded bg-white/80 p-3 text-xs text-slate-800">python tools/run_local_ops_bridge.py --host 127.0.0.1 --port 8765</code>
        </div>
      ) : null}
    </section>
  );
}
