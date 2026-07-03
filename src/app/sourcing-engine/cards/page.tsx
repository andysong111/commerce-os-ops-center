import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export default function SourcingCardsPage() {
  return (
    <>
      <PageHeader
        title="소싱 추천 카드 이력"
        description="생성한 추천 카드를 모아 비교하는 화면입니다. 저장 기능은 다음 단계에서 카드 생성 화면과 연결합니다."
        actions={
          <Link
            href="/sourcing-engine/importer"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            카드 만들기
          </Link>
        }
      />
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">카드 이력 화면 준비 완료</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          다음 단계에서 추천 카드 저장, 후보 비교, JSON 내보내기를 연결합니다.
        </p>
      </section>
    </>
  );
}
