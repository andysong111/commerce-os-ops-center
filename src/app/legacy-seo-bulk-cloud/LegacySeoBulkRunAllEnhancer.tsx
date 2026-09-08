"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const API = "/api/legacy-seo-run-jobs";
const PREFLIGHT_API = "/api/legacy-seo-preflight";
const CHUNK_SIZE = 50;
const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";

type UnknownRecord = Record<string, unknown>;

type LegacyItem = {
  id?: unknown;
  modelNumber?: unknown;
};

type Job = {
  launch_item_id?: unknown;
  status?: unknown;
};

type PreflightItem = {
  itemId?: unknown;
  modelNumber?: unknown;
  ready?: unknown;
  excluded?: unknown;
  issues?: unknown;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function selectionSection() {
  return (
    [...document.querySelectorAll<HTMLElement>("section")].find((section) =>
      section.querySelector("h2")?.textContent?.includes("1. 이전상품 선택"),
    ) ?? null
  );
}

function actionContainer(section: HTMLElement) {
  const button = [...section.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === "현재목록 선택",
  );
  return button?.parentElement ?? null;
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean).slice(0, 200) : [];
  } catch {
    return [];
  }
}

async function readBody(response: Response) {
  const raw = await response.text();
  try {
    return raw ? record(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function chunksOf(ids: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + CHUNK_SIZE));
  }
  return chunks;
}

function preflightIssueSummary(value: unknown) {
  const row = record(value);
  const issues = Array.isArray(row.issues) ? row.issues.map(record) : [];
  const first = issues[0];
  return text(first?.message) || "사전점검 미통과";
}

async function loadTargets() {
  const response = await fetch(API, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message) || `HTTP ${response.status}`);
  }
  const items = (Array.isArray(body.items) ? body.items : []).map(
    (value) => record(value) as LegacyItem,
  );
  const jobs = (Array.isArray(body.jobs) ? body.jobs : []).map(
    (value) => record(value) as Job,
  );
  const blocked = new Set(
    jobs
      .filter((job) => ["queued", "running", "ready"].includes(text(job.status)))
      .map((job) => text(job.launch_item_id))
      .filter(Boolean),
  );
  const allIds = items.map((item) => text(item.id)).filter(Boolean);
  return {
    candidateCount: allIds.length,
    targetIds: allIds.filter((id) => !blocked.has(id)),
  };
}

async function preflightAll(
  ids: string[],
  onProgress: (message: string) => void,
) {
  const chunks = chunksOf(ids);
  const readyIds: string[] = [];
  const excluded: PreflightItem[] = [];
  const failed: PreflightItem[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    onProgress(
      `전체 사전점검 ${index + 1}/${chunks.length} · 옵션/B코드·중국주문 원가/판매가·이미지 확인 중`,
    );
    const response = await fetch(PREFLIGHT_API, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ itemIds: chunks[index] }),
    });
    const body = await readBody(response);
    if (!response.ok && response.status !== 422) {
      throw new Error(text(body.message) || `사전점검 HTTP ${response.status}`);
    }
    const results = (Array.isArray(body.results) ? body.results : []).map(
      (value) => record(value) as PreflightItem,
    );
    for (const result of results) {
      const itemId = text(result.itemId);
      if (result.ready === true && itemId) {
        readyIds.push(itemId);
      } else if (result.excluded === true) {
        excluded.push(result);
      } else {
        failed.push(result);
      }
    }
  }

  return {
    readyIds: [...new Set(readyIds)],
    excluded,
    failed,
  };
}

export default function LegacySeoBulkRunAllEnhancer() {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [candidateCount, setCandidateCount] = useState(0);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const syncDom = () => {
      const section = selectionSection();
      if (!section) {
        setContainer(null);
        return;
      }
      const next = actionContainer(section);
      setContainer((current) => (current === next ? current : next));
    };

    const refresh = async () => {
      try {
        const result = await loadTargets();
        if (cancelled) return;
        setCandidateCount(result.candidateCount);
        setTargetIds(result.targetIds);
      } catch {
        // The main client owns the page-level load error. Avoid duplicating it here.
      }
    };

    syncDom();
    void refresh();

    const domTimer = window.setInterval(syncDom, 1_000);
    const refreshTimer = window.setInterval(() => {
      if (!busy) void refresh();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(domTimer);
      window.clearInterval(refreshTimer);
    };
  }, [busy]);

  if (!container) return null;

  return createPortal(
    <>
      <button
        type="button"
        disabled={busy || targetIds.length === 0}
        onClick={async () => {
          setBusy(true);
          setError("");
          setStatus("");
          try {
            const latest = await loadTargets();
            setCandidateCount(latest.candidateCount);
            setTargetIds(latest.targetIds);
            const ids = latest.targetIds;
            if (!ids.length) {
              setStatus("미실행 상품이 없습니다.");
              return;
            }

            // Phase 1: validate the entire candidate set before any RUN job is
            // inserted. This prevents the old failure mode where batch 1 was
            // already queued before a later 50-item batch discovered bad data.
            const preflight = await preflightAll(ids, setStatus);
            if (preflight.failed.length) {
              const summary = preflight.failed
                .slice(0, 8)
                .map((result) =>
                  `${text(result.modelNumber) || text(result.itemId)}: ${preflightIssueSummary(result)}`,
                )
                .join(" · ");
              throw new Error(
                `전체 SEO RUN 중단 · 사전점검 ${preflight.failed.length}개 미통과${summary ? ` · ${summary}` : ""}`,
              );
            }
            if (!preflight.readyIds.length) {
              setStatus(
                `실행 가능한 상품이 없습니다.${preflight.excluded.length ? ` · 단종/적용제외 ${preflight.excluded.length}개` : ""}`,
              );
              return;
            }

            // Phase 2: only the already-green item ids are enqueued. The server
            // insert path runs the hard preflight gate again as the final defense.
            const runChunks = chunksOf(preflight.readyIds);
            let inserted = 0;
            let skipped = preflight.excluded.length;
            for (let index = 0; index < runChunks.length; index += 1) {
              setStatus(
                `사전점검 통과 · SEO RUN ${index + 1}/${runChunks.length} 배치 처리 중 · 시작 ${inserted}건 · 제외 ${skipped}건`,
              );
              const response = await fetch(API, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                credentials: "same-origin",
                cache: "no-store",
                body: JSON.stringify({
                  action: "enqueue",
                  itemIds: runChunks[index],
                  bulkMode: true,
                  customBlockedTerms: readCustomBlockedTerms(),
                }),
              });
              const body = await readBody(response);
              const missing = Array.isArray(body.missing) ? body.missing : [];
              if (!response.ok) {
                throw new Error(text(body.message) || `HTTP ${response.status}`);
              }
              inserted += Math.max(0, Number(body.insertedCount) || 0);
              skipped += missing.length;
            }
            setStatus(
              `전체 SEO RUN 요청 완료 · 시작 ${inserted}건${skipped ? ` · 단종/제외/기존 RUN ${skipped}건` : ""}`,
            );
            const refreshed = await loadTargets();
            setCandidateCount(refreshed.candidateCount);
            setTargetIds(refreshed.targetIds);
            window.setTimeout(() => window.location.reload(), 1_200);
          } catch (runError) {
            setError(
              runError instanceof Error ? runError.message : "전체 SEO RUN 요청에 실패했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 font-semibold text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
        title="전체 후보를 먼저 사전점검하고 모든 활성 상품이 통과한 경우에만 50개씩 SEO RUN을 시작합니다."
      >
        {busy
          ? "전체 사전점검/SEO RUN 처리 중…"
          : `전체 미실행 ${targetIds.length}개 사전점검 후 SEO RUN`}
      </button>
      <span className="self-center text-xs text-slate-500" title="전체 Shopling 등록완료 후보 수">
        전체후보 {candidateCount}개
      </span>
      {(status || error) && (
        <span
          className={`self-center max-w-[680px] text-xs font-semibold ${
            error ? "text-rose-700" : "text-violet-700"
          }`}
        >
          {error || status}
        </span>
      )}
    </>,
    container,
  );
}
