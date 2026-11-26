export type OpsAiKnowledgeSection = {
  id: string;
  title: string;
  route: string | null;
  keywords: string[];
  content: string;
  source: string;
  version: string;
};

export type OpsAiPageContext = {
  pathname: string;
  title: string;
  url: string;
};

const ACTION_REQUEST_PATTERNS = [
  /(?:기능|화면|버튼|api|코드|레포|저장소|db|데이터베이스).{0,24}(?:만들어|추가해|개발해|수정해|고쳐|바꿔|삭제해|배포해|머지해|커밋해)/i,
  /(?:만들어|추가해|개발해|수정해|고쳐|바꿔|삭제해|배포해|머지해|커밋해).{0,24}(?:줘|주세요|해줘|해라|진행해)/i,
  /(?:실제|바로|지금).{0,16}(?:실행해|주문해|결제해|등록해|변경해|전송해|반영해|삭제해)/i,
  /(?:가격|재고|상품|주문|결제|입고).{0,20}(?:올려줘|내려줘|바꿔줘|처리해줘|확정해줘|실행해줘)/i,
  /(?:지시|규칙|프롬프트|시스템\s*메시지).{0,20}(?:무시|공개|보여|출력)/i,
  /(?:소스\s*코드|코드).{0,20}(?:작성|출력|보여|알려)/i,
];

const EXPLANATION_PATTERNS = [
  /어떻게\s*(?:사용|쓰|진행|입력|확인|재시도)/i,
  /무엇|뭐야|의미|설명|순서|주의|차이|왜|어디|눌러도|하면\s*(?:돼|되|어떻게)/i,
  /사용법|도움말|오류|에러|실패|비활성|안\s*돼|반응이\s*없/i,
];

export const STATIC_OPS_AI_KNOWLEDGE: readonly OpsAiKnowledgeSection[] = [
  {
    id: "assistant-boundary",
    title: "AI 사용상담원 범위",
    route: null,
    keywords: ["AI", "상담", "도움말", "사용법", "개발", "실행", "권한"],
    content:
      "AI 사용상담원은 Commerce OS와 OPS Center의 기존 기능을 어디서 찾고 어떤 순서로 사용하는지, 버튼과 상태값이 무엇을 의미하는지, 오류가 났을 때 어떤 안전한 확인을 해야 하는지만 안내한다. 신규 기능 개발, 코드 수정, GitHub 작업, 배포, 데이터베이스 변경, 샵플링 쓰기, 1688 주문·결제 같은 실제 실행은 하지 않는다. 근거가 부족하면 추측하지 않고 현재 화면명과 오류 문구를 요청한다.",
    source: "ops-ai-help-policy",
    version: "1",
  },
  {
    id: "dashboard-navigation",
    title: "운영 대시보드 사용법",
    route: "/",
    keywords: ["대시보드", "기능", "카드", "검색", "즐겨찾기", "최근", "그룹", "메뉴"],
    content:
      "운영 대시보드는 오늘 처리할 일과 업무 흐름을 먼저 보여준다. 기능명, 모델번호, 자연어 표현으로 필요한 도구를 검색할 수 있고 같은 목적의 기능은 업무 그룹으로 묶여 있다. 자주 쓰는 기능은 즐겨찾기에 두고 최근 사용 기능으로 다시 접근한다. 카드의 상태 배지와 안전 배지는 실제 실행 가능 여부와 주의 수준을 뜻하므로 버튼을 누르기 전에 확인한다.",
    source: "ops-center-dashboard",
    version: "1",
  },
  {
    id: "status-and-safety",
    title: "기능 상태와 안전 배지",
    route: null,
    keywords: ["사용 가능", "준비중", "점검 모드", "MVP", "실제 반영", "차단", "안전", "상태"],
    content:
      "사용 가능은 현재 운영 흐름에서 열어 사용할 수 있다는 뜻이다. 점검 모드는 입력과 적용 계획을 확인할 수 있지만 실제 외부 시스템 반영이 차단될 수 있다. MVP 또는 실행기 뼈대는 일부 단계가 수동이거나 외부 엔진 결과를 연결하는 형태일 수 있다. 실제 가격·재고·주문이 바뀌는 기능은 실행 전 미리보기, 대상 건수, 실패 중단 조건을 먼저 확인한다.",
    source: "ops-center-safety-status",
    version: "1",
  },
  {
    id: "product-launch-workflow",
    title: "신규 상품 출시 기본 흐름",
    route: "/product-launch-tracker",
    keywords: ["신규 상품", "출시", "진행관리", "상세페이지", "키워드", "샵플링", "마켓 등록", "되돌리기", "중국 링크"],
    content:
      "신규 상품 출시 진행관리는 상품별 상세페이지, 가격·키워드, 샵플링 업로드, 마켓 등록, 주문 매핑, 재고 반영 상태를 기록한다. 상품 상세의 공통 링크는 발주와 상세페이지 제작에 함께 쓰인다. 용도별 링크를 입력하면 공통 칸이 비활성화되어 발주 초안에는 발주용 링크, 상세페이지 생성에는 제작용 링크가 사용된다. 발주 후보 링크는 입력 순서대로 보관한다. 샵플링에서 잘못 등록한 상품을 직접 삭제한 경우에는 재출시 되돌리기 기능으로 출시 단계를 초기화한 뒤 처음부터 다시 진행한다. 여러 행은 체크 후 일괄 되돌리기를 사용한다.",
    source: "product-launch-tracker-guide",
    version: "1",
  },
  {
    id: "purchase-order-workflow",
    title: "발주 추천과 중국 주문 흐름",
    route: null,
    keywords: ["발주", "발주 추천", "발주·단종 추천", "추천", "발주안 확정", "중국 주문", "주문 시트", "예산", "배송대행지"],
    content:
      "발주 추천은 같은 바코드의 실행 시점 최신 판매량, 상품마스터의 확인된 추정재고, 중국 주문초안·실주문 중 아직 입고되지 않은 수량을 반영해 신규 주문 필요량을 처음부터 다시 계산한다. 대상 행을 확인하고 발주안 확정을 누르면 중국 발주·입고 관리의 주문 준비 목록으로 넘긴다. 확정은 주문 준비 단계이며 실제 1688 주문·결제와 동일하지 않다. 단종후보와 상품등급 판단은 상품등급·가격조정에서 담당하며, 그림자 운영 중에는 -3·-4 등급도 발주를 실제 차단하지 않는다.",
    source: "purchase-order-workflow-guide",
    version: "1",
  },
  {
    id: "receiving-workflow",
    title: "입고 수량 확인 흐름",
    route: "/china-order-manager",
    keywords: ["입고", "정상입고", "누락", "불량", "수량", "일괄 전체 정상입고", "입고 확정"],
    content:
      "중국 발주·입고 관리에서 대부분 정상 수량으로 도착했다면 일괄 전체 정상입고로 주문수량을 실제 입고수량에 채운다. 일부 누락 또는 불량이 있으면 해당 행의 실제 수량만 수정한다. 주문수량과 실제 수량이 다르면 미확인 건으로 표시되며 차이를 확인했다는 절차를 거친 뒤 입고를 확정한다. 입고 확정 전에 누락·불량 기록과 옵션별 수량을 다시 확인한다.",
    source: "receiving-workflow-guide",
    version: "1",
  },
  {
    id: "price-adjustment-workflow",
    title: "상품등급·가격조정과 실행기 구분",
    route: null,
    keywords: ["상품등급", "등급", "가격", "인상", "인하", "입고원가", "판매추이", "시즌", "단종후보", "가격정책", "옵션추가금", "캐시"],
    content:
      "상품등급·가격조정은 확정 입고원가와 바코드별 3개월 판매강도를 분석하고 숨은 시즌을 자동 판별해 +6~-4 등급, 등급 목표가격, -3~-4 재고정리 상태를 제안한다. -1·-2는 가격을 유지하며 관찰하고, -3부터 단종후보 재고정리를 시작한다. 초기 그림자 운영에서는 실제 가격변경과 재발주 차단을 하지 않는다. 샵플링 쇼핑몰별 가격정책 적용기는 goods_key 기준의 지정 가격정책을 실제 채널 가격에 적용하고, 샵플링 판매가 인상·인하 실행기는 입력한 조정률을 판매가와 옵션추가금에 함께 적용한다. 분석과 실제 반영 버튼을 구분한다.",
    source: "price-adjustment-guide",
    version: "1",
  },
  {
    id: "warehouse-code-workflow",
    title: "창고 위치코드와 바코드",
    route: "/warehouse-location-sync",
    keywords: ["위치코드", "바코드", "옵션자체관리코드", "CA열", "모델번호", "창고", "샵플링"],
    content:
      "창고 위치코드는 옵션자체관리코드와 옵션바코드에 동일하게 넣는 운영 기준을 사용한다. 실재고 사전에서는 위치코드를 CA열에서 읽고, 옵션이 여러 개면 옵션 순서대로 쉼표로 구분한다. 창고 위치코드 관리가 점검 모드인 경우 추천과 적용 계획을 확인할 수 있지만 실제 샵플링 반영은 차단될 수 있으므로 상태 배지를 확인한다. 빈 위치코드는 단종 옵션 또는 아직 배정하지 않은 옵션인지 먼저 확인한다.",
    source: "warehouse-code-guide",
    version: "1",
  },
  {
    id: "detail-page-workflow",
    title: "상세페이지 스튜디오 사용 기준",
    route: null,
    keywords: ["상세페이지", "1688 링크", "이미지", "대표이미지", "재생성", "검수", "상품 분석"],
    content:
      "상세페이지 스튜디오는 이미지 직접 입력형과 1688 링크형을 구분해 사용한다. 링크형은 수집된 상품명, 속성, 상세 이미지를 기준으로 상품 정체성을 분석하고, 이미지 직접 입력형은 제공한 이미지와 상품정보를 기준으로 만든다. 생성 결과가 상품 형태·옵션·수량을 왜곡하거나 근거 없는 효능을 포함하면 재생성 전에 입력 자료를 보완한다. 오류가 발생한 경우 화면을 새로고침하기 전에 오류 종류와 기술 상세를 복사해 두는 것이 좋다.",
    source: "detail-page-studio-guide",
    version: "1",
  },
];

export function normalizeOpsHelpText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOpsHelpActionRequest(questionValue: unknown) {
  const question = normalizeOpsHelpText(questionValue);
  if (!question) return false;
  if (EXPLANATION_PATTERNS.some((pattern) => pattern.test(question))) {
    return false;
  }
  return ACTION_REQUEST_PATTERNS.some((pattern) => pattern.test(question));
}

function tokenize(value: string) {
  return normalizeOpsHelpText(value)
    .toLocaleLowerCase("ko-KR")
    .match(/[0-9a-z가-힣_-]{2,}/g) ?? [];
}

function routeAffinity(sectionRoute: string | null, pathname: string) {
  if (!sectionRoute || !pathname) return 0;
  if (sectionRoute === pathname) return 18;
  if (sectionRoute !== "/" && pathname.startsWith(sectionRoute)) return 12;
  return 0;
}

export function selectOpsAiKnowledge(
  questionValue: unknown,
  page: Partial<OpsAiPageContext> = {},
  sections: readonly OpsAiKnowledgeSection[] = STATIC_OPS_AI_KNOWLEDGE,
  limit = 6,
) {
  const question = normalizeOpsHelpText(questionValue);
  const pathname = normalizeOpsHelpText(page.pathname);
  const title = normalizeOpsHelpText(page.title);
  const queryTokens = new Set(tokenize(`${question} ${title} ${pathname}`));

  return sections
    .map((section, index) => {
      const haystack = tokenize(
        `${section.title} ${section.keywords.join(" ")} ${section.content} ${section.route ?? ""}`,
      );
      let score = routeAffinity(section.route, pathname);
      for (const token of haystack) {
        if (queryTokens.has(token)) score += 2;
      }
      if (question && section.content.includes(question)) score += 10;
      if (section.id === "assistant-boundary") score += 1;
      return { section, score, index };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.section);
}
