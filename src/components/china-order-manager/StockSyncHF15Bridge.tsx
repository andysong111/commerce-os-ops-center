"use client";

import { useLayoutEffect } from "react";

const CHANNEL_MARK = "__commerceOsStockSyncBridgeHF17";

const OUTBOUND = new Map<string, string>([
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF17"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF17"],
]);

const INBOUND = new Map<string, string>([
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF17", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT"],
]);

const LEGACY_INBOUND = new Set(INBOUND.values());

export function StockSyncHF15Bridge() {
  useLayoutEffect(() => {
    const host = window as unknown as Record<string, unknown> & Window;
    if (host[CHANNEL_MARK] === true) return;
    host[CHANNEL_MARK] = true;

    const nativePostMessage = window.postMessage.bind(window) as (...args: unknown[]) => void;
    const originalPostMessage = window.postMessage;

    const patchedPostMessage = (...args: unknown[]) => {
      const message = args[0] as Record<string, unknown> | null | undefined;
      const targetOrigin = typeof args[1] === "string" ? args[1] : window.location.origin;
      const type = message && typeof message === "object" ? String(message.type || "") : "";
      const mapped = OUTBOUND.get(type);
      const next = mapped && message
        ? { ...message, type: mapped, [CHANNEL_MARK]: true }
        : message;
      if (args.length >= 3) nativePostMessage(next, targetOrigin, args[2]);
      else nativePostMessage(next, targetOrigin);
    };

    (host as unknown as { postMessage: (...args: unknown[]) => void }).postMessage = patchedPostMessage;

    const capture = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      const type = String(data.type || "");
      const mapped = INBOUND.get(type);
      if (mapped) {
        event.stopImmediatePropagation();
        queueMicrotask(() => {
          nativePostMessage({ ...data, type: mapped, [CHANNEL_MARK]: true }, window.location.origin);
        });
        return;
      }
      if (LEGACY_INBOUND.has(type) && data[CHANNEL_MARK] !== true) {
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("message", capture, true);
    return () => {
      window.removeEventListener("message", capture, true);
      window.postMessage = originalPostMessage;
      delete host[CHANNEL_MARK];
    };
  }, []);

  return null;
}
