import { detailPageSaasTest260807Module } from "@/lib/detailPageSaasTest260807Module";
import { detailPageSaasTestModule } from "@/lib/detailPageSaasTestModule";
import { DETAIL_PAGE_V3_BASELINE_NOTE } from "@/lib/detailPageV3ProductionBaseline";
import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";
import { fastPurchaseMvpModule } from "@/lib/fastPurchaseMvpModule";
import { keywordEngineElonLabModule } from "@/lib/keywordEngineElonLabModule";
import { legacySeoBulkCloudModule } from "@/lib/legacySeoBulkCloudModule";
import { reliabilityLearningModule } from "@/lib/reliabilityLearningModule";
import { seoTitleCloudShoplingRunnerModule } from "@/lib/seoTitleCloudShoplingRunnerModule";
import { shoplingSeoDispatchModule } from "@/lib/shoplingSeoDispatchModule";
import type { CommerceModule } from "@/lib/moduleRegistry";

const inventoryStockOperationsModule: CommerceModule = {
  id: "inventory-stock-operations",
  title: "재고·품절·판매재개",
  navigationLabel: "재고·품절·판매재개",
  description:
    "창고에서 품절을 확인한 B코드와 재입고·실사 수량만 입력하면 이후 입고·판매를 반영해 현재 재고와 판매상태를 자동 판단합니다.",
  status: "available",
  route: "/china-order-manager/stock-control",
  category: "발주·입고 관리",
  inputType: "품절 B코드, 재입고·실사 현재수량",
  outputType: "현재 재고, 품절·판매중 자동판단, 반영 대기·확인 필요 상태",
  historySupport: true,
  externalProject: false,
  note: "내부 Shopling 화면번호와 기술 경로는 기본 운영화면에서 숨기고 실제 작업에 필요한 상태와 행동만 표시합니다.",
  helperNote: "B코드 중심 · 자동판단",
  actionLabel: "재고 운영 열기",
  safetyBadge: "실물확인 기준",
};

const isolatedBaseModules: readonly CommerceModule[] = extendedModuleRegistry.map(
  (module) => {
    if (module.id === "sourcing-engine") {
      return {
        ...module,
        title: "소싱센터",
        navigationLabel: "소싱센터",
        description:
          "1688 후보 수집부터 한국 수요, 실제 공급상품·SKU, 수익성, 시장가격, AI 상세페이지 사전검사, 소액 테스트 발주까지 전체 소싱 순서를 한 화면에서 확인하고 필요한 단계로 바로 이동합니다.",
        route: "/sourcing-center",
        category: "소싱",
        inputType: "1688 후보, NAVER 수요, 실제 공급상품·SKU, 계획원가, 한국 시장가격, AI 상세페이지 검사결과",
        outputType: "현재 다음 행동, 단계별 통과·탈락 흐름, TEST_READY까지의 전체 소싱 진행상태",
        historySupport: true,
        externalProject: false,
        note: "소싱엔진의 실제 계산·검증 화면은 독립 Production에서 실행하고, OPS Center 소싱센터는 쉬운 용어의 통합 입구와 현재 다음 행동을 제공합니다.",
        helperNote: "전체 소싱 흐름 · 한눈에 보기",
        actionLabel: "소싱센터 열기",
        safetyBadge: "TEST_READY 전 실제 발주 없음",
      };
    }
    if (module.id !== "detail-page-studio") return module;
    return {
      ...module,
      title: "Commerce OS Detail Page Studio · SaaS 전용 · Production",
      navigationLabel: "상세페이지 스튜디오 · SaaS 전용",
      description:
        "외부 고객용 standalone SaaS Production입니다. 입력부만 1688 링크·브라우저 가져오기 또는 이미지 업로드로 분리하고, 상세페이지와 대표·부가 이미지 생성 과정은 상품출시진행관리 OPS source-first-v3 기준을 사용합니다.",
      route: "https://commerce-os-detail-page-saas.vercel.app/",
      inputType:
        "1688 링크·브라우저 가져오기 또는 제품 이미지 3~60장, 실제 판매 옵션, 문구 언어",
      outputType:
        "OPS source-first-v3 상세페이지 1000×14000 JPG, 대표 1장·부가 4장, 사용자 작업 원장과 결과 6개 저장",
      note: `${DETAIL_PAGE_V3_BASELINE_NOTE} 이 카드는 standalone SaaS Production을 엽니다. 내부 상품출시진행관리 연결본과 테스트 Studio 주소는 변경하지 않습니다.`,
      helperNote: "Standalone SaaS Production · OPS V3",
      actionLabel: "SaaS Production 열기",
      safetyBadge: "내부 OPS와 분리",
    };
  },
);

export const opsModuleRegistry: readonly CommerceModule[] = [
  reliabilityLearningModule,
  inventoryStockOperationsModule,
  ...isolatedBaseModules,
  legacySeoBulkCloudModule,
  keywordEngineElonLabModule,
  seoTitleCloudShoplingRunnerModule,
  shoplingSeoDispatchModule,
  fastPurchaseMvpModule,
  detailPageSaasTestModule,
  detailPageSaasTest260807Module,
];
