import { PageHeader } from "@/components/PageHeader";
import { DomeggookPeriodExtensionHistoryCard } from "@/components/domeggook-period-extension/DomeggookPeriodExtensionHistoryCard";

export default function DomeggookPeriodExtensionPage() {
  return (
    <>
      <PageHeader
        eyebrow="COMMERCE OS · 판매채널 유지관리"
        title="도매꾹 상품 기간연장"
        description="계정·시간·연장기간을 설정하고 로컬 Windows 예약 실행과 최근 검증 결과를 관리합니다."
      />
      <DomeggookPeriodExtensionHistoryCard />
    </>
  );
}
