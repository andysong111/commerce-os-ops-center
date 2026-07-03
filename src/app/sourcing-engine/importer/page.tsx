"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { parseCandidateImportText } from "@/lib/sourcingCandidateImport";
import {
  buildRecommendationCard,
  generateChineseSearchTerms,
  getSourcingModeLabel,
  type RecommendationCard,
  type SourcingCandidate,
  type SourcingCostSettings,
  type SourcingInput,
  type SourcingMode,
} from "@/lib/sourcingEngine";

const defaultRawText = `https://detail.1688.com/offer/100.html
汽车缝隙收纳盒
价格: 8.6
起批量: 2
运费: 10
颜色: 黑色, 灰色
店铺: A factory

https://detail.1688.com/offer/101.html
车载缝隙储物盒
价格: 9.2
起批量: 2
运费: 10
颜色: 黑色
店铺: B factory

https://detail.1688.com/offer/102.html
汽车座椅缝隙收纳
价格: 9.5
起批量: 2
运费: 10
颜色: 灰色
店铺: C factory`;

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

const numberFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

export default function SourcingEngineImporterPage() {
  const [input, setInput] = useState<SourcingInput>({
    mode: "FOLLOW_PROVEN",
    koreanQuery: "차량용 틈새 수납함",
    competitorUrl: "",
    targetPriceKrw: 9900,
    testBudgetKrw: 200000,
    forbiddenCategories: defaultForbiddenCategories,
  });
  const [settings, setSettings] = useState<SourcingCostSettings>({
    exchangeRateKrwPerCny: 190,
    testQuantity: 60,
    internationalShippingFeeKrw: 45000,
    agentFeeRate: 5,
  });
  const [rawText, setRawText] = useState(defaultRawText);
  const [candidates, setCandidates] = useState<SourcingCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [card, setCard] = useState<RecommendationCard | null>(null);
  const [decisionMemo, setDecisionMemo] = useState("");

  const searchTerms = useMemo(
    () => generateChineseSearchTerms(input.koreanQuery),
    [input.koreanQuery],
  );

  function parseCandidates() {
    const result = parseCandidateImportText(rawText);
    setCandidates(result.candidates);
    setWarnings(result.warnings);
    setCard(null);
  }

  function createCard() {
    const result = buildRecommendationCard({ input, settings, candidates });
    setCard(result);
    setDecisionMemo(
      `${result.decisionLabel} / ${result.koreanProductName} / ${result.primary?.candidate.url ?? "후보 없음"}`,
    );
  }

  function updateInput<K extends keyof SourcingInput>(
    field: K,
    value: SourcingInput[K],
  ) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  function updateSettings<K extends keyof SourcingCostSettings>(
    field: K,
    value: string,
  ) {
    setSettings((current) => ({
      ...current,
      [field]: value === "" ? 0 : Number(value),
    }));
  }

  function setMode(mode: SourcingMode) {
    updateInput("mode", mode);
  }

  async function copyDecisionMemo() {
    await navigator.clipboard.writeText(decisionMemo);
  }

  return (
    <>
      <PageHeader
        title="1688 후보 일괄 파서 + 주문추천"
        description="1688 후보 정보를 한 번에 붙여넣고 후보 링크 3개 이상을 자동 분해한 뒤, 저장된 링크 안에서만 1순위와 백업 2개를 고릅니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={parseCandidates}
              className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              후보 파싱
            </button>
            <button
              type="button"
              onClick={createCard}
              disabled={candidates.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              카드 생성
            </button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="space-y-4">
          <Panel title="1. 소싱 기준">
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeButton
                selected={input.mode === "FOLLOW_PROVEN"}
                title="검증제품 따라팔기"
                description="기존 판매상품 URL/상품명을 기준으로 1688 유사후보를 압축합니다."
                onClick={() => setMode("FOLLOW_PROVEN")}
              />
              <ModeButton
                selected={input.mode === "DISCOVER_NEW"}
                title="유망 신규제품 먼저팔기"
                description="키워드 씨앗으로 신규 테스트 후보를 검토합니다."
                onClick={() => setMode("DISCOVER_NEW")}
              />
            </div>
            <div className="mt-4 grid gap-3">
              <InputField
                label="한국어 상품명 / 키워드"
                value={input.koreanQuery}
                onChange={(value) => updateInput("koreanQuery", value)}
              />
              <InputField
                label="경쟁상품 URL"
                value={input.competitorUrl}
                onChange={(value) => updateInput("competitorUrl", value)}
                placeholder="네이버, 도매꾹, 오너클랜, 쿠팡 URL"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <InputField
                  label="목표 판매가"
                  type="number"
                  value={String(input.targetPriceKrw)}
                  suffix="원"
                  onChange={(value) =>
                    updateInput("targetPriceKrw", value === "" ? 0 : Number(value))
                  }
                />
                <InputField
                  label="테스트 예산"
                  type="number"
                  value={String(input.testBudgetKrw)}
                  suffix="원"
                  onChange={(value) =>
                    updateInput("testBudgetKrw", value === "" ? 0 : Number(value))
                  }
                />
              </div>
            </div>
          </Panel>

          <Panel title="2. 테스트 비용 기준">
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField
                label="환율"
                type="number"
                value={String(settings.exchangeRateKrwPerCny)}
                suffix="원/CNY"
                onChange={(value) => updateSettings("exchangeRateKrwPerCny", value)}
              />
              <InputField
                label="테스트 수량"
                type="number"
                value={String(settings.testQuantity)}
                suffix="개"
                onChange={(value) => updateSettings("testQuantity", value)}
              />
              <InputField
                label="국제 배송비 추정"
                type="number"
                value={String(settings.internationalShippingFeeKrw)}
                suffix="원"
                onChange={(value) => updateSettings("internationalShippingFeeKrw", value)}
              />
              <InputField
                label="구매대행/수수료율"
                type="number"
                value={String(settings.agentFeeRate)}
                suffix="%"
                onChange={(value) => updateSettings("agentFeeRate", value)}
              />
            </div>
          </Panel>

          <Panel title="3. 1688 후보 일괄 붙여넣기">
            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              지원 형식: 자유 텍스트, 탭/CSV, JSON. URL, 상품명, 가격, MOQ,
              배송비, 옵션, 공급처가 섞여 있어도 가능한 범위에서 자동 추출합니다.
            </div>
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              rows={16}
              className="w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-xs leading-5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRawText(defaultRawText)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                샘플 채우기
              </button>
              <button
                type="button"
                onClick={() => setRawText("")}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                비우기
              </button>
            </div>
          </Panel>
        </section>

        <section className="space-y-4">
          <Panel title="중국어 검색어">
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
              <p className="text-sm text-slate-500">키워드를 입력하면 표시됩니다.</p>
            )}
          </Panel>

          <Panel title={`파싱된 후보 ${candidates.length}개`}>
            {warnings.length > 0 ? (
              <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                {warnings.map((warning) => (
                  <p key={warning}>• {warning}</p>
                ))}
              </div>
            ) : null}
            {candidates.length > 0 ? (
              <div className="space-y-2">
                {candidates.map((candidate, index) => (
                  <CandidateRow key={candidate.id} candidate={candidate} index={index} />
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-500">
                후보 파싱을 누르면 실제 1688 링크 후보가 여기에 정리됩니다.
              </p>
            )}
          </Panel>

          <RecommendationResult card={card} />

          <Panel title="판단 메모">
            <textarea
              value={decisionMemo}
              onChange={(event) => setDecisionMemo(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="주문/보류/폐기 판단 메모"
            />
            <button
              type="button"
              onClick={copyDecisionMemo}
              disabled={!decisionMemo}
              className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              판단 메모 복사
            </button>
          </Panel>
        </section>
      </div>
    </>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold text-slate-950">{title}</h2>
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

function InputField({
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

function CandidateRow({
  candidate,
  index,
}: {
  candidate: SourcingCandidate;
  index: number;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400">후보 {index + 1}</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900">
            {candidate.titleKr || candidate.titleCn || "상품명 없음"}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">{candidate.url}</p>
        </div>
        <a
          href={candidate.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          열기
        </a>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
        <span>단가 {candidate.unitPriceCny} CNY</span>
        <span>MOQ {candidate.moq}</span>
        <span>중국배송 {candidate.chinaShippingFeeCny} CNY</span>
        <span>{candidate.shopName || "공급처 없음"}</span>
      </div>
      {candidate.optionsText ? (
        <p className="mt-2 text-xs text-slate-500">옵션: {candidate.optionsText}</p>
      ) : null}
    </article>
  );
}

function RecommendationResult({ card }: { card: RecommendationCard | null }) {
  if (!card) {
    return (
      <Panel title="주문추천 결과">
        <p className="text-sm leading-6 text-slate-500">
          후보를 파싱한 뒤 카드 생성을 누르면 1순위와 백업 2개가 표시됩니다.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="주문추천 결과">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DecisionBadge decision={card.decision} />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {getSourcingModeLabel(card.mode)}
        </span>
        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
          위험 {card.riskLevel}
        </span>
      </div>

      <h3 className="text-lg font-bold text-slate-950">{card.koreanProductName}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{card.shortDescription}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Metric label="총비용" value={formatKrw(card.estimatedTotalTestCostKrw)} />
        <Metric label="개당원가" value={formatKrw(card.estimatedUnitCostKrw)} />
        <Metric label="판매가" value={formatKrw(card.targetPriceKrw)} />
        <Metric
          label="마진율"
          value={`${percentFormatter.format(card.estimatedMarginRate * 100)}%`}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900">1순위 링크</h4>
          {card.primary ? (
            <LinkCard candidate={card.primary.candidate} score={card.primary.score.score} />
          ) : (
            <p className="mt-2 text-sm text-slate-500">1순위 후보 없음</p>
          )}
          <h4 className="mt-4 text-sm font-bold text-slate-900">백업 링크</h4>
          <div className="mt-2 space-y-2">
            {card.backups.length > 0 ? (
              card.backups.map((backup) => (
                <LinkCard
                  key={backup.candidate.id}
                  candidate={backup.candidate}
                  score={backup.score.score}
                />
              ))
            ) : (
              <p className="text-sm text-slate-500">백업 후보 부족</p>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <InfoBlock title="추천 이유" items={card.recommendationReasons} />
          <InfoBlock title="핵심 리스크" items={card.riskNotes} />
          <InfoBlock title="공급처 문의 문구" items={card.supplierQuestionsCn} />
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
        {card.costNotice}
      </p>
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
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-950">{value}</p>
    </div>
  );
}

function LinkCard({
  candidate,
  score,
}: {
  candidate: SourcingCandidate;
  score: number;
}) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 p-3">
      <p className="truncate text-sm font-semibold text-slate-900">
        {candidate.titleKr || candidate.titleCn || "1688 후보"}
      </p>
      <p className="mt-1 text-xs text-slate-500">점수 {score} · {candidate.shopName || "공급처 없음"}</p>
      <a
        href={candidate.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
      >
        1688 열기
      </a>
    </div>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-slate-900">{title}</h4>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-sm leading-6 text-slate-600">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatKrw(value: number) {
  return `${numberFormatter.format(Math.max(0, Math.round(value)))}원`;
}
