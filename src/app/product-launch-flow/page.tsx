import { PageHeader } from "@/components/PageHeader";
import { ProductLaunchFlow } from "@/components/product-launch-flow/ProductLaunchFlow";

export default function ProductLaunchFlowPage() {
  return (
    <>
      <PageHeader
        title="상품 출시 플로우"
        description="실재고 시트 행번호 기준으로 상품업로드, 가격설정, 상품명/키워드 준비 상태를 연결합니다."
      />
      <ProductLaunchFlow />
    </>
  );
}
