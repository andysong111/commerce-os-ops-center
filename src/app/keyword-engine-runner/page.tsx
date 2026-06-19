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
        title="키워드 엔진 실행"
        description="goods_key로 키워드 엔진 드라이런을 요청하고 생성된 산출물을 OPS CENTER에서 검수합니다."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="외부 keyword-engine 저장소의 GitHub Actions만 실행합니다. OPS CENTER는 로컬 PowerShell을 실행하지 않고, Shopling을 호출하지 않으며, 키워드를 자동 적용하지 않습니다."
        reviewButtonLabel="키워드 검수 / 승인 큐 열기"
        fields={[
          { name: "goods_key", label: "goods_key (필수)", placeholder: "예: BATH001 또는 BATH001,BATH002" },
          { name: "seed_keyword", label: "seed_keyword (선택)", placeholder: "예: 욕실 수건" },
        ]}
      />
    </>
  );
}
