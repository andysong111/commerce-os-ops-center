import { DetailPageLocalRunner } from "@/components/local-ops/DetailPageLocalRunner";
import { PageHeader } from "@/components/PageHeader";

export default function DetailPageLocalRunnerPage() {
  return <><PageHeader title="상세페이지 엔진" description="승준컴 로컬 브릿지를 통해 1688 상품 링크 기반 상세페이지 JPG/HTML 생성을 실행합니다." /><DetailPageLocalRunner mode="source-link" /></>;
}
