import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SourcingCardsClient } from "@/components/sourcing/SourcingCardsClient";

export default function SourcingCardsPage() {
  return (
    <>
      <PageHeader
        title="소싱 추천 카드 이력"
        description="생성한 추천 카드를 모아 비교하는 화면입니다. 현재는 브라우저 저장소의 카드 데이터를 읽습니다."
        actions={
          <Link
            href="/sourcing-engine/importer"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            카드 만들기
          </Link>
        }
      />
      <SourcingCardsClient />
    </>
  );
}
