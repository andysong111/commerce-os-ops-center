import { DetailPageLocalRunner } from "@/components/local-ops/DetailPageLocalRunner";
import { PageHeader } from "@/components/PageHeader";

export default function DetailPageImageUploadRunnerPage() {
  return <><PageHeader title="상세페이지 엔진 (이미지 업로드)" description="1688 페이지가 막힌 경우 업로드한 이미지로 로컬 상세페이지 엔진을 실행합니다." /><DetailPageLocalRunner mode="upload-images" /></>;
}
