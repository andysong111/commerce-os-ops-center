"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  getSourcingModeLabel,
  summarizeSourcingMemory,
  type HumanOrderDecision,
  type SalesResult,
  type SourcingFeedback,
  type SourcingMode,
} from "@/lib/sourcingEngine";

const STORAGE_KEY = "commerce-os:sourcing-engine-feedback";

const failureReasonOptions = [
  "안 팔림",
  "마진 부족",
  "CS 많음",
  "파손",
  "사이즈 불만",
  "상세페이지 문제",
  "공급처 문제",
  "옵션 문제",
  "배송 문제",
  "가격경쟁 심함",
  "위험 리스크 발견",
];

const percentFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

export default function SourcingFeedbackPage() {
  const [feedbackList, setFeedbackList] = useState<SourcingFeedback[]>([]);
  const [draft, setDraft] = useState({
    mode: "FOLLOW_PROVEN" as SourcingMode,
    categoryHint: "차량용 수납",
    humanOrderDecision: "ORDERED" as HumanOrderDecision,
    salesResult: "UNKNOWN" as SalesResult,
    reordered: false,
    failureReasons: [] as string[],
    memo: "",
  });

  const memorySegments = useMemo(
    () => summarizeSourcingMemory(feedbackList),
    [feedbackList],
  );
  const totalTests = feedbackList.length;
  const successCount = feedbackList.filter((item) => item.salesResult === "SUCCESS").length;
  const failCount = feedbackList.filter((item) => item.salesResult === "FAIL").length;
  const successRate = totalTests > 0 ? successCount / totalTests : 0;

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) setFeedbackList(JSON.parse(stored) as SourcingFeedback[]);
      } catch {
        setFeedbackList([]);
      }
    });
  }, []);

  function saveFeedback() {
    const feedback: SourcingFeedback = {
      cardId: `manual-${Date.now()}`,
      mode: draft.mode,
      categoryHint: draft.categoryHint.trim(),
      humanOrderDecision: draft.humanOrderDecision,
      salesResult: draft.salesResult,
      reordered: draft.reordered,
      failureReasons: draft.failureReasons,
      memo: draft.memo.trim(),
      createdAt: new Date().toISOString(),
    };

    setFeedbackList((current) => {
      const next = [feedback, ...current].slice(0, 500);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    setDraft((current) => ({
      ...current,
      memo: "",
      failureReasons: [],
      reordered: false,
    }));
  }

  function clearFeedback() {
    setFeedbackList([]);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function toggleFailureReason(reason: string) {
    setDraft((current) => {
      const exists = current.failureReasons.includes(reason);
      return {
        ...current,
        failureReasons: exists
          ? current.failureReasons.filter((item) => item !== reason)
          : [...current.failureReasons, reason],
      };
    });
  }

  async function exportFeedback() {
    const payload = JSON.stringify(feedbackList, null, 2);
    await navigator.clipboard.writeText(payload);
  }

  function importFeedback(value: string) {
    try {
      const parsed = JSON.parse(value) as SourcingFeedback[];
      if (!Array.isArray(parsed)) return;
      const normalized = parsed.filter((item) => item && typeof item === "object");
      setFeedbackList(normalized);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // ignore invalid JSON to keep the page safe
    }
  }

  return (
    <>
      <PageHeader
        title="소싱 피드백 / 타율 기억장치"
        description="주문추천 카드로 테스트한 상품의 성공·실패 결과를 30초 안에 기록합니다. 초기 버전은 복잡한 머신러닝 대신 수동 피드백 기반 성공률 힌트를 누적합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/sourcing-engine/importer"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              주문추천 카드 만들기
            </Link>
            <Link
              href="/sourcing-engine/market-snapshot"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              시장 스냅샷
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="space-y-4">
          <Panel title="결과 입력">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="소싱 모드"
                value={draft.mode}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, mode: value as SourcingMode }))
                }
                options={[
                  ["FOLLOW_PROVEN", "검증제품 따라팔기"],
                  ["DISCOVER_NEW", "신규제품 먼저팔기"],
                ]}
              />
              <InputField
                label="카테고리/패턴 힌트"
                value={draft.categoryHint}
                onChange={(value) => setDraft((current) => ({ ...current, categoryHint: value }))}
                placeholder="예: 차량용 수납, 캠핑 소품"
              />
              <SelectField
                label="주문 판단"
                value={draft.humanOrderDecision}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    humanOrderDecision: value as HumanOrderDecision,
                  }))
                }
                options={[
                  ["ORDERED", "주문함"],
                  ["HOLD", "보류"],
                  ["REJECTED", "폐기"],
                ]}
              />
              <SelectField
                label="판매 결과"
                value={draft.salesResult}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, salesResult: value as SalesResult }))
                }
                options={[
                  ["UNKNOWN", "아직 모름"],
                  ["SUCCESS", "성공"],
                  ["NEUTRAL", "애매"],
                  ["FAIL", "실패"],
                ]}
              />
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.reordered}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, reordered: event.target.checked }))
                }
              />
              재주문함
            </label>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-slate-500">실패/주의 사유</p>
              <div className="flex flex-wrap gap-2">
                {failureReasonOptions.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => toggleFailureReason(reason)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      draft.failureReasons.includes(reason)
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-semibold text-slate-500">메모</span>
              <textarea
                value={draft.memo}
                onChange={(event) => setDraft((current) => ({ ...current, memo: event.target.value }))}
                rows={4}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder="다음 추천에서 피해야 할 점 또는 다시 밀어볼 조건"
              />
            </label>

            <button
              type="button"
              onClick={saveFeedback}
              className="mt-4 w-full rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            >
              피드백 저장
            </button>
          </Panel>

          <Panel title="백업 / 복구">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportFeedback}
                disabled={feedbackList.length === 0}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                JSON 복사
              </button>
              <button
                type="button"
                onClick={clearFeedback}
                disabled={feedbackList.length === 0}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                기록 전체 삭제
              </button>
            </div>
            <ImportBox onImport={importFeedback} />
          </Panel>
        </section>

        <section className="space-y-4">
          <Panel title="누적 타율 요약">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="총 기록" value={`${totalTests}개`} />
              <Metric label="성공" value={`${successCount}개`} />
              <Metric label="실패" value={`${failCount}개`} />
              <Metric label="성공률" value={`${percentFormatter.format(successRate * 100)}%`} />
            </div>
          </Panel>

          <Panel title="패턴별 기억장치">
            {memorySegments.length > 0 ? (
              <div className="space-y-2">
                {memorySegments.slice(0, 12).map((segment) => (
                  <div key={segment.segmentKey} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {segment.segmentKey}
                      </span>
                      <span className="text-sm font-bold text-blue-700">
                        {percentFormatter.format(segment.successRate * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      총 {segment.total}회 · 성공 {segment.success} · 애매 {segment.neutral} · 실패 {segment.fail}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-500">
                피드백을 저장하면 모드별·카테고리별·실패 사유별 성공률이 누적됩니다.
              </p>
            )}
          </Panel>

          <Panel title="최근 기록">
            {feedbackList.length > 0 ? (
              <div className="space-y-2">
                {feedbackList.slice(0, 12).map((item) => (
                  <article key={`${item.cardId}-${item.createdAt}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {item.categoryHint || "카테고리 없음"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {getSourcingModeLabel(item.mode)} · {toResultLabel(item.salesResult)} · {item.reordered ? "재주문" : "재주문 없음"}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {toDecisionLabel(item.humanOrderDecision)}
                      </span>
                    </div>
                    {item.failureReasons.length > 0 ? (
                      <p className="mt-2 text-xs text-red-600">
                        {item.failureReasons.join(" · ")}
                      </p>
                    ) : null}
                    {item.memo ? (
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.memo}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-500">아직 저장된 피드백이 없습니다.</p>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function ImportBox({ onImport }: { onImport: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-4">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={4}
        placeholder="백업해둔 JSON을 붙여넣으면 복구합니다."
        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="button"
        onClick={() => onImport(value)}
        disabled={!value.trim()}
        className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        JSON 복구
      </button>
    </div>
  );
}

function toDecisionLabel(value: HumanOrderDecision) {
  if (value === "ORDERED") return "주문함";
  if (value === "HOLD") return "보류";
  return "폐기";
}

function toResultLabel(value: SalesResult) {
  if (value === "SUCCESS") return "성공";
  if (value === "NEUTRAL") return "애매";
  if (value === "FAIL") return "실패";
  return "아직 모름";
}
