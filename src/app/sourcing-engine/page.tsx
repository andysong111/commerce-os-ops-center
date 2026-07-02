"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  buildRecommendationCard,
  createEmptyCandidate,
  generateChineseSearchTerms,
  summarizeSourcingMemory,
  type HumanOrderDecision,
  type RecommendationCard,
  type SalesResult,
  type SourcingCandidate,
  type SourcingCostSettings,
  type SourcingFeedback,
  type SourcingInput,
} from "@/lib/sourcingEngine";

const FEEDBACK_STORAGE_KEY = "commerce-os:sourcing-engine-feedback";

const defaultForbiddenCategories = [
  "어린이",
  "유아",
  "의료",
  "건강효능",
  "산업용 안전",
  "보호구",
  "유리",
  "도자기",
  "전기",
  "배터리",
  "충전",
  "발열",
  "화학",
  "식품",
  "화장품",
  "상표",
  "캐릭터",
];

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

const numericCandidateFields = new Set<keyof SourcingCandidate>([
  "unitPriceCny",
  "moq",
  "chinaShippingFeeCny",
]);

const numberFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

export default function SourcingEnginePage() {
  const [input, setInput] = useState<SourcingInput>({
    mode: "FOLLOW_PROVEN",
    koreanQuery: "차량용 틈새 수납함",
    competitorUrl: "",
    targetPriceKrw: 9900,
    testBudgetKrw: 200000,
    forbiddenCategories: defaultForbiddenCategories,
  });
  const [costSettings, setCostSettings] = useState<SourcingCostSettings>({
    exchangeRateKrwPerCny: 190,
    testQuantity: 60,
    internationalShippingFeeKrw: 45000,
    agentFeeRate: 5,
  });
  const [candidates, setCandidates] = useState<SourcingCandidate[]>([
    createEmptyCandidate(1),
    createEmptyCandidate(2),
    createEmptyCandidate(3),
  ]);
  const [card, setCard] = useState<RecommendationCard | null>(null);
  const [feedbackList, setFeedbackList] = useState<SourcingFeedback[]>([]);
  const [feedbackDraft, setFeedbackDraft] = useState({
    humanOrderDecision: "ORDERED" as HumanOrderDecision,
    salesResult: "UNKNOWN" as SalesResult,
    reordered: false,
    categoryHint: "",
    failureReasons: [] as string[],
    memo: "",
  });

  const searchTerms = useMemo(
    () => generateChineseSearchTerms(input.koreanQuery),
    [input.koreanQuery],
  );
  const memorySegments = useMemo(
    () => summarizeSourcingMemory(feedbackList).slice(0, 8),
    [feedbackList],
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
      if (stored) {
        setFeedbackList(JSON.parse(stored) as SourcingFeedback[]);
      }
    } catch {
      setFeedbackList([]);
    }
  }, []);

  function updateInput<K extends keyof SourcingInput>(
    field: K,
    value: SourcingInput[K],
  ) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  function updateCostSetting<K extends keyof SourcingCostSettings>(
    field: K,
    value: string,
  ) {
    setCostSettings((current) => ({
      ...current,
      [field]: value === "" ? 0 : Number(value),
    }));
  }

  function toggleForbiddenCategory(category: string) {
    setInput((current) => {
      const exists = current.forbiddenCategories.includes(category);
      return {
        ...current,
        forbiddenCategories: exists
          ? current.forbiddenCategories.filter((item) => item !== category)
          : [...current.forbiddenCategories, category],
      };
    });
  }

  function updateCandidate(
    id: string,
    field: keyof SourcingCandidate,
    value: string,
  ) {
    setCandidates((current) =>
      current.map((candidate) => {
        if (candidate.id !== id) return candidate;

        return {
          ...candidate,
          [field]: numericCandidateFields.has(field)
            ? value === ""
              ? 0
              : Number(value)
            : value,
        };
      }),
    );
  }

  function addCandidate() {
    setCandidates((current) => [
      ...current,
      createEmptyCandidate(current.length + 1),
    ]);
  }

  function removeCandidate(id: string) {
    setCandidates((current) =>
      current.length <= 1
        ? current
        : current.filter((candidate) => candidate.id !== id),
    );
  }

  function loadSampleCandidates() {
    setCandidates([
      {
        id: "sample-1",
        url: "https://detail.1688.com/offer/100.html",
        imageUrl: "",
        titleCn: "汽车缝隙收纳盒",
        titleKr: "차량용 틈새 수납함",
        unitPriceCny: 8.6,
        moq: 2,
        chinaShippingFeeCny: 10,
        optionsText: "黑色, 灰色",
        shopName: "A factory",
        notes: "차량 호환 사이즈 확인 필요",
      },
      {
        id: "sample-2",
        url: "https://detail.1688.com/offer/101.html",
        imageUrl: "",
        titleCn: "车载缝隙储物盒",
        titleKr: "차량용 수납함",
        unitPriceCny: 9.2,
        moq: 2,
        chinaShippingFeeCny: 10,
        optionsText: "黑色",
        shopName: "B factory",
        notes: "",
      },
      {
        id: "sample-3",
        url: "https://detail.1688.com/offer/102.html",
        imageUrl: "",
        titleCn: "汽车座椅缝隙收纳",
        titleKr: "차량 좌석 틈새 수납",
        unitPriceCny: 9.5,
        moq: 2,
        chinaShippingFeeCny: 10,
        optionsText: "灰色",
        shopName: "C factory",
        notes: "",
      },
    ]);
  }

  function createRecommendation() {
    const nextCard = buildRecommendationCard({
      input,
      settings: costSettings,
      candidates,
    });
    setCard(nextCard);
    setFeedbackDraft((current) => ({
      ...current,
      humanOrderDecision:
        nextCard.decision === "ORDER_READY"
          ? "ORDERED"
          : nextCard.decision === "HOLD"
            ? "HOLD"
            : "REJECTED",
      categoryHint: input.koreanQuery,
    }));
  }

  function saveFeedback() {
    if (!card) return;

    const feedback: SourcingFeedback = {
      cardId: card.id,
      mode: card.mode,
      categoryHint: feedbackDraft.categoryHint,
      humanOrderDecision: feedbackDraft.humanOrderDecision,
      salesResult: feedbackDraft.salesResult,
      reordered: feedbackDraft.reordered,
      failureReasons: feedbackDraft.failureReasons,
      memo: feedbackDraft.memo,
      createdAt: new Date().toISOString(),
    };

    setFeedbackList((current) => {
      const next = [feedback, ...current].slice(0, 200);
      window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleFailureReason(reason: string) {
    setFeedbackDraft((current) => {
      const exists = current.failureReasons.includes(reason);
      return {
        ...current,
        failureReasons: exists
          ? current.failureReasons.filter((item) => item !== reason)
          : [...current.failureReasons, reason],
      };
    });
  }

  async function copySearchTerms() {
    if (searchTerms.length === 0) return;
    await navigator.clipboard.writeText(searchTerms.join("\n"));
  }

  return (
    <>
      <PageHeader
        title="1688 주문추천 카드 생성기"
        description="검증제품 따라팔기와 신규제품 먼저팔기 후보를 실제 1688 링크 안에서만 비교합니다. 위험 리스크를 먼저 제거하고, 테스트 주문 전 대략 비용·마진·백업 링크를 카드로 압축합니다."
        actions={
          <button
            type="button"
            onClick={createRecommendation}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            주문추천 카드 생성
          </button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="space-y-4">
          <Panel title="1. 소싱 모드">
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeButton
                selected={input.mode === "FOLLOW_PROVEN"}
                title="검증제품 따라팔기"
                description="네이버·도매꾹·오너클랜·쿠팡 등 이미 팔리는 상품을 1688에서 더 싸게 찾습니다."
                onClick={() => updateInput("mode", "FOLLOW_PROVEN")}
              />
              <ModeButton
                selected={input.mode === "DISCOVER_NEW"}
                title="유망 신규제품 먼저팔기"
                description="키워드·카테고리 씨앗으로 신규 테스트 후보를 만들고 1688 후보를 압축합니다."
                onClick={() => updateInput("mode", "DISCOVER_NEW")}
              />
            </div>
          </Panel>

          <Panel title="2. 입력값">
            <div className="grid gap-3">
              <LabeledInput
                label="한국어 상품명 / 키워드"
                value={input.koreanQuery}
                onChange={(value) => updateInput("koreanQuery", value)}
                placeholder="예: 차량용 틈새 수납함"
              />
              <LabeledInput
                label="경쟁상품 URL"
                value={input.competitorUrl}
                onChange={(value) => updateInput("competitorUrl", value)}
                placeholder="네이버, 도매꾹, 오너클랜, 쿠팡 URL"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput
                  label="목표 판매가"
                  type="number"
                  value={String(input.targetPriceKrw)}
                  onChange={(value) =>
                    updateInput(
                      "targetPriceKrw",
                      value === "" ? 0 : Number(value),
                    )
                  }
                  suffix="원"
                />
                <LabeledInput
                  label="테스트 예산"
                  type="number"
                  value={String(input.testBudgetKrw)}
                  onChange={(value) =>
                    updateInput(
                      "testBudgetKrw",
                      value === "" ? 0 : Number(value),
                    )
                  }
                  suffix="원"
                />
              </div>
            </div>
          </Panel>

          <Panel title="3. 테스트 비용 계산값">
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput
                label="환율"
                type="number"
                value={String(costSettings.exchangeRateKrwPerCny)}
                onChange={(value) =>
                  updateCostSetting("exchangeRateKrwPerCny", value)
                }
                suffix="원/CNY"
              />
              <LabeledInput
                label="테스트 수량"
                type="number"
                value={String(costSettings.testQuantity)}
                onChange={(value) => updateCostSetting("testQuantity", value)}
                suffix="개"
              />
              <LabeledInput
                label="국제 배송비 추정"
                type="number"
                value={String(costSettings.internationalShippingFeeKrw)}
                onChange={(value) =>
                  updateCostSetting("internationalShippingFeeKrw", value)
                }
                suffix="원"
              />
              <LabeledInput
                label="구매대행/수수료율"
                type="number"
                value={String(costSettings.agentFeeRate)}
                onChange={(value) => updateCostSetting("agentFeeRate", value)}
                suffix="%"
              />
            </div>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              정밀 원가가 아니라 테스트 주문 판단용입니다. 관부가세, 플랫폼
              수수료, 광고비, 반품비, 불량충당, 포장비는 MVP 계산에서
              제외합니다.
            </p>
          </Panel>

          <Panel title="4. 위험 카테고리 필터">
            <div className="flex flex-wrap gap-2">
              {defaultForbiddenCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleForbiddenCategory(category)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    input.forbiddenCategories.includes(category)
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              애매하면 주문 가능이 아니라 보류로 보냅니다. 어린이·의료·산업용
              안전·전기·화학·상표·깨지기 쉬운 유리류는 강하게 차단합니다.
            </p>
          </Panel>

          <Panel
            title="5. 1688 후보 링크"
            actions={
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={loadSampleCandidates}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  샘플 채우기
                </button>
                <button
                  type="button"
                  onClick={addCandidate}
                  className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                >
                  후보 추가
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {candidates.map((candidate, index) => (
                <CandidateEditor
                  key={candidate.id}
                  index={index}
                  candidate={candidate}
                  onUpdate={updateCandidate}
                  onRemove={removeCandidate}
                  removable={candidates.length > 1}
                />
              ))}
            </div>
          </Panel>
        </section>

        <section className="space-y-4">
          <Panel
            title="중국어 검색어 초안"
            actions={
              <button
                type="button"
                onClick={copySearchTerms}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                복사
              </button>
            }
          >
            {searchTerms.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {searchTerms.map((term) => (
                  <span
                    key={term}
                    className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700"
                  >
                    {term}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                상품명/키워드를 입력하면 1688 검색어 후보가 표시됩니다.
              </p>
            )}
          </Panel>

          <RecommendationCardView card={card} />

          <Panel title="수동 피드백 / 소싱 기억장치">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  판매 결과 입력
                </h3>
                <div className="mt-3 grid gap-3">
                  <SelectField
                    label="주문 판단"
                    value={feedbackDraft.humanOrderDecision}
                    onChange={(value) =>
                      setFeedbackDraft((current) => ({
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
                    value={feedbackDraft.salesResult}
                    onChange={(value) =>
                      setFeedbackDraft((current) => ({
                        ...current,
                        salesResult: value as SalesResult,
                      }))
                    }
                    options={[
                      ["UNKNOWN", "아직 모름"],
                      ["SUCCESS", "성공"],
                      ["NEUTRAL", "애매"],
                      ["FAIL", "실패"],
                    ]}
                  />
                  <LabeledInput
                    label="카테고리/패턴 힌트"
                    value={feedbackDraft.categoryHint}
                    onChange={(value) =>
                      setFeedbackDraft((current) => ({
                        ...current,
                        categoryHint: value,
                      }))
                    }
                    placeholder="예: 차량용 수납, 캠핑 소품"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={feedbackDraft.reordered}
                      onChange={(event) =>
                        setFeedbackDraft((current) => ({
                          ...current,
                          reordered: event.target.checked,
                        }))
                      }
                    />
                    재주문함
                  </label>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold text-slate-500">
                    실패/주의 사유
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {failureReasonOptions.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => toggleFailureReason(reason)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          feedbackDraft.failureReasons.includes(reason)
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
                  <span className="text-xs font-semibold text-slate-500">
                    메모
                  </span>
                  <textarea
                    value={feedbackDraft.memo}
                    onChange={(event) =>
                      setFeedbackDraft((current) => ({
                        ...current,
                        memo: event.target.value,
                      }))
                    }
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    placeholder="다음 추천에 반영할 판단 메모"
                  />
                </label>

                <button
                  type="button"
                  onClick={saveFeedback}
                  disabled={!card}
                  className="mt-4 w-full rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  피드백 저장
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  누적 타율 힌트
                </h3>
                {memorySegments.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {memorySegments.map((segment) => (
                      <div
                        key={segment.segmentKey}
                        className="rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-semibold text-slate-700">
                            {segment.segmentKey}
                          </span>
                          <span className="text-xs font-bold text-blue-700">
                            {percentFormatter.format(segment.successRate * 100)}
                            %
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          총 {segment.total}회 · 성공 {segment.success} · 애매{" "}
                          {segment.neutral} · 실패 {segment.fail}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    판매 결과를 저장하면 모드별·카테고리별 성공률이 누적됩니다.
                    초기 버전은 복잡한 머신러닝 대신 수동 피드백 기반 가중치
                    힌트를 만듭니다.
                  </p>
                )}
              </div>
            </div>
          </Panel>
        </section>
      </div>
    </>
  );
}

function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-950">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ModeButton({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        selected
          ? "border-blue-400 bg-blue-50 text-blue-950"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      <p className="text-sm font-bold">{title}</p>
      <p className="mt-2 text-xs leading-5">{description}</p>
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">
        {label}
      </span>
      <div className="flex rounded-lg border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
        />
        {suffix ? (
          <span className="flex items-center px-3 text-xs font-semibold text-slate-400">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
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
      <span className="mb-1 block text-xs font-semibold text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function CandidateEditor({
  index,
  candidate,
  onUpdate,
  onRemove,
  removable,
}: {
  index: number;
  candidate: SourcingCandidate;
  onUpdate: (
    id: string,
    field: keyof SourcingCandidate,
    value: string,
  ) => void;
  onRemove: (id: string) => void;
  removable: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-700">
          후보 {index + 1}
        </h3>
        <button
          type="button"
          onClick={() => onRemove(candidate.id)}
          disabled={!removable}
          className="text-xs font-semibold text-red-500 disabled:text-slate-300"
        >
          삭제
        </button>
      </div>
      <div className="grid gap-3">
        <LabeledInput
          label="1688 URL"
          value={candidate.url}
          onChange={(value) => onUpdate(candidate.id, "url", value)}
          placeholder="https://detail.1688.com/offer/..."
        />
        <LabeledInput
          label="이미지 URL"
          value={candidate.imageUrl}
          onChange={(value) => onUpdate(candidate.id, "imageUrl", value)}
          placeholder="대표 이미지 URL"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="중국어 상품명"
            value={candidate.titleCn}
            onChange={(value) => onUpdate(candidate.id, "titleCn", value)}
            placeholder="汽车缝隙收纳盒"
          />
          <LabeledInput
            label="한국어 설명"
            value={candidate.titleKr}
            onChange={(value) => onUpdate(candidate.id, "titleKr", value)}
            placeholder="차량용 틈새 수납함"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <LabeledInput
            label="1688 단가"
            type="number"
            value={String(candidate.unitPriceCny)}
            onChange={(value) => onUpdate(candidate.id, "unitPriceCny", value)}
            suffix="CNY"
          />
          <LabeledInput
            label="MOQ"
            type="number"
            value={String(candidate.moq)}
            onChange={(value) => onUpdate(candidate.id, "moq", value)}
            suffix="개"
          />
          <LabeledInput
            label="중국 내 배송비"
            type="number"
            value={String(candidate.chinaShippingFeeCny)}
            onChange={(value) =>
              onUpdate(candidate.id, "chinaShippingFeeCny", value)
            }
            suffix="CNY"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput
            label="옵션"
            value={candidate.optionsText}
            onChange={(value) => onUpdate(candidate.id, "optionsText", value)}
            placeholder="黑色, 灰色"
          />
          <LabeledInput
            label="공급처명"
            value={candidate.shopName}
            onChange={(value) => onUpdate(candidate.id, "shopName", value)}
            placeholder="상점명"
          />
        </div>
        <LabeledInput
          label="주의 메모"
          value={candidate.notes}
          onChange={(value) => onUpdate(candidate.id, "notes", value)}
          placeholder="사이즈 확인 필요, 포장 문의 필요 등"
        />
      </div>
    </div>
  );
}

function RecommendationCardView({ card }: { card: RecommendationCard | null }) {
  if (!card) {
    return (
      <Panel title="주문추천 카드">
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">
            아직 생성된 카드가 없습니다.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            입력값과 실제 1688 후보 링크를 넣은 뒤 주문추천 카드를
            생성하세요.
          </p>
        </div>
      </Panel>
    );
  }

  const primary = card.primary;

  return (
    <Panel title="주문추천 카드">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="bg-slate-100">
            {primary?.candidate.imageUrl ? (
              <img
                src={primary.candidate.imageUrl}
                alt={card.koreanProductName}
                className="h-full min-h-60 w-full object-cover"
              />
            ) : (
              <div className="flex h-full min-h-60 items-center justify-center px-6 text-center text-sm font-semibold text-slate-400">
                이미지 URL을 넣으면 여기에 표시됩니다.
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <DecisionBadge decision={card.decision} />
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {card.modeLabel}
              </span>
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                위험 {card.riskLevel}
              </span>
            </div>

            <h2 className="text-xl font-bold tracking-tight text-slate-950">
              {card.koreanProductName}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {card.shortDescription}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="총 테스트 비용" value={formatKrw(card.estimatedTotalTestCostKrw)} />
              <Metric label="개당 대략 원가" value={formatKrw(card.estimatedUnitCostKrw)} />
              <Metric label="목표 판매가" value={formatKrw(card.targetPriceKrw)} />
              <Metric
                label="대략 마진율"
                value={`${percentFormatter.format(card.estimatedMarginRate * 100)}%`}
              />
            </div>

            <div className="mt-5 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              {card.costNotice}
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-200 p-5 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              1순위 1688 링크
            </h3>
            {primary ? (
              <SourcingLinkItem
                title={primary.candidate.titleKr || primary.candidate.titleCn}
                url={primary.candidate.url}
                score={primary.score.score}
                shopName={primary.candidate.shopName}
              />
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                추천 가능한 1순위 후보가 없습니다.
              </p>
            )}

            <h3 className="mt-5 text-sm font-bold text-slate-900">
              백업 링크
            </h3>
            <div className="mt-2 space-y-2">
              {card.backups.length > 0 ? (
                card.backups.map((backup) => (
                  <SourcingLinkItem
                    key={backup.candidate.id}
                    title={backup.candidate.titleKr || backup.candidate.titleCn}
                    url={backup.candidate.url}
                    score={backup.score.score}
                    shopName={backup.candidate.shopName}
                  />
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  백업 링크가 부족합니다. 1688 후보를 3개 이상 넣어야 주문
                  가능 판단이 쉬워집니다.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <InfoBlock
              title="추천 옵션 / 테스트 수량"
              items={[
                `테스트 수량: ${card.testQuantity}개`,
                ...card.recommendedOptions.map((option) => `옵션: ${option}`),
              ]}
            />
            <InfoBlock title="추천 이유" items={card.recommendationReasons} />
            <InfoBlock title="핵심 리스크" items={card.riskNotes} />
            <InfoBlock title="공급처 문의 문구" items={card.supplierQuestionsCn} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function DecisionBadge({ decision }: { decision: RecommendationCard["decision"] }) {
  const className =
    decision === "ORDER_READY"
      ? "bg-emerald-50 text-emerald-700"
      : decision === "HOLD"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";
  const label =
    decision === "ORDER_READY" ? "주문 가능" : decision === "HOLD" ? "보류" : "폐기";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>
      {label}
    </span>
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

function SourcingLinkItem({
  title,
  url,
  score,
  shopName,
}: {
  title: string;
  url: string;
  score: number;
  shopName: string;
}) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {title || "1688 후보"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {shopName || "공급처명 없음"} · 점수 {score}
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          1688 열기
        </a>
      </div>
      <p className="mt-2 truncate text-xs text-slate-400">{url}</p>
    </div>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.length > 0 ? (
          items.map((item) => (
            <li key={item} className="text-sm leading-6 text-slate-600">
              • {item}
            </li>
          ))
        ) : (
          <li className="text-sm text-slate-500">입력값 없음</li>
        )}
      </ul>
    </div>
  );
}

function formatKrw(value: number) {
  return `${numberFormatter.format(Math.max(0, Math.round(value)))}원`;
}
