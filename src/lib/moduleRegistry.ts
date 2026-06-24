export type ModuleStatus =
  | "available"
  | "preparing"
  | "runner_scaffold"
  | "disabled";

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
    description:
      "상품코드, 모델명, 옵션, 바코드 연결 정보를 한곳에서 관리합니다.",
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
    id: "warehouse-label-generator",
    title: "창고 라벨 출력기",
    navigationLabel: "창고 라벨 출력기",
    description:
      "창고 위치코드를 CSV 또는 직접 입력으로 받아 50×30mm 롤지용 PDF 라벨을 생성합니다.",
    status: "available",
    route: "/warehouse-label-generator",
    category: "도구",
    inputType: "창고 위치코드 CSV 또는 줄바꿈 텍스트",
    outputType: "50×30mm 창고 위치코드 라벨 PDF",
    historySupport: false,
    externalProject: false,
    note: "Xprinter XP-DT108B 50×30mm 롤지 출력용 MVP입니다.",
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
    title: "키워드 결과 검토",
    navigationLabel: "키워드 결과 검토",
    description:
      "키워드 엔진 실행 후 가져온 결과물을 검토합니다. 보통은 키워드 엔진 실행기에서 ‘결과 가져오기 및 검토 시작’을 눌러 이동합니다.",
    status: "available",
    route: "/keyword-review-queue",
    category: "keyword",
    inputType: "keyword-engine-soon CSV/Markdown 산출물",
    outputType: "검토된 키워드 승인 데이터",
    historySupport: false,
    externalProject: true,
    note: "승인 행 payload/XML 미리보기만 포함합니다. 실제 Shopling API 실행은 없습니다. 이력 관리는 향후 제공 예정입니다.",
    helperNote: "후속 검토 단계",
    actionLabel: "검토 화면 열기",
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
    helperNote: "후속 검토 단계",
    actionLabel: "검토 화면 열기",
  },

  {
    id: "product-launch-flow",
    title: "상품 출시 플로우",
    navigationLabel: "상품 출시 플로우",
    description:
      "실재고 시트 행번호 기준으로 상품업로드, 가격설정, 상품명/키워드 준비 상태를 연결합니다.",
    status: "runner_scaffold",
    route: "/product-launch-flow",
    category: "채널 자동화",
    inputType: "실재고 시트 행 번호",
    outputType: "상품업로드, 가격설정, 상품명/키워드 준비 상태",
    historySupport: false,
    externalProject: true,
    note: "외부 엔진 실행 결과를 연결하는 MVP 흐름입니다. 마켓전송은 수동으로 진행합니다.",
    helperNote: "MVP 플로우",
    actionLabel: "플로우 열기",
  },

  {
    id: "shopling-product-upload-runner",
    title: "샵플링 상품등록 실행기",
    navigationLabel: "샵플링 상품등록 실행기",
    description:
      "실재고 시트 행 번호를 입력해 외부 상품등록 엔진을 실행합니다.",
    status: "runner_scaffold",
    route: "/shopling-product-upload-runner",
    category: "채널 자동화",
    inputType: "실재고 시트 행 번호 및 채널",
    outputType: "shopling-product-upload-auto 실행 결과",
    historySupport: false,
    externalProject: true,
    note: "로컬 shopling-product-upload-auto 엔진을 서버에서 직접 실행합니다.",
    helperNote: "실제 상품등록 실행",
    actionLabel: "실행기 열기",
  },

  {
    id: "shopling-price-modify-runner",
    title: "샵플링 쇼핑몰별 가격설정 실행기",
    navigationLabel: "샵플링 가격설정 실행기",
    description: "goods_key 기준으로 쇼핑몰별 가격설정을 실행합니다.",
    status: "runner_scaffold",
    route: "/shopling-price-modify-runner",
    category: "채널 자동화",
    inputType: "샵플링 goods_key",
    outputType: "shopling-price-modify-auto result_summary.json",
    historySupport: false,
    externalProject: true,
    note: "OPS Center는 GitHub Actions 실행과 결과 조회만 수행하며 샵플링을 직접 호출하지 않습니다.",
    helperNote: "실제 가격설정 실행",
    actionLabel: "실행기 열기",
  },

  {
    id: "engine-env-setup",
    title: "엔진 환경변수 설정",
    navigationLabel: "엔진 환경변수 설정",
    description:
      "키워드/상세페이지 엔진 실행에 필요한 GitHub Actions Secrets를 점검하고 설정합니다.",
    status: "available",
    route: "/engine-env-setup",
    category: "판매 콘텐츠 자동화",
    inputType: "GitHub Actions Secrets",
    outputType: "외부 엔진 환경변수 설정 상태",
    historySupport: false,
    externalProject: true,
    note: "Secret 값은 OPS CENTER에 저장하지 않습니다.",
    helperNote: "사용 가능",
    actionLabel: "환경변수 설정",
  },
  {
    id: "engine-runner-history",
    title: "엔진 실행 이력",
    navigationLabel: "엔진 실행 이력",
    description:
      "키워드/상세페이지 엔진 실행 요청과 결과물 가져오기 이력을 확인합니다.",
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
