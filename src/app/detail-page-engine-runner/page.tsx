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
        description="1688 상품 링크로 검토용 상세페이지 생성을 요청하고 결과물을 OPS CENTER에서 검토합니다."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="이 실행기는 외부 detail-page engine repo에 실행만 요청합니다. OPS CENTER에서 1688/OpenAI/이미지 생성을 직접 호출하지 않고 상세페이지를 자동 게시하지 않습니다. 사람의 검토가 반드시 필요합니다."
        reviewButtonLabel="상세페이지 검토/미리보기 열기"
        fields={[
          { name: "source_link", label: "1688 상품 링크", placeholder: "https://detail.1688.com/...", helpText: "기본 실행은 이 링크 하나만 넣고 시작할 수 있습니다." },
          { name: "product_code", label: "상품코드(선택)", placeholder: "비워두면 자동 생성", helpText: "비워두면 OPS CENTER가 임시 상품코드를 자동 생성합니다.", advanced: true },
          { name: "source_links", label: "추가 참고 링크(선택)", type: "textarea", placeholder: "한 줄에 링크 하나씩", advanced: true },
          { name: "planning_point", label: "기획 포인트(선택)", advanced: true },
          { name: "option_info", label: "옵션 정보(선택)", advanced: true },
          { name: "target", label: "타깃 고객/용도(선택)", advanced: true },
        ]}
      />
    </>
  );
}
