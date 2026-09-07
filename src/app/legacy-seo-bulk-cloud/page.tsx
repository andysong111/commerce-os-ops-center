import Link from "next/link";
import LegacySeoBulkCloudClient from "./LegacySeoBulkCloudClient";
import LegacySeoBulkSelectEnhancer from "./LegacySeoBulkSelectEnhancer";

export const dynamic = "force-dynamic";

export default function LegacySeoBulkCloudPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">
                이전상품 전용
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                기존 SEO 클라우드와 작업원장 분리
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              이전상품 상품등록SEO 클라우드
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Commerce OS 이전에 Shopling에 수동 등록해 둔 상품 전용입니다. 1688 링크가
              정상 수집되면 1688 원본과 Shopling 기존 상품명·검색어를 함께 사용하고,
              링크가 없거나 수집에 실패하면 Shopling 데이터를 원본으로 대체해 기존 V8
              SEO 엔진을 실행합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-launch-tracker"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
            >
              상품출시 진행관리
            </Link>
            <Link
              href="/seo-bulk-cloud"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
            >
              기존 상품등록 SEO 클라우드
            </Link>
          </div>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">1688 정상</div>
            <div className="mt-1 font-semibold">1688 + Shopling 병합</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              중국 원본의 정체성과 기존 판매용 한국 상품명·검색어를 함께 사용합니다.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">1688 불량/없음</div>
            <div className="mt-1 font-semibold">Shopling-only fallback</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Product Master의 모델번호→goods_key 연결 후 Shopling 공식 API의 현재 데이터를 사용합니다.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">출력</div>
            <div className="mt-1 font-semibold">V8 FINAL 29 + 10</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              금지키워드·정확성·수요 점수화는 현재 상품등록 SEO 엔진과 같은 로직을 재사용합니다.
            </p>
          </div>
        </div>

        <LegacySeoBulkSelectEnhancer />
        <LegacySeoBulkCloudClient />
      </div>
    </main>
  );
}
