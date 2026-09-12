"use client";

import { useLayoutEffect } from "react";

const FULL_API_PATH = "/api/legacy-seo-run-jobs";
const LITE_API_PATH = "/api/legacy-seo-run-jobs-lite";
const ENQUEUE_API_PATH = "/api/legacy-seo-run-jobs-enqueue";
const LIST_TIMEOUT_MS = 20_000;
const OUTAGE_BACKOFF_MS = 5 * 60_000;
const TERMINAL_CACHE_MS = 10 * 60_000;
const ACTIVE_REGISTRATION_STATUSES = new Set(["submitting", "queued", "running"]);
const TERMINAL_RUN_STATUSES = new Set(["ready", "failed", "cancelled"]);

type CachedResponse = {
  expiresAt: number;
  response: Response;
};

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

function isJobsOnlyRead(url: URL) {
  return url.searchParams.get("items") === "false" && url.searchParams.get("jobs") !== "false";
}

function jobsAreTerminal(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const jobs = (body as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return false;
  return jobs.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const runStatus = String(row.status ?? "").trim();
    const registrationStatus = String(row.registration_status ?? "idle").trim();
    return (
      TERMINAL_RUN_STATUSES.has(runStatus) &&
      !ACTIVE_REGISTRATION_STATUSES.has(registrationStatus)
    );
  });
}

function syntheticOutageResponse(outageUntil: number) {
  const retryAfter = Math.max(1, Math.ceil((outageUntil - Date.now()) / 1000));
  return Response.json(
    {
      ok: false,
      code: "LEGACY_SEO_STORAGE_UNAVAILABLE",
      canRegister: false,
      message:
        "저장소 연결 장애 뒤 반복 조회를 잠시 줄이고 있습니다. 실제 데이터가 0건이라는 뜻이 아닙니다.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": String(retryAfter),
        "X-Ops-Client-Backoff": "active",
      },
    },
  );
}

export default function LegacySeoBulkListFetchShim() {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const inFlight = new Map<string, Promise<Response>>();
    let outageUntil = 0;
    let terminalJobsCache: CachedResponse | null = null;

    const clearReadGuards = () => {
      outageUntil = 0;
      terminalJobsCache = null;
    };

    const fetchLite = (url: URL, init?: RequestInit) => {
      const now = Date.now();
      const jobsOnly = isJobsOnlyRead(url);

      if (outageUntil > now) {
        return Promise.resolve(syntheticOutageResponse(outageUntil));
      }
      if (jobsOnly && terminalJobsCache && terminalJobsCache.expiresAt > now) {
        return Promise.resolve(terminalJobsCache.response.clone());
      }
      if (terminalJobsCache && terminalJobsCache.expiresAt <= now) {
        terminalJobsCache = null;
      }

      const key = url.toString();
      const existing = inFlight.get(key);
      if (existing) return existing.then((response) => response.clone());

      const request = originalFetch(key, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(LIST_TIMEOUT_MS),
      })
        .then(async (response) => {
          if ([429, 500, 502, 503, 504].includes(response.status)) {
            const retryAfterHeader = Number(response.headers.get("retry-after")) || 0;
            outageUntil = Date.now() + Math.max(OUTAGE_BACKOFF_MS, retryAfterHeader * 1000);
            terminalJobsCache = null;
          } else if (response.ok) {
            outageUntil = 0;
            if (jobsOnly) {
              try {
                const body = await response.clone().json();
                terminalJobsCache = jobsAreTerminal(body)
                  ? {
                      expiresAt: Date.now() + TERMINAL_CACHE_MS,
                      response: response.clone(),
                    }
                  : null;
              } catch {
                terminalJobsCache = null;
              }
            }
          }
          // Keep the shared in-flight response untouched; every caller receives a clone.
          return response;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, request);
      return request.then((response) => response.clone());
    };

    const writeThrough = (input: RequestInfo | URL, init?: RequestInit) =>
      originalFetch(input, init).then((response) => {
        if (response.ok) clearReadGuards();
        return response;
      });

    const patchedFetch: typeof window.fetch = (input, init) => {
      try {
        const method = requestMethod(input, init);
        const url = new URL(requestUrl(input), window.location.origin);
        if (url.origin === window.location.origin && url.pathname === FULL_API_PATH) {
          if (method === "GET") {
            url.pathname = LITE_API_PATH;
            return fetchLite(url, init);
          }
          if (method === "POST" && isEnqueueBody(init)) {
            url.pathname = ENQUEUE_API_PATH;
            return writeThrough(url.toString(), init);
          }
          if (method === "POST") return writeThrough(input, init);
        }
      } catch {
        // Fall through to the original request if URL/body parsing is not applicable.
      }
      return originalFetch(input, init);
    };

    window.fetch = patchedFetch;
    return () => {
      inFlight.clear();
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
