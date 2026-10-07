import { PageHeader } from "@/components/PageHeader";
import { KeywordResearchClient } from "@/components/keyword-research/KeywordResearchClient";

export default function KeywordResearchPage() {
  return (
    <>
      <PageHeader
        eyebrow="KEYWORD INTELLIGENCE"
        title="키워드 조회"
        description="아이템스카우트처럼 키워드 수요와 경쟁을 빠르게 비교하고, 우리 키워드 엔진의 의미 적합성 Gate로 실제 상품·소싱에 쓸 후보를 골라냅니다."
      />
      <KeywordResearchClient />
    </>
  );
}
