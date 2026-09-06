import type { CommerceModule } from "@/lib/moduleRegistry";

export const legacySeoBulkCloudModule: CommerceModule = {
  id: "legacy-product-seo-bulk-cloud",
  title: "이전상품 상품등록SEO 클라우드",
  navigationLabel: "이전상품 상품등록SEO 클라우드",
  description:
    "Commerce OS 이전에 등록한 기존 상품 전용 SEO 등록 클라우드입니다. 살아있는 1688 링크는 Shopling 기존 상품명·검색어와 함께 사용하고, 1688 링크가 없거나 수집되지 않으면 Shopling 데이터를 원본으로 대체해 V8 SEO 상품명·검색어를 생성합니다.",
  status: "available",
  route: "/legacy-seo-bulk-cloud",
  category: "상품 등록 자동화",
  inputType:
    "상품출시 진행관리 이전상품, Product Master 모델번호→Shopling goods_key 연결, Shopling 기존 상품명·사이트검색어, 선택적 1688 링크",
  outputType:
    "이전상품 전용 SEO FINAL 상품명 29개·검색어 10개와 Shopling 6채널 신규 등록",
  historySupport: true,
  externalProject: false,
  note:
    "기존 상품등록 SEO 클라우드와 작업원장·API·화면을 분리합니다. 기존 /seo-bulk-cloud와 seo_run_jobs는 변경하지 않습니다.",
  helperNote: "이전상품 전용 · 1688 + Shopling / Shopling-only fallback",
  actionLabel: "이전상품 SEO 클라우드 열기",
  safetyBadge: "기존 SEO 클라우드와 분리",
};
