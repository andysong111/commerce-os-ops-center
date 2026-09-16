import { ProductMasterSyncButton } from "@/components/product-launch-flow/ProductMasterSyncButton";

const PRODUCT_LAUNCH_ASSET_VERSION =
  "20260815-bidirectional-purchase-metadata-v1-20260824-option-barcode-no-registry-v1-seo-bulk-cloud-v3-perf-seo-bulk-parallel-v1-detail-stability-v1-numeric-option-barcode-v1-two-stage-workflow-v1-manual-option-authority-v1-manual-price-verify-v1-workflow-snapshot-recovery-v1-seo-cache-fallback-v1-source-chain-20260916-v1";

export default async function ProductLaunchTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ detailPageItem?: string | string[] }>;
}) {
  const resolved = await searchParams;
  const itemId = Array.isArray(resolved.detailPageItem)
    ? resolved.detailPageItem[0]
    : resolved.detailPageItem;
  const iframeParams = new URLSearchParams({
    detail_page_mode: "client",
    asset_version: PRODUCT_LAUNCH_ASSET_VERSION,
  });
  if (itemId) iframeParams.set("open_item", itemId.slice(0, 160));

  return (
    <section className="space-y-3">
      <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
        <strong className="block text-sm">백그라운드 자동화 · 상품마스터와 분리 운영</strong>
        <span className="mt-1 block text-xs leading-5">
          활성 출시 단계는 상세페이지와 샵플링 업로드 두 단계만 사용합니다. 가격정책·SEO·마켓 후속처리는 각 전용 엔진에서 독립적으로 실행됩니다.
        </span>
        <span className="mt-1 block text-xs opacity-80">
          상품마스터 조회와 자동화 실행을 분리해 한쪽의 지연이 다른 쪽의 화면 사용을 막지 않도록 운영합니다.
        </span>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <strong className="block text-sm text-violet-950">SEO 대량등록 클라우드 연결</strong>
          <span className="mt-1 block text-xs leading-5 text-violet-800">
            목록에서 상품을 여러 개 선택한 뒤 ‘SEO 대량등록 클라우드 열기’를 누르면 선택상품을 병렬 분석해 상품별 FINAL 검색어 10개와 쇼핑몰별 상품명을 만들고, 같은 화면에서 Shopling 일괄 대량등록까지 실행합니다.
          </span>
        </div>
        <a href="/seo-bulk-cloud" className="rounded-lg bg-violet-700 px-4 py-2 text-center text-sm font-black text-white">
          SEO 대량등록 클라우드
        </a>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <strong className="block text-sm text-slate-950">상품마스터 기준정보 동기화</strong>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            저장된 출시상품·B-code·옵션바코드NO·샵플링 goods_key와 최근 확정 입고원가를 독립 상품마스터로 보냅니다.
          </span>
        </div>
        <ProductMasterSyncButton />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <iframe
          id="product-launch-tracker-frame"
          title="상품마스터 · 출시관리"
          src={`/product-launch-tracker-app/index.html?${iframeParams.toString()}`}
          allow="local-network; loopback-network; local-network-access"
          className="h-[calc(100vh-10rem)] min-h-[720px] w-full border-0"
        />
      </div>
    </section>
  );
}
