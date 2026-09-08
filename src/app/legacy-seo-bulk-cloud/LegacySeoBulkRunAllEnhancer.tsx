"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const API = "/api/legacy-seo-run-jobs";
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

function updateLegacyScopeCopy(section: HTMLElement) {
  const heading = section.querySelector("h2");
  const copy = heading?.parentElement?.querySelector("p");
  if (!copy) return;
  copy.textContent =
    "상품출시 진행관리 전체 작업묶음 중 Shopling 등록완료 상품을 표시합니다. RUN 직전 누락 옵션/B코드는 기존 Shopling goods_key 근거로 자동 복구하고, 근거가 없으면 안전하게 제외합니다.";
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
      updateLegacyScopeCopy(section);
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
    const observer = new MutationObserver(syncDom);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(() => {
      syncDom();
      if (!busy) void refresh();
    }, 5_000);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearInterval(timer);
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
            const chunks: string[][] = [];
            for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
              chunks.push(ids.slice(index, index + CHUNK_SIZE));
            }
            let inserted = 0;
            let skipped = 0;
            for (let index = 0; index < chunks.length; index += 1) {
              setStatus(
                `일괄 RUN ${index + 1}/${chunks.length} 배치 처리 중 · 시작 ${inserted}건 · 제외 ${skipped}건`,
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
                  itemIds: chunks[index],
                  bulkMode: true,
                  customBlockedTerms: readCustomBlockedTerms(),
                }),
              });
              const body = await readBody(response);
              const missing = Array.isArray(body.missing) ? body.missing : [];
              if (!response.ok && response.status !== 422) {
                throw new Error(text(body.message) || `HTTP ${response.status}`);
              }
              inserted += Math.max(0, Number(body.insertedCount) || 0);
              skipped += missing.length;
            }
            setStatus(
              `전체 SEO RUN 요청 완료 · 시작 ${inserted}건${skipped ? ` · 제외/기존 RUN ${skipped}건` : ""}`,
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
        title="Shopling 등록완료 전체 후보 중 아직 RUN이 없는 상품을 50개씩 안전하게 나누어 SEO RUN을 시작합니다."
      >
        {busy
          ? "전체 SEO RUN 처리 중…"
          : `전체 미실행 ${targetIds.length}개 SEO RUN`}
      </button>
      <span className="self-center text-xs text-slate-500" title="전체 Shopling 등록완료 후보 수">
        전체후보 {candidateCount}개
      </span>
      {(status || error) && (
        <span
          className={`self-center max-w-[460px] text-xs font-semibold ${
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
