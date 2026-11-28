import Link from "next/link";
import AiSaurusBulkDetailWorkbench from "./AiSaurusBulkDetailWorkbench";

export default async function AiSaurusBulkDetailPage({
  searchParams,
}: { searchParams: Promise<{ batch?: string | string[] }> }) {
  const { batch } = await searchParams;
  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-7 sm:px-6">
      <Link href="/product-launch-tracker" className="text-sm font-semibold text-blue-800 hover:underline">← 상품출시 진행관리</Link>
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900">AI 사우루스 상세페이지 일괄 제작</h1>
        <p className="mt-1 text-sm text-slate-600">2026년 8월 1일부터 확정 소싱한 신규상품을 수집하고 상품별 제작 결과를 검수합니다.</p>
      </header>
      <AiSaurusBulkDetailWorkbench key={typeof batch === "string" ? batch : "list"} batchId={typeof batch === "string" ? batch : ""} />
    </main>
  );
}
