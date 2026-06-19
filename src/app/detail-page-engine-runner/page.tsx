import { EngineRunnerConsole } from "@/components/engine-runners/EngineRunnerConsole";
import { PageHeader } from "@/components/PageHeader";
import {
  engineRunnerConfigs,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";

const config = engineRunnerConfigs.find(
  (runner) => runner.kind === "detail_page_engine",
)!;

export default function DetailPageEngineRunnerPage() {
  return (
    <>
      <PageHeader
        title="상세페이지 엔진 실행기"
        description="source_link만으로 상세페이지 산출물 생성을 요청하고 OPS CENTER에서 검수합니다."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="외부 detail-page engine 저장소의 GitHub Actions만 실행합니다. OPS CENTER는 1688/OpenAI를 직접 호출하지 않고 상세페이지를 자동 게시하지 않습니다."
        fields={[
          { name: "source_link", label: "1688 상품 링크(필수)", placeholder: "대표 소스 URL" },
          { name: "product_code", label: "상품코드(선택, 비워두면 자동 생성)", placeholder: "예: BATH001 또는 비워두기" },
        ]}
      />
    </>
  );
}
