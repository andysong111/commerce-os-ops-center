export type ModuleStatus = "available" | "preparing" | "runner_scaffold" | "disabled";

export type CommerceModule = {
  id: string;
  title: string;
  navigationLabel?: string;
  description: string;
  status: ModuleStatus;
  route: string | null;
  category: string;
  inputType: string;
  outputType: string;
  historySupport: boolean;
  externalProject: boolean;
  note: string | null;
  helperNote?: string;
  actionLabel?: string;
};

export const moduleRegistry: readonly CommerceModule[] = [
  {
    id: "china-order-cost",
    title: "중국주문 원가계산기",
    navigationLabel: "중국주문 원가계산",
    description:
      "중국 내 운임을 운임묶음/수량 기준으로 나누어 옵션별 원가에 반영합니다.",
    status: "available",
    route: "/china-orders",
    category: "원가 관리",
    inputType: "주문 및 운임 원가 데이터",
    outputType: "배분된 상품 원가",
    historySupport: false,
    externalProject: false,
    note: null,
  },
  {
    id: "product-master",
    title: "상품 마스터",
    navigationLabel: "상품 마스터",
    description: "상품코드, 모델명, 옵션, 바코드 연결 정보를 한곳에서 관리합니다.",
    status: "available",
    route: "/product-master",
    category: "상품 관리",
    inputType: "상품 및 옵션 데이터",
    outputType: "상품 마스터 기록",
    historySupport: true,
    externalProject: false,
    note: null,
  },
  {
    id: "freight-barcode-pdf",
    title: "배대지 바코드 PDF 생성기",
    navigationLabel: "배대지 바코드 PDF 생성기",
    description:
      "배송대행지 신청서 텍스트를 파싱해 작업요청서와 바코드/원산지 라벨 PDF를 생성합니다.",
    status: "available",
    route: "/freight-barcode-request",
    category: "배대지 운영",
    inputType: "배송대행지 신청서 텍스트",
    outputType: "바코드/원산지 라벨 작업요청서 PDF",
    historySupport: true,
    externalProject: false,
    note: "기존 배대지 바코드 작업요청서 흐름을 사용합니다.",
  },
  {
    id: "keyword-engine",
    title: "키워드 엔진 실행기",
    navigationLabel: "키워드 엔진 실행기",
    description:
      "샵플링 상품코드(goods_key) 기준으로 외부 키워드 엔진을 실행하고 결과 산출물을 가져옵니다.",
    status: "runner_scaffold",
    route: "/keyword-engine-runner",
    category: "판매 콘텐츠 자동화",
    inputType: "상품 및 판매채널 데이터",
    outputType: "정리된 키워드 묶음",
    historySupport: false,
    externalProject: true,
    note: "외부 keyword-engine-soon 저장소의 GitHub Actions를 통해서만 실행합니다.",
    helperNote: "외부 엔진 실행 가능",
  },
  {
    id: "keyword-review-queue",
    title: "키워드 검토/승인 큐",
    navigationLabel: "키워드 검토/승인 큐",
    description:
      "키워드 엔진 결과물을 불러와 자동/수동/차단 항목을 검토하고, 안전한 미리보기 데이터를 생성합니다.",
    status: "available",
    route: "/keyword-review-queue",
    category: "keyword",
    inputType: "keyword-engine-soon CSV/Markdown 산출물",
    outputType: "검토된 키워드 승인 데이터",
    historySupport: false,
    externalProject: true,
    note: "승인 행 payload/XML 미리보기만 포함합니다. 실제 Shopling API 실행은 없습니다. 이력 관리는 향후 제공 예정입니다.",
    helperNote: "현재 사용 가능",
  },
  {
    id: "detail-page-engine",
    title: "상세페이지 엔진 실행기",
    navigationLabel: "상세페이지 엔진 실행기",
    description:
      "1688 상품 링크 기준으로 외부 상세페이지 엔진을 실행하고 HTML/JSON 산출물을 가져옵니다.",
    status: "runner_scaffold",
    route: "/detail-page-engine-runner",
    category: "detail-page",
    inputType: "상품 정보",
    outputType: "상세페이지 기획안 및 판매 문구",
    historySupport: false,
    externalProject: true,
    note: "외부 product-detail-page-auto 저장소의 GitHub Actions를 통해서만 실행합니다.",
    helperNote: "외부 엔진 실행 가능",
  },
  {
    id: "detail-page-draft-review",
    title: "상세페이지 초안 검수 / 미리보기",
    navigationLabel: "상세페이지 초안 검수 / 미리보기",
    description:
      "상세페이지 엔진 산출물 HTML과 리포트를 불러와 검수하고 미리보기합니다.",
    status: "available",
    route: "/detail-page-draft-review",
    category: "detail-page",
    inputType: "product-detail-page-auto HTML/JSON 산출물",
    outputType: "검토된 상세페이지 초안 후보",
    historySupport: false,
    externalProject: true,
    note: "현재 사용 가능한 연동입니다. 직접 엔진 실행은 없습니다. 이력 관리는 향후 제공 예정입니다.",
    helperNote: "현재 사용 가능",
  },

  {
    id: "engine-runner-history",
    title: "엔진 실행 이력",
    navigationLabel: "엔진 실행 이력",
    description: "키워드/상세페이지 엔진 실행 요청과 결과물 가져오기 이력을 확인합니다.",
    status: "available",
    route: "/engine-runner-history",
    category: "판매 콘텐츠 자동화",
    inputType: "브라우저 로컬 실행/가져오기 메타데이터",
    outputType: "브라우저 로컬 엔진 실행 이력",
    historySupport: true,
    externalProject: false,
    note: "현재 이력은 이 브라우저에 저장됩니다.",
    helperNote: "사용 가능",
    actionLabel: "이력 보기",
  },
  {
    id: "inventory-price",
    title: "재고 / 가격 관리",
    description: "상품별 재고 수량과 채널별 가격을 관리합니다.",
    status: "preparing",
    route: null,
    category: "재고 운영",
    inputType: "재고 및 채널별 가격 데이터",
    outputType: "재고 및 가격 상태",
    historySupport: false,
    externalProject: false,
    note: "추후 제공",
  },
  {
    id: "shopling-api-automation",
    title: "샵플링 API 자동화",
    description: "검토·승인된 결과만 샵플링 API로 반영하는 실행 모듈입니다.",
    status: "preparing",
    route: null,
    category: "채널 자동화",
    inputType: "판매채널 운영 요청",
    outputType: "자동화 실행 결과",
    historySupport: false,
    externalProject: false,
    note: "추후 제공",
  },
];
