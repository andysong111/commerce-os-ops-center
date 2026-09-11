import type { CommerceModule } from "@/lib/moduleRegistry";

export type OpsWorkspaceId =
  | "sourcing-order"
  | "warehouse-inbound"
  | "product-launch"
  | "content-keyword"
  | "sales-price"
  | "system-check";

export type OpsWorkspaceGroup = {
  id: OpsWorkspaceId;
  label: string;
  shortLabel: string;
  iconLabel: string;
  description: string;
  moduleIds: readonly string[];
  searchTerms: readonly string[];
};

export const OPS_WORKSPACE_GROUPS: readonly OpsWorkspaceGroup[] = [
  {
    id: "sourcing-order",
    label: "소싱·발주",
    shortLabel: "소싱·발주",
    iconLabel: "발",
    description: "상품 후보를 고르고 발주수량·단종 여부를 판단한 뒤 중국 주문을 관리합니다.",
    moduleIds: ["sourcing-engine", "product-decision-agent", "china-order-cost"],
    searchTerms: ["소싱", "1688", "발주", "주문", "단종", "입고원가"],
  },
  {
    id: "warehouse-inbound",
    label: "입고·창고",
    shortLabel: "입고·창고",
    iconLabel: "창",
    description: "배대지 바코드, 입고 확인, 창고 지도·위치코드와 창고 라벨을 한 흐름으로 처리합니다.",
    moduleIds: [
      "freight-barcode-pdf",
      "warehouse-capacity",
      "warehouse-location-sync",
      "warehouse-label-generator",
      "shopling-option-barcode-sync",
    ],
    searchTerms: ["배대지", "입고", "누락", "창고", "지도", "수용률", "위치코드", "바코드", "라벨"],
  },
  {
    id: "product-launch",
    label: "상품·출시",
    shortLabel: "상품·출시",
    iconLabel: "출",
    description: "상품 마스터부터 신규 상품 준비, AI 카테고리 검토와 샵플링 등록까지 출시 작업을 연결합니다.",
    moduleIds: [
      "product-master",
      "product-launch-tracker",
      "shopling-category-review-queue",
      "detail-page-studio-launch-connector",
      "detail-page-ai-review",
      "product-launch-flow",
      "shopling-product-upload-runner",
    ],
    searchTerms: [
      "상품",
      "모델번호",
      "신규",
      "출시",
      "등록",
      "업로드",
      "샵플링",
      "카테고리",
      "AI",
      "검토",
    ],
  },
  {
    id: "content-keyword",
    label: "콘텐츠·키워드",
    shortLabel: "콘텐츠·키워드",
    iconLabel: "콘",
    description: "상세페이지와 키워드·상품명 생성, 결과 검토를 관리합니다.",
    moduleIds: [
      "detail-page-studio",
      "detail-page-studio-test",
      "keyword-engine",
      "keyword-review-queue",
    ],
    searchTerms: ["상세페이지", "이미지", "키워드", "검색어", "상품명", "콘텐츠", "테스트버전"],
  },
  {
    id: "sales-price",
    label: "판매·가격",
    shortLabel: "판매·가격",
    iconLabel: "가",
    description: "판매가 정책, 인상·인하, 마진 방어와 채널 반영 작업을 실행합니다.",
    moduleIds: [
      "internal-china-cost-price-review",
      "shopling-price-adjustment-runner",
      "shopling-price-modify-runner",
      "price-adjustment-engine",
      "inventory-price",
      "shopling-api-automation",
    ],
    searchTerms: [
      "판매",
      "가격",
      "판매가",
      "인상",
      "인하",
      "마진",
      "정책",
      "채널",
      "확정원가",
      "상품그룹",
      "쇼핑몰별 목표가",
    ],
  },
  {
    id: "system-check",
    label: "시스템·점검",
    shortLabel: "시스템·점검",
    iconLabel: "점",
    description: "자기개선 상태, 반복 오류, 실패 이력, 외부 엔진 연결, 환경변수와 내부 운영 정보를 점검합니다.",
    moduleIds: [
      "reliability-learning-core",
      "engine-runner-history",
      "engine-env-setup",
      "detail-page-cost-admin",
    ],
    searchTerms: [
      "자기개선",
      "신뢰성",
      "학습",
      "회귀",
      "오류",
      "실패",
      "이력",
      "점검",
      "환경변수",
      "설정",
      "원가",
      "관리자",
    ],
  },
] as const;

export const DEFAULT_FAVORITE_MODULE_IDS = [
  "china-order-cost",
  "internal-china-cost-price-review",
  "product-launch-tracker",
  "detail-page-studio",
  "detail-page-studio-test",
  "shopling-price-adjustment-runner",
] as const;

export type OpsCommandIntent = {
  label: string;
  reason: string;
  moduleIds: readonly string[];
};

const COMMAND_INTENTS: readonly (OpsCommandIntent & { patterns: readonly RegExp[] })[] = [
  {
    label: "가격 작업",
    reason: "판매가·마진·인상·인하 관련 표현을 인식했습니다.",
    moduleIds: [
      "internal-china-cost-price-review",
      "shopling-price-adjustment-runner",
      "shopling-price-modify-runner",
      "price-adjustment-engine",
    ],
    patterns: [/가격/, /판매가/, /인상/, /인하/, /마진/, /가격정책/, /확정원가/, /상품그룹/],
  },
  {
    label: "AI 카테고리 검토",
    reason: "샵플링 표준카테고리 추천·검토 관련 표현을 인식했습니다.",
    moduleIds: ["shopling-category-review-queue", "product-launch-tracker"],
    patterns: [/카테고리.*검토/, /검토.*카테고리/, /AI.*카테고리/, /표준카테고리/],
  },
  {
    label: "상품 출시",
    reason: "신규 상품 등록·출시·샵플링 업로드 관련 표현을 인식했습니다.",
    moduleIds: [
      "product-launch-tracker",
      "shopling-category-review-queue",
      "product-launch-flow",
      "shopling-product-upload-runner",
    ],
    patterns: [/신규/, /출시/, /상품등록/, /등록/, /업로드/, /샵플링.*상품/],
  },
  {
    label: "창고 작업",
    reason: "위치코드·바코드·라벨·창고 관련 표현을 인식했습니다.",
    moduleIds: ["warehouse-capacity", "warehouse-location-sync", "warehouse-label-generator", "shopling-option-barcode-sync"],
    patterns: [/위치코드/, /바코드/, /라벨/, /창고/, /창고지도/, /수용률/],
  },
  {
    label: "입고 작업",
    reason: "중국 주문·배대지·입고·누락 관련 표현을 인식했습니다.",
    moduleIds: ["china-order-cost", "freight-barcode-pdf"],
    patterns: [/중국.*주문/, /발주입고/, /입고/, /누락/, /배대지/],
  },
  {
    label: "발주 판단",
    reason: "발주수량·재주문·단종 판단 관련 표현을 인식했습니다.",
    moduleIds: ["product-decision-agent", "sourcing-engine", "china-order-cost"],
    patterns: [/발주/, /재주문/, /단종/, /소싱/, /1688/],
  },
  {
    label: "키워드·상품명",
    reason: "키워드·검색어·상품명 작업 관련 표현을 인식했습니다.",
    moduleIds: ["keyword-engine", "keyword-review-queue", "product-launch-flow"],
    patterns: [/키워드/, /검색어/, /상품명/],
  },
  {
    label: "상세페이지",
    reason: "상세페이지·상품 이미지 제작 관련 표현을 인식했습니다.",
    moduleIds: [
      "detail-page-studio-test",
      "detail-page-studio",
      "detail-page-studio-launch-connector",
      "detail-page-ai-review",
    ],
    patterns: [/상세페이지/, /상세.*이미지/, /이미지.*제작/],
  },
  {
    label: "자기개선 점검",
    reason: "자기개선·신뢰성·학습·회귀 관련 표현을 인식했습니다.",
    moduleIds: ["reliability-learning-core", "engine-runner-history"],
    patterns: [/자기개선/, /신뢰성/, /학습.*오류/, /회귀/, /재발.*방지/],
  },
  {
    label: "오류·실패 점검",
    reason: "오류·실패·이력 확인 관련 표현을 인식했습니다.",
    moduleIds: [
      "reliability-learning-core",
      "detail-page-ai-review",
      "engine-runner-history",
      "engine-env-setup",
    ],
    patterns: [/오류/, /실패/, /에러/, /이력/, /환경변수/, /연결.*확인/],
  },
] as const;

const MODEL_NUMBER_PATTERN = /\b[A-Z]{2,6}\d{2,6}(?:[-_][A-Z0-9]+)?\b/i;
const GOODS_KEY_PATTERN = /(?:goods[_\s-]?key\s*[:#]?\s*)?(\d{5,})/i;

export function getWorkspaceGroup(moduleId: string) {
  return OPS_WORKSPACE_GROUPS.find((group) => group.moduleIds.includes(moduleId));
}

export function getWorkspaceGroupById(groupId: string | null | undefined) {
  return OPS_WORKSPACE_GROUPS.find((group) => group.id === groupId) ?? null;
}

export function extractModelNumber(query: string) {
  return query.toUpperCase().match(MODEL_NUMBER_PATTERN)?.[0] ?? null;
}

export function extractGoodsKey(query: string) {
  return query.match(GOODS_KEY_PATTERN)?.[1] ?? null;
}

export function resolveOpsCommand(query: string): OpsCommandIntent | null {
  const normalized = query.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  if (!normalized) return null;
  return (
    COMMAND_INTENTS.find((intent) =>
      intent.patterns.some((pattern) => pattern.test(normalized)),
    ) ?? null
  );
}

export function rankWorkspaceModules(
  modules: readonly CommerceModule[],
  query: string,
): CommerceModule[] {
  const normalized = normalize(query);
  if (!normalized) return [...modules];

  const tokens = normalized.split(" ").filter(Boolean);
  const command = resolveOpsCommand(query);
  const modelNumber = extractModelNumber(query);
  const goodsKey = extractGoodsKey(query);

  return modules
    .map((module) => {
      const group = getWorkspaceGroup(module.id);
      const haystack = normalize(
        [
          module.title,
          module.navigationLabel,
          module.description,
          module.category,
          module.inputType,
          module.outputType,
          module.helperNote,
          module.note,
          group?.label,
          group?.searchTerms.join(" "),
        ]
          .filter(Boolean)
          .join(" "),
      );

      let score = 0;
      if (haystack.includes(normalized)) score += 80;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 12;
        if (normalize(module.title).startsWith(token)) score += 18;
      }
      const commandIndex = command?.moduleIds.indexOf(module.id) ?? -1;
      if (commandIndex >= 0) score += 70 - commandIndex * 8;
      if (
        modelNumber &&
        [
          "product-master",
          "product-launch-tracker",
          "shopling-category-review-queue",
          "product-launch-flow",
          "shopling-product-upload-runner",
          "shopling-price-adjustment-runner",
        ].includes(module.id)
      ) {
        score += 45;
      }
      if (
        goodsKey &&
        [
          "shopling-price-adjustment-runner",
          "shopling-price-modify-runner",
          "keyword-engine",
          "product-launch-flow",
        ].includes(module.id)
      ) {
        score += 45;
      }
      return { module, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.module.title.localeCompare(right.module.title, "ko"),
    )
    .map((entry) => entry.module);
}

export function moduleRouteWithContext(module: CommerceModule, query: string) {
  if (!module.route) return null;
  const modelNumber = extractModelNumber(query);
  const goodsKey = extractGoodsKey(query);
  const context = modelNumber ?? goodsKey;
  if (!context || /^https?:\/\//.test(module.route)) return module.route;
  const separator = module.route.includes("?") ? "&" : "?";
  return `${module.route}${separator}q=${encodeURIComponent(context)}`;
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[_/·,()[\]{}:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}