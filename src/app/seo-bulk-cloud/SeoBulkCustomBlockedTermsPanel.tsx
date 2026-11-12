"use client";

import { useEffect, useMemo, useState } from "react";

const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";
const APPLY_API = "/api/seo-run-custom-blocked-terms";
const CUSTOM_BLOCKED_LIMIT = 200;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function parseSeoBulkCustomBlockedTerms(value: string) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[\n,;]+/g)) {
    const normalized = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    const key = normalized.toLocaleLowerCase("ko-KR");
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized.slice(0, 60));
    if (result.length >= CUSTOM_BLOCKED_LIMIT) break;
  }
  return result;
}

function readStoredTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean).slice(0, CUSTOM_BLOCKED_LIMIT) : [];
  } catch {
    return [];
  }
}

function persistTerms(terms: string[]) {
  window.localStorage.setItem(CUSTOM_BLOCKED_STORAGE_KEY, JSON.stringify(terms));
}

export default function SeoBulkCustomBlockedTermsPanel() {
  const [input, setInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const terms = useMemo(() => parseSeoBulkCustomBlockedTerms(input), [input]);

  useEffect(() => {
    let cancelled = false;
    const localTerms = readStoredTerms();
    queueMicrotask(() => {
      if (!cancelled) setInput(localTerms.join(", "));
    });
    void (async () => {
      try {
        const response = await fetch(APPLY_API, {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok || body.ok !== true) return;
        const serverTerms = Array.isArray(body.customBlockedTerms)
          ? body.customBlockedTerms.map(text).filter(Boolean)
          : [];
        const merged = parseSeoBulkCustomBlockedTerms(
          [...localTerms, ...serverTerms].join("\n"),
        );
        if (!cancelled) {
          persistTerms(merged);
          setInput(merged.join(", "));
        }
      } catch {
        // The local list remains usable when the durable policy read is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveDefault = () => {
    persistTerms(terms);
    setError("");
    setMessage(
      terms.length
        ? `직접 금지키워드 ${terms.length}개를 저장했습니다. 다음 SEO 대량등록부터 자동 적용됩니다.`
        : "직접 금지키워드 기본값을 비웠습니다.",
    );
  };

  const applyToCurrentRuns = async () => {
    setApplying(true);
    setError("");
    setMessage("");
    persistTerms(terms);
    try {
      const response = await fetch(APPLY_API, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ customBlockedTerms: terms }),
      });
      const raw = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}`);
      }
      if (!response.ok || body.ok !== true) {
        throw new Error(text(body.message) || `HTTP ${response.status}`);
      }
      const requeued = Number(body.requeuedCount ?? 0);
      const updatedOnly = Number(body.updatedOnlyCount ?? 0);
      const skippedRunning = Number(body.skippedRunningCount ?? 0);
      const skippedRegistration = Number(body.skippedRegistrationCount ?? 0);
      setMessage(
        `금지키워드 ${terms.length}개 저장 · STEP4부터 재검증 ${requeued}개 · 아직 STEP4 전이라 입력값만 반영 ${updatedOnly}개` +
          `${skippedRunning ? ` · 현재 실행 중 ${skippedRunning}개는 안전상 건드리지 않음` : ""}` +
          `${skippedRegistration ? ` · Shopling 등록 중/완료 ${skippedRegistration}개 제외` : ""}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "직접 금지키워드 적용에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="mx-auto max-w-[1500px] px-5 pt-7 text-slate-900">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black text-slate-950">직접 금지키워드</h2>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-amber-800 ring-1 ring-amber-200">
                현재 {terms.length}개 · A19 자동학습 포함
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
              상품명과 검색어에서 제외할 단어를 쉼표 또는 엔터로 입력하세요. 저장된 값은 이후 SEO 대량등록에도 자동 적용됩니다.
            </p>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              maxLength={12000}
              placeholder={"예: 교정, 성형, 특정브랜드명\n임산부용"}
              className="mt-3 w-full resize-y rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={saveDefault}
              disabled={applying}
              className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-900 disabled:opacity-40"
            >
              기본값 저장
            </button>
            <button
              type="button"
              onClick={() => void applyToCurrentRuns()}
              disabled={applying}
              className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
            >
              {applying ? "현재 RUN 적용 중…" : "현재 미등록 RUN에도 적용"}
            </button>
          </div>
        </div>
        {terms.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {terms.slice(0, 30).map((term) => (
              <span
                key={term}
                className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700"
              >
                {term}
              </span>
            ))}
            {terms.length > 30 ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                +{terms.length - 30}개
              </span>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
