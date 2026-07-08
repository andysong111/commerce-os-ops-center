import { PageHeader } from "@/components/PageHeader";
import { SourcingCockpitClient } from "@/components/sourcing/SourcingCockpitClient";

export default function SourcingEngineCockpitPage() {
  return (
    <>
      <PageHeader
        title="1688 소싱엔진"
        description="1688 후보 링크를 붙여넣으면 주문추천 카드를 만듭니다. 상품명만 입력하는 자동 1688 탐색은 준비 중입니다."
      />
      <SourcingCockpitClient />
    </>
  );
}
