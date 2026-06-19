import { EngineRunnerConsole } from "@/components/engine-runners/EngineRunnerConsole";
import { PageHeader } from "@/components/PageHeader";
import {
  engineRunnerConfigs,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";

const config = engineRunnerConfigs.find(
  (runner) => runner.kind === "keyword_engine",
)!;

export default function KeywordEngineRunnerPage() {
  return (
    <>
      <PageHeader
        title="키워드 엔진 실행기"
        description="goods_key로 키워드 엔진 드라이런을 요청하고 생성된 산출물을 OPS CENTER에서 검수합니다."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="외부 keyword-engine 저장소의 GitHub Actions만 실행합니다. OPS CENTER는 로컬 PowerShell을 실행하지 않고, Shopling을 호출하지 않으며, 키워드를 자동 적용하지 않습니다."
        fields={[
          { name: "goods_key", label: "샵플링 상품코드(goods_key) 필수", placeholder: "예: 121059 또는 121059,121060" },
          { name: "seed_keyword", label: "시드 키워드(선택)", placeholder: "예: 욕실 수건", helpText: "비워두면 상품코드 기준으로 자동 진행합니다." },
        ]}
      />
    </>
  );
}
