import { PageHeader } from "@/components/PageHeader";
import { ShoplingProductUploadRunner } from "@/components/shopling-product-upload-runner/ShoplingProductUploadRunner";

export default function ShoplingProductUploadRunnerPage() {
  return (
    <>
      <PageHeader
        title="샵플링 상품등록 실행기"
        description="실재고 시트 행 번호를 입력해 shopling-product-upload-auto 외부 엔진을 실행합니다."
      />
      <ShoplingProductUploadRunner />
    </>
  );
}
