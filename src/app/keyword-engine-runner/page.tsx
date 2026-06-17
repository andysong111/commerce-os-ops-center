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
        title="Keyword Engine Runner"
        description="Dispatch keyword-engine dry-run workflows and review generated artifacts in OPS CENTER."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="This runner dispatches the external keyword-engine repo. It does not run local PowerShell, does not call Shopling, and does not auto-apply keywords."
        reviewButtonLabel="Open Keyword Review / Approval Queue"
        fields={[
          { name: "goods_keys", label: "goods_key or goods_keys", placeholder: "e.g. BATH001 or BATH001,BATH002" },
          { name: "seed_keyword", label: "Seed keyword", placeholder: "e.g. bath towel" },
        ]}
      />
    </>
  );
}
