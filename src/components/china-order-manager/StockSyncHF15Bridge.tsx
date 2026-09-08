"use client";

import { useLayoutEffect } from "react";

const CHANNEL_MARK = "__commerceOsStockSyncBridgeHF15";

const OUTBOUND = new Map<string, string>([
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF15"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF15"],
]);

const INBOUND = new Map<string, string>([
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF15", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF15", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF15", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS"],
  ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF15", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT"],
]);

const LEGACY_INBOUND = new Set(INBOUND.values());

export function StockSyncHF15Bridge() {
  useLayoutEffect(() => {
    const host = window as typeof window & { [CHANNEL_MARK]?: boolean };
    if (host[CHANNEL_MARK]) return;
    host[CHANNEL_MARK] = true;

    const nativePostMessage = window.postMessage.bind(window);
    const originalPostMessage = window.postMessage;

    (window as unknown as { postMessage: (...args: unknown[]) => unknown }).postMessage = ((...args: unknown[]) => {
      const [message, targetOrigin, transfer] = args as [Record<string, unknown> | null, string | undefined, unknown];
      const type = message && typeof message === "object" ? String(message.type || "") : "";
      const mapped = OUTBOUND.get(type);
      if (mapped) {
        const next = { ...message, type: mapped, [CHANNEL_MARK]: true };
        return transfer === undefined
          ? nativePostMessage(next, targetOrigin || window.location.origin)
          : (nativePostMessage as (...values: unknown[]) => unknown)(next, targetOrigin || window.location.origin, transfer);
      }
      return transfer === undefined
        ? nativePostMessage(message, targetOrigin || window.location.origin)
        : (nativePostMessage as (...values: unknown[]) => unknown)(message, targetOrigin || window.location.origin, transfer);
    }) as typeof window.postMessage;

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
        // Ignore READY/STATUS/PROGRESS/RESULT emitted by older concurrently installed
        // stock-sync extensions. Only the HF15 namespaced channel is authoritative.
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
