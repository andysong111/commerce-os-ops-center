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
        description="키워드 엔진 검토용 실행을 요청하고 생성 결과물을 OPS CENTER에서 검토합니다."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="이 실행기는 외부 keyword-engine repo에 실행만 요청합니다. 로컬 PowerShell을 실행하지 않고, Shopling을 호출하지 않으며, 키워드를 자동 반영하지 않습니다. 사람의 검토가 반드시 필요합니다."
        reviewButtonLabel="키워드 검토/승인 큐 열기"
        fields={[
          { name: "goods_keys", label: "상품번호(goods_key)", placeholder: "예: BATH001 또는 BATH001,BATH002", helpText: "하나 또는 여러 개 입력할 수 있습니다. 여러 개는 쉼표로 구분합니다." },
          { name: "seed_keyword", label: "시드 키워드(선택)", placeholder: "비워두어도 됩니다", helpText: "비워두면 키워드 엔진이 goods_key 기준으로 상품 정보를 읽어 자동으로 진행합니다.", advanced: true },
        ]}
      />
    </>
  );
}
