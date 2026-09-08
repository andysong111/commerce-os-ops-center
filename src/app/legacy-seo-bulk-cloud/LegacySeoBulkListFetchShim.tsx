"use client";

import { useLayoutEffect } from "react";

const FULL_API_PATH = "/api/legacy-seo-run-jobs";
const LITE_API_PATH = "/api/legacy-seo-run-jobs-lite";
const ENQUEUE_API_PATH = "/api/legacy-seo-run-jobs-enqueue";
const LIST_TIMEOUT_MS = 20_000;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function isEnqueueBody(init?: RequestInit) {
  if (typeof init?.body !== "string") return false;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const action = String(body.action ?? "enqueue").trim();
    return !action || action === "enqueue";
  } catch {
    return false;
  }
}

export default function LegacySeoBulkListFetchShim() {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = (input, init) => {
      try {
        const method = requestMethod(input, init);
        const url = new URL(requestUrl(input), window.location.origin);
        if (url.origin === window.location.origin && url.pathname === FULL_API_PATH) {
          if (method === "GET") {
            url.pathname = LITE_API_PATH;
            return originalFetch(url.toString(), {
              ...init,
              signal: init?.signal ?? AbortSignal.timeout(LIST_TIMEOUT_MS),
            });
          }
          if (method === "POST" && isEnqueueBody(init)) {
            url.pathname = ENQUEUE_API_PATH;
            return originalFetch(url.toString(), init);
          }
        }
      } catch {
        // Fall through to the original request if URL/body parsing is not applicable.
      }
      return originalFetch(input, init);
    };

    window.fetch = patchedFetch;
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
